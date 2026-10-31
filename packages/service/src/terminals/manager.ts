import { randomUUID } from "node:crypto";
import { constants } from "node:fs";
import { access, stat } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import type { TerminalInfo } from "@karont/contract";
import type { IPty } from "node-pty";
import { DeltaCoalescer } from "../coalescer.ts";
import { ServiceError } from "../errors.ts";

const MAX_REPLAY_BYTES = 256 * 1024;
const MAX_TERMINALS = 16;
const CLOSE_TIMEOUT_MS = 2_000;
const INITIAL_COMMAND_IDLE_MS = 150;
const INITIAL_COMMAND_STARTUP_TIMEOUT_MS = 2_000;

export type TerminalPty = Pick<
  IPty,
  "onData" | "onExit" | "write" | "resize" | "kill" | "pause" | "resume"
>;

export type TerminalPtyFactory = (
  shell: string,
  args: string[],
  options: { name: string; cols: number; rows: number; cwd: string; env: NodeJS.ProcessEnv },
) => TerminalPty;

export type TerminalScheduler = (callback: () => void, delayMs: number) => () => void;

export type TerminalEvent =
  | { event: "terminals.output"; payload: { id: string; seq: number; data: string } }
  | {
      event: "terminals.exit";
      payload: { id: string; exitCode: number | null; signal: number | null };
    }
  | { event: "terminals.changed"; payload: { terminals: TerminalInfo[] } };

export type TerminalManagerOptions = {
  broadcast: (event: TerminalEvent) => Promise<void>;
  ptyFactory?: TerminalPtyFactory;
  env?: NodeJS.ProcessEnv;
  homeDir?: string;
  isExecutable?: (filePath: string) => Promise<boolean>;
  now?: () => Date;
  schedule?: TerminalScheduler;
};

type PendingInitialCommand = {
  command: string;
  hasOutput: boolean;
  cancelStartupTimeout?: () => void;
  cancelIdleTimeout?: () => void;
};

type ManagedTerminal = {
  info: TerminalInfo;
  pty: TerminalPty;
  replay: string;
  seq: number;
  coalescer: DeltaCoalescer;
  pendingAdds: Set<Promise<void>>;
  pendingFlushes: number;
  pendingInitialCommand?: PendingInitialCommand;
  closePromise?: Promise<void>;
  resolveExit: () => void;
  exitPromise: Promise<void>;
};

export class TerminalManager {
  readonly #broadcast: TerminalManagerOptions["broadcast"];
  readonly #ptyFactory: TerminalPtyFactory | undefined;
  readonly #env: NodeJS.ProcessEnv;
  readonly #homeDir: string;
  readonly #isExecutable: (filePath: string) => Promise<boolean>;
  readonly #now: () => Date;
  readonly #schedule: TerminalScheduler;
  readonly #terminals = new Map<string, ManagedTerminal>();

  constructor({
    broadcast,
    ptyFactory,
    env = process.env,
    homeDir = os.homedir(),
    isExecutable = defaultIsExecutable,
    now = () => new Date(),
    schedule = scheduleTimeout,
  }: TerminalManagerOptions) {
    this.#broadcast = broadcast;
    this.#ptyFactory = ptyFactory;
    this.#env = env;
    this.#homeDir = homeDir;
    this.#isExecutable = isExecutable;
    this.#now = now;
    this.#schedule = schedule;
  }

