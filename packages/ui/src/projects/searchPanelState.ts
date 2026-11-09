/** Lógica pura da busca: sem React nem ponte. */
import type {
  SearchConversationResult,
  SearchMessageResult,
  SearchProjectResult,
  SearchResult,
} from "@karont/contract";

export type SearchEntry =
  | { key: string; kind: "conversation"; item: SearchConversationResult }
  | { key: string; kind: "project"; item: SearchProjectResult }
  | { key: string; kind: "message"; item: SearchMessageResult };

export type SearchGroupKind = SearchEntry["kind"];
export type SearchGroup = { kind: SearchGroupKind; entries: SearchEntry[] };

/** Grupos na ordem Conversas, Projetos, Mensagens; só os que têm itens. */
export function buildSearchGroups(result: SearchResult | null): SearchGroup[] {
  if (!result) return [];
  const groups: SearchGroup[] = [
    {
      kind: "conversation",
      entries: result.conversations.map((item) => ({
        key: `conversation:${item.conversationId}`,
        kind: "conversation" as const,
        item,
      })),
    },
    {
      kind: "project",
      entries: result.projects.map((item) => ({
        key: `project:${item.projectId}`,
        kind: "project" as const,
        item,
      })),
    },
    {
      kind: "message",
      entries: result.messages.map((item) => ({
        key: `message:${item.messageId}`,
        kind: "message" as const,
        item,
      })),
    },
  ];
  return groups.filter((group) => group.entries.length > 0);
}

/** Lista única para as setas: passa pelos grupos sem parar nos títulos. */
export function flattenSearchGroups(groups: readonly SearchGroup[]): SearchEntry[] {
  return groups.flatMap((group) => group.entries);
}

/** Seta para baixo ou para cima, voltando ao outro extremo nas pontas. */
export function moveSearchSelection(
  keys: readonly string[],
  selectedKey: string | null,
  direction: "next" | "previous",
): string | null {
  if (keys.length === 0) return null;
  const index = selectedKey === null ? -1 : keys.indexOf(selectedKey);
  if (index < 0) return direction === "next" ? (keys[0] ?? null) : (keys[keys.length - 1] ?? null);
  const next =
    direction === "next" ? (index + 1) % keys.length : (index - 1 + keys.length) % keys.length;
  return keys[next] ?? null;
}

export type SearchSelectionState = {
  keys: readonly string[];
  selectedKey: string | null;
  /** O usuário moveu a seleção com as setas nesta lista. */
  moved: boolean;
};

/**
 * Seleção quando chega uma resposta. A primeira linha fica selecionada, exceto se a lista que
 * chegou é a mesma que já estava na tela e o usuário já tinha movido as setas nela.
 */
export function selectionAfterResponse(
  previous: SearchSelectionState,
  nextKeys: readonly string[],
): SearchSelectionState {
  const sameList =
    previous.keys.length === nextKeys.length &&
    previous.keys.every((key, i) => key === nextKeys[i]);
  if (
    sameList &&
    previous.moved &&
    previous.selectedKey !== null &&
    nextKeys.includes(previous.selectedKey)
  ) {
    return { keys: nextKeys, selectedKey: previous.selectedKey, moved: true };
  }
  return { keys: nextKeys, selectedKey: nextKeys[0] ?? null, moved: false };
}

export type SearchShortcutInput = {
  key: string;
  ctrlKey: boolean;
  metaKey: boolean;
  altKey: boolean;
  shiftKey: boolean;
  repeat: boolean;
  isComposing: boolean;
  /** O foco está dentro de um terminal visível: lá o Ctrl K apaga a linha. */
  inTerminal: boolean;
  searchOpen: boolean;
};

/** Ctrl K abre ou fecha a busca; `ignore` deixa a tecla seguir para quem estava com o foco. */
export function decideSearchShortcut(input: SearchShortcutInput): "open" | "close" | "ignore" {
  if (input.key.toLowerCase() !== "k") return "ignore";
  if (!input.ctrlKey || input.metaKey || input.altKey || input.shiftKey) return "ignore";
  if (input.repeat || input.isComposing) return "ignore";
  if (input.searchOpen) return "close";
  if (input.inTerminal) return "ignore";
  return "open";
}

/** Só a resposta do pedido mais recente vale; cancelar invalida o que estiver pendente. */
export function createLatestGate() {
  let current = 0;
  return {
    begin(): number {
      current += 1;
      return current;
    },
    cancel(): void {
      current += 1;
    },
    isCurrent(token: number): boolean {
      return token === current;
    },
  };
}
