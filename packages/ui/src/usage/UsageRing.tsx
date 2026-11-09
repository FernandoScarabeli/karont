import { memo } from "react";
import { AgentIcon } from "../agents/AgentIcon.tsx";
import { Tooltip, type TooltipAlign, type TooltipSide } from "../components/Tooltip/Tooltip.tsx";
import { t } from "../i18n/pt-BR.ts";
import { formatDuration, ringValue, windowView } from "./format.ts";
import type { UsageRow } from "./UsageContext.tsx";
import styles from "./UsageRing.module.css";

const ATTENTION_PERCENT = 80;
const FULL_PERCENT = 100;
const CENTER = 18;
const RADIUS = 16;

function toneClass(percent: number): string {
  if (percent >= FULL_PERCENT) return styles.danger ?? "";
  if (percent >= ATTENTION_PERCENT) return styles.attention ?? "";
  return styles.ok ?? "";
}

/** Círculo com o ícone do agente e um anel que enche conforme o uso da janela mais próxima do limite. */
export const UsageRing = memo(function UsageRing({
  row,
  now,
  onClick,
  tooltipSide = "top",
  tooltipAlign = "center",
}: {
  row: UsageRow;
  now: number;
  onClick: () => void;
  tooltipSide?: TooltipSide;
  tooltipAlign?: TooltipAlign;
}) {
  const value = ringValue(row.windows, now);
  const percent = value === null ? 0 : Math.min(FULL_PERCENT, Math.max(0, value.percent));

  const views = row.windows.map((window) => ({ window, view: windowView(window, now) }));
  const label = t.usage.ringLabel(
    row.name,
    views.map(({ window, view }) =>
      t.usage.ringPart(
        t.usage.windowSpoken[window.id],
        view.percent,
        view.resetsIn === null ? null : formatDuration(view.resetsIn),
      ),
    ),
  );
  const tip = t.usage.ringTip(
    row.name,
    views.map(({ window, view }) =>
      t.usage.ringTipPart(t.usage.windowLabel[window.id], view.percent),
    ),
  );

  return (
    <Tooltip align={tooltipAlign} label={tip} side={tooltipSide}>
      <button
        aria-label={label}
        className={`${styles.ring} ${value === null ? "" : toneClass(percent)}`}
        onClick={onClick}
        type="button"
      >
        <svg aria-hidden="true" className={styles.svg} focusable="false" viewBox="0 0 36 36">
          <circle
            className={styles.track}
            cx={CENTER}
            cy={CENTER}
            fill="none"
            pathLength={100}
            r={RADIUS}
          />
          <circle
            className={styles.value}
            cx={CENTER}
            cy={CENTER}
            fill="none"
            pathLength={100}
            r={RADIUS}
            strokeDasharray={`${percent} 100`}
            transform={`rotate(-90 ${CENTER} ${CENTER})`}
          />
        </svg>
        <AgentIcon agentId={row.agent} className={styles.icon} />
      </button>
    </Tooltip>
  );
});
