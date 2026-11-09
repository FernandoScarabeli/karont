import {
  createContext,
  type PropsWithChildren,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { getBridge } from "../bridge/index.ts";
import { getConversationIndexEntry } from "../conversation/useConversationIndex.ts";
import { t } from "../i18n/pt-BR.ts";
import {
  hasOpenContent,
  isOverviewVisible,
  type OverviewOverride,
  overrideAfterActiveTabClick,
  shouldClearOverrideOnLayoutChange,
} from "../projects/overviewVisibility.ts";
import { getProject } from "../projects/useProjects.ts";
import { getWorkspaces, setActiveWorkspace, useWorkspaces } from "../projects/useWorkspaces.ts";
import {
  LEGACY_LAYOUT_SETTING,
  LOCAL_WORKSPACE_KEY,
  layoutSettingKey,
  restoreWorkspaceLayouts,
} from "../projects/workspaceState.ts";
import {
  closePane as closePaneInLayout,
  EMPTY_LAYOUT,
  findPane,
  findPaneByConversation,
  findPaneByTerminal,
  isValidLayout,
  type LayoutNode,
  listPanes,
  movePane as movePaneInLayout,
  type PaneEdge,
  type PaneView,
  paneCount,
  resolveActivePaneId,
  selectTerminalPane,
  setSizes as setLayoutSizes,
  setView as setPaneView,
  splitPane as splitPaneInLayout,
} from "../workspace/layout.ts";

export type View =
  | { name: "home" }
  | { name: "workspace" }
  | { name: "inbox" }
  | {
      name: "settings";
      section: "general" | "profile" | "appearance" | "agents" | "diagnostics" | "dot";
    };

export type NavigationTarget =
  | View
  | { name: "new-conversation"; projectId?: string; workspaceId?: string }
  | { name: "conversation"; id: string; workspaceId?: string }
  | { name: "terminal"; id: string; workspaceId?: string };

type NavigationState = {
  view: View;
  /** Workspace ativo (ou `local`, se a lista de workspaces não carregou). */
  activeWorkspaceId: string;
  /** Layout e painel ativo do workspace ativo. */
  layout: LayoutNode;
  activePaneId: string;
  /** Layout e painel ativo de cada workspace, para manter os outros montados. */
  layouts: Record<string, LayoutNode>;
  activePaneIds: Record<string, string>;
  statusMessage: string;
  /** A tela do workspace (resumo) está por cima dos painéis do workspace ativo. */
  workspaceOverviewVisible: boolean;
  navigate: (view: NavigationTarget) => void;
  setLeaveGuard: (guard: ((proceed: () => void) => boolean) | null) => void;
  /**
   * Ativa o workspace e mostra a área de trabalho dele. Na aba em que já se está, alterna entre a
   * tela do workspace e as conversas abertas.
   */
  openWorkspace: (workspaceId: string) => void;
  setActivePane: (paneId: string) => void;
  splitActivePane: (direction: "row" | "column", paneId?: string) => string | null;
  /** Devolve o painel; `null` se não coube; `undefined` se a saída ainda espera confirmação. */
  openConversationBeside: (conversationId: string) => string | null | undefined;
  closeConversationWorkspacePanes: (conversationId: string) => void;
  closeAllConversationPanes: () => void;
  closeWorkspacePane: (paneId: string) => void;
  closeTerminalWorkspacePane: (terminalId: string) => void;
  moveWorkspacePane: (paneId: string, targetPaneId: string, edge: PaneEdge) => void;
  resizeWorkspaceSplit: (splitId: string, sizes: number[]) => void;
};

type NavigationSnapshot = Pick<
  NavigationState,
  | "view"
  | "activeWorkspaceId"
  | "layout"
  | "activePaneId"
  | "layouts"
  | "activePaneIds"
  | "statusMessage"
  | "workspaceOverviewVisible"
>;
type NavigationActions = Omit<NavigationState, keyof NavigationSnapshot>;

const LAST_VIEW_SETTING = "navigation.lastView";
type PersistedView = "home" | "workspace" | "settings";

const NavigationStateContext = createContext<NavigationSnapshot | null>(null);
const NavigationActionsContext = createContext<NavigationActions | null>(null);

export function NavigationProvider({ children }: PropsWithChildren) {
  const bridge = getBridge();
  const workspacesState = useWorkspaces();
  const activeWorkspaceId = workspacesState.activeId ?? LOCAL_WORKSPACE_KEY;
  const [view, setView] = useState<View>({ name: "home" });
  const [layouts, setLayouts] = useState<Record<string, LayoutNode>>({});
  const [activePaneIds, setActivePaneIds] = useState<Record<string, string>>({});
  const [overviewOverrides, setOverviewOverrides] = useState<Record<string, OverviewOverride>>({});
  const [statusMessage, setStatusMessage] = useState("");
  const [layoutLoaded, setLayoutLoaded] = useState(false);
  const [navigationLoaded, setNavigationLoaded] = useState(false);
  const layout = layouts[activeWorkspaceId] ?? EMPTY_LAYOUT;
  const activePaneId = resolveActivePaneId(layout, activePaneIds[activeWorkspaceId]);
  const workspaceOverviewVisible =
    layoutLoaded && isOverviewVisible(hasOpenContent(layout), overviewOverrides[activeWorkspaceId]);
  const navigationRef = useRef({
    layout,
    activePaneId,
    layouts,
    activePaneIds,
    activeWorkspaceId,
    view,
    workspaceOverviewVisible,
  });
  navigationRef.current = {
    layout,
    activePaneId,
    layouts,
    activePaneIds,
    activeWorkspaceId,
    view,
    workspaceOverviewVisible,
  };
  /** Último layout de cada workspace que já está salvo, para só salvar o que mudou. */
  const savedLayoutsRef = useRef(new Map<string, LayoutNode>());
  const workspacesReady = !workspacesState.loading;
  const workspaceIdsKey = workspacesState.workspaces.map((workspace) => workspace.id).join("|");

  const setLayoutFor = useCallback(
    (workspaceId: string, update: LayoutNode | ((current: LayoutNode) => LayoutNode)) => {
      setLayouts((current) => {
        const previous = current[workspaceId] ?? EMPTY_LAYOUT;
        const next = typeof update === "function" ? update(previous) : update;
        return next === current[workspaceId] ? current : { ...current, [workspaceId]: next };
      });
    },
    [],
  );
  const setActivePaneFor = useCallback(
    (workspaceId: string, update: string | ((current: string) => string)) => {
      setActivePaneIds((current) => {
        const previous = current[workspaceId] ?? EMPTY_LAYOUT.id;
        const next = typeof update === "function" ? update(previous) : update;
        return next === current[workspaceId] ? current : { ...current, [workspaceId]: next };
      });
    },
    [],
  );
  const setLayout = useCallback(
    (update: LayoutNode | ((current: LayoutNode) => LayoutNode)) =>
      setLayoutFor(navigationRef.current.activeWorkspaceId, update),
    [setLayoutFor],
  );
  const setActivePaneId = useCallback(
    (update: string | ((current: string) => string)) =>
      setActivePaneFor(navigationRef.current.activeWorkspaceId, update),
    [setActivePaneFor],
  );
  const setOverviewFor = useCallback((workspaceId: string, value: OverviewOverride | undefined) => {
    setOverviewOverrides((current) => {
      if (current[workspaceId] === value) return current;
      const next = { ...current };
      if (value) next[workspaceId] = value;
      else delete next[workspaceId];
      return next;
    });
  }, []);
  /** Aplica a mudança a todos os workspaces (uma conversa ou terminal pode estar em qualquer um). */
  const updateAllLayouts = useCallback((update: (current: LayoutNode) => LayoutNode) => {
    // Quem perdeu conversa ou terminal volta a mostrar a tela do workspace.
    const cleared: string[] = [];
    for (const [id, value] of Object.entries(navigationRef.current.layouts)) {
      const updated = update(value);
      if (
        updated !== value &&
        shouldClearOverrideOnLayoutChange(hasOpenContent(value), hasOpenContent(updated))
      ) {
        cleared.push(id);
      }
    }
    if (cleared.length > 0) {
      setOverviewOverrides((current) => {
        if (!cleared.some((id) => current[id])) return current;
        const next = { ...current };
        for (const id of cleared) delete next[id];
        return next;
      });
    }
    setLayouts((current) => {
      let changed = false;
      const next: Record<string, LayoutNode> = {};
      for (const [id, value] of Object.entries(current)) {
        const updated = update(value);
        if (updated !== value) changed = true;
        next[id] = updated;
      }
      return changed ? next : current;
    });
  }, []);

  // biome-ignore lint/correctness/useExhaustiveDependencies: carrega uma vez, quando a lista de workspaces fica pronta.
  useEffect(() => {
    if (!workspacesReady) return;
    if (!bridge) {
      setLayoutLoaded(true);
      setNavigationLoaded(true);
      return;
    }

    const workspaceIds = workspacesState.workspaces.map((workspace) => workspace.id);
    const activeId = workspacesState.activeId ?? LOCAL_WORKSPACE_KEY;
    const idsToLoad = workspaceIds.length > 0 ? workspaceIds : [LOCAL_WORKSPACE_KEY];
    let mounted = true;
    void Promise.allSettled([
      bridge.request("settings.get", { key: LEGACY_LAYOUT_SETTING }),
      bridge.request("terminals.list", {}),
      bridge.request("settings.get", { key: LAST_VIEW_SETTING }),
      ...idsToLoad.map((id) => bridge.request("settings.get", { key: layoutSettingKey(id) })),
    ]).then(([legacyResult, terminalsResult, lastViewResult, ...savedResults]) => {
      if (!mounted) return;
      const legacy = legacyResult.status === "fulfilled" ? legacyResult.value.value : null;
      const saved: Record<string, unknown> = {};
      idsToLoad.forEach((id, index) => {
        const result = savedResults[index];
        // A chave do modo local é a antiga: ela só entra como migração.
        if (id !== LOCAL_WORKSPACE_KEY && result?.status === "fulfilled") {
          saved[id] = result.value.value;
        }
      });
      const restored = restoreWorkspaceLayouts({
        workspaceIds: idsToLoad,
        activeId,
        saved,
        legacy,
        terminalIds:
          terminalsResult.status === "fulfilled"
            ? new Set(terminalsResult.value.terminals.map((terminal) => terminal.id))
            : null,
      });
      for (const id of idsToLoad) {
        const restoredLayout = restored.layouts[id];
        if (restoredLayout && isValidLayout(saved[id])) {
          savedLayoutsRef.current.set(id, restoredLayout);
        }
      }
      if (restored.migratedLegacy && activeId !== LOCAL_WORKSPACE_KEY) {
        // O layout antigo passou a ser o do workspace ativo; a chave antiga não vale mais.
        void bridge.request("settings.set", { key: LEGACY_LAYOUT_SETTING, value: null });
      }
      setLayouts((current) => ({ ...restored.layouts, ...current }));
      setActivePaneIds((current) => ({ ...restored.activePaneIds, ...current }));
      const lastView = lastViewResult.status === "fulfilled" ? lastViewResult.value.value : null;
      const restoredView: View =
        lastView === "settings"
          ? { name: "settings", section: "general" }
          : lastView === "workspace" && restored.hadLayout[activeId]
            ? { name: "workspace" }
            : { name: "home" };
      setView(restoredView);
      setLayoutLoaded(true);
      setNavigationLoaded(true);
    });

    return () => {
      mounted = false;
    };
  }, [bridge, workspacesReady]);

  // Workspace apagado: os painéis dele deixam de existir (terminais e conversas seguem vivos).
  // biome-ignore lint/correctness/useExhaustiveDependencies: reage à lista de ids, não ao objeto.
  useEffect(() => {
    if (!layoutLoaded || !workspacesReady || workspacesState.workspaces.length === 0) return;
    const known = new Set(workspacesState.workspaces.map((workspace) => workspace.id));
    const prune = <T,>(current: Record<string, T>) => {
      const stale = Object.keys(current).filter((id) => !known.has(id));
      if (stale.length === 0) return current;
      const next = { ...current };
      for (const id of stale) delete next[id];
      return next;
    };
    for (const id of [...savedLayoutsRef.current.keys()]) {
      if (!known.has(id)) savedLayoutsRef.current.delete(id);
    }
    setLayouts(prune);
    setActivePaneIds(prune);
    setOverviewOverrides(prune);
  }, [layoutLoaded, workspacesReady, workspaceIdsKey]);

  useEffect(() => {
    if (!bridge || !navigationLoaded) return;
    // A caixa de entrada não é lembrada: ao abrir o app volta-se à última tela de antes dela.
    if (view.name === "inbox") return;
    const lastView: PersistedView = view.name;
    void bridge.request("settings.set", { key: LAST_VIEW_SETTING, value: lastView }).catch(() => {
      setStatusMessage(t.workspace.navigationSaveFailed);
    });
  }, [bridge, navigationLoaded, view.name]);

  useEffect(() => {
    if (!bridge) return;
    return bridge.onEvent((event) => {
      if (event.event === "conversation.deletedAll") {
        updateAllLayouts(resetConversationPanes);
      }
    });
  }, [bridge, updateAllLayouts]);

  useEffect(() => {
    if (!bridge || !layoutLoaded) return;
    const timeouts: number[] = [];
    for (const [id, value] of Object.entries(layouts)) {
      if (savedLayoutsRef.current.get(id) === value) continue;
      timeouts.push(
        window.setTimeout(() => {
          savedLayoutsRef.current.set(id, value);
          void bridge.request("settings.set", { key: layoutSettingKey(id), value }).catch(() => {
            setStatusMessage(t.workspace.layoutSaveFailed);
          });
        }, 500),
      );
    }
    return () => {
      for (const timeout of timeouts) window.clearTimeout(timeout);
    };
  }, [bridge, layouts, layoutLoaded]);

  const setActivePane = useCallback(
    (paneId: string) => {
      if (!findPane(navigationRef.current.layout, paneId)) return;
      setActivePaneId((current) => (current === paneId ? current : paneId));
      setView((current) => (current.name === "workspace" ? current : { name: "workspace" }));
    },
    [setActivePaneId],
  );

  const openWorkspace = useCallback(
    (workspaceId: string) => {
      const current = navigationRef.current;
      if (current.view.name === "workspace" && workspaceId === current.activeWorkspaceId) {
        // Clique na aba em que já se está: alterna entre a tela do workspace e as conversas.
        setOverviewFor(
          workspaceId,
          overrideAfterActiveTabClick(
            hasOpenContent(current.layout),
            current.workspaceOverviewVisible,
          ),
        );
        return;
      }
      setActiveWorkspace(workspaceId);
      setView((view) => (view.name === "workspace" ? view : { name: "workspace" }));
    },
    [setOverviewFor],
  );

  const navigate = useCallback(
    (target: NavigationTarget) => {
      const current = navigationRef.current;
      // Conversa, terminal ou projeto de outro workspace: ativa esse workspace antes e abre no layout dele.
      let workspaceId = current.activeWorkspaceId;
      const owner =
        target.name === "conversation"
          ? (target.workspaceId ?? getConversationIndexEntry(target.id)?.workspaceId)
          : target.name === "terminal"
            ? target.workspaceId
            : target.name === "new-conversation"
              ? (target.workspaceId ??
                (target.projectId ? getProject(target.projectId)?.workspaceId : undefined))
              : undefined;
      if (
        owner &&
        owner !== workspaceId &&
        getWorkspaces().some((workspace) => workspace.id === owner)
      ) {
        workspaceId = owner;
        setActiveWorkspace(owner);
      }
      const currentLayout = current.layouts[workspaceId] ?? EMPTY_LAYOUT;
      const currentPaneId = resolveActivePaneId(currentLayout, current.activePaneIds[workspaceId]);
      const showWorkspace = () =>
        setView((view) => (view.name === "workspace" ? view : { name: "workspace" }));

      if (target.name === "new-conversation") {
        const paneView: PaneView = target.projectId
          ? { kind: "new-conversation", projectId: target.projectId }
          : { kind: "new-conversation" };
        setLayoutFor(workspaceId, (layoutNow) => setPaneView(layoutNow, currentPaneId, paneView));
        setActivePaneFor(workspaceId, currentPaneId);
        // "Nova conversa" abre limpa, só com o campo de mensagem.
        setOverviewFor(workspaceId, "hide");
        showWorkspace();
        return;
      }
      if (target.name === "terminal") {
        setOverviewFor(workspaceId, undefined);
        const selected = selectTerminalPane(currentLayout, currentPaneId, target.id);
        if (selected.tree !== currentLayout) setLayoutFor(workspaceId, selected.tree);
        setActivePaneFor(workspaceId, selected.paneId);
        showWorkspace();
        return;
      }
      if (target.name === "conversation") {
        setOverviewFor(workspaceId, undefined);
        const existing = findPaneByConversation(currentLayout, target.id);
        if (existing) {
          setActivePaneFor(workspaceId, existing.id);
        } else {
          setLayoutFor(workspaceId, (layoutNow) =>
            setPaneView(layoutNow, currentPaneId, { kind: "chat", conversationId: target.id }),
          );
          setActivePaneFor(workspaceId, currentPaneId);
        }
        showWorkspace();
        return;
      }
      setView(target);
    },
    [setActivePaneFor, setLayoutFor, setOverviewFor],
  );

  const splitActivePane = useCallback(
    (direction: "row" | "column", paneId?: string) => {
      const currentLayout = navigationRef.current.layout;
      const targetPaneId = paneId ?? navigationRef.current.activePaneId;
      if (paneCount(currentLayout) >= 6) return null;
      const previousIds = new Set(listPanes(currentLayout).map((pane) => pane.id));
      const nextLayout = splitPaneInLayout(currentLayout, targetPaneId, direction, "after", {
        kind: "new-conversation",
      });
      const newPane = listPanes(nextLayout).find((pane) => !previousIds.has(pane.id));
      if (!newPane) return null;
      setLayout(nextLayout);
      setActivePaneId(newPane.id);
      setView({ name: "workspace" });
      setStatusMessage(t.workspace.paneSplit);
      return newPane.id;
    },
    [setActivePaneId, setLayout],
  );

  const openConversationBeside = useCallback(
    (conversationId: string) => {
      const { layout: currentLayout, activePaneId: currentPaneId } = navigationRef.current;
      const existing = findPaneByConversation(currentLayout, conversationId);
      setOverviewFor(navigationRef.current.activeWorkspaceId, undefined);
      if (existing) {
        setActivePaneId(existing.id);
        setView((current) => (current.name === "workspace" ? current : { name: "workspace" }));
        return existing.id;
      }
      if (paneCount(currentLayout) >= 6) return null;
      const nextLayout = splitPaneInLayout(currentLayout, currentPaneId, "row", "after", {
        kind: "chat",
        conversationId,
      });
      const nextPane = listPanes(nextLayout).find(
        (pane) => pane.view.kind === "chat" && pane.view.conversationId === conversationId,
      );
      if (!nextPane) return null;
      setLayout(nextLayout);
      setActivePaneId(nextPane.id);
      setView({ name: "workspace" });
      setStatusMessage(t.workspace.paneSplit);
      return nextPane.id;
    },
    [setActivePaneId, setLayout, setOverviewFor],
  );

  const closeConversationWorkspacePanes = useCallback(
    (conversationId: string) => {
      updateAllLayouts((current) => {
        let next = current;
        for (const pane of listPanes(current)) {
          if (pane.view.kind === "chat" && pane.view.conversationId === conversationId) {
            next = setPaneView(next, pane.id, { kind: "new-conversation" });
          }
        }
        return next;
      });
    },
    [updateAllLayouts],
  );

  const closeAllConversationPanes = useCallback(() => {
    updateAllLayouts(resetConversationPanes);
  }, [updateAllLayouts]);

  const closeWorkspacePane = useCallback(
    (paneId: string) => {
      const { layout: currentLayout, activePaneId: currentActivePaneId } = navigationRef.current;
      const nextLayout = closePaneInLayout(currentLayout, paneId);
      setLayout(nextLayout);
      if (
        shouldClearOverrideOnLayoutChange(hasOpenContent(currentLayout), hasOpenContent(nextLayout))
      ) {
        setOverviewFor(navigationRef.current.activeWorkspaceId, undefined);
      }
      if (paneId === currentActivePaneId || !findPane(nextLayout, currentActivePaneId)) {
        setActivePaneId(
          findPane(nextLayout, paneId)?.id ?? listPanes(nextLayout)[0]?.id ?? "pane-1",
        );
      }
      setView({ name: "workspace" });
      setStatusMessage(t.workspace.paneClosed);
    },
    [setActivePaneId, setLayout, setOverviewFor],
  );

  const closeTerminalWorkspacePane = useCallback(
    (terminalId: string) => {
      updateAllLayouts((current) => {
        const pane = findPaneByTerminal(current, terminalId);
        return pane ? setPaneView(current, pane.id, { kind: "new-conversation" }) : current;
      });
    },
    [updateAllLayouts],
  );

  const moveWorkspacePane = useCallback(
    (paneId: string, targetPaneId: string, edge: PaneEdge) => {
      const currentLayout = navigationRef.current.layout;
      const nextLayout = movePaneInLayout(currentLayout, paneId, targetPaneId, edge);
      if (nextLayout === currentLayout) return;
      setLayout(nextLayout);
      setActivePaneId(paneId);
      setView({ name: "workspace" });
      setStatusMessage(t.workspace.paneMoved);
    },
    [setActivePaneId, setLayout],
  );

  const resizeWorkspaceSplit = useCallback(
    (splitId: string, sizes: number[]) => {
      setLayout((current) => setLayoutSizes(current, splitId, sizes));
    },
    [setLayout],
  );

  const state = useMemo(
    () => ({
      view,
      activeWorkspaceId,
      layout,
      activePaneId,
      layouts,
      activePaneIds,
      statusMessage,
      workspaceOverviewVisible,
    }),
    [
      view,
      activeWorkspaceId,
      layout,
      activePaneId,
      layouts,
      activePaneIds,
      statusMessage,
      workspaceOverviewVisible,
    ],
  );
  const leaveGuard = useRef<((proceed: () => void) => boolean) | null>(null);
  const actions = useMemo<NavigationActions>(
    () => ({
      setLeaveGuard: (guard) => {
        leaveGuard.current = guard;
      },
      navigate: (target) => {
        if (!leaveGuard.current?.(() => navigate(target))) navigate(target);
      },
      openWorkspace: (id) => {
        if (!leaveGuard.current?.(() => openWorkspace(id))) openWorkspace(id);
      },
      setActivePane: (id) => {
        if (!leaveGuard.current?.(() => setActivePane(id))) setActivePane(id);
      },
      splitActivePane: (direction, id) =>
        leaveGuard.current?.(() => {
          splitActivePane(direction, id);
        })
          ? null
          : splitActivePane(direction, id),
      openConversationBeside: (id) =>
        leaveGuard.current?.(() => {
          openConversationBeside(id);
        })
          ? undefined
          : openConversationBeside(id),
      closeConversationWorkspacePanes,
      closeAllConversationPanes,
      closeWorkspacePane,
      closeTerminalWorkspacePane,
      moveWorkspacePane,
      resizeWorkspaceSplit,
    }),
    [
      navigate,
      openWorkspace,
      setActivePane,
      splitActivePane,
      openConversationBeside,
      closeConversationWorkspacePanes,
      closeAllConversationPanes,
      closeWorkspacePane,
      closeTerminalWorkspacePane,
      moveWorkspacePane,
      resizeWorkspaceSplit,
    ],
  );

  return (
    <NavigationActionsContext.Provider value={actions}>
      <NavigationStateContext.Provider value={state}>{children}</NavigationStateContext.Provider>
    </NavigationActionsContext.Provider>
  );
}

function resetConversationPanes(layout: LayoutNode): LayoutNode {
  let next = layout;
  for (const pane of listPanes(layout)) {
    if (pane.view.kind === "chat") {
      next = setPaneView(next, pane.id, { kind: "new-conversation" });
    }
  }
  return next;
}

export function useNavigation(): NavigationState {
  return { ...useNavigationState(), ...useNavigationActions() };
}

export function useNavigationState(): NavigationSnapshot {
  const state = useContext(NavigationStateContext);
  if (!state) throw new Error("useNavigation deve ser usado dentro de NavigationProvider.");
  return state;
}

export function useNavigationActions(): NavigationActions {
  const actions = useContext(NavigationActionsContext);
  if (!actions) throw new Error("useNavigation deve ser usado dentro de NavigationProvider.");
  return actions;
}

export type { PaneView };
