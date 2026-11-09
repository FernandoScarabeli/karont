import type { ChildProcess, SpawnOptions } from "node:child_process";
import type { DatabaseSync } from "node:sqlite";
import { type AgentUsage, agentUsageSchema, type UsageWindow } from "@karont/contract";
import { getSetting, setSetting } from "../db.ts";

export const USAGE_SETTING_PREFIX = "usage.latest.";
// Sem mudança, só regrava o valor guardado depois deste tempo.
export const USAGE_REFRESH_MS = 60_000;

const FIVE_HOURS_MINUTES = 300;
const WEEK_MINUTES = 10_080;

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isoFromSeconds(value: unknown): string | null {
  if (typeof value !== "number" || !Number.isFinite(value)) return null;
  const date = new Date(value * 1000);
  return Number.isNaN(date.getTime()) ? null : date.toISOString();
}

function clampPercent(value: number): number {
  return Math.min(100, Math.max(0, Math.round(value)));
}

function claudeWindow(id: UsageWindow["id"], value: unknown): UsageWindow | undefined {
  if (!isRecord(value)) return undefined;
  const utilization = value.utilization;
  if (typeof utilization !== "number" || !Number.isFinite(utilization)) return undefined;
  return {
    id,
    usedPercent: clampPercent(utilization * 100),
    resetsAt: isoFromSeconds(value.resetsAt),
  };
}

// Recebe a linha `rate_limit_event` do Claude.
export function parseClaudeRateLimit(value: unknown): UsageWindow[] {
  if (!isRecord(value) || !isRecord(value.rate_limit_info)) return [];
  const windows = value.rate_limit_info.unifiedWindows;
  if (!isRecord(windows)) return [];
  const result: UsageWindow[] = [];
  const fiveHour = claudeWindow("five_hour", windows.five_hour);
  if (fiveHour) result.push(fiveHour);
  const weekly = claudeWindow("weekly", windows.seven_day);
  if (weekly) result.push(weekly);
  return result;
}

function isoFromText(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? null : date.toISOString();
}

function claudeUsageWindow(id: UsageWindow["id"], value: unknown): UsageWindow | undefined {
  if (!isRecord(value)) return undefined;
  const utilization = value.utilization;
  // Aqui vai de 0 a 100 (no `rate_limit_event` vai de 0 a 1).
  if (typeof utilization !== "number" || !Number.isFinite(utilization)) return undefined;
  if (utilization < 0) return undefined;
  // Acima de 100 é limite estourado: aparece como 100%.
  return { id, usedPercent: clampPercent(utilization), resetsAt: isoFromText(value.resets_at) };
}

// Recebe `response.response` do `get_usage` do Claude. Formato estranho: sem leitura.
export function parseClaudeUsage(value: unknown): UsageWindow[] {
  if (!isRecord(value) || value.rate_limits_available !== true) return [];
  const limits = value.rate_limits;
  if (!isRecord(limits)) return [];
  const result: UsageWindow[] = [];
  const fiveHour = claudeUsageWindow("five_hour", limits.five_hour);
  if (fiveHour) result.push(fiveHour);
  const weekly = claudeUsageWindow("weekly", limits.seven_day);
  if (weekly) result.push(weekly);
  return result;
}

function codexWindow(value: unknown): UsageWindow | undefined {
  if (!isRecord(value)) return undefined;
  const id =
    value.windowDurationMins === FIVE_HOURS_MINUTES
      ? "five_hour"
      : value.windowDurationMins === WEEK_MINUTES
        ? "weekly"
        : undefined;
  const used = value.usedPercent;
  if (!id || typeof used !== "number" || !Number.isFinite(used)) return undefined;
  return { id, usedPercent: clampPercent(used), resetsAt: isoFromSeconds(value.resetsAt) };
}

// Recebe os params de `account/rateLimits/updated` do Codex.
export function parseCodexRateLimits(value: unknown): UsageWindow[] {
  if (!isRecord(value) || !isRecord(value.rateLimits)) return [];
  const limits = value.rateLimits;
  if (limits.limitId !== "codex") return [];
  const result = new Map<UsageWindow["id"], UsageWindow>();
  for (const candidate of [limits.primary, limits.secondary]) {
    const window = codexWindow(candidate);
    if (window && !result.has(window.id)) result.set(window.id, window);
  }
  return [...result.values()];
}

// Junta por janela: o que não veio no evento continua como estava.
export function mergeUsageWindows(
  previous: readonly UsageWindow[],
  incoming: readonly UsageWindow[],
): UsageWindow[] {
  const byId = new Map<UsageWindow["id"], UsageWindow>();
  for (const window of previous) byId.set(window.id, window);
  for (const window of incoming) byId.set(window.id, window);
  return [...byId.values()].sort((a, b) => a.id.localeCompare(b.id));
}

export function readStoredUsage(db: DatabaseSync, agent: string): AgentUsage | undefined {
  try {
    const parsed = agentUsageSchema.safeParse(getSetting(db, USAGE_SETTING_PREFIX + agent));
    return parsed.success ? parsed.data : undefined;
  } catch {
    return undefined;
  }
}

function windowsChanged(before: readonly UsageWindow[], after: readonly UsageWindow[]): boolean {
  if (before.length !== after.length) return true;
  return after.some((window) => {
    const old = before.find((item) => item.id === window.id);
    return !old || old.usedPercent !== window.usedPercent || old.resetsAt !== window.resetsAt;
  });
}

