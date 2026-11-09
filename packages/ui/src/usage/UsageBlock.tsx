import type { UsageWindow } from "@karont/contract";
import { RefreshCw } from "lucide-react";
import { useEffect, useId, useState } from "react";
import { AgentIcon } from "../agents/AgentIcon.tsx";
import { IconButton } from "../components/IconButton/IconButton.tsx";
import { t } from "../i18n/pt-BR.ts";
import { formatAgoShort, formatDuration, formatResetShort, windowView } from "./format.ts";
import styles from "./UsageBlock.module.css";
import { useUsage } from "./useUsage.ts";

const CLOCK_MS = 60_000;
const ATTENTION_PERCENT = 80;
const WINDOW_ORDER: UsageWindow["id"][] = ["five_hour", "weekly"];

/** Relógio de 1 minuto, só com a janela visível. O estado fica aqui para não render a Sidebar. */
function useMinuteClock(): number {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const tick = () => {
      if (document.visibilityState === "visible") setNow(Date.now());
    };
    const timer = setInterval(tick, CLOCK_MS);
    document.addEventListener("visibilitychange", tick);
    return () => {
      clearInterval(timer);
      document.removeEventListener("visibilitychange", tick);
    };
  }, []);
  return now;
}

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
  const { usage, names, refreshing, forceRefresh } = useUsage();
  const now = useMinuteClock();

  const rows = usage
    .map((item) => ({
      ...item,
      windows: WINDOW_ORDER.flatMap((id) => item.windows.filter((window) => window.id === id)),
    }))
    .filter((item) => item.windows.length > 0);

  if (rows.length === 0) return null;

  return (
    <section aria-labelledby={titleId} className={styles.block}>
      <div className={styles.header}>
        <h2 className={styles.title} id={titleId}>
          {t.usage.title}
        </h2>
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
      </div>
      <ul className={styles.agents}>
        {rows.map((item) => {
          const name = names.get(item.agent) ?? item.agent;
          return (
            <li className={styles.agent} key={item.agent}>
              <div className={styles.agentHeader}>
                <AgentIcon agentId={item.agent} className={styles.agentIcon} />
                <h3 className={styles.agentName}>{name}</h3>
                <span className={styles.updated}>{formatAgoShort(item.observedAt, now)}</span>
              </div>
              <ul className={styles.windows}>
                {item.windows.map((window) => (
                  <WindowRow agentName={name} key={window.id} now={now} window={window} />
                ))}
              </ul>
            </li>
          );
        })}
      </ul>
    </section>
  );
}
