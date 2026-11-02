export type FileChangeDetail = { path: string; kind: string; diff: string };
export type DiffDisplayLine = {
  text: string;
  kind: "added" | "removed" | "separator" | "context";
  oldLine?: number;
  newLine?: number;
};

const hunkHeaderPattern = /^@@\s+-(\d+)(?:,(\d+))?\s+\+(\d+)(?:,(\d+))?\s+@@(?:\s.*)?$/u;

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
  let inHunk = false;
  let oldLine: number | undefined;
  let newLine: number | undefined;
  let hunkCount = 0;
  const displayLines: DiffDisplayLine[] = [];

  for (const line of lines) {
    if (!line) continue;
    if (line.startsWith("diff --git ")) {
      inHunk = false;
      oldLine = undefined;
      newLine = undefined;
      hunkCount = 0;
      continue;
    }
    if (line.startsWith("index ") || line.startsWith("\\ No newline at end of file")) continue;

    const hunkHeader = hunkHeaderPattern.exec(line);
    if (hunkHeader) {
      inHunk = true;
      hunkCount += 1;
      oldLine = Number(hunkHeader[1]);
      newLine = Number(hunkHeader[3]);
      if (hunkCount > 1) displayLines.push({ text: "⋯", kind: "separator" });
      continue;
    }
    if (line.startsWith("@@")) continue;

    const kind: DiffDisplayLine["kind"] = line.startsWith("+")
      ? "added"
      : line.startsWith("-")
        ? "removed"
        : "context";
    if (!inHunk && isFileHeader(line)) continue;

    const text = kind === "context" ? (line.startsWith(" ") ? line.slice(1) : line) : line.slice(1);
    const displayLine: DiffDisplayLine = { text, kind };
    if (kind !== "added" && oldLine !== undefined) displayLine.oldLine = oldLine++;
    if (kind !== "removed" && newLine !== undefined) displayLine.newLine = newLine++;
    displayLines.push(displayLine);
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
