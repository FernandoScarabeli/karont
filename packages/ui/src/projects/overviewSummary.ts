import type { OverviewWorkspace } from "@karont/contract";
import { t } from "../i18n/pt-BR.ts";

export type OverviewTone = "working" | "queued" | "waiting" | "error";
export type OverviewStatusItem = { tone: OverviewTone; count: number; label: string };

type StatusCounts = { working: number; queued?: number; waiting: number; error?: number };

/** Só os estados com número real (diferente de zero), na ordem em que aparecem nas telas. */
export function statusItems(counts: StatusCounts): OverviewStatusItem[] {
  const items: OverviewStatusItem[] = [];
  const push = (tone: OverviewTone, count: number | undefined, label: (n: number) => string) => {
    if (count && count > 0) items.push({ tone, count, label: label(count) });
  };
  push("working", counts.working, t.overview.working);
  push("queued", counts.queued, t.overview.queued);
  push("waiting", counts.waiting, t.overview.waiting);
  push("error", counts.error, t.overview.error);
  return items;
}

/** "3 conversas hoje · 1 trabalhando · 1 precisa de você"; com tudo zero, "Nenhuma conversa hoje". */
export function buildDayLine(
  workspace: Pick<OverviewWorkspace, "activeToday" | "working" | "queued" | "waiting" | "error">,
): string {
  const parts: string[] = [];
  if (workspace.activeToday > 0) parts.push(t.overview.conversationsToday(workspace.activeToday));
  for (const item of statusItems(workspace)) parts.push(item.label);
  return parts.length > 0 ? parts.join(" · ") : t.overview.noConversationsToday;
}

/** Começo do dia local (meia-noite) como ISO UTC, no formato que `overview.get` pede. */
export function startOfLocalDay(now: Date): string {
  return new Date(now.getFullYear(), now.getMonth(), now.getDate()).toISOString();
}

/** Dia local de uma data, para saber se os números carregados ainda valem. */
export function localDayKey(now: Date): string {
  return `${now.getFullYear()}-${now.getMonth() + 1}-${now.getDate()}`;
}
