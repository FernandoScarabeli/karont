import type { RefObject } from "react";
import { t } from "../i18n/pt-BR.ts";
import { useNavigation } from "../navigation/NavigationContext.tsx";
import { AgentsSection } from "./AgentsSection.tsx";
import { GeneralSection } from "./GeneralSection.tsx";
import styles from "./SettingsView.module.css";

export function SettingsView({ titleRef }: { titleRef: RefObject<HTMLHeadingElement | null> }) {
  const { navigate, view } = useNavigation();
  const selectedSection = view.name === "settings" ? view.section : "general";

  return (
    <div className={styles.page}>
      <h1 className={styles.pageTitle} ref={titleRef} tabIndex={-1}>
        {t.settings.title}
      </h1>
      <div className={styles.layout}>
        <nav aria-label={t.settings.sectionsNavigation} className={styles.navigation}>
          <ul className={styles.sectionList}>
            <li>
              <button
                aria-current={selectedSection === "general" ? "page" : undefined}
                className={styles.sectionLink}
                onClick={() => navigate({ name: "settings", section: "general" })}
                type="button"
              >
                {t.settings.general}
              </button>
            </li>
            <li>
              <button
                aria-current={selectedSection === "agents" ? "page" : undefined}
                className={styles.sectionLink}
                onClick={() => navigate({ name: "settings", section: "agents" })}
                type="button"
              >
                {t.settings.agents}
              </button>
            </li>
          </ul>
        </nav>
        {selectedSection === "general" ? <GeneralSection /> : <AgentsSection />}
      </div>
    </div>
  );
}
