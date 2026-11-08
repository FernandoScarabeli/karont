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
import { t } from "../i18n/pt-BR.ts";
import {
  closePane as closePaneInLayout,
  createInitialLayout,
  findPane,
  findPaneByConversation,
  findPaneByTerminal,
  isValidLayout,
  type LayoutNode,
  listPanes,
  movePane as movePaneInLayout,
  normalize,
  type PaneEdge,
  type PaneView,
  paneCount,
  selectTerminalPane,
  setSizes as setLayoutSizes,
  setView as setPaneView,
  splitPane as splitPaneInLayout,
  validate,
} from "../workspace/layout.ts";

export type View =
  | { name: "home" }
  | { name: "workspace" }
  | { name: "settings"; section: "general" | "agents" };

export type NavigationTarget =
  | View
  | { name: "new-conversation"; projectId?: string }
  | { name: "conversation"; id: string }
  | { name: "terminal"; id: string };

type NavigationState = {
  view: View;
  layout: LayoutNode;
  activePaneId: string;
  statusMessage: string;
  navigate: (view: NavigationTarget) => void;
  setActivePane: (paneId: string) => void;
  splitActivePane: (direction: "row" | "column", paneId?: string) => string | null;
  openConversationBeside: (conversationId: string) => string | null;
  closeConversationWorkspacePanes: (conversationId: string) => void;
  closeAllConversationPanes: () => void;
  closeWorkspacePane: (paneId: string) => void;
  closeTerminalWorkspacePane: (terminalId: string) => void;
  moveWorkspacePane: (paneId: string, targetPaneId: string, edge: PaneEdge) => void;
  resizeWorkspaceSplit: (splitId: string, sizes: number[]) => void;
};

type NavigationSnapshot = Pick<
  NavigationState,
  "view" | "layout" | "activePaneId" | "statusMessage"
>;
type NavigationActions = Omit<NavigationState, keyof NavigationSnapshot>;

const LAYOUT_SETTING = "workspace.layout";
const LAST_VIEW_SETTING = "navigation.lastView";
type PersistedView = "home" | "workspace" | "settings";

const NavigationStateContext = createContext<NavigationSnapshot | null>(null);
const NavigationActionsContext = createContext<NavigationActions | null>(null);