  list(): { terminals: TerminalInfo[] } {
    return { terminals: [...this.#terminals.values()].map(({ info }) => ({ ...info })) };
  }

  async open(params: {
    cwd?: string;
    cols: number;
    rows: number;
    command?: string;
  }): Promise<{ terminal: TerminalInfo }> {
    validateSize(params.cols, params.rows);
    if (this.#terminals.size >= MAX_TERMINALS) {
      throw new ServiceError("unavailable", "O serviço já está com 16 terminais abertos.");
    }

    const cwd = path.resolve(params.cwd ?? this.#homeDir);
    if (!path.isAbsolute(cwd) || cwd.length > 4_096) {
      throw new ServiceError(
        "invalid_request",
        "A pasta do terminal deve ser um caminho absoluto.",
      );
    }
    let cwdInfo: Awaited<ReturnType<typeof stat>>;
    try {
      cwdInfo = await stat(cwd);
    } catch {
      throw new ServiceError("invalid_request", "A pasta do terminal não existe.");
    }
    if (!cwdInfo.isDirectory()) {
      throw new ServiceError("invalid_request", "A pasta do terminal não é um diretório.");
    }
    if (params.command !== undefined) {
      const commandBytes = Buffer.byteLength(params.command, "utf8");
      if (commandBytes < 1 || commandBytes > 4_096 || params.command.includes("\u0000")) {
        throw new ServiceError("invalid_request", "O comando inicial do terminal é inválido.");
      }
    }

    const shell = await this.#selectShell();
    const shellName = path.basename(shell);
    const args = ["bash", "zsh", "sh"].includes(shellName) ? ["-l"] : [];
    const id = randomUUID();
    const terminalEnv = createTerminalEnvironment(this.#env);
    let pty: TerminalPty;
    try {
      const options = {
        name: "xterm-256color",
        cols: params.cols,
        rows: params.rows,
        cwd,
        env: terminalEnv,
      };
      pty = this.#ptyFactory
        ? this.#ptyFactory(shell, args, options)
        : await (await import("node-pty")).spawn(shell, args, options);
    } catch {
      throw new ServiceError("unavailable", "Não foi possível iniciar o shell do terminal.");
    }

    let resolveExit = (): void => undefined;
    const exitPromise = new Promise<void>((resolve) => {
      resolveExit = resolve;
    });
    const info: TerminalInfo = {
      id,
      title: `${shellName} · ${abbreviatePath(cwd, this.#homeDir)}`,
      cwd,
      shell,
      cols: params.cols,
      rows: params.rows,
      startedAt: this.#now().toISOString(),
      exited: false,
    };
    const terminal: ManagedTerminal = {
      info,
      pty,
      replay: "",
      seq: 0,
      pendingAdds: new Set(),
      pendingFlushes: 0,
      resolveExit,
      exitPromise,
      coalescer: undefined as unknown as DeltaCoalescer,
    };
    terminal.coalescer = new DeltaCoalescer(
      async (data) => {
        terminal.replay = appendReplay(terminal.replay, data);
        terminal.seq += 1;
        await this.#broadcast({
          event: "terminals.output",
          payload: { id, seq: terminal.seq, data },
        });
      },
      {
        onFlushPending: () => {
          terminal.pendingFlushes += 1;
          if (terminal.pendingFlushes === 1) pty.pause();
        },
        onFlushComplete: () => {
          terminal.pendingFlushes = Math.max(0, terminal.pendingFlushes - 1);
          if (terminal.pendingFlushes === 0 && !terminal.info.exited && !terminal.closePromise) {
            pty.resume();
          }
        },
      },
    );
    this.#terminals.set(id, terminal);
    pty.onData((data) => {
      this.#queueOutput(terminal, data);
      this.#onOutputForInitialCommand(terminal, data);
    });
    pty.onExit(({ exitCode, signal }) => {
      void this.#handleExit(terminal, exitCode, signal);
    });
    if (params.command !== undefined) {
      this.#scheduleInitialCommand(terminal, params.command);
    }
    await this.#emitChanged();
    return { terminal: { ...info } };
  }

  attach(id: string): { terminal: TerminalInfo; replay: string; seq: number } {
    const terminal = this.#get(id);
    return { terminal: { ...terminal.info }, replay: terminal.replay, seq: terminal.seq };
  }

  write(id: string, data: string): { ok: true } {
    const terminal = this.#get(id);
    if (terminal.info.exited) {
      throw new ServiceError("invalid_request", "O processo deste terminal já foi encerrado.");
    }
    const bytes = Buffer.byteLength(data, "utf8");
    if (bytes < 1 || bytes > 65_536) {
      throw new ServiceError("invalid_request", "A entrada deve ter de 1 a 65.536 bytes UTF-8.");
    }
    terminal.pty.write(data);
    return { ok: true };
  }

  resize(id: string, cols: number, rows: number): { ok: true } {
    validateSize(cols, rows);
    const terminal = this.#get(id);
    if (terminal.info.exited) {
      throw new ServiceError("invalid_request", "O processo deste terminal já foi encerrado.");
    }
    terminal.pty.resize(cols, rows);
    terminal.info.cols = cols;
    terminal.info.rows = rows;
    return { ok: true };
  }

  async close(id: string): Promise<{ ok: true }> {
    const terminal = this.#get(id);
    await this.#closeTerminal(terminal);
    return { ok: true };
  }

  async closeAll(): Promise<void> {
    await Promise.all(
      [...this.#terminals.values()].map((terminal) => this.#closeTerminal(terminal)),
    );
  }

  async #selectShell(): Promise<string> {
    const requested = this.#env.SHELL;
    if (requested && path.isAbsolute(requested) && (await this.#isExecutable(requested))) {
      return requested;
    }
    if (await this.#isExecutable("/bin/bash")) return "/bin/bash";
    if (await this.#isExecutable("/bin/sh")) return "/bin/sh";
    throw new ServiceError("unavailable", "Nenhum shell executável foi encontrado.");
  }

  #queueOutput(terminal: ManagedTerminal, data: string): void {
    if (!data) return;
    const task = terminal.coalescer.add(data);
    terminal.pendingAdds.add(task);
    void task.catch(() => undefined).finally(() => terminal.pendingAdds.delete(task));
  }

  async #handleExit(terminal: ManagedTerminal, exitCode: number, signal?: number): Promise<void> {
    if (terminal.info.exited) return;
    this.#cancelInitialCommand(terminal);
    terminal.info.exited = true;
    terminal.info.exitCode = Number.isInteger(exitCode) ? exitCode : null;
    await Promise.allSettled([...terminal.pendingAdds]);
    await terminal.coalescer.end().catch(() => undefined);
    await this.#broadcast({
      event: "terminals.exit",
      payload: {
        id: terminal.info.id,
        exitCode: Number.isInteger(exitCode) ? exitCode : null,
        signal: Number.isInteger(signal) ? (signal as number) : null,
      },
    });
    await this.#emitChanged();
    terminal.resolveExit();
  }

  async #closeTerminal(terminal: ManagedTerminal): Promise<void> {
    if (terminal.closePromise) return terminal.closePromise;
    this.#cancelInitialCommand(terminal);
    terminal.closePromise = (async () => {
      if (!terminal.info.exited) {
        try {
          terminal.pty.kill("SIGHUP");
        } catch {
          // The pty may have exited between the status check and kill().
        }
        await Promise.race([terminal.exitPromise, delay(CLOSE_TIMEOUT_MS)]);
        if (!terminal.info.exited) {
          try {
            terminal.pty.kill("SIGKILL");
          } catch {
            // The process may have exited before SIGKILL could be delivered.
          }
        }
      }
      this.#terminals.delete(terminal.info.id);
      await this.#emitChanged();
    })();
    return terminal.closePromise;
  }

