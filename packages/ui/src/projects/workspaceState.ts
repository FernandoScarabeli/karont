import type { Conversation, Project, TerminalInfo, Workspace } from "@karont/contract";
import {
  createInitialLayout,
  isValidLayout,
  type LayoutNode,
  listPanes,
  normalize,
  setView as setPaneView,
  validate,
} from "../workspace/layout.ts";

/** Chave usada só quando a lista de workspaces não carrega: o layout cai na chave antiga. */
export const LOCAL_WORKSPACE_KEY = "local";
/** Chave antiga, de quando havia um único layout para o app inteiro. */
export const LEGACY_LAYOUT_SETTING = "workspace.layout";
export const ACTIVE_WORKSPACE_SETTING = "workspace.active";

export type WorkspaceMark = "waiting" | "working";

/** Mesma ordem do serviço: `position`, e a ordem recebida desempata. */
export function sortWorkspaces(workspaces: readonly Workspace[]): Workspace[] {
  return workspaces
    .map((workspace, index) => ({ workspace, index }))
    .sort(
      (left, right) =>
        left.workspace.position - right.workspace.position || left.index - right.index,
    )
    .map((entry) => entry.workspace);
}

/** O workspace salvo, se ainda existir; senão o primeiro da lista; `null` só com a lista vazia. */
export function pickActiveWorkspaceId(
  workspaces: readonly Workspace[],
  savedId: string | null | undefined,
): string | null {
  if (savedId && workspaces.some((workspace) => workspace.id === savedId)) return savedId;
  return sortWorkspaces(workspaces)[0]?.id ?? null;
}

/** Para onde vão projetos e conversas ao apagar: o de menor `position` que sobrar (como no serviço). */
export function removalTarget(workspaces: readonly Workspace[], id: string): Workspace | null {
  return sortWorkspaces(workspaces.filter((workspace) => workspace.id !== id))[0] ?? null;
}

export function filterByWorkspace<T extends { workspaceId: string }>(
  items: readonly T[],
  workspaceId: string | null,
): T[] {
  if (workspaceId === null) return [...items];
  return items.filter((item) => item.workspaceId === workspaceId);
}

/**
 * Marca da aba de cada workspace: "precisa de você" vence "trabalhando", como nas bolinhas
 * da sidebar. Vem só das conversas que já estão em memória.
 */
export function workspaceMarks(
  conversations: readonly Pick<Conversation, "workspaceId" | "state">[],
): Map<string, WorkspaceMark> {
  const marks = new Map<string, WorkspaceMark>();
  for (const conversation of conversations) {
    if (conversation.state === "waiting") marks.set(conversation.workspaceId, "waiting");
    else if (conversation.state === "working" && !marks.has(conversation.workspaceId)) {
      marks.set(conversation.workspaceId, "working");
    }
  }
  return marks;
}

export type TerminalGroups = {
  /** Terminais de cada projeto do workspace. */
  byProject: Map<string, TerminalInfo[]>;
  /** Terminais sem projeto, ou de um projeto que não está no workspace. */
  loose: TerminalInfo[];
};

/**
 * Terminal aberto dentro de um projeto aparece dentro dele, como as conversas. Enquanto os
 * projetos carregam, terminal com `projectId` espera, para não pular de lugar.
 */
export function groupTerminals(
  terminals: readonly TerminalInfo[],
  projects: readonly Pick<Project, "id">[],
  projectsLoading: boolean,
): TerminalGroups {
  const byProject = new Map<string, TerminalInfo[]>(
    projects.map((project) => [project.id, [] as TerminalInfo[]]),
  );
  const loose: TerminalInfo[] = [];
  for (const terminal of terminals) {
    const group = terminal.projectId ? byProject.get(terminal.projectId) : undefined;
    if (group) group.push(terminal);
    else if (!terminal.projectId || !projectsLoading) loose.push(terminal);
  }
  return { byProject, loose };
}

export type WorkspaceMove = {
  workspaceId: string;
  fromWorkspaceId?: string | undefined;
  projectId?: string | undefined;
};

/** Diz se a cópia local da conversa precisa trocar de workspace por causa do evento. */
export function isAffectedByWorkspaceMove(
  conversation: Pick<Conversation, "workspaceId" | "projectId">,
  move: WorkspaceMove,
): boolean {
  if (conversation.workspaceId === move.workspaceId) return false;
  if (move.fromWorkspaceId !== undefined) return conversation.workspaceId === move.fromWorkspaceId;
  if (move.projectId !== undefined) return conversation.projectId === move.projectId;
  return false;
}

/** Chave de `settings` do layout de um workspace (as chaves não aceitam hífen nem passam de 64). */
export function layoutSettingKey(workspaceId: string): string {
  if (workspaceId === LOCAL_WORKSPACE_KEY) return LEGACY_LAYOUT_SETTING;
  const safe = workspaceId.replace(/[^a-zA-Z0-9]/g, "").slice(0, 40);
  return `${LEGACY_LAYOUT_SETTING}.${safe}`;
}

export type RestoredLayouts = {
  layouts: Record<string, LayoutNode>;
  activePaneIds: Record<string, string>;
  /** Workspaces que tinham layout salvo de verdade (próprio ou migrado). */
  hadLayout: Record<string, boolean>;
  /** O layout da chave antiga foi usado: quem chama deve limpá-la. */
  migratedLegacy: boolean;
};

/**
 * Monta o layout de cada workspace a partir do que estava salvo. O layout da chave antiga
 * vale uma vez só, para o workspace ativo que ainda não tem layout próprio.
 */
export function restoreWorkspaceLayouts(input: {
  workspaceIds: readonly string[];
  activeId: string;
  saved: Readonly<Record<string, unknown>>;
  legacy: unknown;
  terminalIds: ReadonlySet<string> | null;
}): RestoredLayouts {
  const layouts: Record<string, LayoutNode> = {};
  const activePaneIds: Record<string, string> = {};
  const hadLayout: Record<string, boolean> = {};
  let migratedLegacy = false;

  for (const id of input.workspaceIds) {
    const own = input.saved[id];
    let source: unknown = null;
    if (isValidLayout(own)) {
      source = own;
    } else if (id === input.activeId && isValidLayout(input.legacy)) {
      source = input.legacy;
      migratedLegacy = true;
    }
    let restored = source ? validate(source) : createInitialLayout();
    if (input.terminalIds) {
      for (const pane of listPanes(restored)) {
        if (pane.view.kind === "terminal" && !input.terminalIds.has(pane.view.terminalId)) {
          restored = setPaneView(restored, pane.id, { kind: "new-conversation" });
        }
      }
    }
    restored = normalize(restored);
    layouts[id] = restored;
    activePaneIds[id] = listPanes(restored)[0]?.id ?? "pane-1";
    hadLayout[id] = source !== null;
  }
  return { layouts, activePaneIds, hadLayout, migratedLegacy };
}
