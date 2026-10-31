import { ListTodo, Plus, Settings, SquarePen } from "lucide-react";
import { Button } from "../components/Button/Button.tsx";
import { IconButton } from "../components/IconButton/IconButton.tsx";
import { t } from "../i18n/pt-BR.ts";
import { ServiceStatus } from "./ServiceStatus.tsx";
import styles from "./Sidebar.module.css";

export function Sidebar() {
  return (
    <aside aria-label={t.shell.sidebar} className={styles.sidebar}>
      <nav aria-label={t.shell.primaryNavigation} className={styles.navigation}>
        <div className={styles.primaryActions}>
          <Button
            aria-description={t.shell.availableSoon}
            className={styles.navigationAction}
            disabled
            iconStart={<SquarePen aria-hidden="true" size={16} strokeWidth={1.75} />}
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
              aria-description={t.shell.availableSoon}
              disabled
              icon={<Plus aria-hidden="true" size={14} strokeWidth={1.75} />}
              label={t.shell.newLooseConversation}
              size="sm"
            />
          </div>
          <p className={styles.emptyList}>{t.shell.noConversations}</p>
        </section>
      </nav>

      <footer className={styles.footer}>
        <ServiceStatus />
        <IconButton
          aria-description={t.shell.availableSoon}
          disabled
          icon={<Settings aria-hidden="true" size={16} strokeWidth={1.75} />}
          label={t.shell.settings}
          size="sm"
        />
      </footer>
    </aside>
  );
}