// Guarda o último uso do agente. Devolve o valor novo só quando ele foi gravado
// (e deve ser publicado); nunca lança, para não atrapalhar a conversa.
export function recordUsage(
  db: DatabaseSync,
  agent: string,
  incoming: readonly UsageWindow[],
  now: string,
): AgentUsage | undefined {
  if (incoming.length === 0) return undefined;
  try {
    const previous = readStoredUsage(db, agent);
    const windows = mergeUsageWindows(previous?.windows ?? [], incoming);
    if (previous && !windowsChanged(previous.windows, windows)) {
      const age = Date.parse(now) - Date.parse(previous.observedAt);
      if (Number.isFinite(age) && age >= 0 && age <= USAGE_REFRESH_MS) return undefined;
    }
    const usage: AgentUsage = { agent, windows, observedAt: now };
    setSetting(db, USAGE_SETTING_PREFIX + agent, usage);
    return usage;
  } catch {
    return undefined;
  }
}

export const USAGE_PROBE_TIMEOUT_MS = 15_000;
export const USAGE_PROBE_KILL_MS = 2_000;

export type UsageProbeSpawn = (
  command: string,
  args: string[],
  options: SpawnOptions,
) => ChildProcess;

export type UsageProbe = {
  spawn: UsageProbeSpawn;
  command: string;
  args: string[];
  cwd: string;
  env: NodeJS.ProcessEnv;
  signal?: AbortSignal | undefined;
  timeoutMs?: number;
  killAfterMs?: number;
  /** Chamado uma vez com o processo aberto, para mandar a primeira linha. */
  onStart(write: (message: Record<string, unknown>) => void): void;
  /** Chamado a cada linha JSON. Devolve as janelas (ou `[]`) para terminar; `undefined` espera mais. */
  onMessage(
    message: Record<string, unknown>,
    write: (message: Record<string, unknown>) => void,
  ): UsageWindow[] | undefined;
};

// Abre uma CLI só para ler o uso. Nunca lança e sempre encerra o processo
// (stdin fechado, SIGTERM e SIGKILL depois de `killAfterMs`).
export function runUsageProbe(probe: UsageProbe): Promise<UsageWindow[]> {
  const timeoutMs = probe.timeoutMs ?? USAGE_PROBE_TIMEOUT_MS;
  const killAfterMs = probe.killAfterMs ?? USAGE_PROBE_KILL_MS;
  return new Promise<UsageWindow[]>((resolve) => {
    let child: ChildProcess | undefined;
    let settled = false;
    let timeout: ReturnType<typeof setTimeout> | undefined;
    let killTimer: ReturnType<typeof setTimeout> | undefined;

    const terminate = () => {
      const target = child;
      if (!target) return;
      try {
        target.stdin?.end();
      } catch {
        // O processo pode já ter fechado a entrada.
      }
      if (target.exitCode !== null || target.signalCode !== null) return;
      killTimer = setTimeout(() => {
        try {
          if (target.exitCode === null && target.signalCode === null) target.kill("SIGKILL");
        } catch {
          // Já encerrou.
        }
      }, killAfterMs);
      target.once("exit", () => clearTimeout(killTimer));
      try {
        target.kill("SIGTERM");
      } catch {
        // Já encerrou.
      }
    };
    const finish = (windows: UsageWindow[]) => {
      if (settled) return;
      settled = true;
      if (timeout) clearTimeout(timeout);
      probe.signal?.removeEventListener("abort", onAbort);
      terminate();
      resolve(windows);
    };
    const onAbort = () => finish([]);
    const write = (message: Record<string, unknown>) => {
      try {
        const stdin = child?.stdin;
        if (stdin && !stdin.destroyed && !stdin.writableEnded)
          stdin.write(`${JSON.stringify(message)}\n`, "utf8", () => undefined);
      } catch {
        finish([]);
      }
    };

    if (probe.signal?.aborted) {
      resolve([]);
      return;
    }
    try {
      child = probe.spawn(probe.command, probe.args, {
        cwd: probe.cwd,
        env: probe.env,
        stdio: ["pipe", "pipe", "pipe"],
      });
    } catch {
      resolve([]);
      return;
    }
    const spawned = child;
    probe.signal?.addEventListener("abort", onAbort, { once: true });
    timeout = setTimeout(() => finish([]), timeoutMs);
    spawned.once("error", () => finish([]));
    spawned.once("close", () => finish([]));
    spawned.stdin?.on("error", () => undefined);
    spawned.stderr?.on("data", () => undefined);
    spawned.stderr?.on("error", () => undefined);

    let buffer = "";
    const handleLine = (line: string) => {
      if (settled || line.trim() === "") return;
      let parsed: unknown;
      try {
        parsed = JSON.parse(line);
      } catch {
        return;
      }
      if (!isRecord(parsed)) return;
      try {
        const windows = probe.onMessage(parsed, write);
        if (windows) finish(windows);
      } catch {
        finish([]);
      }
    };
    spawned.stdout?.setEncoding?.("utf8");
    spawned.stdout?.on("data", (chunk: Buffer | string) => {
      buffer += typeof chunk === "string" ? chunk : chunk.toString("utf8");
      if (buffer.length > 4 * 1024 * 1024) {
        finish([]);
        return;
      }
      let index = buffer.indexOf("\n");
      while (index >= 0) {
        handleLine(buffer.slice(0, index));
        buffer = buffer.slice(index + 1);
        index = buffer.indexOf("\n");
      }
    });
    spawned.stdout?.on("error", () => finish([]));
    try {
      probe.onStart(write);
    } catch {
      finish([]);
    }
  });
}
