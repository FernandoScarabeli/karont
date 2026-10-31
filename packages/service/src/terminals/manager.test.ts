import assert from "node:assert/strict";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { test } from "node:test";
import { ServiceError } from "../errors.ts";
import {
  type TerminalEvent,
  TerminalManager,
  type TerminalPty,
  type TerminalPtyFactory,
} from "./manager.ts";

const MAX_REPLAY_BYTES = 256 * 1024;
const skipNative = process.env.KARONT_SKIP_SOCKET_TESTS === "1";

class FakePty implements TerminalPty {
  readonly dataListeners: Array<(data: string) => void> = [];
  readonly exitListeners: Array<(event: { exitCode: number; signal?: number }) => void> = [];
  readonly writes: string[] = [];
  readonly sizes: Array<[number, number]> = [];
  readonly signals: string[] = [];
  pauseCount = 0;
  resumeCount = 0;

  onData(listener: (data: string) => void): { dispose(): void } {
    this.dataListeners.push(listener);
    return { dispose: () => undefined };
  }

  onExit(listener: (event: { exitCode: number; signal?: number }) => void): { dispose(): void } {
    this.exitListeners.push(listener);
    return { dispose: () => undefined };
  }

  write(data: string): void {
    this.writes.push(data);
  }

  resize(cols: number, rows: number): void {
    this.sizes.push([cols, rows]);
  }

  kill(signal = "SIGHUP"): void {
    this.signals.push(signal);
    if (signal === "SIGHUP") this.exit(0, 1);
  }

  pause(): void {
    this.pauseCount += 1;
  }

  resume(): void {
    this.resumeCount += 1;
  }

  emitData(data: string): void {
    for (const listener of this.dataListeners) listener(data);
  }

  exit(exitCode: number, signal?: number): void {
    for (const listener of this.exitListeners) listener({ exitCode, signal });
  }
}

class FakeTimers {
  #now = 0;
  #nextId = 0;
  readonly #tasks = new Map<number, { callback: () => void; at: number }>();

  readonly schedule = (callback: () => void, delayMs: number): (() => void) => {
    const id = this.#nextId++;
    this.#tasks.set(id, { callback, at: this.#now + delayMs });
    return () => this.#tasks.delete(id);
  };

  advanceBy(milliseconds: number): void {
    const target = this.#now + milliseconds;
    while (true) {
      let nextId: number | undefined;
      let nextAt = Number.POSITIVE_INFINITY;
      for (const [id, task] of this.#tasks) {
        if (task.at <= target && task.at < nextAt) {
          nextId = id;
          nextAt = task.at;
        }
      }
      if (nextId === undefined) break;
      const next = this.#tasks.get(nextId);
      this.#tasks.delete(nextId);
      this.#now = nextAt;
      next?.callback();
    }
    this.#now = target;
  }
}

function fakeFactory(
  created: FakePty[],
  capture?: (shell: string, args: string[], env: NodeJS.ProcessEnv) => void,
): TerminalPtyFactory {
  return (shell, args, options) => {
    capture?.(shell, args, options.env);
    const pty = new FakePty();
    created.push(pty);
    return pty;
  };
}

function eventsCollector() {
  const events: TerminalEvent[] = [];
  return { events, broadcast: async (event: TerminalEvent) => void events.push(event) };
}

test("replay mantém os últimos 256 KiB sem cortar caracteres e seq cresce", async (context) => {
  const root = await mkdtemp(path.join(os.tmpdir(), "karont-terminal-"));
  context.after(() => rm(root, { recursive: true, force: true }));
  const created: FakePty[] = [];
  const recorder = eventsCollector();
  const manager = new TerminalManager({
    broadcast: recorder.broadcast,
    ptyFactory: fakeFactory(created),
    env: { SHELL: "/bin/bash" },
    homeDir: root,
    isExecutable: async () => true,
  });
  const { terminal } = await manager.open({ cwd: root, cols: 80, rows: 24 });
  const pty = created[0];
  assert.ok(pty);
  const output = `${"x".repeat(MAX_REPLAY_BYTES - 3)}🙂${"z".repeat(20)}`;
  pty.emitData(output);
  await waitUntil(
    () => recorder.events.filter((event) => event.event === "terminals.output").length >= 2,
  );

  const attached = manager.attach(terminal.id);
  const outputEvents = recorder.events.filter(
    (event): event is Extract<TerminalEvent, { event: "terminals.output" }> =>
      event.event === "terminals.output",
  );
  assert.deepEqual(
    outputEvents.map((event) => event.payload.seq),
    [1, 2],
  );
  assert.equal(attached.seq, 2);
  assert.equal(Buffer.byteLength(attached.replay, "utf8"), MAX_REPLAY_BYTES);
  assert.equal(attached.replay, output.slice(21));
  assert.equal(attached.replay.endsWith(`🙂${"z".repeat(20)}`), true);
  await manager.close(terminal.id);
});

