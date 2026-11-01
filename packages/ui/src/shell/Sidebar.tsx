import { BridgeError, type TerminalInfo } from "@karont/contract";
import { ListTodo, Plus, Settings, SquarePen, SquareTerminal, TriangleAlert } from "lucide-react";
import { type RefObject, useRef, useState } from "react";
import { AgentIcon } from "../agents/AgentIcon.tsx";
import { getBridge } from "../bridge/index.ts";
import { Button } from "../components/Button/Button.tsx";
import { Dialog } from "../components/Dialog/Dialog.tsx";
import { IconButton } from "../components/IconButton/IconButton.tsx";
import { useConversationIndex } from "../conversation/useConversationIndex.ts";
import { t } from "../i18n/pt-BR.ts";
import { useNavigation } from "../navigation/NavigationContext.tsx";
import { TerminalCloseButton } from "../terminal/TerminalCloseButton.tsx";
import {
  getTerminalDisplayDetails,
  getTerminalDisplayTitles,
  useTerminals,
} from "../terminal/useTerminals.ts";
import { findPane } from "../workspace/layout.ts";
import { ServiceStatus } from "./ServiceStatus.tsx";
import styles from "./Sidebar.module.css";

export function Sidebar() {
  const { closeTerminalWorkspacePane, navigate, view, layout, activePaneId } = useNavigation();
  const bridge = getBridge();
  const activePane = findPane(layout, activePaneId);
  const { terminals, error } = useTerminals();
  const conversationIndex = useConversationIndex();
  const terminalTitles = getTerminalDisplayTitles(terminals);
  const [terminalToClose, setTerminalToClose] = useState<TerminalInfo | null>(null);
  const [isClosing, setIsClosing] = useState(false);
  const [closeError, setCloseError] = useState("");
  const cancelCloseRef = useRef<HTMLButtonElement>(null);
  const focusAfterCloseRef = useRef<HTMLElement>(null);
  const terminalButtonRefs = useRef(new Map<string, HTMLButtonElement>());
  const newLooseConversationRef = useRef<HTMLButtonElement>(null);

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
    } catch (error) {
      focusAfterCloseRef.current = null;
      setCloseError(
        error instanceof BridgeError && error.message ? error.message : t.terminal.closeFailed,
      );
    } finally {
      setIsClosing(false);
    }
  }

  return (
    <aside aria-label={t.shell.sidebar} className={styles.sidebar}>
      <nav aria-label={t.shell.primaryNavigation} className={styles.navigation}>
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
            variant="ghost"
          >
            {t.shell.newConversation}
          </Button>
          <Button
            aria-description={t.shell.availableSoon}
            className={styles.navigationAction}
            disabled
            iconStart={<ListTodo aria-hidden="true" size={16} strokeWidth={1.75} />}
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
              icon={<Plus aria-hidden="true" size={14} strokeWidth={1.75} />}
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
            <h2 className={styles.sectionTitle} id="sidebar-conversations-title">
              {t.shell.conversations}
            </h2>
            <IconButton
              icon={<Plus aria-hidden="true" size={14} strokeWidth={1.75} />}
              label={t.shell.newLooseConversation}
              onClick={() => navigate({ name: "new-conversation" })}
              ref={newLooseConversationRef}
              size="sm"
            />
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
          {conversationIndex.conversations.length > 0 ? (
            <ul aria-label={t.shell.agentConversations} className={styles.conversationList}>
              {conversationIndex.conversations.map((conversation) => {
                const stateText =
                  conversation.state === "working"
                    ? t.chat.working
                    : conversation.state === "waiting"
                      ? t.chat.waiting
                      : conversation.state === "error"
                        ? t.shell.conversationError
                        : t.chat.idle;
                const accessibleName = `${conversation.title}, ${stateText}`;
                const active =
                  view.name === "workspace" &&
                  activePane?.view.kind === "chat" &&
                  activePane.view.conversationId === conversation.id;
                return (
                  <li className={styles.conversationItem} key={conversation.id}>
                    <button
                      aria-current={active ? "page" : undefined}
                      aria-description={stateText}
                      aria-label={conversation.title}
                      className={styles.conversationButton}
                      onClick={() => navigate({ name: "conversation", id: conversation.id })}
                      title={accessibleName}
                      type="button"
                    >
                      <AgentIcon agentId={conversation.agent} />
                      <span className={styles.conversationTitle}>{conversation.title}</span>
                      {conversation.state === "working" ? (
                        <span aria-hidden="true" className={styles.agentWorkingMarker} />
                      ) : null}
                      {conversation.state === "waiting" ? (
                        <span className={styles.needsYouMarker}>
                          <TriangleAlert aria-hidden="true" size={14} />
                        </span>
                      ) : null}
                    </button>
                  </li>
                );
              })}
            </ul>
          ) : null}
          {terminals.length > 0 ? (
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
                        if (element) terminalButtonRefs.current.set(terminal.id, element);
                        else terminalButtonRefs.current.delete(terminal.id);
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
          ) : conversationIndex.conversations.length === 0 ? (
            <p className={styles.emptyList}>
              <span>{t.shell.noConversations}</span>
            </p>
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
    </aside>
  );
}
