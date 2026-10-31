import { t } from "../i18n/pt-BR.ts";
import styles from "./Sheet.module.css";

export function Sheet() {
  return (
    <main className={styles.sheet}>
      <h1 className={styles.pageTitle}>{t.home.title}</h1>
      <section aria-labelledby="home-empty-title" className={styles.emptyState}>
        <h2 className={styles.emptyTitle} id="home-empty-title">
          {t.home.emptyTitle}
        </h2>
        <p className={styles.emptyDescription}>{t.home.emptyDescription}</p>
      </section>
    </main>
  );
}
