export type FileChangeDetail = { path: string; kind: string; diff: string };
export type DiffDisplayLine = {
  text: string;
  kind: "added" | "removed" | "hunk" | "context";
};

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
  for (const line of getDiffDisplayLines(diff)) {
    if (line.kind === "added") added += 1;
    else if (line.kind === "removed") removed += 1;
  }
  return { added, removed };
}

export function formatDiffStats(added: number, removed: number): string {
  const stats: string[] = [];
  if (added > 0) stats.push(`+${added}`);
  if (removed > 0) stats.push(`−${removed}`);
  return stats.join(" ");
}

export function getDiffDisplayLines(diff: string): DiffDisplayLine[] {
  const lines = diff.split(/\r?\n/u);
  const hunkCount = lines.filter((line) => line.startsWith("@@")).length;
  let inHunk = false;
  const displayLines: DiffDisplayLine[] = [];

  for (const line of lines) {
    if (line.startsWith("diff --git ")) {
      inHunk = false;
      continue;
    }
    if (line.startsWith("index ")) continue;
    if (line.startsWith("@@")) {
      inHunk = true;
      if (hunkCount > 1) displayLines.push({ text: line, kind: "hunk" });
      continue;
    }
    if (!inHunk && isFileHeader(line)) continue;

    const kind: DiffDisplayLine["kind"] = line.startsWith("+")
      ? "added"
      : line.startsWith("-")
        ? "removed"
        : "context";
    displayLines.push({ text: line, kind });
  }

  return displayLines;
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

function isFileHeader(line: string): boolean {
  return line === "+++" || line.startsWith("+++ ") || line === "---" || line.startsWith("--- ");
}