test("pausa o pty enquanto o envio aguarda drain e retoma depois", async (context) => {
  const root = await mkdtemp(path.join(os.tmpdir(), "karont-terminal-"));
  context.after(() => rm(root, { recursive: true, force: true }));
  const created: FakePty[] = [];
  let releaseOutput: (() => void) | undefined;
  const manager = new TerminalManager({
    broadcast: async (event) => {
      if (event.event === "terminals.output") {
        await new Promise<void>((resolve) => {
          releaseOutput = resolve;
        });
      }
    },
    ptyFactory: fakeFactory(created),
    env: { SHELL: "/bin/bash" },
    homeDir: root,
    isExecutable: async () => true,
  });
  const { terminal } = await manager.open({ cwd: root, cols: 80, rows: 24 });
  const pty = created[0];
  assert.ok(pty);
  pty.emitData("x".repeat(MAX_REPLAY_BYTES));
  assert.equal(pty.pauseCount, 1);
  assert.equal(pty.resumeCount, 0);
  await waitUntil(() => releaseOutput !== undefined);
  releaseOutput?.();
  await waitUntil(() => pty.resumeCount === 1);
  await manager.close(terminal.id);
});

test("limita a 16 terminais, rejeita escrita após saída e emite changed", async (context) => {
  const root = await mkdtemp(path.join(os.tmpdir(), "karont-terminal-"));
  context.after(() => rm(root, { recursive: true, force: true }));
  const created: FakePty[] = [];
  const recorder = eventsCollector();
  const manager = new TerminalManager({
    broadcast: recorder.broadcast,
    ptyFactory: fakeFactory(created),
    env: { SHELL: "/bin/bash" },
    homeDir: root,
    isExecutable: async () => true,
  });
  const opened = [];
  for (let index = 0; index < 16; index += 1) {
    opened.push(await manager.open({ cwd: root, cols: 80, rows: 24 }));
  }
  await assert.rejects(
    manager.open({ cwd: root, cols: 80, rows: 24 }),
    (error: unknown) => error instanceof ServiceError && error.code === "unavailable",
  );
  const exited = opened[0];
  const exitedPty = created[0];
  assert.ok(exited && exitedPty);
  exitedPty.exit(7, 9);
  await waitUntil(() => recorder.events.some((event) => event.event === "terminals.exit"));
  assert.equal(manager.list().terminals[0]?.exited, true);
  assert.equal(manager.list().terminals[0]?.exitCode, 7);
  assert.throws(
    () => manager.write(exited.terminal.id, "x"),
    (error: unknown) => error instanceof ServiceError && error.code === "invalid_request",
  );
  await manager.open({ cwd: root, cols: 80, rows: 24 });
  assert.equal(manager.list().terminals.length, 17);
  await manager.close(exited.terminal.id);
  assert.equal(manager.list().terminals.length, 16);
  assert.equal(
    recorder.events.some((event) => event.event === "terminals.changed"),
    true,
  );
  await manager.closeAll();
  assert.equal(manager.list().terminals.length, 0);
});

test("reserva vagas antes dos awaits em aberturas simultâneas", async (context) => {
  const root = await mkdtemp(path.join(os.tmpdir(), "karont-terminal-reservation-"));
  context.after(() => rm(root, { recursive: true, force: true }));
  const created: FakePty[] = [];
  let executableChecks = 0;
  let releaseExecutableCheck: (() => void) | undefined;
  const executableGate = new Promise<void>((resolve) => {
    releaseExecutableCheck = resolve;
  });
  const manager = new TerminalManager({
    broadcast: async () => undefined,
    ptyFactory: fakeFactory(created),
    env: { SHELL: "/bin/bash" },
    homeDir: root,
    isExecutable: async () => {
      executableChecks += 1;
      await executableGate;
      return true;
    },
  });

  const attempts = Array.from({ length: 17 }, () =>
    manager.open({ cwd: root, cols: 80, rows: 24 }),
  );
  const allResults = Promise.allSettled(attempts);
  await waitUntil(() => executableChecks === 16);
  releaseExecutableCheck?.();
  const results = await allResults;
  assert.equal(results.filter((result) => result.status === "fulfilled").length, 16);
  assert.equal(results.filter((result) => result.status === "rejected").length, 1);
  assert.equal(created.length, 16);
  await manager.closeAll();
});

