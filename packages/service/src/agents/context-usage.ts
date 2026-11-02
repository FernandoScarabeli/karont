import type { ConversationContextUsage } from "@karont/contract";

export function codexContextUsage(value: unknown): ConversationContextUsage | undefined {
  if (!isRecord(value) || !isRecord(value.last)) return undefined;
  const usedTokens = tokenCount(value.last.inputTokens);
  const windowTokens = tokenCount(value.modelContextWindow);
  if (usedTokens === undefined || windowTokens === undefined || windowTokens === 0)
    return undefined;
  return { usedTokens, windowTokens };
}

export function claudeContextUsage(
  usage: unknown,
  modelUsage: unknown,
  model: string | undefined,
): ConversationContextUsage | undefined {
  if (!isRecord(usage) || !isRecord(modelUsage) || !model || !isRecord(modelUsage[model]))
    return undefined;
  const inputTokens = tokenCount(usage.input_tokens);
  const cachedTokens = tokenCount(usage.cache_read_input_tokens);
  const cacheCreationTokens = tokenCount(usage.cache_creation_input_tokens);
  const windowTokens = tokenCount(modelUsage[model].contextWindow);
  if (
    inputTokens === undefined ||
    cachedTokens === undefined ||
    cacheCreationTokens === undefined ||
    windowTokens === undefined ||
    windowTokens === 0
  ) {
    return undefined;
  }
  const usedTokens = inputTokens + cachedTokens + cacheCreationTokens;
  if (!Number.isSafeInteger(usedTokens)) return undefined;
  return { usedTokens, windowTokens };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function tokenCount(value: unknown): number | undefined {
  return typeof value === "number" && Number.isSafeInteger(value) && value >= 0 ? value : undefined;
}
