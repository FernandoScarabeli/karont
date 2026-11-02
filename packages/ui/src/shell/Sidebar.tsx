import { BridgeError, type Conversation, type TerminalInfo } from "@karont/contract";
import {
  Archive,
  ArchiveRestore,
  ArrowLeft,
  Columns2,
  Ellipsis,
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
import { createRef, type RefObject, useEffect, useRef, useState } from "react";
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
import { useNavigation } from "../navigation/NavigationContext.tsx";
import { TerminalCloseButton } from "../terminal/TerminalCloseButton.tsx";
import {
  getTerminalDisplayDetails,
  getTerminalDisplayTitles,
  useTerminals,
} from "../terminal/useTerminals.ts";
import { findPane, findPaneByConversation, paneCount } from "../workspace/layout.ts";
import { ServiceStatus } from "./ServiceStatus.tsx";
import styles from "./Sidebar.module.css";

type MenuState =
  | { kind: "section" }
  | { kind: "conversation"; id: string; point?: { x: number; y: number } }
  | null;

export function Sidebar() {
  const {
    closeConversationWorkspacePanes,
    closeTerminalWorkspacePane,
    navigate,
    openConversationBeside,
    view,
    layout,
    activePaneId,
  } = useNavigation();
  const bridge = getBridge();
  const activePane = findPane(layout, activePaneId);
  const navigationRef = useRef<HTMLElement>(null);
  const fluidHover = useFluidHover(navigationRef, {
    axis: "y",
    isItemDisabled: (element) => element.matches(":disabled"),
    gapClick: false,
  });
  const { terminals, error } = useTerminals();
  const [showArchived, setShowArchived] = useState(false);
  const conversationIndex = useConversationIndex(showArchived);
  const conversationList = conversationIndex.conversations;
  const [documentVisible, setDocumentVisible] = useState(
    () => document.visibilityState === "visible",
  );
  const pinnedConversations = showArchived
    ? []
    : conversationList.filter((conversation) => conversation.pinnedAt !== null);
  const recentConversations = showArchived
    ? conversationList
    : conversationList.filter((conversation) => conversation.pinnedAt === null);
  const terminalTitles = getTerminalDisplayTitles(terminals);
  const [terminalToClose, setTerminalToClose] = useState<TerminalInfo | null>(null);
  const [isClosing, setIsClosing] = useState(false);
  const [closeError, setCloseError] = useState("");
  const [sidebarActionError, setSidebarActionError] = useState("");
  const [menu, setMenu] = useState<MenuState>(null);
  const [editingConversationId, setEditingConversationId] = useState<string | null>(null);
  const [titleDraft, setTitleDraft] = useState("");
  const [savingConversationId, setSavingConversationId] = useState<string | null>(null);
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

  function conversationRemovalFocusTarget(conversationId: string) {
    const index = conversationList.findIndex((conversation) => conversation.id === conversationId);
    const target = conversationList[index + 1] ?? conversationList[index - 1];
    return target
      ? (conversationButtonRefs.current.get(target.id) ?? null)
      : showArchived
        ? archivedBackRef.current
        : newLooseConversationRef.current;
  }

  function focusAfterConversationRemoval(conversationId: string) {
    const element = conversationRemovalFocusTarget(conversationId);
    if (element) requestAnimationFrame(() => element.focus());
  }

  function getConversationActionRef(conversationId: string) {
    let ref = conversationActionRefs.current.get(conversationId);
    if (!ref) {
      ref = createRef<HTMLButtonElement>();
      conversationActionRefs.current.set(conversationId, ref);
    }
    return ref;
  }

  function beginConversationRename(conversation: Conversation) {
    setSidebarActionError("");
    setMenu(null);
    setTitleDraft(conversation.title);
    setEditingConversationId(conversation.id);
  }

  function cancelConversationRename(restoreFocus = false) {
    const id = editingConversationId;
    setEditingConversationId(null);
    setTitleDraft("");
    if (restoreFocus && id) {
      requestAnimationFrame(() => conversationButtonRefs.current.get(id)?.focus());
    }
  }

  async function saveConversationRename(conversation: Conversation) {
    if (!bridge || savingConversationId === conversation.id) return;
    const title = titleDraft.trim();
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
      setSavingConversationId(null);
    }
  }

  async function togglePinned(conversation: Conversation) {
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
  }

  async function setConversationArchived(conversation: Conversation, archived: boolean) {
    if (!bridge) return;
    const timestamp = new Date().toISOString();
    const optimistic = {
      ...conversation,
      pinnedAt: null,
      archivedAt: archived ? timestamp : null,
    };
    setSidebarActionError("");
    upsertConversation(optimistic);
    if (showArchived === !archived) focusAfterConversationRemoval(conversation.id);
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
  }

  function requestDeleteConversation(conversation: Conversation) {
    deleteReturnFocusRef.current = conversationButtonRefs.current.get(conversation.id) ?? null;
    setDeleteError("");
    setConversationToDelete(conversation);
  }

  async function deleteConversation() {
    if (!bridge || !conversationToDelete || isDeletingConversation) return;
    const conversation = conversationToDelete;
    setDeleteError("");
    setSidebarActionError("");
    setIsDeletingConversation(true);
    removeConversationFromIndex(conversation.id);
    try {
      await bridge.request("conversation.delete", { id: conversation.id });
      removeConversationFromIndex(conversation.id);
      closeConversationWorkspacePanes(conversation.id);
      conversationActionRefs.current.delete(conversation.id);
      deleteReturnFocusRef.current = conversationRemovalFocusTarget(conversation.id);
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

  function conversationMenuItems(conversation: Conversation): ActionMenuItem[] {
    const items: ActionMenuItem[] = [];
    if (!showArchived) {
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
        label: showArchived ? t.shell.unarchiveConversation : t.shell.archiveConversation,
        icon: showArchived ? <ArchiveRestore size={15} /> : <Archive size={15} />,
        onSelect: () => void setConversationArchived(conversation, !showArchived),
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
  }

  function renderConversation(conversation: Conversation) {
    const stateText =
      conversation.state === "working"
        ? t.chat.working
        : conversation.state === "waiting"
          ? t.chat.waiting
          : conversation.state === "error"
            ? t.shell.conversationError
            : t.chat.idle;
    const conversationOpenAndVisible =
      documentVisible &&
      view.name === "workspace" &&
      findPaneByConversation(layout, conversation.id) !== undefined;
    const isUnread = Boolean(conversation.unreadAt) && !conversationOpenAndVisible;
    const stateDetails = [
      stateText,
      isUnread ? t.shell.unreadResponse : "",
      conversation.pinnedAt ? t.shell.pinnedState : "",
      showArchived ? t.shell.archivedState : "",
    ]
      .filter(Boolean)
      .join(", ");
    const statusClass =
      conversation.state === "waiting"
        ? styles.conversationStatusNeedsYou
        : conversation.state === "working"
          ? styles.conversationStatusWorking
          : conversation.state === "error"
            ? styles.conversationStatusError
            : isUnread
              ? styles.conversationStatusUnread
              : "";
    const active =
      view.name === "workspace" &&
      activePane?.view.kind === "chat" &&
      activePane.view.conversationId === conversation.id;
    const editing = editingConversationId === conversation.id;
    const menuOpen = menu?.kind === "conversation" && menu.id === conversation.id;
    const actionRef = getConversationActionRef(conversation.id);

    return (
      <li
        className={`${styles.conversationItem} ${menuOpen ? styles.conversationMenuOpen : ""}`}
        key={conversation.id}
        onContextMenu={(event) => {
          if (editing) return;
          event.preventDefault();
          setMenu({
            kind: "conversation",
            id: conversation.id,
            point: { x: event.clientX, y: event.clientY },
          });
        }}
      >
        {editing ? (
          <input
            aria-label={t.chat.renameTitleInput}
            className={`${styles.conversationButton} ${styles.conversationTitleInput}`}
            disabled={savingConversationId === conversation.id}
            maxLength={240}
            onBlur={() => {
              const draft = titleDraft.trim();
              if (!draft || draft === conversation.title) cancelConversationRename();
              else void saveConversationRename(conversation);
            }}
            onChange={(event) => setTitleDraft(event.currentTarget.value)}
            onKeyDown={(event) => {
              event.stopPropagation();
              if (event.key === "Enter") {
                event.preventDefault();
                void saveConversationRename(conversation);
              } else if (event.key === "Escape") {
                event.preventDefault();
                cancelConversationRename(true);
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
            onClick={() => navigate({ name: "conversation", id: conversation.id })}
            ref={(element) => {
              if (element) {
                conversationButtonRefs.current.set(conversation.id, element);
                fluidHover.registerItem(`conversation:${conversation.id}`, element);
              } else {
                conversationButtonRefs.current.delete(conversation.id);
                fluidHover.registerItem(`conversation:${conversation.id}`, null);
              }
            }}
            title={`${conversation.title}, ${stateDetails}`}
            type="button"
          >
            <AgentIcon agentId={conversation.agent} />
            <span className={styles.conversationTitle}>{conversation.title}</span>
            {conversation.pinnedAt && !showArchived ? (
              <Pin aria-hidden="true" className={styles.pinnedMarker} size={13} />
            ) : null}
            {statusClass ? (
              <span
                aria-hidden="true"
                className={`${styles.conversationStatusDot} ${statusClass}`}
              />
            ) : null}
          </button>
        )}
        {!editing ? (
          <ActionMenu
            anchorPoint={menuOpen ? menu.point : undefined}
            items={conversationMenuItems(conversation)}
            label={t.shell.conversationActions(conversation.title)}
            onOpenChange={(open) => {
              setMenu((current) => {
                if (open) return { kind: "conversation", id: conversation.id };
                return current?.kind === "conversation" && current.id === conversation.id
                  ? null
                  : current;
              });
            }}
            open={menuOpen}
            triggerClassName={styles.conversationActions}
            triggerIcon={<Ellipsis aria-hidden="true" size={17} strokeWidth={1.8} />}
            triggerLabel={t.shell.conversationActions(conversation.title)}
            triggerRef={actionRef}
          />
        ) : null}
      </li>
    );
  }

  const pinnedRows = pinnedConversations.map(renderConversation);
  const recentRows = recentConversations.map(renderConversation);

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
              view.name === "workspace" && activePane?.view.kind === "new-conversation"
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

        <section aria-labelledby="sidebar-projects-title" className={styles.section}>
          <div className={styles.sectionHeader}>
            <h2 className={styles.sectionTitle} id="sidebar-projects-title">
              {t.shell.projects}
            </h2>
            <IconButton
              aria-description={t.shell.availableSoon}
              disabled
              icon={<Plus aria-hidden="true" size={16} strokeWidth={1.8} />}
              label={t.shell.newProject}
              size="sm"
            />
          </div>
          <p className={styles.emptyList}>
            <span>{t.shell.noProjects}</span>
          </p>
        </section>

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
          conversationList.length === 0 &&
          terminals.length === 0 ? (
            <p className={styles.emptyList}>
              <span>{t.shell.noConversations}</span>
            </p>
          ) : null}
          {!showArchived && terminals.length > 0 ? (
            <ul aria-label={t.shell.conversations} className={styles.conversationList}>
              {terminals.map((terminal) => {
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
                      onClick={() => navigate({ name: "terminal", id: terminal.id })}
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
              })}
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
    </aside>
  );
}
