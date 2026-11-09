import styles from "./Dot.module.css";
import { type DotCharacterProps, dotLabel } from "./types.ts";

const ink = "var(--k-dot-ink)";
const brand = "var(--k-color-brand)";

function Eyes({ mood }: Pick<DotCharacterProps, "mood">) {
  if (mood === "sleeping") {
    return (
      <g fill="none" stroke={ink} strokeLinecap="round" strokeWidth="1.5">
        <path d="M9.3 17 Q11.5 19.4 13.7 17" />
        <path d="M18.3 17 Q20.5 19.4 22.7 17" />
      </g>
    );
  }
  if (mood === "working") {
    return (
      <>
        <ellipse cx="11.5" cy="18.2" fill={ink} rx="2.4" ry="1.1" />
        <ellipse cx="20.5" cy="18.2" fill={ink} rx="2.4" ry="1.1" />
        <g fill="none" stroke={ink} strokeLinecap="round" strokeWidth="1.2">
          <path d="M8.8 13.4 L13.8 14.7" />
          <path d="M23.2 13.4 L18.2 14.7" />
        </g>
      </>
    );
  }
  if (mood === "needs-you") {
    return (
      <>
        <ellipse cx="11.5" cy="16" fill={ink} rx="2.7" ry="3.5" />
        <ellipse cx="20.5" cy="16" fill={ink} rx="2.7" ry="3.5" />
        <circle cx="10.8" cy="14.6" fill={brand} r="0.95" />
        <circle cx="19.8" cy="14.6" fill={brand} r="0.95" />
      </>
    );
  }
  return (
    <>
      <ellipse cx="11.5" cy="16.5" fill={ink} rx="2.1" ry="2.9" />
      <ellipse cx="20.5" cy="16.5" fill={ink} rx="2.1" ry="2.9" />
    </>
  );
}

/** A · Ponto: um círculo liso com dois olhinhos. */
export function DotPoint({ mood, size, decorative }: DotCharacterProps) {
  return (
    <svg
      aria-hidden={decorative || undefined}
      aria-label={dotLabel(mood)}
      className={`${styles.root} ${styles.point}`}
      data-mood={mood}
      role="img"
      height={size}
      viewBox="0 0 32 32"
      width={size}
    >
      <g className={styles.body}>
        <circle cx="16" cy="17" fill={brand} r="12.5" />
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
