import type { ChildProcess, SpawnOptions } from "node:child_process";
import { EventEmitter } from "node:events";
import { readFileSync } from "node:fs";
import { PassThrough } from "node:stream";

type FixtureLine = { direction: string; stream: string; line: string };
type JsonRecord = Record<string, unknown>;
type FakeProcessOptions = {
  startAtResume?: boolean;
  withoutCommandTiming?: boolean;
  withoutCommandStart?: boolean;
  planDecision?: "approve" | "adjust";
};

export type FakeCodexSpawn = ((
  command: string,
  args: string[],
  options: SpawnOptions,
) => ChildProcess) & {
  messages: JsonRecord[][];
  processes: Array<{ exitCode: number | null; signalCode: NodeJS.Signals | null }>;
};

/** Process-compatible Codex fake that consumes host JSON-RPC and replays captured fixtures. */
export function createFakeCodexSpawn(
  fixturePath: string,
  options: FakeProcessOptions = {},
): FakeCodexSpawn {
  const messages: JsonRecord[][] = [];
  const processes: FakeCodexProcess[] = [];
  const spawn = (() => {
    const recorded: JsonRecord[] = [];
    messages.push(recorded);
    const child = new FakeCodexProcess(fixturePath, { ...options, recorded });
    processes.push(child);
    return child as unknown as ChildProcess;
  }) as unknown as FakeCodexSpawn;
  spawn.messages = messages;
  spawn.processes = processes;
  return spawn;
}

class FakeCodexProcess extends EventEmitter {
  readonly stdin = new PassThrough();
  readonly stdout = new PassThrough();
  readonly stderr = new PassThrough();
  exitCode: number | null = null;
  signalCode: NodeJS.Signals | null = null;
  readonly #records: FixtureLine[];
  readonly #options: FakeProcessOptions & { recorded: JsonRecord[] };
  #cursor = 0;
  #pending = "";
  #turnStarts = 0;

  constructor(fixturePath: string, options: FakeProcessOptions & { recorded: JsonRecord[] }) {
    super();
    this.#options = options;
    this.#records = readFileSync(fixturePath, "utf8")
      .split(/\r?\n/)
      .filter(Boolean)
      .map((line) => JSON.parse(line) as FixtureLine);
    this.stdin.on("data", (chunk: Buffer) => this.#read(chunk.toString("utf8")));
  }

  kill(signal: NodeJS.Signals = "SIGTERM"): boolean {
    if (this.exitCode !== null || this.signalCode !== null) return false;
    this.signalCode = signal;
    this.#finish(null, signal);
    return true;
  }

  #read(chunk: string): void {
    this.#pending += chunk;
    let newline = this.#pending.indexOf("\n");
    while (newline >= 0) {
      const line = this.#pending.slice(0, newline);
      this.#pending = this.#pending.slice(newline + 1);
      this.#hostMessage(line);
      newline = this.#pending.indexOf("\n");
    }
  }

