import type { ReactNode } from "react";
import type { OverviewStatusItem } from "../../projects/overviewSummary.ts";
import styles from "./OverviewCard.module.css";

const toneClass = {
  working: styles.toneWorking,
  queued: styles.toneQueued,
  waiting: styles.toneWaiting,
  error: styles.toneError,
} as const;

/** Cartão clicável de projeto ou workspace: ícone, nome, linhas de dados reais e estados. */
export function OverviewCard({
  icon,
  title,
  lines,
  status,
  hint,
  onClick,
}: {
  icon: ReactNode;
  title: string;
  /** Linhas de texto já formatadas; vazias não entram. */
  lines: Array<string | null | undefined | false>;
  status: OverviewStatusItem[];
  hint: string;
  onClick: () => void;
}) {
  const visibleLines = lines.filter(Boolean) as string[];
  return (
    <button aria-description={hint} className={styles.card} onClick={onClick} type="button">
      <span className={styles.heading}>
        <span aria-hidden="true" className={styles.icon}>
          {icon}
        </span>
        <span className={styles.title}>{title}</span>
      </span>
      {visibleLines.map((line) => (
        <span className={styles.line} key={line}>
          {line}
        </span>
      ))}
      {status.length > 0 ? (
        <span className={styles.statusList}>
          {status.map((item) => (
            <span className={styles.status} key={item.tone}>
              <span aria-hidden="true" className={`${styles.dot} ${toneClass[item.tone]}`} />
              {item.label}
            </span>
          ))}
        </span>
      ) : null}
    </button>
  );
}
