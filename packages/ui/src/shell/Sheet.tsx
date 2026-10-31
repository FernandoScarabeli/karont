import { useEffect, useRef } from "react";
import { t } from "../i18n/pt-BR.ts";
import { useNavigation } from "../navigation/NavigationContext.tsx";
import { SettingsView } from "../settings/SettingsView.tsx";
import styles from "./Sheet.module.css";

export function Sheet() {
  const { view } = useNavigation();
  const titleRef = useRef<HTMLHeadingElement>(null);
  const previousView = useRef(view);

  useEffect(() => {
    const changed =
      previousView.current.name !== view.name ||
      (previousView.current.name === "settings" &&
        view.name === "settings" &&
        previousView.current.section !== view.section);
    if (changed) titleRef.current?.focus();
    previousView.current = view;
  }, [view]);

  return (
    <main className={styles.sheet}>
      {view.name === "settings" ? (
        <SettingsView titleRef={titleRef} />
      ) : (
        <>
          <h1 className={styles.pageTitle} ref={titleRef} tabIndex={-1}>
            {t.home.title}
          </h1>
          <section aria-labelledby="home-empty-title" className={styles.emptyState}>
            <h2 className={styles.emptyTitle} id="home-empty-title">
              {t.home.emptyTitle}
            </h2>
            <p className={styles.emptyDescription}>{t.home.emptyDescription}</p>
          </section>
        </>
      )}
    </main>
  );
}
