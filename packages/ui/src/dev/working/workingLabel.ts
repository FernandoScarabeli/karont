import type { MessagePart } from "@karont/contract";

type ThinkingPart = Extract<MessagePart, { type: "thinking" }>;
type ActionPart = Extract<MessagePart, { type: "action" }>;

export function deriveWorkingLabel(parts: readonly MessagePart[]): string | null {
  const currentPart = parts.at(-1);
  if (!currentPart) return null;
  if (currentPart.type === "thinking") return "Pensando";
  if (currentPart.type !== "action" || currentPart.state !== "running") return null;

  switch (currentPart.actionType) {
    case "read": {
      const files = trailingRunningReads(parts);
      if (files.length > 1) return `Lendo ${files.length} arquivos`;
      return `Lendo ${shortFileName(currentPart.title)}`;
    }
    case "edit":
      return `Editando ${shortFileName(currentPart.title)}`;
    case "write":
      return `Escrevendo ${shortFileName(currentPart.title)}`;
    case "command":
      return `Rodando ${currentPart.title.trim()}`;
    case "search":
      return `Buscando ${currentPart.title.trim()}`;
    case "web":
      return `Pesquisando ${currentPart.title.trim()}`;
    case "other":
      return currentPart.title.trim();
  }
}

export function currentActionFiles(parts: readonly MessagePart[]): string[] {
  const currentPart = parts.at(-1);
  if (
    currentPart?.type !== "action" ||
    (currentPart.actionType !== "read" &&
      currentPart.actionType !== "edit" &&
      currentPart.actionType !== "write")
  ) {
    return [];
  }

  const actions = currentPart.actionType === "read" ? trailingRunningReads(parts) : [currentPart];

  return [...new Set(actions.map((action) => shortFileName(action.title)))];
}

function trailingRunningReads(parts: readonly MessagePart[]): ActionPart[] {
  const reads: ActionPart[] = [];
  for (let index = parts.length - 1; index >= 0; index -= 1) {
    const part = parts[index];
    if (part?.type !== "action" || part.actionType !== "read" || part.state !== "running") break;
    reads.push(part);
  }
  return reads;
}

function shortFileName(title: string): string {
  const paths = title.match(/(?:[\w.@-]+\/)*[\w.@-]+\.[a-z\d]+/gi);
  const path = paths?.at(-1);
  if (path) return path.split("/").at(-1) ?? path;
  return title.trim();
}

export function lastThinkingSentence(part: ThinkingPart | undefined): string {
  if (!part?.text.trim()) return "";
  const sentences = part.text.match(/[^.!?]+[.!?]+|[^.!?]+$/g);
  return sentences?.at(-1)?.trim() ?? part.text.trim();
}
