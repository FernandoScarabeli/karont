import { useId } from "react";
import styles from "./Dot.module.css";
import { type DotCharacterProps, dotLabel } from "./types.ts";

const ink = "var(--k-dot-ink)";
const brand = "var(--k-color-brand)";

function Eyes({ mood }: Pick<DotCharacterProps, "mood">) {
  const eye = { fill: "none", stroke: ink, strokeLinecap: "round" } as const;
  if (mood === "sleeping") {
    return (
      <g {...eye} strokeWidth="1.6">
        <path d="M9 16.6 Q11.5 19.4 14 16.6" />
        <path d="M18 16.6 Q20.5 19.4 23 16.6" />
      </g>
    );
  }
  if (mood === "working") {
    return (
      <g {...eye} strokeWidth="1.6">
        <path d="M9.2 17.8 H13.8" />
        <path d="M18.2 17.8 H22.8" />
      </g>
    );
  }
  if (mood === "needs-you") {
    return (
      <g {...eye} strokeWidth="1.9">
        <path d="M8.6 18.2 Q11.5 11.6 14.4 18.2" />
        <path d="M17.6 18.2 Q20.5 11.6 23.4 18.2" />
      </g>
    );
  }
  return (
    <g {...eye} strokeWidth="1.7">
      <path d="M9 17.6 Q11.5 13.6 14 17.6" />
      <path d="M18 17.6 Q20.5 13.6 23 17.6" />
    </g>
  );
}

/** B · Lua: um círculo com sombra em crescente que muda de lado e de tamanho com o humor. */
export function DotMoon({ mood, size, decorative }: DotCharacterProps) {
  const clipId = `dot-moon-${useId().replace(/:/g, "")}`;

  return (
    <svg
      aria-hidden={decorative || undefined}
      aria-label={dotLabel(mood)}
      className={`${styles.root} ${styles.moon}`}
      data-mood={mood}
      role="img"
      height={size}
      viewBox="0 0 32 32"
      width={size}
    >
      <defs>
        <clipPath id={clipId}>
          <circle cx="16" cy="17" r="12.5" />
        </clipPath>
      </defs>
      <g className={styles.body}>
        <circle cx="16" cy="17" fill="var(--k-dot-shade)" r="12.5" />
        <g clipPath={`url(#${clipId})`}>
          <circle className={styles.lit} cx="16" cy="17" fill={brand} r="12.5" />
        </g>
        <g className={styles.eyes}>
          <Eyes mood={mood} />
        </g>
      </g>
      {mood === "needs-you" ? (
        <g className={styles.badge}>
          <circle cx="25.5" cy="6.5" fill="var(--k-color-attention)" r="5.2" />
          <rect x="24.8" y="3.4" fill={ink} height="3.8" rx="0.7" width="1.4" />
          <circle cx="25.5" cy="9.3" fill={ink} r="0.85" />
        </g>
      ) : null}
      {mood === "sleeping" ? (
        <path
          className={styles.zzz}
          d="M23.4 4.4 H27.4 L23.4 9 H27.4"
          fill="none"
          stroke="var(--k-color-text-secondary)"
          strokeLinecap="round"
          strokeLinejoin="round"
          strokeWidth="1.2"
        />
      ) : null}
    </svg>
  );
}
