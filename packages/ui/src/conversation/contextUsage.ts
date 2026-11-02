import type { ConversationContextUsage } from "@karont/contract";
import { t } from "../i18n/pt-BR.ts";

export function contextUsagePercent(usage: ConversationContextUsage): number {
  return Math.round((usage.usedTokens / usage.windowTokens) * 100);
}

export function formatContextTokenCount(tokens: number): string {
  if (tokens >= 1_000_000) return `${formatScaled(tokens / 1_000_000)} mi`;
  if (tokens >= 1_000) return `${formatScaled(tokens / 1_000)} mil`;
  return new Intl.NumberFormat("pt-BR", { maximumFractionDigits: 0 }).format(tokens);
}

export function formatContextUsage(usage: ConversationContextUsage): string {
  return t.chat.contextUsageTooltip(
    contextUsagePercent(usage),
    formatContextTokenCount(usage.usedTokens),
    formatContextTokenCount(usage.windowTokens),
  );
}

export function formatContextUsageDetail(usage: ConversationContextUsage): string {
  return t.chat.contextUsageDetail(
    formatContextTokenCount(usage.usedTokens),
    formatContextTokenCount(usage.windowTokens),
  );
}

function formatScaled(value: number): string {
  return new Intl.NumberFormat("pt-BR", { maximumFractionDigits: 1 }).format(value);
}