  #get(id: string): ManagedTerminal {
    const terminal = this.#terminals.get(id);
    if (!terminal) throw new ServiceError("invalid_request", "O terminal solicitado não existe.");
    return terminal;
  }

  async #emitChanged(): Promise<void> {
    await this.#broadcast({ event: "terminals.changed", payload: this.list() });
  }

  #scheduleInitialCommand(terminal: ManagedTerminal, command: string): void {
    const pending: PendingInitialCommand = { command, hasOutput: false };
    terminal.pendingInitialCommand = pending;
    pending.cancelStartupTimeout = this.#schedule(() => {
      pending.cancelStartupTimeout = undefined;
      this.#writeInitialCommand(terminal, pending);
    }, INITIAL_COMMAND_STARTUP_TIMEOUT_MS);
  }

  #onOutputForInitialCommand(terminal: ManagedTerminal, data: string): void {
    if (!data) return;
    const pending = terminal.pendingInitialCommand;
    if (!pending) return;

    if (!pending.hasOutput) {
      pending.hasOutput = true;
      pending.cancelStartupTimeout?.();
      pending.cancelStartupTimeout = undefined;
    }
    pending.cancelIdleTimeout?.();
    pending.cancelIdleTimeout = this.#schedule(() => {
      pending.cancelIdleTimeout = undefined;
      this.#writeInitialCommand(terminal, pending);
    }, INITIAL_COMMAND_IDLE_MS);
  }

  #writeInitialCommand(terminal: ManagedTerminal, pending: PendingInitialCommand): void {
    if (terminal.pendingInitialCommand !== pending) return;
    this.#cancelInitialCommand(terminal);
    if (
      terminal.info.exited ||
      terminal.closePromise ||
      this.#terminals.get(terminal.info.id) !== terminal
    ) {
      return;
    }
    try {
      terminal.pty.write(`${pending.command}\r`);
    } catch {
      try {
        terminal.pty.kill("SIGHUP");
      } catch {
        // O processo pode ter encerrado antes do envio do comando.
      }
    }
  }

  #cancelInitialCommand(terminal: ManagedTerminal): void {
    const pending = terminal.pendingInitialCommand;
    if (!pending) return;
    pending.cancelStartupTimeout?.();
    pending.cancelIdleTimeout?.();
    terminal.pendingInitialCommand = undefined;
  }
}

