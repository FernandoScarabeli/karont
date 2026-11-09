import { type RefObject, useRef } from "react";
import { t } from "../i18n/pt-BR.ts";
import { useInbox } from "../projects/useInbox.ts";
import styles from "./InboxList.module.css";
import { InboxList, useInboxFocus } from "./InboxList.tsx";

/** Conteúdo da caixa de entrada: todos os workspaces, lista completa. O título (h1) fica no `Sheet`. */
export function InboxScreen({ titleRef }: { titleRef: RefObject<HTMLHeadingElement | null> }) {
  const { items, total, loading, error } = useInbox();
  const rootRef = useRef<HTMLDivElement>(null);
  useInboxFocus(items, rootRef, [titleRef]);
  return (
    <div className={styles.screen} ref={rootRef}>
      {items.length > 0 ? (
        <InboxList items={items} label={t.inbox.title} total={total} />
      ) : loading ? null : error ? (
        <p className={styles.empty} role="status">
          {t.inbox.loadFailed}
        </p>
      ) : (
        <p className={styles.empty}>{t.inbox.empty}</p>
      )}
    </div>
  );
}
