import { BridgeError, type Conversation, type Project, type TerminalInfo } from "@karont/contract";
import {
  Archive,
  ArchiveRestore,
  ArrowLeft,
  ArrowRightLeft,
  ChevronDown,
  ChevronRight,
  Columns2,
  Ellipsis,
  GitFork,
  Inbox,
  ListTodo,
  Pencil,
  Pin,
  PinOff,
  Plus,
  Settings,
  SquarePen,
  SquareTerminal,
  Trash2,
} from "lucide-react";
import { createRef, memo, type RefObject, useCallback, useEffect, useRef, useState } from "react";
import { AgentIcon } from "../agents/AgentIcon.tsx";
import { getBridge } from "../bridge/index.ts";
import { ActionMenu, type ActionMenuItem } from "../components/ActionMenu/ActionMenu.tsx";
import { Button } from "../components/Button/Button.tsx";
import { Dialog } from "../components/Dialog/Dialog.tsx";
import { FluidHoverHighlight, useFluidHover } from "../components/FluidHover/FluidHover.tsx";
import { IconButton } from "../components/IconButton/IconButton.tsx";
import scrollAreaStyles from "../components/ScrollArea/ScrollArea.module.css";
import {
  removeConversationFromIndex,
  upsertConversation,
  useConversationIndex,
} from "../conversation/useConversationIndex.ts";
import { t } from "../i18n/pt-BR.ts";
import { useNavigationActions, useNavigationState } from "../navigation/NavigationContext.tsx";
import { ProjectDialog } from "../projects/ProjectDialog.tsx";
import { groupConversations } from "../projects/projectGroups.ts";
import { getProjectIcon } from "../projects/projectIcons.ts";
import { useInbox } from "../projects/useInbox.ts";
import { removeProjectFromStore, upsertProject, useProjects } from "../projects/useProjects.ts";
import { useWorkspaces } from "../projects/useWorkspaces.ts";
import { useWorktrees } from "../projects/useWorktrees.ts";
import { filterByWorkspace, groupTerminals } from "../projects/workspaceState.ts";
import { TerminalCloseButton } from "../terminal/TerminalCloseButton.tsx";
import {
  getTerminalDisplayDetails,
  getTerminalDisplayTitles,
  useTerminals,
} from "../terminal/useTerminals.ts";
import { findPane, findPaneByConversation, paneCount } from "../workspace/layout.ts";
import { ServiceStatus } from "./ServiceStatus.tsx";
import styles from "./Sidebar.module.css";

const conversationActionsIcon = <Ellipsis aria-hidden="true" size={17} strokeWidth={1.8} />;
const COLLAPSED_PROJECTS_SETTING = "sidebar.collapsedProjects";

type MenuState =
  | { kind: "section" }
  | { kind: "conversation"; id: string; point?: { x: number; y: number } }
  | { kind: "project"; id: string }
  | null;

type ProjectDialogState = { project: Project | null } | null;

type ConversationRowProps = {
  conversation: Conversation;
  showArchived: boolean;
  active: boolean;
  openAndVisible: boolean;
  editing: boolean;
  menuOpen: boolean;
  anchorPoint?: { x: number; y: number };
  titleDraft: string;
  saving: boolean;
  actionRef: RefObject<HTMLButtonElement | null>;
  renameInputRef: RefObject<HTMLInputElement | null>;
  getMenuItems: (conversation: Conversation) => ActionMenuItem[];
  onOpenConversation: (id: string) => void;
  onRegisterConversationButton: (id: string, element: HTMLButtonElement | null) => void;
  onContextMenu: (id: string, point: { x: number; y: number }) => void;
  onMenuOpenChange: (id: string, open: boolean) => void;
  onCancelRename: (restoreFocus?: boolean) => void;
  onSaveRename: (conversation: Conversation) => void;
  onDraftChange: (draft: string) => void;
};