export function createTerminalEnvironment(env: NodeJS.ProcessEnv): NodeJS.ProcessEnv {
  const terminalEnv: NodeJS.ProcessEnv = {};
  for (const [key, value] of Object.entries(env)) {
    if (value === undefined || key.startsWith("KARONT_") || key === "ELECTRON_RUN_AS_NODE") {
      continue;
    }
    terminalEnv[key] = value;
  }
  terminalEnv.TERM = "xterm-256color";
  terminalEnv.COLORTERM = "truecolor";
  return terminalEnv;
}

function appendReplay(current: string, data: string): string {
  return trimUtf8Start(`${current}${data}`, MAX_REPLAY_BYTES);
}

function trimUtf8Start(value: string, maxBytes: number): string {
  const totalBytes = Buffer.byteLength(value, "utf8");
  if (totalBytes <= maxBytes) return value;
  let skippedBytes = 0;
  let skippedCharacters = 0;
  for (const character of value) {
    const characterBytes = Buffer.byteLength(character, "utf8");
    if (totalBytes - skippedBytes <= maxBytes) break;
    skippedBytes += characterBytes;
    skippedCharacters += character.length;
  }
  return value.slice(skippedCharacters);
}

function abbreviatePath(cwd: string, homeDir: string): string {
  if (cwd === homeDir) return "~";
  return cwd.startsWith(`${homeDir}${path.sep}`) ? `~${cwd.slice(homeDir.length)}` : cwd;
}

function validateSize(cols: number, rows: number): void {
  if (!Number.isInteger(cols) || cols < 2 || cols > 1_000) {
    throw new ServiceError("invalid_request", "O terminal precisa ter de 2 a 1.000 colunas.");
  }
  if (!Number.isInteger(rows) || rows < 2 || rows > 500) {
    throw new ServiceError("invalid_request", "O terminal precisa ter de 2 a 500 linhas.");
  }
}

async function defaultIsExecutable(filePath: string): Promise<boolean> {
  try {
    await access(filePath, constants.X_OK);
    return (await stat(filePath)).isFile();
  } catch {
    return false;
  }
}

function delay(milliseconds: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, milliseconds));
}

function scheduleTimeout(callback: () => void, delayMs: number): () => void {
  const timeout = setTimeout(callback, delayMs);
  return () => clearTimeout(timeout);
}