  #hostMessage(line: string): void {
    let value: JsonRecord;
    try {
      const parsed: unknown = JSON.parse(line);
      if (!isRecord(parsed)) throw new Error("Formato inesperado.");
      value = parsed;
    } catch {
      this.#fail("JSON inválido do host.");
      return;
    }
    this.#options.recorded.push(value);
    const expectedRecord = this.#nextExpectedHostRecord(value);
    if (!expectedRecord) return;
    const expected = parseFixture(expectedRecord.line);
    if (expected.method !== value.method) {
      this.#fail(
        `Método inesperado: ${String(value.method)}; fixture esperava ${String(expected.method)}.`,
      );
      return;
    }
    const paramsMatch =
      this.#options.planDecision === "adjust" &&
      this.#turnStarts > 0 &&
      expected.method === "turn/start"
        ? matchesAdjustmentTurn(expected.params, value.params)
        : expected.method === "turn/start"
          ? matchesTurnStart(expected.params, value.params)
          : expected.method === "initialize"
            ? deepEqual(
                isRecord(expected.params) ? expected.params.capabilities : undefined,
                isRecord(value.params) ? value.params.capabilities : undefined,
              )
            : expected.method === "thread/start"
              ? deepEqual(omitPolicy(expected.params), omitPolicy(value.params))
              : deepEqual(expected.params ?? {}, value.params ?? {});
    if (!paramsMatch) {
      this.#fail(`Parâmetros de ${String(value.method)} não correspondem à fixture.`);
      return;
    }
    const isAdjustmentTurn = value.method === "turn/start" && this.#turnStarts > 0;
    if (value.method === "turn/start") this.#turnStarts += 1;
    if (expected.method === undefined) {
      if (!deepEqual(expected.result ?? {}, value.result ?? {})) {
        this.#fail("A resposta JSON-RPC do host não corresponde à fixture.");
        return;
      }
    }
    if (this.#options.planDecision === "adjust" && isAdjustmentTurn) {
      this.#pump(value.id, true);
      this.#replayPlan();
    } else this.#pump(value.id);
  }

  #replayPlan(): void {
    const firstTurnStart = this.#records.findIndex((record) => {
      if (record.direction !== "in" || record.stream !== "stdout") return false;
      return parseFixture(record.line).method === "turn/started";
    });
    const firstTurnComplete = this.#records.findIndex((record, index) => {
      if (index <= firstTurnStart || record.direction !== "in" || record.stream !== "stdout")
        return false;
      return parseFixture(record.line).method === "turn/completed";
    });
    for (const record of this.#records.slice(firstTurnStart, firstTurnComplete + 1)) {
      if (record.direction !== "in" || record.stream !== "stdout") continue;
      const message = parseFixture(record.line);
      const planId = `karont-adjusted-plan-${this.#turnStarts}`;
      if (
        (message.method === "item/started" || message.method === "item/completed") &&
        isRecord(message.params) &&
        isRecord(message.params.item) &&
        message.params.item.type === "plan"
      )
        message.params.item.id = planId;
      if (message.method === "item/plan/delta" && isRecord(message.params))
        message.params.itemId = planId;
      this.stdout.write(`${JSON.stringify(message)}\n`);
    }
  }

  #nextExpectedHostRecord(actual: JsonRecord): FixtureLine | undefined {
    let record = this.#records[this.#cursor];
    if (
      this.#options.startAtResume &&
      actual.method === "thread/resume" &&
      record &&
      parseFixture(record.line).method !== "thread/resume"
    ) {
      const resumeIndex = this.#records.findIndex(
        (candidate, index) =>
          index >= this.#cursor &&
          candidate.direction === "out" &&
          candidate.stream === "stdin" &&
          parseFixture(candidate.line).method === "thread/resume",
      );
      if (resumeIndex >= 0) this.#cursor = resumeIndex;
      this.#options.startAtResume = false;
      record = this.#records[this.#cursor];
    }
    if (record?.direction !== "out" || record.stream !== "stdin") {
      this.#fail(
        `A fixture não contém a saída do host ${String(actual.method ?? "resposta")} nesta posição.`,
      );
      return undefined;
    }
    this.#cursor += 1;
    return record;
  }

  #pump(hostRequestId: unknown, stopAfterResponse = false): void {
    while (this.#cursor < this.#records.length) {
      const record = this.#records[this.#cursor];
      if (!record) return;
      if (record.direction === "out" && record.stream === "stdin") return;
      this.#cursor += 1;
      if (record.direction === "stderr") this.stderr.write(`${record.line}\n`);
      else if (record.direction === "in" && record.stream === "stdout") {
        const message = parseFixture(record.line);
        if (
          this.#options.withoutCommandStart &&
          message.method === "item/started" &&
          isRecord(message.params) &&
          isRecord(message.params.item) &&
          message.params.item.type === "commandExecution"
        )
          continue;
        if (
          this.#options.withoutCommandTiming &&
          (message.method === "item/started" || message.method === "item/completed") &&
          isRecord(message.params) &&
          isRecord(message.params.item) &&
          message.params.item.type === "commandExecution"
        ) {
          delete message.params.item.startedAtMs;
          delete message.params.item.completedAtMs;
          delete message.params.item.durationMs;
        }
        if (message.method === undefined && message.id !== undefined && hostRequestId !== undefined)
          message.id = hostRequestId;
        this.stdout.write(`${JSON.stringify(message)}\n`);
        if (stopAfterResponse && message.method === undefined && message.id === hostRequestId)
          return;
      }
    }
  }

  #fail(message: string): void {
    this.stderr.write(`fake codex: ${message}\n`);
    this.#finish(2, null);
  }

  #finish(code: number | null, signal: NodeJS.Signals | null): void {
    if (this.exitCode !== null || (this.signalCode !== null && signal === null)) return;
    if (signal === null) this.exitCode = code;
    this.stdin.end();
    this.stdout.end();
    this.stderr.end();
    let streamsClosed = 0;
    const onStreamClose = () => {
      streamsClosed += 1;
      if (streamsClosed === 3) this.emit("close", this.exitCode, signal);
    };
    this.stdin.once("close", onStreamClose);
    this.stdout.once("close", onStreamClose);
    this.stderr.once("close", onStreamClose);
    queueMicrotask(() => this.emit("exit", this.exitCode, signal));
  }
}

function matchesAdjustmentTurn(expected: unknown, actual: unknown): boolean {
  if (!isRecord(expected) || !isRecord(actual)) return false;
  const expectedThreadId = expected.threadId;
  const actualMode = isRecord(actual.collaborationMode) ? actual.collaborationMode.mode : undefined;
  return (
    actual.threadId === expectedThreadId &&
    actualMode === "plan" &&
    Array.isArray(actual.input) &&
    actual.input.length === 1 &&
    isRecord(actual.input[0]) &&
    typeof actual.input[0].text === "string"
  );
}

function matchesTurnStart(expected: unknown, actual: unknown): boolean {
  if (!isRecord(expected) || !isRecord(actual)) return false;
  const { input: expectedInput, ...expectedParams } = expected;
  const { input: actualInput, ...actualParams } = actual;
  if (!Array.isArray(expectedInput) || !Array.isArray(actualInput) || actualInput.length < 1)
    return false;
  if (!deepEqual(expectedParams, actualParams) || !deepEqual(expectedInput[0], actualInput[0]))
    return false;
  return actualInput
    .slice(1)
    .every(
      (item) =>
        isRecord(item) &&
        ((item.type === "text" && typeof item.text === "string") ||
          (item.type === "localImage" && typeof item.path === "string")),
    );
}

function isRecord(value: unknown): value is JsonRecord {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function parseFixture(line: string): JsonRecord {
  return JSON.parse(line) as JsonRecord;
}

function deepEqual(left: unknown, right: unknown): boolean {
  return JSON.stringify(left) === JSON.stringify(right);
}

function omitPolicy(value: unknown): unknown {
  if (!isRecord(value)) return value;
  const { sandbox: _sandbox, approvalPolicy: _approvalPolicy, ...params } = value;
  return params;
}
