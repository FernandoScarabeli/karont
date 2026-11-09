import assert from "node:assert/strict";
import { EventEmitter } from "node:events";
import { mkdtempSync, rmSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { PassThrough } from "node:stream";
import { after, test } from "node:test";
import { openDatabase } from "../db.ts";
import { createClaudeUsageReader } from "./claude-adapter.ts";
import { createCodexUsageReader } from "./codex-adapter.ts";
import {
  mergeUsageWindows,
  parseClaudeRateLimit,
  parseClaudeUsage,
  parseCodexRateLimits,
  readStoredUsage,
  recordUsage,
  runUsageProbe,
} from "./usage.ts";

const iso = (seconds: number) => new Date(seconds * 1000).toISOString();

// `openTempDatabase()` criaria um arquivo com esse nome na pasta atual.
const tempRoot = mkdtempSync(path.join(os.tmpdir(), "karont-usage-"));
after(() => rmSync(tempRoot, { recursive: true, force: true }));
let tempDatabases = 0;
const openTempDatabase = () => openDatabase(path.join(tempRoot, `${++tempDatabases}.db`));

const claudeEvent = {
  type: "rate_limit_event",
  rate_limit_info: {
    status: "allowed",
    resetsAt: 1793507400,
    rateLimitType: "five_hour",
    unifiedWindows: {
      five_hour: { utilization: 0.06, resetsAt: 1793507400, status: "allowed" },
      seven_day: { utilization: 0.44, resetsAt: 1793908800, status: "allowed" },
    },
  },
};

const codexParams = {
  rateLimits: {
    limitId: "codex",
    primary: { usedPercent: 20, windowDurationMins: 300, resetsAt: 1793508694 },
    secondary: { usedPercent: 32, windowDurationMins: 10080, resetsAt: 1793901203 },
  },
};

test("parseClaudeRateLimit lê as duas janelas do exemplo real", () => {
  assert.deepEqual(parseClaudeRateLimit(claudeEvent), [
    { id: "five_hour", usedPercent: 6, resetsAt: iso(1793507400) },
    { id: "weekly", usedPercent: 44, resetsAt: iso(1793908800) },
  ]);
});

test("parseClaudeRateLimit tolera entradas ruins", () => {
  assert.deepEqual(parseClaudeRateLimit(null), []);
  assert.deepEqual(parseClaudeRateLimit({ rate_limit_info: {} }), []);
  const only = {
    rate_limit_info: { unifiedWindows: { seven_day: { utilization: 0.5, resetsAt: "x" } } },
  };
  assert.deepEqual(parseClaudeRateLimit(only), [{ id: "weekly", usedPercent: 50, resetsAt: null }]);
  const over = {
    rate_limit_info: { unifiedWindows: { five_hour: { utilization: 1.7, resetsAt: 1793507400 } } },
  };
  assert.equal(parseClaudeRateLimit(over)[0]?.usedPercent, 100);
  const bad = { rate_limit_info: { unifiedWindows: { five_hour: { utilization: "0.1" } } } };
  assert.deepEqual(parseClaudeRateLimit(bad), []);
});

test("parseCodexRateLimits lê as duas janelas do exemplo real", () => {
  assert.deepEqual(parseCodexRateLimits(codexParams), [
    { id: "five_hour", usedPercent: 20, resetsAt: iso(1793508694) },
    { id: "weekly", usedPercent: 32, resetsAt: iso(1793901203) },
  ]);
});

test("parseCodexRateLimits identifica pela duração e ignora o que não é válido", () => {
  assert.deepEqual(parseCodexRateLimits(null), []);
  assert.deepEqual(
    parseCodexRateLimits({ rateLimits: { ...codexParams.rateLimits, limitId: "outro" } }),
    [],
  );
  const swapped = {
    rateLimits: {
      limitId: "codex",
      primary: { usedPercent: 40.4, windowDurationMins: 10080, resetsAt: 1793901203 },
      secondary: null,
    },
  };
  assert.deepEqual(parseCodexRateLimits(swapped), [
    { id: "weekly", usedPercent: 40, resetsAt: iso(1793901203) },
  ]);
  const unknown = {
    rateLimits: {
      limitId: "codex",
      primary: { usedPercent: 10, windowDurationMins: 60, resetsAt: 1 },
      secondary: { usedPercent: 250, windowDurationMins: 300, resetsAt: "x" },
    },
  };
  assert.deepEqual(parseCodexRateLimits(unknown), [
    { id: "five_hour", usedPercent: 100, resetsAt: null },
  ]);
});

test("mergeUsageWindows mantém a janela que não veio no evento", () => {
  const merged = mergeUsageWindows(
    [
      { id: "five_hour", usedPercent: 10, resetsAt: null },
      { id: "weekly", usedPercent: 30, resetsAt: null },
    ],
    [{ id: "five_hour", usedPercent: 12, resetsAt: null }],
  );
  assert.deepEqual(merged, [
    { id: "five_hour", usedPercent: 12, resetsAt: null },
    { id: "weekly", usedPercent: 30, resetsAt: null },
  ]);
});

test("recordUsage só regrava com mudança ou depois de 60 s", () => {
  const db = openTempDatabase();
  try {
    const t0 = "2026-11-09T10:00:00.000Z";
    const five = (usedPercent: number) => [
      { id: "five_hour" as const, usedPercent, resetsAt: null },
    ];
    const week = [{ id: "weekly" as const, usedPercent: 30, resetsAt: null }];
    assert.equal(recordUsage(db, "codex", [], t0), undefined);
    assert.equal(recordUsage(db, "codex", five(10), t0)?.observedAt, t0);
    assert.equal(recordUsage(db, "codex", five(10), "2026-11-09T10:00:30.000Z"), undefined);
    assert.equal(readStoredUsage(db, "codex")?.observedAt, t0);
    const changed = recordUsage(db, "codex", five(11), "2026-11-09T10:00:31.000Z");
    assert.equal(changed?.windows[0]?.usedPercent, 11);
    const later = "2026-11-09T10:01:32.000Z";
    assert.equal(recordUsage(db, "codex", five(11), later)?.observedAt, later);
    const merged = recordUsage(db, "codex", week, later);
    assert.deepEqual(
      merged?.windows.map((window) => window.id),
      ["five_hour", "weekly"],
    );
    assert.equal(readStoredUsage(db, "outro"), undefined);
  } finally {
    db.close();
  }
});

test("recordUsage não lança quando a gravação falha", () => {
  const db = openTempDatabase();
  db.close();
  assert.equal(
    recordUsage(
      db,
      "codex",
      [{ id: "five_hour", usedPercent: 1, resetsAt: null }],
      "2026-11-09T10:00:00.000Z",
    ),
    undefined,
  );
});

const claudeUsageResponse = {
  subscription_type: "pro",
  rate_limits_available: true,
  rate_limits: {
    five_hour: { utilization: 40, resets_at: "2026-11-09T18:40:00.700169+00:00" },
    seven_day: { utilization: 66, resets_at: "2026-11-12T20:00:00.700187+00:00" },
  },
};

test("parseClaudeUsage lê o exemplo real do get_usage", () => {
  assert.deepEqual(parseClaudeUsage(claudeUsageResponse), [
    { id: "five_hour", usedPercent: 40, resetsAt: "2026-11-09T18:40:00.700Z" },
    { id: "weekly", usedPercent: 66, resetsAt: "2026-11-12T20:00:00.700Z" },
  ]);
});

test("parseClaudeUsage ignora entradas ruins", () => {
  assert.deepEqual(parseClaudeUsage({ ...claudeUsageResponse, rate_limits_available: false }), []);
  assert.deepEqual(parseClaudeUsage({ ...claudeUsageResponse, rate_limits: null }), []);
  assert.deepEqual(parseClaudeUsage(null), []);
  assert.deepEqual(parseClaudeUsage("x"), []);
  const nullWindow = {
    ...claudeUsageResponse,
    rate_limits: { five_hour: null, seven_day: claudeUsageResponse.rate_limits.seven_day },
  };
  assert.deepEqual(parseClaudeUsage(nullWindow), [
    { id: "weekly", usedPercent: 66, resetsAt: "2026-11-12T20:00:00.700Z" },
  ]);
  const over = {
    ...claudeUsageResponse,
    rate_limits: { five_hour: { utilization: 140, resets_at: null } },
  };
  assert.deepEqual(parseClaudeUsage(over), [{ id: "five_hour", usedPercent: 100, resetsAt: null }]);
  const badDate = {
    ...claudeUsageResponse,
    rate_limits: { five_hour: { utilization: 10, resets_at: "ontem" } },
  };
  assert.deepEqual(parseClaudeUsage(badDate), [
    { id: "five_hour", usedPercent: 10, resetsAt: null },
  ]);
});

class FakeChild extends EventEmitter {
  readonly stdin = new PassThrough();
  readonly stdout = new PassThrough();
  readonly stderr = new PassThrough();
  exitCode: number | null = null;
  signalCode: NodeJS.Signals | null = null;
  readonly signals: string[] = [];
  readonly written: Record<string, unknown>[] = [];
  readonly diesOn: Set<string>;

  constructor(
    diesOn: string[],
    onWrite: (child: FakeChild, message: Record<string, unknown>) => void,
  ) {
    super();
    this.diesOn = new Set(diesOn);
    let pending = "";
    this.stdin.on("data", (chunk: Buffer) => {
      pending += chunk.toString("utf8");
      let index = pending.indexOf("\n");
      while (index >= 0) {
        const message = JSON.parse(pending.slice(0, index)) as Record<string, unknown>;
        pending = pending.slice(index + 1);
        this.written.push(message);
        onWrite(this, message);
        index = pending.indexOf("\n");
      }
    });
  }

  reply(value: unknown): void {
    this.stdout.write(`${JSON.stringify(value)}\n`);
  }

  kill(signal: NodeJS.Signals): boolean {
    this.signals.push(signal);
    if (this.diesOn.has(signal)) {
      this.signalCode = signal;
      queueMicrotask(() => {
        this.emit("exit", null, signal);
        this.emit("close", null, signal);
      });
    }
    return true;
  }
}

function fakeSpawn(child: FakeChild) {
  const calls: Array<{ command: string; args: string[]; cwd: unknown }> = [];
  const spawn = (command: string, args: string[], options: { cwd?: unknown }) => {
    calls.push({ command, args, cwd: options.cwd });
    return child as never;
  };
  return { spawn: spawn as never, calls };
}

const claudeScript = (child: FakeChild, message: Record<string, unknown>) => {
  const request = message.request as { subtype: string };
  child.reply({ type: "system", subtype: "hook_started" });
  if (request.subtype === "initialize")
    child.reply({
      type: "control_response",
      response: { subtype: "success", request_id: "karont-usage-init", response: {} },
    });
  if (request.subtype === "get_usage")
    child.reply({
      type: "control_response",
      response: {
        subtype: "success",
        request_id: "karont-usage-read",
        response: claudeUsageResponse,
      },
    });
};

test("leitor do Claude: caminho feliz, ignora outras linhas e encerra o processo", async () => {
  const child = new FakeChild(["SIGTERM"], claudeScript);
  const { spawn, calls } = fakeSpawn(child);
  const read = createClaudeUsageReader({ spawn, env: { KARONT_CLAUDE_CLI: "claude-falso" } });
  const windows = await read({ dataDir: tempRoot });
  assert.deepEqual(windows, [
    { id: "five_hour", usedPercent: 40, resetsAt: "2026-11-09T18:40:00.700Z" },
    { id: "weekly", usedPercent: 66, resetsAt: "2026-11-12T20:00:00.700Z" },
  ]);
  assert.equal(calls[0]?.command, "claude-falso");
  assert.equal(calls[0]?.cwd, tempRoot);
  assert.ok(!calls[0]?.args.includes("--include-partial-messages"));
  assert.ok(calls[0]?.args.includes("plan"));
  assert.deepEqual(
    child.written.map((message) => (message.request as { subtype: string }).subtype),
    ["initialize", "get_usage"],
  );
  assert.equal(child.stdin.writableEnded, true);
  assert.deepEqual(child.signals, ["SIGTERM"]);
});

test("leitor do Claude: erro, formato estranho e CLI indisponível devolvem []", async () => {
  const failing = new FakeChild(["SIGTERM"], (child) =>
    child.reply({
      type: "control_response",
      response: { subtype: "error", request_id: "karont-usage-init", error: "x" },
    }),
  );
  const first = fakeSpawn(failing);
  const env = { KARONT_CLAUDE_CLI: "claude-falso" };
  assert.deepEqual(
    await createClaudeUsageReader({ spawn: first.spawn, env })({ dataDir: tempRoot }),
    [],
  );
  assert.deepEqual(failing.signals, ["SIGTERM"]);

  const unavailable = new FakeChild(["SIGTERM"], (child, message) => {
    const subtype = (message.request as { subtype: string }).subtype;
    child.reply({
      type: "control_response",
      response: {
        subtype: "success",
        request_id: subtype === "initialize" ? "karont-usage-init" : "karont-usage-read",
        response: { rate_limits_available: false },
      },
    });
  });
  const second = fakeSpawn(unavailable);
  assert.deepEqual(
    await createClaudeUsageReader({ spawn: second.spawn, env })({ dataDir: tempRoot }),
    [],
  );

  const throwing = (() => {
    throw new Error("ENOENT");
  }) as never;
  assert.deepEqual(
    await createClaudeUsageReader({ spawn: throwing, env })({ dataDir: tempRoot }),
    [],
  );
});

test("leitor do Claude: prazo estourado encerra com SIGTERM e depois SIGKILL", async () => {
  const child = new FakeChild(["SIGKILL"], () => undefined);
  const { spawn } = fakeSpawn(child);
  const started = Date.now();
  const windows = await createClaudeUsageReader({
    spawn,
    env: { KARONT_CLAUDE_CLI: "claude-falso" },
    timeoutMs: 30,
    killAfterMs: 40,
  })({ dataDir: tempRoot });
  assert.deepEqual(windows, []);
  assert.ok(Date.now() - started < 1_000);
  assert.deepEqual(child.signals, ["SIGTERM"]);
  await new Promise((resolve) => setTimeout(resolve, 100));
  assert.deepEqual(child.signals, ["SIGTERM", "SIGKILL"]);
});

test("leitor: abortar o sinal encerra o processo", async () => {
  const child = new FakeChild(["SIGTERM"], () => undefined);
  const { spawn } = fakeSpawn(child);
  const controller = new AbortController();
  const pending = createCodexUsageReader({ spawn, env: { KARONT_CODEX_CLI: "codex-falso" } })({
    dataDir: tempRoot,
    signal: controller.signal,
  });
  controller.abort();
  assert.deepEqual(await pending, []);
  assert.deepEqual(child.signals, ["SIGTERM"]);
});

test("leitor do Codex: initialize, initialized e account/rateLimits/read", async () => {
  const child = new FakeChild(["SIGTERM"], (self, message) => {
    if (message.method === "initialize") self.reply({ id: 1, result: { userAgent: "x" } });
    if (message.method === "account/rateLimits/read")
      self.reply({
        id: 2,
        result: {
          rateLimits: {
            limitId: "codex",
            primary: { usedPercent: 8, windowDurationMins: 300, resetsAt: 1794236389 },
            secondary: { usedPercent: 39, windowDurationMins: 10080, resetsAt: 1794501334 },
          },
        },
      });
  });
  const { spawn, calls } = fakeSpawn(child);
  const windows = await createCodexUsageReader({
    spawn,
    env: { KARONT_CODEX_CLI: "codex-falso" },
  })({ dataDir: tempRoot });
  assert.deepEqual(windows, [
    { id: "five_hour", usedPercent: 8, resetsAt: iso(1794236389) },
    { id: "weekly", usedPercent: 39, resetsAt: iso(1794501334) },
  ]);
  assert.deepEqual(calls[0]?.args, ["app-server", "--stdio"]);
  assert.equal(calls[0]?.cwd, tempRoot);
  assert.deepEqual(
    child.written.map((message) => message.method),
    ["initialize", "initialized", "account/rateLimits/read"],
  );
  assert.deepEqual(child.signals, ["SIGTERM"]);
});

test("leitor do Codex: resposta de erro devolve []", async () => {
  const child = new FakeChild(["SIGTERM"], (self, message) => {
    if (message.method === "initialize") self.reply({ id: 1, result: {} });
    if (message.method === "account/rateLimits/read")
      self.reply({ id: 2, error: { code: -32601, message: "nope" } });
  });
  const { spawn } = fakeSpawn(child);
  assert.deepEqual(
    await createCodexUsageReader({ spawn, env: { KARONT_CODEX_CLI: "codex-falso" } })({
      dataDir: tempRoot,
    }),
    [],
  );
  assert.deepEqual(child.signals, ["SIGTERM"]);
});

test("runUsageProbe: processo que sai sozinho devolve [] sem matar de novo", async () => {
  const child = new FakeChild([], () => undefined);
  const { spawn } = fakeSpawn(child);
  const pending = runUsageProbe({
    spawn,
    command: "x",
    args: [],
    cwd: tempRoot,
    env: {},
    onStart: () => undefined,
    onMessage: () => undefined,
  });
  child.exitCode = 1;
  child.emit("close", 1, null);
  assert.deepEqual(await pending, []);
  assert.deepEqual(child.signals, []);
});