const ConversationRow = memo(function ConversationRow({
  conversation,
  showArchived,
  active,
  openAndVisible,
  editing,
  menuOpen,
  anchorPoint,
  titleDraft,
  saving,
  actionRef,
  renameInputRef,
  getMenuItems,
  onOpenConversation,
  onRegisterConversationButton,
  onContextMenu,
  onMenuOpenChange,
  onCancelRename,
  onSaveRename,
  onDraftChange,
}: ConversationRowProps) {
  const stateText =
    conversation.state === "working"
      ? t.chat.working
      : conversation.state === "waiting"
        ? t.chat.waiting
        : conversation.state === "queued"
          ? t.chat.queued
          : conversation.state === "error"
            ? t.shell.conversationError
            : t.chat.idle;
  const isUnread = Boolean(conversation.unreadAt) && !openAndVisible;
  const stateDetails = [
    stateText,
    isUnread ? t.shell.unreadResponse : "",
    conversation.pinnedAt ? t.shell.pinnedState : "",
    conversation.worktreeId ? t.shell.separateCopyState : "",
    showArchived ? t.shell.archivedState : "",
  ]
    .filter(Boolean)
    .join(", ");
  const statusClass =
    conversation.state === "waiting"
      ? styles.conversationStatusNeedsYou
      : conversation.state === "working"
        ? styles.conversationStatusWorking
        : conversation.state === "queued"
          ? styles.conversationStatusQueued
          : conversation.state === "error"
            ? styles.conversationStatusError
            : isUnread
              ? styles.conversationStatusUnread
              : "";
  const registerButton = useCallback(
    (element: HTMLButtonElement | null) => onRegisterConversationButton(conversation.id, element),
    [conversation.id, onRegisterConversationButton],
  );
  const changeMenu = useCallback(
    (open: boolean) => onMenuOpenChange(conversation.id, open),
    [conversation.id, onMenuOpenChange],
  );
  const getItems = useCallback(() => getMenuItems(conversation), [conversation, getMenuItems]);

  return (
    <li
      className={`${styles.conversationItem} ${menuOpen ? styles.conversationMenuOpen : ""}`}
      onContextMenu={(event) => {
        if (editing) return;
        event.preventDefault();
        onContextMenu(conversation.id, { x: event.clientX, y: event.clientY });
      }}
    >
      {editing ? (
        <input
          aria-label={t.chat.renameTitleInput}
          className={`${styles.conversationButton} ${styles.conversationTitleInput}`}
          disabled={saving}
          maxLength={240}
          onBlur={() => {
            const draft = titleDraft.trim();
            if (!draft || draft === conversation.title) onCancelRename();
            else onSaveRename(conversation);
          }}
          onChange={(event) => onDraftChange(event.currentTarget.value)}
          onKeyDown={(event) => {
            event.stopPropagation();
            if (event.key === "Enter") {
              event.preventDefault();
              onSaveRename(conversation);
            } else if (event.key === "Escape") {
              event.preventDefault();
              onCancelRename(true);
            }
          }}
          ref={renameInputRef}
          value={titleDraft}
        />
      ) : (
        <button
          aria-current={active ? "page" : undefined}
          aria-description={stateDetails}
          aria-label={conversation.title}
          className={styles.conversationButton}
          onClick={() => onOpenConversation(conversation.id)}
          ref={registerButton}
          title={`${conversation.title}, ${stateDetails}`}
          type="button"
        >
          <AgentIcon agentId={conversation.agent} />
          <span className={styles.conversationTitle}>{conversation.title}</span>
          {conversation.pinnedAt && !showArchived ? (
            <Pin aria-hidden="true" className={styles.pinnedMarker} size={13} />
          ) : null}
          {conversation.worktreeId ? (
            <GitFork aria-hidden="true" className={styles.pinnedMarker} size={13} />
          ) : null}
          {statusClass ? (
            <span aria-hidden="true" className={`${styles.conversationStatusDot} ${statusClass}`} />
          ) : null}
        </button>
      )}
      {!editing ? (
        <ActionMenu
          anchorPoint={menuOpen ? anchorPoint : undefined}
          items={getItems}
          label={t.shell.conversationActions(conversation.title)}
          onOpenChange={changeMenu}
          open={menuOpen}
          triggerClassName={styles.conversationActions}
          triggerIcon={conversationActionsIcon}
          triggerLabel={t.shell.conversationActions(conversation.title)}
          triggerRef={actionRef}
        />
      ) : null}
    </li>
  );
});

