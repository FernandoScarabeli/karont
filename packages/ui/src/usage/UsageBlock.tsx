import type { UsageWindow } from "@karont/contract";
import { ChevronDown, ChevronUp, RefreshCw } from "lucide-react";
import { useId } from "react";
import { AgentIcon } from "../agents/AgentIcon.tsx";
import { IconButton } from "../components/IconButton/IconButton.tsx";
import { t } from "../i18n/pt-BR.ts";
import { formatAgoShort, formatDuration, formatResetShort, windowView } from "./format.ts";
import styles from "./UsageBlock.module.css";
import { useUsageData, useUsageLayout } from "./UsageContext.tsx";
import { UsageRing } from "./UsageRing.tsx";
import { useMinuteClock } from "./useMinuteClock.ts";

const ATTENTION_PERCENT = 80;

function barClass(percent: number | null): string {
  if (percent !== null && percent >= 100) return styles.barDanger ?? "";
  if (percent !== null && percent >= ATTENTION_PERCENT) return styles.barAttention ?? "";
  return styles.barNeutral ?? "";
}

function WindowRow({
  agentName,
  window,
  now,
}: {
  agentName: string;
  window: UsageWindow;
  now: number;
}) {
  const view = windowView(window, now);
  const resetsFull = view.resetsIn === null ? null : formatDuration(view.resetsIn);
  return (
    <li className={styles.window}>
      <span className={styles.windowLabel}>{t.usage.windowLabel[window.id]}</span>
      <progress
        aria-label={t.usage.barLabel(
          agentName,
          t.usage.windowSpoken[window.id],
          view.percent,
          resetsFull,
        )}
        className={`${styles.bar} ${barClass(view.percent)}`}
        max={100}
        value={view.percent ?? 0}
      />
      <span className={styles.percent}>{view.percent === null ? "—" : `${view.percent}%`}</span>
      <span className={styles.reset}>
        {view.expired
          ? t.usage.expired
          : view.resetsIn === null
            ? null
            : formatResetShort(view.resetsIn)}
      </span>
    </li>
  );
}

/** Uso dos agentes, sempre visível acima do perfil. Sem dados de nenhum agente, não existe. */
export function UsageBlock() {
  const titleId = useId();
  const { rows, refreshing, forceRefresh } = useUsageData();
  const { ready, compact, setCompact } = useUsageLayout();
  const now = useMinuteClock();

  if (!ready || rows.length === 0) return null;

  return (
    <section aria-labelledby={titleId} className={styles.block}>
      <div className={styles.header}>
        <h2 className={styles.title} id={titleId}>
          {t.usage.title}
        </h2>
        <div className={styles.actions}>
          <IconButton
            disabled={refreshing}
            icon={
              <RefreshCw
                aria-hidden="true"
                className={refreshing ? styles.spinning : undefined}
                size={14}
                strokeWidth={1.75}
              />
            }
            label={t.usage.refresh}
            onClick={forceRefresh}
            size="sm"
          />
          <IconButton
            aria-expanded={!compact}
            icon={
              compact ? (
                <ChevronUp aria-hidden="true" size={14} strokeWidth={1.75} />
              ) : (
                <ChevronDown aria-hidden="true" size={14} strokeWidth={1.75} />
              )
            }
            label={compact ? t.usage.expand : t.usage.collapse}
            onClick={() => setCompact(!compact)}
            size="sm"
          />
        </div>
      </div>
      {compact ? (
        <ul className={`${styles.rings} ${styles.swap}`}>
          {rows.map((item) => (
            <li className={styles.ringItem} key={item.agent}>
              <UsageRing
                now={now}
                onClick={() => setCompact(false)}
                row={item}
                tooltipAlign="start"
              />
            </li>
          ))}
        </ul>
      ) : (
        <ul className={`${styles.agents} ${styles.swap}`}>
          {rows.map((item) => (
            <li className={styles.agent} key={item.agent}>
              <div className={styles.agentHeader}>
                <AgentIcon agentId={item.agent} className={styles.agentIcon} />
                <h3 className={styles.agentName}>{item.name}</h3>
                <span className={styles.updated}>{formatAgoShort(item.observedAt, now)}</span>
              </div>
              <ul className={styles.windows}>
                {item.windows.map((window) => (
                  <WindowRow agentName={item.name} key={window.id} now={now} window={window} />
                ))}
              </ul>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
