export type MarkdownBlock = {
  markdown: string;
  kind: "code" | "markdown";
  closed: boolean;
  hasFencedCode: boolean;
  start: number;
};

type BlockKind =
  | MarkdownBlock["kind"]
  | "paragraph"
  | "list-ul"
  | "list-ol-dot"
  | "list-ol-paren"
  | "quote"
  | "table"
  | "heading"
  | "rule";

type Fence = { marker: "`" | "~"; length: number };

export function splitMarkdownBlocks(markdown: string): MarkdownBlock[] {
  const normalizedMarkdown = markdown.replace(/\r\n/gu, "\n");
  const lines = normalizedMarkdown.split("\n");
  const nextNonBlankIndexes = new Array<number>(lines.length);
  let nextNonBlankIndex = -1;
  for (let index = lines.length - 1; index >= 0; index -= 1) {
    if (!/^\s*$/u.test(lines[index] ?? "")) nextNonBlankIndex = index;
    nextNonBlankIndexes[index] = nextNonBlankIndex;
  }
  const blocks: MarkdownBlock[] = [];
  let current: string[] = [];
  let currentStart = 0;
  let currentContainsFencedCode = false;
  let offset = 0;
  let currentKind: BlockKind = "paragraph";
  let openFence: Fence | null = null;

  const push = (closed: boolean) => {
    if (current.length === 0) return;
    blocks.push({
      markdown: current.join("\n"),
      kind: currentKind === "code" ? "code" : "markdown",
      closed,
      hasFencedCode: currentKind === "code" || currentContainsFencedCode,
      start: currentStart,
    });
    current = [];
    currentContainsFencedCode = false;
  };

  for (let index = 0; index < lines.length; index += 1) {
    const line = lines[index] ?? "";
    const lineStart = offset;
    offset += line.length + (index < lines.length - 1 ? 1 : 0);
    const isSingleTrailingNewline =
      index === lines.length - 1 &&
      /\n$/u.test(normalizedMarkdown) &&
      !/\n\s*\n$/u.test(normalizedMarkdown);
    if (isSingleTrailingNewline && openFence) continue;
    if (openFence) {
      current.push(line);
      if (isFenceClose(line, openFence)) {
        openFence = null;
        if (currentKind === "code") push(true);
      }
      continue;
    }

    if (/^\s*$/u.test(line)) {
      if (isSingleTrailingNewline) continue;
      if (currentKind.startsWith("list-")) {
        const nextIndex = nextNonBlankIndexes[index + 1] ?? -1;
        const nextLine = nextIndex >= 0 ? lines[nextIndex] : undefined;
        const nextKind = classifyLine(nextLine ?? "", lines[nextIndex + 1]);
        if (nextLine && (nextKind === currentKind || /^(?: {2,}|\t)\S/u.test(nextLine))) {
          current.push("");
          continue;
        }
      }
      push(true);
      continue;
    }

    const fence = getFence(line);
    const lineKind = classifyLine(line, lines[index + 1]);
    if (current.length === 0) {
      current = [line];
      currentStart = lineStart;
      currentKind = fence ? "code" : lineKind;
      currentContainsFencedCode = fence !== null;
      openFence = fence;
      if (lineKind === "rule") push(true);
      continue;
    }

    const currentIsList = currentKind.startsWith("list-");
    const currentStartsWithAtxHeading = /^ {0,3}#{1,6}(?:\s|$)/u.test(current[0] ?? "");
    const hasSetextUnderline =
      currentKind === "heading" &&
      current.length > 1 &&
      /^ {0,3}(?:=+|-+)\s*$/u.test(current[1] ?? "");
    const isSetextUnderline =
      currentKind === "heading" &&
      current.length === 1 &&
      !currentStartsWithAtxHeading &&
      lineKind === "rule";
    const startsNewBlock =
      currentStartsWithAtxHeading ||
      hasSetextUnderline ||
      lineKind === "heading" ||
      (lineKind === "rule" && !isSetextUnderline) ||
      (lineKind === "quote" &&
        currentKind !== "quote" &&
        (!currentIsList || !/^(?: {2,}|\t)>/u.test(line))) ||
      (lineKind === "table" && currentKind !== "table") ||
      (lineKind === "code" && currentKind !== "code" && !currentIsList) ||
      (lineKind.startsWith("list-") &&
        lineKind !== currentKind &&
        (!currentIsList || !/^(?: {2,}|\t)/u.test(line))) ||
      (fence !== null && (!currentIsList || !/^(?: {2,}|\t)/u.test(line))) ||
      (currentKind === "code" && lineKind !== "code") ||
      (currentKind === "table" && !line.includes("|"));

    if (startsNewBlock) {
      push(true);
      current = [line];
      currentStart = lineStart;
      currentKind = fence ? "code" : lineKind;
      currentContainsFencedCode = fence !== null;
      openFence = fence;
      if (lineKind === "rule") push(true);
      continue;
    }

    current.push(line);
    if (fence) {
      currentContainsFencedCode = true;
      openFence = fence;
    }
  }

  if (current.length > 0) push(openFence === null && currentKind === "code");
  return blocks;
}

function classifyLine(line: string, nextLine: string | undefined): BlockKind {
  if (/^ {0,3}#{1,6}(?:\s|$)/u.test(line)) return "heading";
  if (nextLine && /^ {0,3}(?:=+|-+)\s*$/u.test(nextLine)) return "heading";
  if (/^ {0,3}(?:[-*_]\s*){3,}$/u.test(line)) return "rule";
  if (/^ {0,3}>/u.test(line)) return "quote";
  if (/^ {0,3}[-+*]\s+/u.test(line)) return "list-ul";
  if (/^ {0,3}\d+[.)]\s+/u.test(line)) {
    return /^ {0,3}\d+\.\s+/u.test(line) ? "list-ol-dot" : "list-ol-paren";
  }
  if (isTableDelimiter(nextLine) && line.includes("|")) return "table";
  if (/^(?: {4}|\t)/u.test(line)) return "code";
  return "paragraph";
}

function getFence(line: string): Fence | null {
  const match = /^ {0,3}(`{3,}|~{3,})(.*)$/u.exec(line);
  if (!match?.[1]) return null;
  if (match[1][0] === "`" && match[2]?.includes("`")) return null;
  return { marker: match[1][0] as Fence["marker"], length: match[1].length };
}

function isFenceClose(line: string, fence: Fence): boolean {
  const escapedMarker = fence.marker === "`" ? "`" : "~";
  const match = new RegExp(`^ {0,3}(${escapedMarker}{${fence.length},})\\s*$`, "u").exec(line);
  return Boolean(match?.[1]);
}

function isTableDelimiter(line: string | undefined): boolean {
  if (!line) return false;
  return /^\s*\|?\s*:?-{3,}:?\s*(?:\|\s*:?-{3,}:?\s*)+\|?\s*$/u.test(line);
}