export function NavigationProvider({ children }: PropsWithChildren) {
  const bridge = getBridge();
  const [view, setView] = useState<View>({ name: "home" });
  const [layout, setLayout] = useState<LayoutNode>(createInitialLayout);
  const [activePaneId, setActivePaneId] = useState("pane-1");
  const [statusMessage, setStatusMessage] = useState("");
  const [layoutLoaded, setLayoutLoaded] = useState(false);
  const [navigationLoaded, setNavigationLoaded] = useState(false);
  const navigationRef = useRef({ layout, activePaneId });
  navigationRef.current = { layout, activePaneId };

  useEffect(() => {
    if (!bridge) {
      setLayoutLoaded(true);
      setNavigationLoaded(true);
      return;
    }

    let mounted = true;
    void Promise.allSettled([
      bridge.request("settings.get", { key: LAYOUT_SETTING }),
      bridge.request("terminals.list", {}),
      bridge.request("settings.get", { key: LAST_VIEW_SETTING }),
    ]).then(([layoutResult, terminalsResult, lastViewResult]) => {
      if (!mounted) return;
      const savedLayout = layoutResult.status === "fulfilled" ? layoutResult.value.value : null;
      const hasValidSavedLayout = isValidLayout(savedLayout);
      let restored = hasValidSavedLayout ? validate(savedLayout) : createInitialLayout();

      if (terminalsResult.status === "fulfilled") {
        const terminalIds = new Set(terminalsResult.value.terminals.map((terminal) => terminal.id));
        for (const pane of listPanes(restored)) {
          if (pane.view.kind === "terminal" && !terminalIds.has(pane.view.terminalId)) {
            restored = setPaneView(restored, pane.id, { kind: "new-conversation" });
          }
        }
      }

      restored = normalize(restored);
      setLayout(restored);
      setActivePaneId(listPanes(restored)[0]?.id ?? "pane-1");
      const lastView = lastViewResult.status === "fulfilled" ? lastViewResult.value.value : null;
      const restoredView: View =
        lastView === "settings"
          ? { name: "settings", section: "general" }
          : lastView === "workspace" && hasValidSavedLayout
            ? { name: "workspace" }
            : { name: "home" };
      setView(restoredView);
      setLayoutLoaded(true);
      setNavigationLoaded(true);
    });

    return () => {
      mounted = false;
    };
  }, [bridge]);

  useEffect(() => {
    if (!bridge || !navigationLoaded) return;
    const lastView: PersistedView = view.name;
    void bridge.request("settings.set", { key: LAST_VIEW_SETTING, value: lastView }).catch(() => {
      setStatusMessage(t.workspace.navigationSaveFailed);
    });
  }, [bridge, navigationLoaded, view.name]);

  useEffect(() => {
    if (!bridge) return;
    return bridge.onEvent((event) => {
      if (event.event === "conversation.deletedAll") {
        setLayout((current) => resetConversationPanes(current));
      }
    });
  }, [bridge]);

  useEffect(() => {
    if (!bridge || !layoutLoaded) return;
    const timeout = window.setTimeout(() => {
      void bridge.request("settings.set", { key: LAYOUT_SETTING, value: layout }).catch(() => {
        setStatusMessage(t.workspace.layoutSaveFailed);
      });
    }, 500);
    return () => window.clearTimeout(timeout);
  }, [bridge, layout, layoutLoaded]);

  const setActivePane = useCallback((paneId: string) => {
    if (!findPane(navigationRef.current.layout, paneId)) return;
    setActivePaneId((current) => (current === paneId ? current : paneId));
    setView((current) => (current.name === "workspace" ? current : { name: "workspace" }));
  }, []);

  const navigate = useCallback((target: NavigationTarget) => {
    const { layout: currentLayout, activePaneId: currentPaneId } = navigationRef.current;
    if (target.name === "new-conversation") {
      const view: PaneView = target.projectId
        ? { kind: "new-conversation", projectId: target.projectId }
        : { kind: "new-conversation" };
      setLayout((current) => setPaneView(current, currentPaneId, view));
      setView((current) => (current.name === "workspace" ? current : { name: "workspace" }));
      return;
    }
    if (target.name === "terminal") {
      const selected = selectTerminalPane(currentLayout, currentPaneId, target.id);
      if (selected.tree !== currentLayout) setLayout(selected.tree);
      setActivePaneId((current) => (current === selected.paneId ? current : selected.paneId));
      setView((current) => (current.name === "workspace" ? current : { name: "workspace" }));
      return;
    }
    if (target.name === "conversation") {
      const existing = findPaneByConversation(currentLayout, target.id);
      if (existing) {
        setActivePaneId((current) => (current === existing.id ? current : existing.id));
      } else {
        setLayout((current) =>
          setPaneView(current, currentPaneId, { kind: "chat", conversationId: target.id }),
        );
      }
      setView((current) => (current.name === "workspace" ? current : { name: "workspace" }));
      return;
    }
    setView(target);
  }, []);

  const splitActivePane = useCallback((direction: "row" | "column", paneId?: string) => {
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
  }, []);

  const openConversationBeside = useCallback((conversationId: string) => {
    const { layout: currentLayout, activePaneId: currentPaneId } = navigationRef.current;
    const existing = findPaneByConversation(currentLayout, conversationId);
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
  }, []);

  const closeConversationWorkspacePanes = useCallback((conversationId: string) => {
    setLayout((current) => {
      let next = current;
      for (const pane of listPanes(current)) {
        if (pane.view.kind === "chat" && pane.view.conversationId === conversationId) {
          next = setPaneView(next, pane.id, { kind: "new-conversation" });
        }
      }
      return next;
    });
  }, []);

  const closeAllConversationPanes = useCallback(() => {
    setLayout((current) => resetConversationPanes(current));
  }, []);

  const closeWorkspacePane = useCallback((paneId: string) => {
    const { layout: currentLayout, activePaneId: currentActivePaneId } = navigationRef.current;
    const nextLayout = closePaneInLayout(currentLayout, paneId);
    setLayout(nextLayout);
    if (paneId === currentActivePaneId || !findPane(nextLayout, currentActivePaneId)) {
      setActivePaneId(findPane(nextLayout, paneId)?.id ?? listPanes(nextLayout)[0]?.id ?? "pane-1");
    }
    setView({ name: "workspace" });
    setStatusMessage(t.workspace.paneClosed);
  }, []);

  const closeTerminalWorkspacePane = useCallback((terminalId: string) => {
    setLayout((current) => {
      const pane = findPaneByTerminal(current, terminalId);
      return pane ? setPaneView(current, pane.id, { kind: "new-conversation" }) : current;
    });
  }, []);

  const moveWorkspacePane = useCallback((paneId: string, targetPaneId: string, edge: PaneEdge) => {
    const currentLayout = navigationRef.current.layout;
    const nextLayout = movePaneInLayout(currentLayout, paneId, targetPaneId, edge);
    if (nextLayout === currentLayout) return;
    setLayout(nextLayout);
    setActivePaneId(paneId);
    setView({ name: "workspace" });
    setStatusMessage(t.workspace.paneMoved);
  }, []);

  const resizeWorkspaceSplit = useCallback((splitId: string, sizes: number[]) => {
    setLayout((current) => setLayoutSizes(current, splitId, sizes));
  }, []);

  const state = useMemo(
    () => ({ view, layout, activePaneId, statusMessage }),
    [view, layout, activePaneId, statusMessage],
  );
  const actions = useMemo(
    () => ({
      navigate,
      setActivePane,
      splitActivePane,
      openConversationBeside,
      closeConversationWorkspacePanes,
      closeAllConversationPanes,
      closeWorkspacePane,
      closeTerminalWorkspacePane,
      moveWorkspacePane,
      resizeWorkspaceSplit,
    }),
    [
      navigate,
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
