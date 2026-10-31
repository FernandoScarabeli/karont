import { ListTodo, Plus, Settings, SquarePen, SquareTerminal } from "lucide-react";
import { Button } from "../components/Button/Button.tsx";
import { IconButton } from "../components/IconButton/IconButton.tsx";
import { t } from "../i18n/pt-BR.ts";
import { useNavigation } from "../navigation/NavigationContext.tsx";
import { useTerminals } from "../terminal/useTerminals.ts";
import { ServiceStatus } from "./ServiceStatus.tsx";
import styles from "./Sidebar.module.css";

export function Sidebar() {
  const { navigate, view } = useNavigation();
  const { terminals, error } = useTerminals();

  return (
    <aside aria-label={t.shell.sidebar} className={styles.sidebar}>
      <nav aria-label={t.shell.primaryNavigation} className={styles.navigation}>
        <div className={styles.primaryActions}>
          <Button
            aria-current={view.name === "new-conversation" ? "page" : undefined}
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
          <p className={styles.emptyList}>{t.shell.noProjects}</p>
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
              size="sm"
            />
          </div>
          {error ? (
            <p className={styles.emptyList} role="status">
              {t.shell.conversationsLoadError}
            </p>
          ) : terminals.length > 0 ? (
            <ul aria-label={t.shell.conversations} className={styles.conversationList}>
              {terminals.map((terminal) => (
                <li className={styles.conversationItem} key={terminal.id}>
                  <button
                    aria-current={
                      view.name === "terminal" && view.id === terminal.id ? "page" : undefined
                    }
                    className={styles.conversationButton}
                    onClick={() => navigate({ name: "terminal", id: terminal.id })}
                    type="button"
                  >
                    <SquareTerminal aria-hidden="true" size={15} strokeWidth={1.8} />
                    <span className={styles.conversationTitle}>{terminal.title}</span>
                    {terminal.exited ? (
                      <span className={styles.exitedMarker}>{t.shell.exited}</span>
                    ) : null}
                  </button>
                </li>
              ))}
            </ul>
          ) : (
            <p className={styles.emptyList}>{t.shell.noConversations}</p>
          )}
        </section>
      </nav>

      <footer className={styles.footer}>
        <ServiceStatus />
        <IconButton
          aria-current={view.name === "settings" ? "page" : undefined}
          className={styles.settingsButton}
          icon={<Settings aria-hidden="true" size={16} strokeWidth={1.75} />}
          label={t.shell.settings}
          onClick={() => navigate({ name: "settings", section: "agents" })}
          size="sm"
        />
      </footer>
    </aside>
  );
}
