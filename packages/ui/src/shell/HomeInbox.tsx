import { type RefObject, useRef } from "react";
import { t } from "../i18n/pt-BR.ts";
import { useInbox } from "../projects/useInbox.ts";
import styles from "./InboxList.module.css";
import { InboxList, useInboxFocus } from "./InboxList.tsx";

/** "Precisa de você" no Início: só existe quando há itens. */
export function HomeInbox({ titleRef }: { titleRef: RefObject<HTMLHeadingElement | null> }) {
  const { items, total } = useInbox();
  const rootRef = useRef<HTMLDivElement>(null);
  const headingRef = useRef<HTMLHeadingElement>(null);
  useInboxFocus(items, rootRef, [headingRef, titleRef]);
  return (
    <div ref={rootRef}>
      {items.length > 0 ? (
        <section aria-labelledby="home-inbox-title" className={styles.section}>
          <h2 className={styles.sectionTitle} id="home-inbox-title" ref={headingRef} tabIndex={-1}>
            {t.inbox.needsYou}
          </h2>
          <InboxList items={items} label={t.inbox.needsYou} total={total} />
        </section>
      ) : null}
    </div>
  );
}