test("seleciona SHELL válido, usa fallback para SHELL relativo ou ausente", async (context) => {
  const root = await mkdtemp(path.join(os.tmpdir(), "karont-terminal-"));
  context.after(() => rm(root, { recursive: true, force: true }));
  const cases = [
    {
      shell: "/opt/shells/zsh",
      executable: ["/opt/shells/zsh"],
      expected: "/opt/shells/zsh",
      args: ["-l"],
    },
    { shell: "bash", executable: ["/bin/bash"], expected: "/bin/bash", args: ["-l"] },
    { shell: "/missing/shell", executable: ["/bin/bash"], expected: "/bin/bash", args: ["-l"] },
    { shell: undefined, executable: ["/bin/sh"], expected: "/bin/sh", args: ["-l"] },
    {
      shell: "/opt/shells/fish",
      executable: ["/opt/shells/fish"],
      expected: "/opt/shells/fish",
      args: [],
    },
  ];
  for (const item of cases) {
    const created: FakePty[] = [];
    let captured: { shell: string; args: string[] } | undefined;
    const manager = new TerminalManager({
      broadcast: async () => undefined,
      ptyFactory: fakeFactory(created, (shell, args) => {
        captured = { shell, args };
      }),
      env: { SHELL: item.shell },
      homeDir: root,
      isExecutable: async (filePath) => item.executable.includes(filePath),
    });
    const { terminal } = await manager.open({ cwd: root, cols: 80, rows: 24 });
    assert.deepEqual(captured, { shell: item.expected, args: item.args });
    await manager.close(terminal.id);
  }
});

test("ambiente do shell remove variáveis do Karont e Electron", async (context) => {
  const root = await mkdtemp(path.join(os.tmpdir(), "karont-terminal-"));
  context.after(() => rm(root, { recursive: true, force: true }));
  const created: FakePty[] = [];
  let shellEnv: NodeJS.ProcessEnv | undefined;
  const manager = new TerminalManager({
    broadcast: async () => undefined,
    ptyFactory: fakeFactory(created, (_shell, _args, env) => {
      shellEnv = env;
    }),
    env: {
      PATH: "/usr/bin",
      LANG: "pt_BR.UTF-8",
      KARONT_DEV: "1",
      KARONT_SECRET: "nao-herdar",
      ELECTRON_RUN_AS_NODE: "1",
      SHELL: "/bin/bash",
    },
    homeDir: root,
    isExecutable: async () => true,
  });
  const { terminal } = await manager.open({ cwd: root, cols: 80, rows: 24 });
  assert.equal(shellEnv?.PATH, "/usr/bin");
  assert.equal(shellEnv?.LANG, "pt_BR.UTF-8");
  assert.equal(shellEnv?.TERM, "xterm-256color");
  assert.equal(shellEnv?.COLORTERM, "truecolor");
  assert.equal(
    Object.keys(shellEnv ?? {}).some((key) => key.startsWith("KARONT_")),
    false,
  );
  assert.equal(shellEnv?.ELECTRON_RUN_AS_NODE, undefined);
  await manager.close(terminal.id);
});

test("valida a pasta de trabalho e redimensiona terminal", async (context) => {
  const root = await mkdtemp(path.join(os.tmpdir(), "karont-terminal-"));
  const file = path.join(root, "arquivo.txt");
  await writeFile(file, "x");
  context.after(() => rm(root, { recursive: true, force: true }));
  const created: FakePty[] = [];
  const manager = new TerminalManager({
    broadcast: async () => undefined,
    ptyFactory: fakeFactory(created),
    env: { SHELL: "/bin/bash" },
    homeDir: root,
    isExecutable: async () => true,
  });
  await assert.rejects(
    manager.open({ cwd: path.join(root, "missing"), cols: 80, rows: 24 }),
    (error: unknown) => error instanceof ServiceError && error.code === "invalid_request",
  );
  await assert.rejects(
    manager.open({ cwd: file, cols: 80, rows: 24 }),
    (error: unknown) => error instanceof ServiceError && error.code === "invalid_request",
  );
  const { terminal } = await manager.open({ cwd: root, cols: 80, rows: 24 });
  assert.deepEqual(manager.resize(terminal.id, 100, 32), { ok: true });
  assert.deepEqual(created[0]?.sizes, [[100, 32]]);
  await manager.close(terminal.id);
});

