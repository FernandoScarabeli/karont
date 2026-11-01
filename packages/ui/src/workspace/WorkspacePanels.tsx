import {
  type DragEvent,
  lazy,
  type ReactNode,
  type RefObject,
  Suspense,
  useCallback,
  useEffect,
  useRef,
  useState,
} from "react";
import { Group, Panel, Separator } from "react-resizable-panels";
import { NewConversationView } from "../conversation/NewConversationView.tsx";
import { t } from "../i18n/pt-BR.ts";
import { useNavigation } from "../navigation/NavigationContext.tsx";
import { TerminalView } from "../terminal/TerminalView.tsx";
import { getTerminalDisplayTitles, useTerminals } from "../terminal/useTerminals.ts";
import {
  type LayoutNode,
  type PaneEdge,
  type PaneNode,
  paneCount,
  type SplitNode,
} from "./layout.ts";
import { PanelToolbar } from "./PanelToolbar.tsx";
import styles from "./WorkspacePanels.module.css";

const ConversationView = lazy(async () => {
  const module = await import("../conversation/ConversationView.tsx");
  return { default: module.ConversationView };
});

type DragTarget = { paneId: string; edge: PaneEdge } | null;

export function WorkspacePanels({ titleRef }: { titleRef: RefObject<HTMLHeadingElement | null> }) {
  const {
    layout,
    activePaneId,
    statusMessage,
    setActivePane,
    splitActivePane,
    closeWorkspacePane,
    moveWorkspacePane,
    resizeWorkspaceSplit,
  } = useNavigation();
  const { terminals } = useTerminals();
  const paneElements = useRef(new Map<string, HTMLDivElement>());
  const [draggedPaneId, setDraggedPaneId] = useState<string | null>(null);
  const [dropTarget, setDropTarget] = useState<DragTarget>(null);
  const terminalTitles = getTerminalDisplayTitles(terminals);
  const terminalById = new Map(terminals.map((terminal) => [terminal.id, terminal]));

  useEffect(() => {
    if (!draggedPaneId) return;
    const cancelDrag = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        setDraggedPaneId(null);
        setDropTarget(null);
      }
    };
    window.addEventListener("keydown", cancelDrag);
    return () => window.removeEventListener("keydown", cancelDrag);
  }, [draggedPaneId]);

  useEffect(() => {
    const handleShortcut = (event: KeyboardEvent) => {
      if (!event.ctrlKey || !event.altKey) return;
      const directionByKey = {
        ArrowLeft: "left",
        ArrowRight: "right",
        ArrowUp: "up",
        ArrowDown: "down",
      } as const;
      const direction = directionByKey[event.key as keyof typeof directionByKey];
      if (!direction) return;
      const target = event.target;
      if (!(target instanceof Element)) return;
      if (
        target.closest(
          ".xterm, input, textarea, select, dialog, [contenteditable='true'], [role='textbox'], [role='combobox'], [role='dialog'], [role='menu']",
        )
      )
        return;
      const current = paneElements.current.get(activePaneId)?.getBoundingClientRect();
      if (!current) return;
      const origin = { x: current.left + current.width / 2, y: current.top + current.height / 2 };
      const candidates = [...paneElements.current.entries()]
        .filter(([paneId]) => paneId !== activePaneId)
        .map(([paneId, element]) => {
          const rect = element.getBoundingClientRect();
          const point = { x: rect.left + rect.width / 2, y: rect.top + rect.height / 2 };
          const primary =
            direction === "left" || direction === "right" ? point.x - origin.x : point.y - origin.y;
          const perpendicular =
            direction === "left" || direction === "right" ? point.y - origin.y : point.x - origin.x;
          const matchesDirection =
            direction === "left"
              ? primary < 0
              : direction === "right"
                ? primary > 0
                : direction === "up"
                  ? primary < 0
                  : primary > 0;
          return {
            paneId,
            element,
            score: Math.abs(primary) + Math.abs(perpendicular) * 2,
            matchesDirection,
          };
        })
        .filter((candidate) => candidate.matchesDirection)
        .sort((left, right) => left.score - right.score);
      const neighbor = candidates[0];
      if (!neighbor) return;
      event.preventDefault();
      if (event.shiftKey) {
        const edge: PaneEdge =
          direction === "left"
            ? "left"
            : direction === "right"
              ? "right"
              : direction === "up"
                ? "top"
                : "bottom";
        moveWorkspacePane(activePaneId, neighbor.paneId, edge);
        window.requestAnimationFrame(() =>
          getPaneFocusTarget(paneElements.current.get(activePaneId))?.focus({
            preventScroll: true,
          }),
        );
        return;
      }
      setActivePane(neighbor.paneId);
      window.requestAnimationFrame(() =>
        getPaneFocusTarget(neighbor.element)?.focus({ preventScroll: true }),
      );
    };
    window.addEventListener("keydown", handleShortcut);
    return () => window.removeEventListener("keydown", handleShortcut);
  }, [activePaneId, moveWorkspacePane, setActivePane]);

  const allPanes = collectPanes(layout);
  const activePane = allPanes.find((pane) => pane.id === activePaneId);
  const activeViewKind = activePane?.view.kind ?? "new-conversation";
  const previousActive = useRef({ paneId: activePaneId, viewKind: activeViewKind });
  const paneTitles = new Map(
    allPanes.map((pane) => [pane.id, getPaneTitle(pane, terminalById, terminalTitles)]),
  );
  const focusPaneContext = useCallback((paneId: string) => {
    window.requestAnimationFrame(() => {
      getPaneFocusTarget(paneElements.current.get(paneId))?.focus({ preventScroll: true });
    });
  }, []);

  useEffect(() => {
    const previous = previousActive.current;
    if (previous.paneId === activePaneId && previous.viewKind !== activeViewKind) {
      focusPaneContext(activePaneId);
    }
    previousActive.current = { paneId: activePaneId, viewKind: activeViewKind };
  }, [activePaneId, activeViewKind, focusPaneContext]);

  function startDrag(event: DragEvent<HTMLHeadingElement>, paneId: string) {
    event.dataTransfer.effectAllowed = "move";
    event.dataTransfer.setData("text/plain", paneId);
    setDraggedPaneId(paneId);
    setDropTarget(null);
  }

  function endDrag() {
    setDraggedPaneId(null);
    setDropTarget(null);
  }

  function movePanel(paneId: string, targetPaneId: string, edge: PaneEdge) {
    moveWorkspacePane(paneId, targetPaneId, edge);
    focusPaneContext(paneId);
  }

  function closePanel(paneId: string) {
    const nextPaneId = allPanes.find((pane) => pane.id !== paneId)?.id ?? paneId;
    closeWorkspacePane(paneId);
    focusPaneContext(nextPaneId);
  }

  function edgeFromPointer(event: DragEvent<HTMLDivElement>): PaneEdge {
    const rect = event.currentTarget.getBoundingClientRect();
    const distances: Array<[PaneEdge, number]> = [
      ["left", event.clientX - rect.left],
      ["right", rect.right - event.clientX],
      ["top", event.clientY - rect.top],
      ["bottom", rect.bottom - event.clientY],
    ];
    distances.sort((left, right) => left[1] - right[1]);
    return distances[0]?.[0] ?? "right";
  }

  function renderToolbar(pane: PaneNode) {
    const paneTitle = paneTitles.get(pane.id) ?? t.conversation.title;

    return (
      <PanelToolbar
        canSplit={paneCount(layout) < 6}
        onClosePane={() => closePanel(pane.id)}
        onSplit={(direction) => {
          const newPaneId = splitActivePane(direction, pane.id);
          if (newPaneId) focusPaneContext(newPaneId);
        }}
        paneTitle={paneTitle}
      />
    );
  }

  function renderPaneContent(pane: PaneNode): ReactNode {
    const isActive = pane.id === activePaneId;
    const dragHandleProps = {
      draggable: true,
      onDragEnd: endDrag,
      onDragStart: (event: DragEvent<HTMLHeadingElement>) => startDrag(event, pane.id),
      tabIndex: 0 as const,
    };

    if (pane.view.kind === "new-conversation") {
      return (
        <NewConversationView
          dragHandleProps={dragHandleProps}
          headerActions={renderToolbar(pane)}
          titleRef={isActive ? titleRef : undefined}
        />
      );
    }

    if (pane.view.kind === "terminal") {
      return (
        <TerminalView
          dragHandleProps={dragHandleProps}
          headerActions={renderToolbar(pane)}
          id={pane.view.terminalId}
          titleRef={isActive ? titleRef : undefined}
        />
      );
    }

    return (
      <Suspense
        fallback={
          <div className={styles.chatLoading} role="status">
            {t.chat.loading}
          </div>
        }
      >
        <ConversationView
          dragHandleProps={dragHandleProps}
          headerActions={renderToolbar(pane)}
          id={pane.view.conversationId}
          key={pane.view.conversationId}
        />
      </Suspense>
    );
  }

  function renderPane(pane: PaneNode) {
    const title = paneTitles.get(pane.id) ?? t.conversation.title;
    const active = pane.id === activePaneId;
    const dropEdge = dropTarget?.paneId === pane.id ? dropTarget.edge : null;
    return (
      <>
        {/* biome-ignore lint/a11y/useSemanticElements: a tarefa exige role=region explícito em cada painel. */}
        <div
          aria-label={title}
          className={styles.paneSurface}
          data-active={active ? "true" : "false"}
          onClickCapture={() => setActivePane(pane.id)}
          onDragLeave={(event) => {
            if (!event.currentTarget.contains(event.relatedTarget as Node | null)) {
              setDropTarget((current) => (current?.paneId === pane.id ? null : current));
            }
          }}
          onDragOver={(event) => {
            if (!draggedPaneId || draggedPaneId === pane.id) return;
            event.preventDefault();
            setDropTarget({ paneId: pane.id, edge: edgeFromPointer(event) });
          }}
          onDrop={(event) => {
            event.preventDefault();
            const sourcePaneId = event.dataTransfer.getData("text/plain") || draggedPaneId;
            const edge = dropTarget?.paneId === pane.id ? dropTarget.edge : edgeFromPointer(event);
            if (sourcePaneId && sourcePaneId !== pane.id) movePanel(sourcePaneId, pane.id, edge);
            endDrag();
          }}
          onFocusCapture={() => setActivePane(pane.id)}
          ref={(element) => {
            if (element) paneElements.current.set(pane.id, element);
            else paneElements.current.delete(pane.id);
          }}
          role="region"
          tabIndex={-1}
        >
          {renderPaneContent(pane)}
          {dropEdge ? (
            <div
              aria-hidden="true"
              className={`${styles.dropZone} ${styles[`drop${capitalize(dropEdge)}`]}`}
            />
          ) : null}
        </div>
      </>
    );
  }

  function renderSplit(split: SplitNode): ReactNode {
    const childSignature = split.children.map((child) => child.id).join("-");
    const defaultLayout = Object.fromEntries(
      split.children.map((child, index) => [child.id, split.sizes[index] ?? 50]),
    );
    return (
      <Group
        className={styles.group}
        defaultLayout={defaultLayout}
        id={split.id}
        key={`${split.id}-${childSignature}`}
        onLayoutChanged={(nextLayout, metadata) => {
          if (!metadata.isUserInteraction) return;
          const requestedLayout = metadata.requestedLayout ?? nextLayout;
          resizeWorkspaceSplit(
            split.id,
            split.children.map(
              (child, index) => requestedLayout[child.id] ?? split.sizes[index] ?? 50,
            ),
          );
        }}
        orientation={split.direction === "row" ? "horizontal" : "vertical"}
        resizeTargetMinimumSize={{ coarse: 8, fine: 8 }}
      >
        {split.children.flatMap((child, index) => {
          const nextChild = split.children[index + 1];
          const separatorId = nextChild
            ? `${split.id}-separator-${child.id}-${nextChild.id}`
            : null;
          return [
            <Panel className={styles.panel} id={child.id} key={child.id} minSize="15%">
              {child.type === "pane" ? renderPane(child) : renderSplit(child)}
            </Panel>,
            separatorId ? (
              <Separator
                aria-label={
                  split.direction === "row" ? t.workspace.resizeColumns : t.workspace.resizeRows
                }
                className={styles.separator}
                id={separatorId}
                key={separatorId}
              />
            ) : null,
          ];
        })}
      </Group>
    );
  }

  return (
    <div className={styles.workspace}>
      {layout.type === "pane" ? renderPane(layout) : renderSplit(layout)}
      <div aria-live="polite" className={styles.visuallyHidden} role="status">
        {statusMessage}
      </div>
    </div>
  );
}

function collectPanes(tree: LayoutNode): PaneNode[] {
  return tree.type === "pane" ? [tree] : tree.children.flatMap(collectPanes);
}

function getPaneFocusTarget(pane: HTMLElement | undefined): HTMLElement | null {
  if (!pane) return null;
  return (
    pane.querySelector<HTMLElement>("[data-focus-context]") ??
    pane.querySelector<HTMLHeadingElement>("h1")
  );
}

function getPaneTitle(
  pane: PaneNode,
  terminals: Map<string, { title: string }>,
  displayTitles: Map<string, string>,
): string {
  if (pane.view.kind === "new-conversation") return t.conversation.title;
  if (pane.view.kind === "terminal") {
    return (
      terminals.get(pane.view.terminalId)?.title ??
      displayTitles.get(pane.view.terminalId) ??
      t.terminal.loadingTitle
    );
  }
  return t.workspace.chatTitle;
}

function capitalize(value: string): string {
  return value.charAt(0).toUpperCase() + value.slice(1);
}
