import { type RefObject, useRef } from "react";
import { FluidHoverHighlight, useFluidHover } from "../components/FluidHover/FluidHover.tsx";
import { t } from "../i18n/pt-BR.ts";
import { useNavigation } from "../navigation/NavigationContext.tsx";
import { AgentsSection } from "./AgentsSection.tsx";
import { AppearanceSection } from "./AppearanceSection.tsx";
import { DiagnosticsSection } from "./DiagnosticsSection.tsx";
import { GeneralSection } from "./GeneralSection.tsx";
import { ProfileSection } from "./ProfileSection.tsx";
import styles from "./SettingsView.module.css";

export function SettingsView({ titleRef }: { titleRef: RefObject<HTMLHeadingElement | null> }) {
  const { navigate, view } = useNavigation();
  const selectedSection = view.name === "settings" ? view.section : "general";
  const navigationRef = useRef<HTMLElement>(null);
  const fluidHover = useFluidHover(navigationRef, { axis: "y" });

  return (
    <div className={styles.page}>
      <h1 className={styles.pageTitle} ref={titleRef} tabIndex={-1}>
        {t.settings.title}
      </h1>
      <div className={styles.layout}>
        <nav
          aria-label={t.settings.sectionsNavigation}
          className={styles.navigation}
          ref={fluidHover.containerRef}
        >
          <FluidHoverHighlight controller={fluidHover} />
          <ul className={styles.sectionList}>
            <li>
              <button
                aria-current={selectedSection === "general" ? "page" : undefined}
                className={styles.sectionLink}
                onClick={() => navigate({ name: "settings", section: "general" })}
                ref={(element) => fluidHover.registerItem("settings-general", element)}
                type="button"
              >
                {t.settings.general}
              </button>
            </li>
            <li>
              <button
                aria-current={selectedSection === "profile" ? "page" : undefined}
                className={styles.sectionLink}
                onClick={() => navigate({ name: "settings", section: "profile" })}
                ref={(element) => fluidHover.registerItem("settings-profile", element)}
                type="button"
              >
                {t.settings.profile}
              </button>
            </li>
            <li>
              <button
                aria-current={selectedSection === "appearance" ? "page" : undefined}
                className={styles.sectionLink}
                onClick={() => navigate({ name: "settings", section: "appearance" })}
                ref={(element) => fluidHover.registerItem("settings-appearance", element)}
                type="button"
              >
                {t.settings.appearance}
              </button>
            </li>
            <li>
              <button
                aria-current={selectedSection === "agents" ? "page" : undefined}
                className={styles.sectionLink}
                onClick={() => navigate({ name: "settings", section: "agents" })}
                ref={(element) => fluidHover.registerItem("settings-agents", element)}
                type="button"
              >
                {t.settings.agents}
              </button>
            </li>
            <li>
              <button
                aria-current={selectedSection === "diagnostics" ? "page" : undefined}
                className={styles.sectionLink}
                onClick={() => navigate({ name: "settings", section: "diagnostics" })}
                ref={(element) => fluidHover.registerItem("settings-diagnostics", element)}
                type="button"
              >
                {t.settings.diagnostics}
              </button>
            </li>
          </ul>
        </nav>
        {selectedSection === "general" ? (
          <GeneralSection />
        ) : selectedSection === "profile" ? (
          <ProfileSection />
        ) : selectedSection === "appearance" ? (
          <AppearanceSection />
        ) : selectedSection === "diagnostics" ? (
          <DiagnosticsSection />
        ) : (
          <AgentsSection />
        )}
      </div>
    </div>
  );
}
