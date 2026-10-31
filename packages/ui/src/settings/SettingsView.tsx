import type { RefObject } from "react";
import { t } from "../i18n/pt-BR.ts";
import { AgentsSection } from "./AgentsSection.tsx";
import styles from "./SettingsView.module.css";

export function SettingsView({ titleRef }: { titleRef: RefObject<HTMLHeadingElement | null> }) {
  return (
    <div className={styles.page}>
      <h1 className={styles.pageTitle} ref={titleRef} tabIndex={-1}>
        {t.settings.title}
      </h1>
      <div className={styles.layout}>
        <nav aria-label={t.settings.sectionsNavigation} className={styles.navigation}>
          <ul className={styles.sectionList}>
            <li>
              <a aria-current="page" className={styles.sectionLink} href="#settings-agents">
                {t.settings.agents}
              </a>
            </li>
          </ul>
        </nav>
        <AgentsSection />
      </div>
    </div>
  );
}