export function Sidebar() {
  const { view, layout, activePaneId, workspaceOverviewVisible } = useNavigationState();
  const { total: inboxTotal } = useInbox();
  const {
    closeConversationWorkspacePanes,
    closeTerminalWorkspacePane,
    navigate,
    openConversationBeside,
  } = useNavigationActions();
  const bridge = getBridge();
  const activePane = findPane(layout, activePaneId);
  const navigationRef = useRef<HTMLElement>(null);
  const fluidHover = useFluidHover(navigationRef, {
    axis: "y",
    isItemDisabled: (element) => element.matches(":disabled"),
    gapClick: false,
  });
  const { terminals: allTerminals, error } = useTerminals();
  const { workspaces, activeId: activeWorkspaceId, loading: workspacesLoading } = useWorkspaces();
  const [showArchived, setShowArchived] = useState(false);
  const showArchivedRef = useRef(showArchived);
  showArchivedRef.current = showArchived;
  const conversationIndex = useConversationIndex(showArchived);
  const projectsState = useProjects();
  // A sidebar mostra só o workspace ativo; em Início, o último que esteve ativo.
  // Enquanto a lista de workspaces carrega não há ativo: não mostramos tudo para depois encolher.
  const scoped = <T extends { workspaceId: string }>(items: readonly T[]) =>
    workspacesLoading ? [] : filterByWorkspace(items, activeWorkspaceId);
  const conversationList = scoped(conversationIndex.conversations);
  const workspaceProjects = scoped(projectsState.projects);
  const terminals = scoped(allTerminals);
  const groups = groupConversations(conversationList, workspaceProjects, projectsState.loading);
  const terminalGroups = groupTerminals(terminals, workspaceProjects, projectsState.loading);
  // Fora das arquivadas, a seção Conversas mostra só as soltas.
  const visibleConversations = showArchived ? conversationList : groups.loose;
  const focusScopeRef = useRef({ visibleConversations, groups, showArchived });
  focusScopeRef.current = { visibleConversations, groups, showArchived };
  const [collapsedProjects, setCollapsedProjects] = useState<string[]>([]);
  const collapsedProjectsRef = useRef(collapsedProjects);
  collapsedProjectsRef.current = collapsedProjects;
  const collapsedTouchedRef = useRef(false);
  const [projectDialog, setProjectDialog] = useState<ProjectDialogState>(null);
  const [projectToRemove, setProjectToRemove] = useState<Project | null>(null);
  const projectToRemoveWorktrees = useWorktrees(projectToRemove?.id).worktrees;
  const [isRemovingProject, setIsRemovingProject] = useState(false);
  const [removeProjectError, setRemoveProjectError] = useState("");
  const projectButtonRefs = useRef(new Map<string, HTMLButtonElement>());
  const projectActionRefs = useRef(new Map<string, RefObject<HTMLButtonElement | null>>());
  const newProjectRef = useRef<HTMLButtonElement>(null);
  const projectDialogReturnFocusRef = useRef<HTMLElement>(null);
  const removeProjectCancelRef = useRef<HTMLButtonElement>(null);
  const removeProjectReturnFocusRef = useRef<HTMLElement>(null);
  const [documentVisible, setDocumentVisible] = useState(
    () => document.visibilityState === "visible",
  );
  const pinnedConversations = showArchived
    ? []
    : visibleConversations.filter((conversation) => conversation.pinnedAt !== null);
  const recentConversations = showArchived
    ? visibleConversations
    : visibleConversations.filter((conversation) => conversation.pinnedAt === null);
  const terminalTitles = getTerminalDisplayTitles(allTerminals);
  const [terminalToClose, setTerminalToClose] = useState<TerminalInfo | null>(null);
  const [isClosing, setIsClosing] = useState(false);
  const [closeError, setCloseError] = useState("");
  const [sidebarActionError, setSidebarActionError] = useState("");
  const [menu, setMenu] = useState<MenuState>(null);
  const [editingConversationId, setEditingConversationId] = useState<string | null>(null);
  const [titleDraft, setTitleDraft] = useState("");
  const titleDraftRef = useRef(titleDraft);
  titleDraftRef.current = titleDraft;
  const [savingConversationId, setSavingConversationId] = useState<string | null>(null);
  const savingConversationIdRef = useRef(savingConversationId);
  savingConversationIdRef.current = savingConversationId;
  const editingConversationIdRef = useRef(editingConversationId);
  editingConversationIdRef.current = editingConversationId;
  const [conversationToDelete, setConversationToDelete] = useState<Conversation | null>(null);
  const [isDeletingConversation, setIsDeletingConversation] = useState(false);
  const [deleteError, setDeleteError] = useState("");
  const cancelCloseRef = useRef<HTMLButtonElement>(null);
  const focusAfterCloseRef = useRef<HTMLElement>(null);
  const terminalButtonRefs = useRef(new Map<string, HTMLButtonElement>());
  const conversationButtonRefs = useRef(new Map<string, HTMLButtonElement>());
  const conversationActionRefs = useRef(new Map<string, RefObject<HTMLButtonElement | null>>());
  const renameInputRef = useRef<HTMLInputElement>(null);
  const newLooseConversationRef = useRef<HTMLButtonElement>(null);
  const archivedBackRef = useRef<HTMLButtonElement>(null);
  const deleteCancelRef = useRef<HTMLButtonElement>(null);
  const deleteReturnFocusRef = useRef<HTMLElement>(null);

  useEffect(() => {
    const updateDocumentVisibility = () => {
      setDocumentVisible(document.visibilityState === "visible");
    };
    document.addEventListener("visibilitychange", updateDocumentVisibility);
    return () => document.removeEventListener("visibilitychange", updateDocumentVisibility);
  }, []);

  useEffect(() => {
    if (!bridge) return;
    let mounted = true;
    void bridge
      .request("settings.get", { key: COLLAPSED_PROJECTS_SETTING })
      .then(({ value }) => {
        if (!mounted || collapsedTouchedRef.current || !Array.isArray(value)) return;
        setCollapsedProjects(value.filter((id): id is string => typeof id === "string"));
      })
      .catch(() => {
        // Sem a preferência salva, os grupos ficam abertos.
      });
    return () => {
      mounted = false;
    };
  }, [bridge]);

  useEffect(() => {
    if (!editingConversationId) return;
    const frame = requestAnimationFrame(() => {
      renameInputRef.current?.focus();
      renameInputRef.current?.select();
    });
    return () => cancelAnimationFrame(frame);
  }, [editingConversationId]);

  function requestClose(terminal: TerminalInfo) {
    focusAfterCloseRef.current = null;
    setCloseError("");
    setTerminalToClose(terminal);
  }

  function cancelClose() {
    if (isClosing) return;
    focusAfterCloseRef.current = null;
    setTerminalToClose(null);
  }

  async function closeTerminal() {
    if (!bridge || !terminalToClose || isClosing) return;
    const closingTerminal = terminalToClose;
    const closingIndex = terminals.findIndex((terminal) => terminal.id === closingTerminal.id);
    const focusTerminal = terminals[closingIndex + 1] ?? terminals[closingIndex - 1];
    focusAfterCloseRef.current = focusTerminal
      ? (terminalButtonRefs.current.get(focusTerminal.id) ?? null)
      : newLooseConversationRef.current;

    setCloseError("");
    setIsClosing(true);
    try {
      await bridge.request("terminals.close", { id: closingTerminal.id });
      setTerminalToClose(null);
      closeTerminalWorkspacePane(closingTerminal.id);
    } catch (closeErrorValue) {
      focusAfterCloseRef.current = null;
      setCloseError(
        closeErrorValue instanceof BridgeError && closeErrorValue.message
          ? closeErrorValue.message
          : t.terminal.closeFailed,
      );
    } finally {
      setIsClosing(false);
    }
  }

  const conversationRemovalFocusTarget = useCallback((conversationId: string) => {
    const {
      visibleConversations: loose,
      groups: current,
      showArchived: archived,
    } = focusScopeRef.current;
    let siblings = loose;
    let projectId: string | null = null;
    if (!archived) {
      for (const [id, conversations] of current.byProject) {
        if (conversations.some((conversation) => conversation.id === conversationId)) {
          siblings = conversations;
          projectId = id;
          break;
        }
      }
    }
    const index = siblings.findIndex((conversation) => conversation.id === conversationId);
    const target = siblings[index + 1] ?? siblings[index - 1];
    const targetButton = target ? conversationButtonRefs.current.get(target.id) : undefined;
    if (targetButton) return targetButton;
    if (projectId) return projectButtonRefs.current.get(projectId) ?? null;
    return archived ? archivedBackRef.current : newLooseConversationRef.current;
  }, []);

  const focusAfterConversationRemoval = useCallback(
    (conversationId: string) => {
      const element = conversationRemovalFocusTarget(conversationId);
      if (element) requestAnimationFrame(() => element.focus());
    },
    [conversationRemovalFocusTarget],
  );

  const getConversationActionRef = useCallback((conversationId: string) => {
    let ref = conversationActionRefs.current.get(conversationId);
    if (!ref) {
      ref = createRef<HTMLButtonElement>();
      conversationActionRefs.current.set(conversationId, ref);
    }
    return ref;
  }, []);

  const beginConversationRename = useCallback((conversation: Conversation) => {
    setSidebarActionError("");
    setMenu(null);
    setTitleDraft(conversation.title);
    setEditingConversationId(conversation.id);
  }, []);

  const cancelConversationRename = useCallback((restoreFocus = false) => {
    const id = editingConversationIdRef.current;
    setEditingConversationId(null);
    setTitleDraft("");
    if (restoreFocus && id) {
      requestAnimationFrame(() => conversationButtonRefs.current.get(id)?.focus());
    }
  }, []);

  const saveConversationRename = useCallback(
    async (conversation: Conversation) => {
      if (!bridge || savingConversationIdRef.current === conversation.id) return;
      const title = titleDraftRef.current.trim();
      if (!title) {
        setSidebarActionError(t.chat.titleRequired);
        renameInputRef.current?.focus();
        return;
      }
      if (title === conversation.title) {
        cancelConversationRename(true);
        return;
      }

      const optimistic = { ...conversation, title, updatedAt: new Date().toISOString() };
      setSidebarActionError("");
      savingConversationIdRef.current = conversation.id;
      setSavingConversationId(conversation.id);
      upsertConversation(optimistic);
      try {
        const result = await bridge.request("conversation.rename", { id: conversation.id, title });
        upsertConversation(result.conversation);
        setEditingConversationId(null);
        setTitleDraft("");
      } catch (renameError) {
        upsertConversation(conversation);
        setSidebarActionError(
          renameError instanceof BridgeError && renameError.message
            ? renameError.message
            : t.chat.renameTitleFailed,
        );
      } finally {
        savingConversationIdRef.current = null;
        setSavingConversationId(null);
      }
    },
    [bridge, cancelConversationRename],
  );

  const togglePinned = useCallback(
    async (conversation: Conversation) => {
      if (!bridge) return;
      const pinned = conversation.pinnedAt === null;
      const timestamp = new Date().toISOString();
      const optimistic = {
        ...conversation,
        pinnedAt: pinned ? timestamp : null,
      };
      setSidebarActionError("");
      upsertConversation(optimistic);
      try {
        const result = await bridge.request("conversation.setPinned", {
          id: conversation.id,
          pinned,
        });
        upsertConversation(result.conversation);
      } catch (pinError) {
        upsertConversation(conversation);
        setSidebarActionError(
          pinError instanceof BridgeError && pinError.message
            ? pinError.message
            : t.shell.conversationActionFailed,
        );
      }
    },
    [bridge],
  );

  const setConversationArchived = useCallback(
    async (conversation: Conversation, archived: boolean) => {
      if (!bridge) return;
      const timestamp = new Date().toISOString();
      const optimistic = {
        ...conversation,
        pinnedAt: null,
        archivedAt: archived ? timestamp : null,
      };
      setSidebarActionError("");
      upsertConversation(optimistic);
      if (showArchivedRef.current === !archived) focusAfterConversationRemoval(conversation.id);
      try {
        const result = await bridge.request("conversation.setArchived", {
          id: conversation.id,
          archived,
        });
        upsertConversation(result.conversation);
        if (archived) closeConversationWorkspacePanes(conversation.id);
      } catch (archiveError) {
        upsertConversation(conversation);
        setSidebarActionError(
          archiveError instanceof BridgeError && archiveError.message
            ? archiveError.message
            : t.shell.conversationActionFailed,
        );
      }
    },
    [bridge, closeConversationWorkspacePanes, focusAfterConversationRemoval],
  );

  const requestDeleteConversation = useCallback((conversation: Conversation) => {
    deleteReturnFocusRef.current = conversationButtonRefs.current.get(conversation.id) ?? null;
    setDeleteError("");
    setConversationToDelete(conversation);
  }, []);

  async function deleteConversation() {
    if (!bridge || !conversationToDelete || isDeletingConversation) return;
    const conversation = conversationToDelete;
    setDeleteError("");
    setSidebarActionError("");
    setIsDeletingConversation(true);
    const focusTarget = conversationRemovalFocusTarget(conversation.id);
    removeConversationFromIndex(conversation.id);
    try {
      await bridge.request("conversation.delete", { id: conversation.id });
      removeConversationFromIndex(conversation.id);
      closeConversationWorkspacePanes(conversation.id);
      conversationActionRefs.current.delete(conversation.id);
      deleteReturnFocusRef.current = focusTarget;
      setConversationToDelete(null);
    } catch (removeError) {
      upsertConversation(conversation);
      const message =
        removeError instanceof BridgeError && removeError.message
          ? removeError.message
          : t.shell.conversationDeleteFailed;
      setDeleteError(message);
      setSidebarActionError(message);
    } finally {
      setIsDeletingConversation(false);
    }
  }

  function viewArchivedConversations() {
    setMenu(null);
    setShowArchived(true);
    requestAnimationFrame(() => requestAnimationFrame(() => archivedBackRef.current?.focus()));
  }

  function showRecentConversations() {
    setMenu(null);
    setShowArchived(false);
    requestAnimationFrame(() =>
      requestAnimationFrame(() => newLooseConversationRef.current?.focus()),
    );
  }

  const conversationMenuItems = useCallback(
    (conversation: Conversation): ActionMenuItem[] => {
      const items: ActionMenuItem[] = [];
      if (!showArchivedRef.current) {
        items.push({
          id: "pin",
          label: conversation.pinnedAt ? t.shell.unpinConversation : t.shell.pinConversation,
          icon: conversation.pinnedAt ? <PinOff size={15} /> : <Pin size={15} />,
          onSelect: () => void togglePinned(conversation),
        });
      }
      items.push(
        {
          id: "rename",
          label: t.shell.renameConversation,
          icon: <Pencil size={15} />,
          onSelect: () => beginConversationRename(conversation),
        },
        {
          id: "open-beside",
          label: t.shell.openConversationBeside,
          icon: <Columns2 size={15} />,
          disabled: paneCount(layout) >= 6 && !findPaneByConversation(layout, conversation.id),
          onSelect: () => {
            setSidebarActionError("");
            const paneId = openConversationBeside(conversation.id);
            if (!paneId) setSidebarActionError(t.workspace.panelLimit);
          },
        },
        { id: "main-separator", separator: true },
        {
          id: "archive",
          label: showArchivedRef.current
            ? t.shell.unarchiveConversation
            : t.shell.archiveConversation,
          icon: showArchivedRef.current ? <ArchiveRestore size={15} /> : <Archive size={15} />,
          onSelect: () => void setConversationArchived(conversation, !showArchivedRef.current),
        },
        {
          id: "delete",
          label: t.shell.deleteConversation,
          icon: <Trash2 size={15} />,
          danger: true,
          onSelect: () => requestDeleteConversation(conversation),
        },
      );
      return items;
    },
    [
      beginConversationRename,
      layout,
      openConversationBeside,
      requestDeleteConversation,
      setConversationArchived,
      togglePinned,
    ],
  );
  const openConversation = useCallback(
    (id: string) => navigate({ name: "conversation", id }),
    [navigate],
  );
  const registerConversationButton = useCallback(
    (id: string, element: HTMLButtonElement | null) => {
      if (element) conversationButtonRefs.current.set(id, element);
      else conversationButtonRefs.current.delete(id);
      fluidHover.registerItem(`conversation:${id}`, element);
    },
    [fluidHover.registerItem],
  );
  const openConversationContextMenu = useCallback(
    (id: string, point: { x: number; y: number }) => setMenu({ kind: "conversation", id, point }),
    [],
  );
  const changeConversationMenu = useCallback((id: string, open: boolean) => {
    setMenu((current) => {
      if (open) return { kind: "conversation", id };
      return current?.kind === "conversation" && current.id === id ? null : current;
    });
  }, []);
  const changeTitleDraft = useCallback((draft: string) => setTitleDraft(draft), []);
  const renderConversation = (conversation: Conversation) => {
    const isOpen =
      view.name === "workspace" && findPaneByConversation(layout, conversation.id) !== undefined;
    // Com a tela do workspace por cima, o painel escondido não conta como ativo.
    const active =
      view.name === "workspace" &&
      !workspaceOverviewVisible &&
      activePane?.view.kind === "chat" &&
      activePane.view.conversationId === conversation.id;
    const editing = editingConversationId === conversation.id;
    const menuOpen = menu?.kind === "conversation" && menu.id === conversation.id;
    return (
      <ConversationRow
        active={active}
        actionRef={getConversationActionRef(conversation.id)}
        anchorPoint={menuOpen && menu?.kind === "conversation" ? menu.point : undefined}
        conversation={conversation}
        editing={editing}
        getMenuItems={conversationMenuItems}
        key={conversation.id}
        menuOpen={menuOpen}
        onCancelRename={cancelConversationRename}
        onContextMenu={openConversationContextMenu}
        onDraftChange={changeTitleDraft}
        onMenuOpenChange={changeConversationMenu}
        onOpenConversation={openConversation}
        onRegisterConversationButton={registerConversationButton}
        onSaveRename={saveConversationRename}
        openAndVisible={documentVisible && isOpen}
        renameInputRef={renameInputRef}
        saving={savingConversationId === conversation.id}
        showArchived={showArchived}
        titleDraft={editing ? titleDraft : ""}
      />
    );
  };

  const pinnedRows = pinnedConversations.map(renderConversation);
  const recentRows = recentConversations.map(renderConversation);

  const getProjectActionRef = (projectId: string) => {
    let ref = projectActionRefs.current.get(projectId);
    if (!ref) {
      ref = createRef<HTMLButtonElement>();
      projectActionRefs.current.set(projectId, ref);
    }
    return ref;
  };

  const saveCollapsedProjects = (next: string[]) => {
    collapsedTouchedRef.current = true;
    setCollapsedProjects(next);
    if (!bridge) return;
    void bridge
      .request("settings.set", { key: COLLAPSED_PROJECTS_SETTING, value: next })
      .catch(() => {
        setSidebarActionError(t.shell.projectsSaveFailed);
      });
  };

  const toggleProject = (projectId: string) => {
    const current = collapsedProjectsRef.current;
    const known = new Set(projectsState.projects.map((project) => project.id));
    const next = current.includes(projectId)
      ? current.filter((id) => id !== projectId)
      : [...current, projectId];
    saveCollapsedProjects(next.filter((id) => known.has(id)));
  };

  const openProjectDialog = (project: Project | null) => {
    setMenu(null);
    setSidebarActionError("");
    projectDialogReturnFocusRef.current = project
      ? (getProjectActionRef(project.id).current ??
        projectButtonRefs.current.get(project.id) ??
        null)
      : newProjectRef.current;
    setProjectDialog({ project });
  };

  const handleProjectSaved = (project: Project, mode: "create" | "edit") => {
    upsertProject(project);
    setProjectDialog(null);
    if (mode === "create") {
      if (collapsedProjectsRef.current.includes(project.id)) {
        saveCollapsedProjects(collapsedProjectsRef.current.filter((id) => id !== project.id));
      }
      navigate({ name: "new-conversation", projectId: project.id });
    }
  };

  const requestRemoveProject = (project: Project) => {
    setMenu(null);
    setRemoveProjectError("");
    removeProjectReturnFocusRef.current =
      getProjectActionRef(project.id).current ?? projectButtonRefs.current.get(project.id) ?? null;
    setProjectToRemove(project);
  };

  const cancelRemoveProject = () => {
    if (isRemovingProject) return;
    setProjectToRemove(null);
    setRemoveProjectError("");
  };

  async function removeProject() {
    if (!bridge || !projectToRemove || isRemovingProject) return;
    const project = projectToRemove;
    setRemoveProjectError("");
    setIsRemovingProject(true);
    try {
      await bridge.request("projects.remove", { id: project.id });
      projectActionRefs.current.delete(project.id);
      removeProjectReturnFocusRef.current = newProjectRef.current;
      removeProjectFromStore(project.id);
      setProjectToRemove(null);
    } catch (removeError) {
      setRemoveProjectError(
        removeError instanceof BridgeError && removeError.message
          ? removeError.message
          : t.projects.removeFailed,
      );
    } finally {
      setIsRemovingProject(false);
    }
  }

  async function moveProject(project: Project, workspaceId: string) {
    if (!bridge) return;
    setSidebarActionError("");
    try {
      const result = await bridge.request("projects.update", { id: project.id, workspaceId });
      upsertProject(result.project);
    } catch (moveError) {
      setSidebarActionError(
        moveError instanceof BridgeError && moveError.message
          ? moveError.message
          : t.shell.moveProjectFailed,
      );
    }
  }

  const projectMenuItems = (project: Project): ActionMenuItem[] => {
    const otherWorkspaces = workspaces.filter((workspace) => workspace.id !== project.workspaceId);
    return [
      {
        id: "edit",
        label: t.shell.editProject,
        icon: <Pencil size={15} />,
        onSelect: () => openProjectDialog(project),
      },
      ...(otherWorkspaces.length > 0
        ? [
            { id: "move-separator", separator: true as const },
            ...otherWorkspaces.map((workspace) => ({
              id: `move-${workspace.id}`,
              label: t.shell.moveProjectTo(workspace.name),
              icon: <ArrowRightLeft size={15} />,
              onSelect: () => void moveProject(project, workspace.id),
            })),
            { id: "remove-separator", separator: true as const },
          ]
        : []),
      {
        id: "remove",
        label: t.shell.removeProject,
        icon: <Trash2 size={15} />,
        danger: true,
        onSelect: () => requestRemoveProject(project),
      },
    ];
  };

  const renderTerminal = (terminal: TerminalInfo) => {
    const details = getTerminalDisplayDetails(terminal);
    const title = terminalTitles.get(terminal.id) ?? details.shortTitle;
    const terminalState = terminal.exited ? t.shell.exited : t.terminal.running;
    const accessibleName = t.terminal.sidebarAccessibleName(title, terminalState);
    return (
      <li
        className={`${styles.conversationItem} ${styles.terminalConversationItem}`}
        key={terminal.id}
      >
        <button
          aria-current={
            view.name === "workspace" &&
            activePane?.view.kind === "terminal" &&
            activePane.view.terminalId === terminal.id
              ? "page"
              : undefined
          }
          aria-label={accessibleName}
          className={styles.conversationButton}
          onClick={() =>
            navigate({ name: "terminal", id: terminal.id, workspaceId: terminal.workspaceId })
          }
          ref={(element) => {
            if (element) {
              terminalButtonRefs.current.set(terminal.id, element);
              fluidHover.registerItem(`terminal:${terminal.id}`, element);
            } else {
              terminalButtonRefs.current.delete(terminal.id);
              fluidHover.registerItem(`terminal:${terminal.id}`, null);
            }
          }}
          title={accessibleName}
          type="button"
        >
          <SquareTerminal aria-hidden="true" size={15} strokeWidth={1.8} />
          <span className={styles.conversationTitle}>{title}</span>
          {terminal.exited ? (
            <span className={styles.exitedMarker}>{t.shell.exited}</span>
          ) : (
            <span aria-hidden="true" className={styles.runningMarker} />
          )}
        </button>
        <TerminalCloseButton
          className={styles.endTerminalButton}
          label={title}
          onRequestClose={() => requestClose(terminal)}
        />
      </li>
    );
  };

  const renderProject = (project: Project) => {
    const conversations = groups.byProject.get(project.id) ?? [];
    const projectTerminals = terminalGroups.byProject.get(project.id) ?? [];
    const expanded = !collapsedProjects.includes(project.id);
    const hasWaiting = conversations.some((conversation) => conversation.state === "waiting");
    const hasWorking = conversations.some((conversation) => conversation.state === "working");
    const hasQueued = conversations.some((conversation) => conversation.state === "queued");
    const statusClass = expanded
      ? ""
      : hasWaiting
        ? styles.conversationStatusNeedsYou
        : hasWorking
          ? styles.conversationStatusWorking
          : hasQueued
            ? styles.conversationStatusQueued
            : "";
    const statusText = expanded
      ? ""
      : hasWaiting
        ? t.shell.projectStatusWaiting
        : hasWorking
          ? t.shell.projectStatusWorking
          : hasQueued
            ? t.shell.projectStatusQueued
            : "";
    const menuOpen = menu?.kind === "project" && menu.id === project.id;
    const ProjectIcon = getProjectIcon(project.icon);
    const Chevron = expanded ? ChevronDown : ChevronRight;
    const listId = `sidebar-project-${project.id}`;
    return (
      <li className={styles.projectItem} key={project.id}>
        <div
          className={`${styles.conversationItem} ${menuOpen ? styles.conversationMenuOpen : ""}`}
        >
          <button
            aria-controls={expanded ? listId : undefined}
            aria-description={t.shell.projectDescription(
              conversations.length,
              statusText,
              projectTerminals.length,
            )}
            aria-expanded={expanded}
            className={styles.conversationButton}
            onClick={() => toggleProject(project.id)}
            ref={(element) => {
              if (element) projectButtonRefs.current.set(project.id, element);
              else projectButtonRefs.current.delete(project.id);
              fluidHover.registerItem(`project:${project.id}`, element);
            }}
            title={project.path}
            type="button"
          >
            <Chevron
              aria-hidden="true"
              className={styles.projectChevron}
              size={16}
              strokeWidth={1.8}
            />
            <ProjectIcon aria-hidden="true" size={15} strokeWidth={1.8} />
            <span className={styles.conversationTitle}>{project.name}</span>
            {statusClass ? (
              <span
                aria-hidden="true"
                className={`${styles.conversationStatusDot} ${statusClass}`}
              />
            ) : null}
          </button>
          <div className={styles.projectActions}>
            <IconButton
              icon={<Plus aria-hidden="true" size={16} strokeWidth={1.8} />}
              label={t.shell.newConversationInProject(project.name)}
              onClick={() => navigate({ name: "new-conversation", projectId: project.id })}
              size="sm"
            />
            <ActionMenu
              items={() => projectMenuItems(project)}
              label={t.shell.projectActions(project.name)}
              onOpenChange={(open) => {
                setMenu((current) => {
                  if (open) return { kind: "project", id: project.id };
                  return current?.kind === "project" && current.id === project.id ? null : current;
                });
              }}
              open={menuOpen}
              triggerIcon={conversationActionsIcon}
              triggerLabel={t.shell.projectActions(project.name)}
              triggerRef={getProjectActionRef(project.id)}
            />
          </div>
        </div>
        {expanded ? (
          conversations.length > 0 || projectTerminals.length > 0 ? (
            <ul
              aria-label={t.shell.projectConversations(project.name)}
              className={`${styles.conversationList} ${styles.projectConversations}`}
              id={listId}
            >
              {conversations.map(renderConversation)}
              {projectTerminals.map(renderTerminal)}
            </ul>
          ) : (
            <p className={`${styles.emptyList} ${styles.projectEmpty}`} id={listId}>
              <span>{t.shell.projectNoConversations}</span>
            </p>
          )
        ) : null}
      </li>
    );
  };

  return (
    <aside aria-label={t.shell.sidebar} className={styles.sidebar}>
      <nav
        aria-label={t.shell.primaryNavigation}
        className={`${styles.navigation} ${scrollAreaStyles.scrollArea}`}
        ref={fluidHover.containerRef}
      >
        <FluidHoverHighlight controller={fluidHover} />
        <div className={styles.primaryActions}>
          <Button
            aria-current={
              view.name === "workspace" &&
              !workspaceOverviewVisible &&
              activePane?.view.kind === "new-conversation" &&
              !activePane.view.projectId
                ? "page"
                : undefined
            }
            className={styles.navigationAction}
            iconStart={<SquarePen aria-hidden="true" size={16} strokeWidth={1.75} />}
            onClick={() => navigate({ name: "new-conversation" })}
            ref={(element) => fluidHover.registerItem("new-conversation", element)}
            variant="ghost"
          >
            {t.shell.newConversation}
          </Button>
          <Button
            aria-current={view.name === "inbox" ? "page" : undefined}
            aria-description={inboxTotal > 0 ? t.shell.inboxCount(inboxTotal) : undefined}
            className={styles.navigationAction}
            iconStart={<Inbox aria-hidden="true" size={16} strokeWidth={1.75} />}
            onClick={() => navigate({ name: "inbox" })}
            ref={(element) => fluidHover.registerItem("inbox", element)}
            variant="ghost"
          >
            {t.shell.inbox}
            {inboxTotal > 0 ? (
              <span aria-hidden="true" className={styles.navigationCount}>
                {inboxTotal}
              </span>
            ) : null}
          </Button>
          <Button
            aria-description={t.shell.availableSoon}
            className={styles.navigationAction}
            disabled
            iconStart={<ListTodo aria-hidden="true" size={16} strokeWidth={1.75} />}
            ref={(element) => fluidHover.registerItem("tasks", element)}
            variant="ghost"
          >
            {t.shell.tasks}
          </Button>
        </div>

        {showArchived ? null : (
          <section aria-labelledby="sidebar-projects-title" className={styles.section}>
            <div className={styles.sectionHeader}>
              <h2 className={styles.sectionTitle} id="sidebar-projects-title">
                {t.shell.projects}
              </h2>
              <IconButton
                icon={<Plus aria-hidden="true" size={16} strokeWidth={1.8} />}
                label={t.shell.newProject}
                onClick={() => openProjectDialog(null)}
                ref={newProjectRef}
                size="sm"
              />
            </div>
            {projectsState.error ? (
              <p className={styles.emptyList} role="status">
                <span>{t.shell.projectsLoadError}</span>
              </p>
            ) : null}
            {workspaceProjects.length > 0 ? (
              <ul aria-label={t.shell.projectList} className={styles.conversationList}>
                {workspaceProjects.map(renderProject)}
              </ul>
            ) : projectsState.loading || projectsState.error || workspacesLoading ? null : (
              <p className={styles.emptyList}>
                <span>{t.shell.noProjects}</span>
              </p>
            )}
          </section>
        )}

        <section aria-labelledby="sidebar-conversations-title" className={styles.section}>
          <div className={styles.sectionHeader}>
            {showArchived ? (
              <div className={styles.sectionHeadingStart}>
                <IconButton
                  icon={<ArrowLeft aria-hidden="true" size={16} strokeWidth={1.8} />}
                  label={t.shell.backToConversations}
                  onClick={showRecentConversations}
                  ref={archivedBackRef}
                  size="sm"
                />
                <h2 className={styles.sectionTitle} id="sidebar-conversations-title">
                  {t.shell.archivedConversations}
                </h2>
              </div>
            ) : (
              <h2 className={styles.sectionTitle} id="sidebar-conversations-title">
                {t.shell.conversations}
              </h2>
            )}
            {showArchived ? null : (
              <div className={styles.sectionActions}>
                <ActionMenu
                  items={[
                    {
                      id: "view-archived",
                      label: t.shell.viewArchivedConversations,
                      icon: <Archive size={15} />,
                      onSelect: viewArchivedConversations,
                    },
                  ]}
                  label={t.shell.conversationSectionActions}
                  onOpenChange={(open) => setMenu(open ? { kind: "section" } : null)}
                  open={menu?.kind === "section"}
                  triggerClassName={styles.sectionActionsMenu}
                  triggerIcon={<Ellipsis aria-hidden="true" size={16} strokeWidth={1.8} />}
                  triggerLabel={t.shell.conversationSectionActions}
                />
                <IconButton
                  icon={<Plus aria-hidden="true" size={16} strokeWidth={1.8} />}
                  label={t.shell.newLooseConversation}
                  onClick={() => navigate({ name: "new-conversation" })}
                  ref={newLooseConversationRef}
                  size="sm"
                />
              </div>
            )}
          </div>

          {error ? (
            <p className={styles.emptyList} role="status">
              <span>{t.shell.conversationsLoadError}</span>
            </p>
          ) : null}
          {conversationIndex.error ? (
            <p className={styles.emptyList} role="status">
              <span>{t.shell.conversationsLoadError}</span>
            </p>
          ) : null}
          {sidebarActionError ? (
            <p className={styles.actionError} role="status">
              {sidebarActionError}
            </p>
          ) : null}

          {pinnedRows.length > 0 ? (
            <>
              <h3 className={styles.conversationSubheading}>{t.shell.pinnedConversations}</h3>
              <ul aria-label={t.shell.pinnedConversations} className={styles.conversationList}>
                {pinnedRows}
              </ul>
            </>
          ) : null}
          {recentRows.length > 0 ? (
            <>
              {pinnedRows.length > 0 ? (
                <h3 className={styles.conversationSubheading}>{t.shell.recentConversations}</h3>
              ) : null}
              <ul
                aria-label={
                  showArchived ? t.shell.archivedConversations : t.shell.agentConversations
                }
                className={styles.conversationList}
              >
                {recentRows}
              </ul>
            </>
          ) : null}
          {showArchived && !conversationIndex.loading && conversationList.length === 0 ? (
            <p className={styles.emptyList}>
              <span>{t.shell.noArchivedConversations}</span>
            </p>
          ) : null}
          {!showArchived &&
          !conversationIndex.loading &&
          !projectsState.loading &&
          groups.loose.length === 0 &&
          terminalGroups.loose.length === 0 ? (
            <p className={styles.emptyList}>
              <span>{t.shell.noConversations}</span>
            </p>
          ) : null}
          {!showArchived && terminalGroups.loose.length > 0 ? (
            <ul aria-label={t.shell.conversations} className={styles.conversationList}>
              {terminalGroups.loose.map(renderTerminal)}
            </ul>
          ) : null}
        </section>
      </nav>

      <footer className={styles.footer}>
        <ServiceStatus />
        <IconButton
          aria-current={view.name === "settings" ? "page" : undefined}
          className={styles.settingsButton}
          icon={<Settings aria-hidden="true" size={16} strokeWidth={1.75} />}
          label={t.shell.settings}
          onClick={() => navigate({ name: "settings", section: "general" })}
          size="sm"
        />
      </footer>
      <Dialog
        description={
          terminalToClose?.exited ? t.terminal.closeExitedDescription : t.terminal.closeDescription
        }
        initialFocusRef={cancelCloseRef as RefObject<HTMLElement | null>}
        onClose={cancelClose}
        open={terminalToClose !== null}
        returnFocusRef={focusAfterCloseRef as RefObject<HTMLElement | null>}
        title={t.terminal.closeTitle}
        footer={
          <>
            <Button
              disabled={isClosing}
              onClick={cancelClose}
              ref={cancelCloseRef}
              variant="secondary"
            >
              {t.terminal.cancel}
            </Button>
            <Button disabled={isClosing} onClick={() => void closeTerminal()} variant="danger">
              <SquareTerminal aria-hidden="true" size={15} strokeWidth={1.8} />
              {isClosing ? t.terminal.closing : t.terminal.close}
            </Button>
          </>
        }
      >
        {closeError ? (
          <p className={styles.closeError} role="alert">
            {closeError}
          </p>
        ) : null}
      </Dialog>
      <Dialog
        description={t.shell.deleteConversationDescription}
        initialFocusRef={deleteCancelRef as RefObject<HTMLElement | null>}
        onClose={() => {
          if (isDeletingConversation) return;
          setConversationToDelete(null);
          setDeleteError("");
        }}
        open={conversationToDelete !== null}
        returnFocusRef={deleteReturnFocusRef as RefObject<HTMLElement | null>}
        title={t.shell.deleteConversationTitle}
        footer={
          <>
            <Button
              disabled={isDeletingConversation}
              onClick={() => {
                setConversationToDelete(null);
                setDeleteError("");
              }}
              ref={deleteCancelRef}
              variant="secondary"
            >
              {t.conversation.cancel}
            </Button>
            <Button
              disabled={isDeletingConversation}
              onClick={() => void deleteConversation()}
              variant="danger"
            >
              <Trash2 aria-hidden="true" size={15} />
              {t.shell.deleteConversation}
            </Button>
          </>
        }
      >
        {deleteError ? (
          <p className={styles.closeError} role="alert">
            {deleteError}
          </p>
        ) : null}
      </Dialog>
      <ProjectDialog
        onClose={() => setProjectDialog(null)}
        onSaved={handleProjectSaved}
        open={projectDialog !== null}
        project={projectDialog?.project ?? null}
        returnFocusRef={projectDialogReturnFocusRef}
      />
      <Dialog
        description={t.projects.removeDescription}
        footer={
          <>
            <Button
              disabled={isRemovingProject}
              onClick={cancelRemoveProject}
              ref={removeProjectCancelRef}
              variant="secondary"
            >
              {t.projects.cancel}
            </Button>
            <Button
              disabled={isRemovingProject}
              onClick={() => void removeProject()}
              variant="danger"
            >
              <Trash2 aria-hidden="true" size={15} />
              {isRemovingProject ? t.projects.removing : t.projects.removeAction}
            </Button>
          </>
        }
        initialFocusRef={removeProjectCancelRef as RefObject<HTMLElement | null>}
        onClose={cancelRemoveProject}
        open={projectToRemove !== null}
        returnFocusRef={removeProjectReturnFocusRef}
        title={t.projects.removeTitle(projectToRemove?.name ?? "")}
      >
        {projectToRemoveWorktrees.length > 0 ? (
          <p className={styles.removeProjectNote}>{t.projects.removeKeepsCopies}</p>
        ) : null}
        {removeProjectError ? (
          <p className={styles.closeError} role="alert">
            {removeProjectError}
          </p>
        ) : null}
      </Dialog>
    </aside>
  );
}
