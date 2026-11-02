import {
  MAX_MESSAGE_SOURCES,
  type MessageSource,
  normalizeSourceUrl,
  safeSourceUrl,
} from "@karont/contract";

const SOURCE_TITLE_LIMIT = 240;
const SOURCE_SNIPPET_LIMIT = 720;
const SOURCE_DATE_LIMIT = 80;

export function makeMessageSource(input: {
  url: unknown;
  title?: unknown;
  snippet?: unknown;
  date?: unknown;
}): MessageSource | null {
  if (typeof input.url !== "string") return null;
  const url = safeSourceUrl(input.url);
  if (!url) return null;
  const title = cleanSourceText(input.title, SOURCE_TITLE_LIMIT);
  const snippet = cleanSourceText(input.snippet, SOURCE_SNIPPET_LIMIT);
  const date = cleanSourceText(input.date, SOURCE_DATE_LIMIT);
  return {
    url,
    ...(title ? { title } : {}),
    ...(snippet ? { snippet } : {}),
    ...(date ? { date } : {}),
  };
}

export function mergeMessageSources(
  current: readonly MessageSource[],
  additions: readonly MessageSource[],
): MessageSource[] {
  const merged = new Map<string, MessageSource>();
  for (const source of [...current, ...additions]) {
    const key = normalizeSourceUrl(source.url);
    if (!key) continue;
    const prior = merged.get(key);
    if (prior) merged.set(key, { ...prior, ...source });
    else if (merged.size < MAX_MESSAGE_SOURCES) merged.set(key, source);
  }
  return [...merged.values()];
}

function cleanSourceText(value: unknown, maxLength: number): string | undefined {
  if (typeof value !== "string") return undefined;
  const text = value.replace(/\s+/gu, " ").trim().slice(0, maxLength);
  return text || undefined;
}
