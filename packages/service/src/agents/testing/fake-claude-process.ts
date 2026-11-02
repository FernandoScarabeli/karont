import type { ChildProcess, SpawnOptions } from "node:child_process";
import { EventEmitter } from "node:events";
import { readFileSync } from "node:fs";
import { PassThrough } from "node:stream";

type FixtureLine = { direction: string; stream: string; line: string };
type FakeClaudeOptions = {
  exitAfterResult?: boolean;
  planDecision?: "approve" | "adjust";
};

export type FakeClaudeSpawn = ((
  command: string,
  args: string[],
  options: SpawnOptions,
) => ChildProcess) & {
  controlRequests: Array<{ subtype: string; mode?: string }>;
  controlResponses: Record<string, unknown>[];
  messages: Record<string, unknown>[];
};

/** Process-compatible Claude fake. It consumes host JSONL and replays captured fixture lines. */
export function createFakeClaudeSpawn(
  fixturePath: string,
  options: FakeClaudeOptions = {},
): FakeClaudeSpawn {
  const controlRequests: FakeClaudeSpawn["controlRequests"] = [];
  const controlResponses: FakeClaudeSpawn["controlResponses"] = [];
  const messages: FakeClaudeSpawn["messages"] = [];
  const spawn = (() =>
    new FakeClaudeProcess(
      fixturePath,
      options,
      controlRequests,
      controlResponses,
      messages,
    ) as unknown as ChildProcess) as unknown as FakeClaudeSpawn;
  spawn.controlRequests = controlRequests;
  spawn.controlResponses = controlResponses;
  spawn.messages = messages;
  return spawn;
}

class FakeClaudeProcess extends EventEmitter {
  readonly stdin = new PassThrough();
  readonly stdout = new PassThrough();
  readonly stderr = new PassThrough();
  exitCode: number | null = null;
  signalCode: NodeJS.Signals | null = null;
  readonly #records: FixtureLine[];
  readonly #exitAfterResult: boolean;
  readonly #options: FakeClaudeOptions;
  readonly #controlRequests: FakeClaudeSpawn["controlRequests"];
  readonly #controlResponses: FakeClaudeSpawn["controlResponses"];
  readonly #messages: FakeClaudeSpawn["messages"];
  #cursor = 0;
  #pending = "";

  constructor(
    fixturePath: string,
    options: FakeClaudeOptions,
    controlRequests: FakeClaudeSpawn["controlRequests"],
    controlResponses: FakeClaudeSpawn["controlResponses"],
    messages: FakeClaudeSpawn["messages"],
  ) {
    super();
    this.#options = options;
    this.#exitAfterResult = options.exitAfterResult === true;
    this.#controlRequests = controlRequests;
    this.#controlResponses = controlResponses;
    this.#messages = messages;
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
    let value: Record<string, unknown>;
    try {
      value = JSON.parse(line) as Record<string, unknown>;
    } catch {
      this.#fail("JSON inválido do host.");
      return;
    }
    this.#messages.push(value);
    if (value.type === "control_request") {
      const request = value.request as Record<string, unknown> | undefined;
      if (request?.subtype === "initialize" || request?.subtype === "interrupt") {
        this.#consumeHost("control_request", request.subtype);
        this.#pump();
        return;
      }
      if (request?.subtype === "set_permission_mode" && typeof request.mode === "string") {
        this.#controlRequests.push({ subtype: request.subtype, mode: request.mode });
        this.stdout.write(
          `${JSON.stringify({
            type: "control_response",
            response: {
              subtype: "success",
              request_id: value.request_id,
              response: { mode: request.mode },
            },
          })}\n`,
        );
        return;
      }
    }
    if (value.type === "user") {
      this.#consumeHost("user");
      this.#pump();
      return;
    }
    if (value.type === "control_response") {
      const response = value.response as Record<string, unknown> | undefined;
      const actual = response?.response as Record<string, unknown> | undefined;
      this.#controlResponses.push(response ?? {});
      const record = this.#consumeHost("control_response");
      if (record) {
        const captured = JSON.parse(record.line) as Record<string, unknown>;
        const wrapper = captured.response as Record<string, unknown> | undefined;
        const expected = wrapper?.response as Record<string, unknown> | undefined;
        if (this.#options.planDecision !== "adjust" && expected?.behavior !== actual?.behavior)
          this.#fail("A decisão do host não corresponde à fixture.");
        if (
          expected?.updatedPermissions &&
          JSON.stringify(expected.updatedPermissions) !== JSON.stringify(actual?.updatedPermissions)
        )
          this.#fail("updatedPermissions difere da fixture.");
      }
      if (this.#options.planDecision === "adjust" && actual?.behavior === "deny") {
        this.#replayPlan();
      } else this.#pump();
    }
  }

  #replayPlan(): void {
    const userIndex = this.#records.findIndex((record) => {
      if (record.direction !== "out" || record.stream !== "stdin") return false;
      return (JSON.parse(record.line) as { type?: string }).type === "user";
    });
    const responseIndex = this.#records.findIndex((record, index) => {
      if (index <= userIndex || record.direction !== "out" || record.stream !== "stdin")
        return false;
      return (JSON.parse(record.line) as { type?: string }).type === "control_response";
    });
    for (const record of this.#records.slice(userIndex + 1, responseIndex)) {
      if (record.direction === "in" && record.stream === "stdout")
        this.stdout.write(`${record.line}\n`);
    }
  }

  #consumeHost(type: string, subtype?: string): FixtureLine | undefined {
    for (; this.#cursor < this.#records.length; this.#cursor += 1) {
      const record = this.#records[this.#cursor];
      if (record?.direction !== "out" || record.stream !== "stdin") continue;
      const value = JSON.parse(record.line) as Record<string, unknown>;
      const request = value.request as Record<string, unknown> | undefined;
      if (value.type === type && (subtype === undefined || request?.subtype === subtype)) {
        this.#cursor += 1;
        return record;
      }
    }
    this.#fail(`A fixture não contém saída do host ${type}${subtype ? `/${subtype}` : ""}.`);
    return undefined;
  }

  #pump(): void {
    while (this.#cursor < this.#records.length) {
      const record = this.#records[this.#cursor];
      if (!record) return;
      if (record.direction === "out" && record.stream === "stdin") return;
      this.#cursor += 1;
      if (record.direction === "stderr") this.stderr.write(`${record.line}\n`);
      else if (record.direction === "in" && record.stream === "stdout")
        this.stdout.write(`${record.line}\n`);
    }
    const hasResult = this.#records.some(
      (record) =>
        record.direction === "in" &&
        record.stream === "stdout" &&
        (JSON.parse(record.line) as { type?: string }).type === "result",
    );
    if (!hasResult) this.#finish(1, null);
    else if (this.#exitAfterResult) this.#finish(0, null);
  }

  #fail(message: string): void {
    this.stderr.write(`fake claude: ${message}\n`);
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
