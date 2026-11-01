import { t } from "../i18n/pt-BR.ts";
import styles from "./ConversationView.module.css";

export function WorkingIndicator({ stopping = false }: { stopping?: boolean }) {
  return (
    <p className={styles.progress} role="status">
      <span aria-hidden="true" className={styles.progressMark} />
      {t.chat.working}
      {stopping ? ` · ${t.chat.stopping}` : ""}
    </p>
  );
}