test("escreve o comando inicial 150 ms depois da última saída do shell", async (context) => {
  const root = await mkdtemp(path.join(os.tmpdir(), "karont-terminal-command-"));
  context.after(() => rm(root, { recursive: true, force: true }));
  const created: FakePty[] = [];
  const timers = new FakeTimers();
  const manager = new TerminalManager({
    broadcast: async () => undefined,
    ptyFactory: fakeFactory(created),
    env: { SHELL: "/bin/bash" },
    homeDir: root,
    isExecutable: async () => true,
    schedule: timers.schedule,
  });

  const command = "echo karont-$((2+3))";
  const { terminal } = await manager.open({ cwd: root, cols: 80, rows: 24, command });
  const pty = created[0];
  assert.ok(pty);
  assert.deepEqual(pty.writes, []);
  timers.advanceBy(1_000);
  assert.deepEqual(pty.writes, []);

  pty.emitData("prompt");
  timers.advanceBy(149);
  assert.deepEqual(pty.writes, []);
  pty.emitData(" more prompt");
  timers.advanceBy(149);
  assert.deepEqual(pty.writes, []);
  timers.advanceBy(1);

  assert.deepEqual(pty.writes, [`${command}\r`]);
  assert.equal(terminal.title, "bash · ~");
  await manager.close(terminal.id);
});

test("envia o comando inicial após 2 s se o shell não produzir saída", async (context) => {
  const root = await mkdtemp(path.join(os.tmpdir(), "karont-terminal-command-timeout-"));
  context.after(() => rm(root, { recursive: true, force: true }));
  const created: FakePty[] = [];
  const timers = new FakeTimers();
  const manager = new TerminalManager({
    broadcast: async () => undefined,
    ptyFactory: fakeFactory(created),
    env: { SHELL: "/bin/bash" },
    homeDir: root,
    isExecutable: async () => true,
    schedule: timers.schedule,
  });

  const command = "echo pronto";
  const { terminal } = await manager.open({ cwd: root, cols: 80, rows: 24, command });
  const pty = created[0];
  assert.ok(pty);
  timers.advanceBy(1_999);
  assert.deepEqual(pty.writes, []);
  timers.advanceBy(1);
  assert.deepEqual(pty.writes, [`${command}\r`]);
  await manager.close(terminal.id);
});

test("não envia o comando inicial se o terminal sair ou for fechado antes", async (context) => {
  const root = await mkdtemp(path.join(os.tmpdir(), "karont-terminal-command-cancel-"));
  context.after(() => rm(root, { recursive: true, force: true }));

  for (const ending of ["exit", "close"] as const) {
    const created: FakePty[] = [];
    const timers = new FakeTimers();
    const manager = new TerminalManager({
      broadcast: async () => undefined,
      ptyFactory: fakeFactory(created),
      env: { SHELL: "/bin/bash" },
      homeDir: root,
      isExecutable: async () => true,
      schedule: timers.schedule,
    });
    const { terminal } = await manager.open({
      cwd: root,
      cols: 80,
      rows: 24,
      command: "echo não-enviar",
    });
    const pty = created[0];
    assert.ok(pty);
    pty.emitData("prompt");
    timers.advanceBy(100);

    if (ending === "exit") pty.exit(0);
    else await manager.close(terminal.id);
    timers.advanceBy(1_000);

    assert.deepEqual(pty.writes, []);
    await manager.closeAll();
  }
});

test("pty real espera o prompt e executa o comando inicial uma vez", {
  skip: skipNative,
}, async (context) => {
  const root = await mkdtemp(path.join(os.tmpdir(), "karont-terminal-real-"));
  context.after(() => rm(root, { recursive: true, force: true }));
  const outputs: string[] = [];
  const manager = new TerminalManager({
    broadcast: async (event) => {
      if (event.event === "terminals.output") outputs.push(event.payload.data);
    },
    env: { ...process.env, SHELL: "/bin/bash" },
    homeDir: root,
  });
  const command = "echo karont-$((2+3)) && pwd";
  const { terminal } = await manager.open({ cwd: root, cols: 80, rows: 24, command });
  await waitUntil(() => outputs.join("").includes("karont-5"), 5_000);
  const output = outputs.join("");
  assert.equal(output.split(command).length - 1, 1);
  assert.ok(output.indexOf(command) < output.indexOf("karont-5"));
  assert.deepEqual(manager.resize(terminal.id, 100, 40), { ok: true });
  assert.equal(manager.attach(terminal.id).replay.includes("karont-5"), true);
  await manager.close(terminal.id);
  assert.equal(manager.list().terminals.length, 0);
});

async function waitUntil(condition: () => boolean, timeoutMs = 2_000): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (!condition() && Date.now() < deadline) {
    await new Promise<void>((resolve) => setTimeout(resolve, 5));
  }
  assert.equal(condition(), true);
}
