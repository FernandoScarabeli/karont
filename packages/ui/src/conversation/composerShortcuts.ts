export type ComposerShortcutType = "file" | "skill" | "command";

export type ComposerShortcutTrigger = {
  type: ComposerShortcutType;
  start: number;
  caret: number;
  tokenEnd: number;
  query: string;
};

export type ComposerSkillReference = {
  name: string;
  path?: string;
};

export type SkillCatalogRequestState<T> = {
  conversationId: string;
  catalog: readonly T[] | null;
  promise: Promise<readonly T[]> | null;
};

export function requestSkillCatalogOnce<T>(
  state: { current: SkillCatalogRequestState<T> | null },
  conversationId: string,
  load: () => Promise<readonly T[]>,
): Promise<readonly T[]> {
  const current = state.current;
  if (current?.conversationId === conversationId) {
    if (current.catalog !== null) return Promise.resolve(current.catalog);
    if (current.promise) return current.promise;
  }

  const requestState: SkillCatalogRequestState<T> = {
    conversationId,
    catalog: null,
    promise: null,
  };
  const request = Promise.resolve()
    .then(load)
    .then((catalog) => {
      if (state.current === requestState) {
        requestState.catalog = catalog;
        requestState.promise = null;
      }
      return catalog;
    })
    .catch((error: unknown) => {
      if (state.current === requestState) state.current = null;
      throw error;
    });
  requestState.promise = request;
  state.current = requestState;
  return request;
}

export function hasSkillMention(value: string): boolean {
  return /(?:^|\s)\$[^\s$]+/u.test(value);
}

export function consumePendingComposerCaret(pending: { current: number | null }): number | null {
  const caret = pending.current;
  pending.current = null;
  return caret;
}

export function detectComposerShortcut(
  value: string,
  caret: number,
  supportsSkills = true,
): ComposerShortcutTrigger | null {
  if (caret < 0 || caret > value.length) return null;

  let start = caret;
  while (start > 0 && !/\s/u.test(value[start - 1] ?? "")) start -= 1;
  if (start > 0 && !/\s/u.test(value[start - 1] ?? "")) return null;

  const symbol = value[start];
  const type =
    symbol === "@" ? "file" : symbol === "$" ? "skill" : symbol === "/" ? "command" : null;
  if (!type || (type === "skill" && !supportsSkills)) return null;

  let tokenEnd = start + 1;
  while (tokenEnd < value.length && !/\s/u.test(value[tokenEnd] ?? "")) tokenEnd += 1;
  return {
    type,
    start,
    caret,
    tokenEnd,
    query: value.slice(start + 1, caret),
  };
}

export function insertComposerShortcut(
  value: string,
  trigger: ComposerShortcutTrigger,
  insertion: string,
): { value: string; caret: number } {
  const prefix = value.slice(0, trigger.start);
  let suffix = value.slice(trigger.tokenEnd);
  if (insertion.endsWith(" ") && suffix.startsWith(" ")) suffix = suffix.slice(1);
  const nextValue = `${prefix}${insertion}${suffix}`;
  return { value: nextValue, caret: prefix.length + insertion.length };
}

export function removeComposerCommand(
  value: string,
  trigger: ComposerShortcutTrigger,
): { value: string; caret: number } {
  const prefix = value.slice(0, trigger.start).replace(/\s+$/u, "");
  const suffix = value.slice(trigger.tokenEnd).replace(/^\s+/u, "");
  const separator = prefix && suffix ? " " : "";
  const nextValue = `${prefix}${separator}${suffix}`;
  return { value: nextValue, caret: prefix.length + separator.length };
}

export function fuzzyFilter<T>(
  items: readonly T[],
  query: string,
  getSearchText: (item: T) => string,
  limit = 50,
): T[] {
  if (limit <= 0) return [];
  const needle = normalizeSearchText(query);
  if (!needle) return items.slice(0, limit);

  return items
    .map((item, index) => ({
      item,
      index,
      score: fuzzyScore(normalizeSearchText(getSearchText(item)), needle),
    }))
    .filter((entry) => entry.score !== null)
    .sort((left, right) => (left.score ?? 0) - (right.score ?? 0) || left.index - right.index)
    .slice(0, limit)
    .map((entry) => entry.item);
}

export function findMentionedSkills(
  value: string,
  catalog: readonly ComposerSkillReference[],
  limit = 8,
): ComposerSkillReference[] {
  if (catalog.length === 0 || limit <= 0) return [];
  const names = new Map(catalog.map((skill) => [skill.name, skill]));
  const selected = new Map<string, ComposerSkillReference>();
  for (const match of value.matchAll(/(?:^|\s)\$([^\s$]+)/gu)) {
    const name = match[1]?.replace(/(?:[.,;:!?)]|["'‘’“”])+$/u, "");
    if (!name) continue;
    const skill = names.get(name);
    if (skill)
      selected.set(skill.name, { name: skill.name, ...(skill.path ? { path: skill.path } : {}) });
  }
  return [...selected.values()].slice(0, Math.min(8, limit));
}

function normalizeSearchText(value: string): string {
  return value
    .normalize("NFD")
    .replace(/\p{Diacritic}/gu, "")
    .toLocaleLowerCase("pt-BR");
}

function fuzzyScore(haystack: string, needle: string): number | null {
  const substringAt = haystack.indexOf(needle);
  if (substringAt >= 0) return substringAt === 0 ? 0 : 8 + substringAt;

  let cursor = 0;
  let first = -1;
  let previous = -1;
  let gaps = 0;
  for (const character of needle) {
    const foundAt = haystack.indexOf(character, cursor);
    if (foundAt < 0) return null;
    if (first < 0) first = foundAt;
    if (previous >= 0) gaps += foundAt - previous - 1;
    previous = foundAt;
    cursor = foundAt + 1;
  }
  return 24 + (first ?? 0) * 2 + gaps;
}
