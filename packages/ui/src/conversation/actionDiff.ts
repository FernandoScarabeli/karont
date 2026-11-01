export type FileChangeDetail = { path: string; kind: string; diff: string };

export function parseFileChanges(output: string): FileChangeDetail[] {
  let parsed: unknown;
  try {
    parsed = JSON.parse(output);
  } catch {
    return [];
  }
  if (isRecord(parsed) && "changes" in parsed) parsed = parsed.changes;
  if (Array.isArray(parsed)) return parsed.flatMap((item) => fileChangeItem(item));
  if (!isRecord(parsed)) return [];
  if (typeof parsed.path === "string") return fileChangeItem(parsed);
  return Object.entries(parsed).flatMap(([path, value]) => fileChangeItem(value, path));
}

export function countDiffLines(diff: string): { added: number; removed: number } {
  let added = 0;
  let removed = 0;
  let inHunk = false;
  for (const line of diff.split(/\r?\n/u)) {
    if (line.startsWith("@@")) inHunk = true;
    if (
      !inHunk &&
      (line === "+++" || line.startsWith("+++ ") || line === "---" || line.startsWith("--- "))
    ) {
      continue;
    }
    if (line.startsWith("+")) added += 1;
    else if (line.startsWith("-")) removed += 1;
  }
  return { added, removed };
}

function fileChangeItem(value: unknown, fallbackPath = ""): FileChangeDetail[] {
  if (!isRecord(value)) return [];
  const path = typeof value.path === "string" ? value.path : fallbackPath;
  if (!path.trim()) return [];
  return [
    {
      path: path.trim(),
      kind:
        typeof value.kind === "string"
          ? value.kind
          : isRecord(value.kind) && typeof value.kind.type === "string"
            ? value.kind.type
            : typeof value.type === "string"
              ? value.type
              : "",
      diff:
        typeof value.diff === "string"
          ? value.diff
          : typeof value.unifiedDiff === "string"
            ? value.unifiedDiff
            : "",
    },
  ];
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}
