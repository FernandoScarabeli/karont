import type { AgentUsage, UsageWindow } from "@karont/contract";
import { useCallback, useEffect, useState } from "react";
import { AgentIcon } from "../agents/AgentIcon.tsx";
import { getBridge } from "../bridge/index.ts";
import { Button } from "../components/Button/Button.tsx";
import { t } from "../i18n/pt-BR.ts";
import { formatAgo, formatDuration, windowView } from "./format.ts";
import { mergeListed, upsertUsage } from "./merge.ts";
import styles from "./UsagePanel.module.css";

const TICK_MS = 30_000;
const LOADING_DELAY_MS = 300;
const ATTENTION_PERCENT = 80;
const WINDOW_ORDER: UsageWindow["id"][] = ["five_hour", "weekly"];

type Status = "loading" | "ready" | "error";

function useNow(): number {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const timer = setInterval(() => setNow(Date.now()), TICK_MS);
    return () => clearInterval(timer);
  }, []);
  return now;
}

/** Só existe com o painel aberto: ao fechar, a assinatura e o timer somem com ele. */
function useUsageData(attempt: number) {
  const [status, setStatus] = useState<Status>("loading");
  const [usage, setUsage] = useState<AgentUsage[]>([]);
  const [names, setNames] = useState<ReadonlyMap<string, string>>(new Map());
  const [showLoading, setShowLoading] = useState(false);

  // biome-ignore lint/correctness/useExhaustiveDependencies: `attempt` refaz o pedido no "Tentar de novo".
  useEffect(() => {
    const bridge = getBridge();
    if (!bridge) {
      setStatus("error");
      return;
    }
    let active = true;
    setStatus("loading");
    const unsubscribe = bridge.onEvent((event) => {
      if (event.event !== "usage.updated") return;
      setUsage((current) => upsertUsage(current, event.payload));
    });
    void Promise.allSettled([
      bridge.request("usage.list", {}),
      bridge.request("agents.list", {}),
    ]).then(([listed, agents]) => {
      if (!active) return;
      if (agents.status === "fulfilled") {
        setNames(new Map(agents.value.agents.map((agent) => [agent.id, agent.name])));
      }
      if (listed.status === "rejected") {
        setStatus("error");
        return;
      }
      setUsage((current) => mergeListed(current, listed.value.usage));
      setStatus("ready");
    });
    return () => {
      active = false;
      unsubscribe();
    };
  }, [attempt]);

  useEffect(() => {
    if (status !== "loading") {
      setShowLoading(false);
      return;
    }
    const timer = setTimeout(() => setShowLoading(true), LOADING_DELAY_MS);
    return () => clearTimeout(timer);
  }, [status]);

  return { status, usage, names, showLoading };
}

function barClass(percent: number | null): string {
  if (percent === null) return styles.barNeutral ?? "";
  if (percent >= 100) return styles.barDanger ?? "";
  if (percent >= ATTENTION_PERCENT) return styles.barAttention ?? "";
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
  const resets = view.resetsIn === null ? null : formatDuration(view.resetsIn);
  return (
    <li className={styles.window}>
      <span className={styles.windowLabel}>{t.usage.windowLabel[window.id]}</span>
      <progress
        aria-label={t.usage.barLabel(
          agentName,
          t.usage.windowSpoken[window.id],
          view.percent,
          resets,
        )}
        className={`${styles.bar} ${barClass(view.percent)}`}
        max={100}
        value={view.percent ?? 0}
      />
      <span className={styles.percent}>{view.percent === null ? "—" : `${view.percent}%`}</span>
      <span className={styles.reset}>
        {view.expired ? t.usage.expired : resets ? t.usage.resetsIn(resets) : null}
      </span>
    </li>
  );
}

export function UsagePanel() {
  const [attempt, setAttempt] = useState(0);
  const { status, usage, names, showLoading } = useUsageData(attempt);
  const now = useNow();
  const retry = useCallback(() => setAttempt((value) => value + 1), []);

  const rows = usage
    .filter((item) => item.windows.length > 0)
    .map((item) => ({
      ...item,
      windows: WINDOW_ORDER.flatMap((id) => item.windows.filter((window) => window.id === id)),
    }))
    .filter((item) => item.windows.length > 0);

  return (
    <div className={styles.panel}>
      <h2 className={styles.title}>{t.usage.title}</h2>
      {status === "error" ? (
        <div className={styles.message} role="alert">
          <span>{t.usage.loadError}</span>
          <Button onClick={retry} size="sm" variant="secondary">
            {t.usage.retry}
          </Button>
        </div>
      ) : status === "loading" ? (
        showLoading ? (
          <p className={styles.message}>{t.usage.loading}</p>
        ) : null
      ) : rows.length === 0 ? (
        <p className={styles.message}>{t.usage.empty}</p>
      ) : (
        <ul className={styles.agents}>
          {rows.map((item) => {
            const name = names.get(item.agent) ?? item.agent;
            return (
              <li className={styles.agent} key={item.agent}>
                <div className={styles.agentHeader}>
                  <AgentIcon agentId={item.agent} className={styles.agentIcon} />
                  <h3 className={styles.agentName}>{name}</h3>
                  <span className={styles.updated}>
                    {t.usage.updated(formatAgo(item.observedAt, now))}
                  </span>
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
      )}
    </div>
  );
}
