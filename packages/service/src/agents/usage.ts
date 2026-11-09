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
