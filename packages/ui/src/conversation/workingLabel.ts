import type { MessagePart } from "@karont/contract";
import { t } from "../i18n/pt-BR.ts";
import { mcpActionParts } from "./actionSummary.ts";

export type WorkingActionPart = Extract<MessagePart, { type: "action" }>;
type ThinkingPart = Extract<MessagePart, { type: "thinking" }>;

export function getFinalRunningActions(parts: readonly MessagePart[]): WorkingActionPart[] {
  const lastPart = parts.at(-1);
  if (lastPart?.type !== "action" || lastPart.state !== "running") return [];
  if (lastPart.actionType !== "read") return [lastPart];

  const actions: WorkingActionPart[] = [];
  for (let index = parts.length - 1; index >= 0; index -= 1) {
    const part = parts[index];
    if (part?.type !== "action" || part.actionType !== "read" || part.state !== "running") break;
    actions.push(part);
  }
  return actions.reverse();
}

export function deriveWorkingLabel(
  lastPart: MessagePart | undefined,
  actions: readonly WorkingActionPart[],
  stopping = false,
): string {
  if (stopping) return t.chat.stopping;
  if (!lastPart) return t.chat.working;
  if (lastPart.type === "text") return t.chat.responding;
  if (lastPart.type === "thinking") return t.chat.thinkingStep;
  if (lastPart.type !== "action" || lastPart.state !== "running") return t.chat.working;

  const files = currentActionFiles(actions);
  switch (lastPart.actionType) {
    case "read":
      if (actions.length > 1) return t.chat.readingFiles(actions.length);
      return files[0] ? t.chat.readingFile(files[0]) : t.chat.readingFilesUnknown;
    case "edit":
      return files.length > 1
        ? t.chat.editingFiles(files.length)
        : files[0]
          ? t.chat.editingFile(files[0])
          : t.chat.editingFilesUnknown;
    case "write":
      return files.length > 1
        ? t.chat.writingFiles(files.length)
        : files[0]
          ? t.chat.writingFile(files[0])
          : t.chat.writingFilesUnknown;
    case "command":
      return lastPart.title.trim() ? t.chat.runningAction(lastPart.title.trim()) : t.chat.working;
    case "search":
      return t.chat.searchingAction(searchDetail(lastPart.title));
    case "web":
      return t.chat.researchingAction(searchDetail(lastPart.title));
    case "subagent":
      return t.chat.runningSubagent;
    case "mcp": {
      const { server, tool } = mcpActionParts(lastPart);
      return t.chat.callingMcp(server, tool);
    }
    case "image":
      return t.chat.generatingImage;
    case "other":
      return lastPart.title.trim() || t.chat.working;
  }
}

export function currentActionFiles(actions: readonly WorkingActionPart[]): string[] {
  const files = actions.flatMap((action) => {
    if (
      action.actionType !== "read" &&
      action.actionType !== "edit" &&
      action.actionType !== "write"
    ) {
      return [];
    }
    return actionFileNames(action);
  });
  return [...new Set(files)];
}

export function lastThinkingSentence(part: ThinkingPart | undefined): string {
  if (!part?.text.trim()) return "";
  const sentences = part.text.match(/[^.!?]+[.!?]+|[^.!?]+$/g);
  return sentences?.at(-1)?.trim().replace(/\s+/g, " ") ?? part.text.trim();
}

function actionFileNames(action: WorkingActionPart): string[] {
  const candidates: { value: string; allowSpaces?: boolean }[] = [];
  const title = action.title.trim();
  const claudePath = title.match(/^(?:Read|Edit|Write)\s*·\s*(.+)$/i)?.[1];
  const codexReadName = title.match(/^Leu\s+(.+)$/i)?.[1];
  const codexFileChange = /^(?:Editou|Criou) arquivos$/i.test(title);
  if (claudePath) {
    candidates.push(
      { value: claudePath, allowSpaces: true },
      { value: action.input, allowSpaces: true },
    );
  }
  if (codexReadName) candidates.push({ value: codexReadName, allowSpaces: true });

  if (codexFileChange) {
    candidates.push(...inputPathLines(action.input).map((value) => ({ value, allowSpaces: true })));
  }

  candidates.push(
    ...fileTokens(title).map((value) => ({ value })),
    ...fileTokens(action.input).map((value) => ({ value })),
  );
  return [
    ...new Set(
      candidates
        .map(({ value, allowSpaces }) => shortFileName(value, allowSpaces))
        .filter((name): name is string => Boolean(name)),
    ),
  ];
}

function inputPathLines(input: string): string[] {
  return input.split(/\r?\n/).map(cleanPath).filter(Boolean);
}

function fileTokens(value: string): string[] {
  const matches = value.match(/(?:[\w@.-]+\/)*[\w@.-]+\.[a-z\d_-]+/gi) ?? [];
  return matches;
}

function shortFileName(value: string, allowSpaces = false): string | null {
  const path = cleanPath(value);
  if (!path || (!allowSpaces && /\s/.test(path))) return null;
  const fileName = path.split(/[\\/]/).at(-1)?.trim();
  return fileName || null;
}

function cleanPath(value: string): string {
  return value.trim().replace(/^[`"']+|[`"',;:)]+$/g, "");
}

function searchDetail(title: string): string {
  const detail = title
    .trim()
    .replace(/^(?:(?:Buscou|Buscando)\s+|(?:Glob|Grep|WebSearch|WebFetch)\s*·\s*)/i, "");
  return detail || title.trim();
}
