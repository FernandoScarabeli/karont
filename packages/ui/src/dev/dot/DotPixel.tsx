import styles from "./Dot.module.css";
import { type DotCharacterProps, dotLabel } from "./types.ts";

type Run = { x: number; y: number; w: number };

/** Corpo na grade de 12x12. "#" é um quadradinho; o resto fica vazio. */
const bodyRows = [
  "............",
  "............",
  "..########..",
  ".##########.",
  "############",
  "############",
  "############",
  "############",
  "############",
  ".##########.",
  "..########..",
  "..##....##..",
];

/** Junta quadradinhos vizinhos de uma linha num retângulo só. */
function rowsToRuns(rows: readonly string[]): Run[] {
  const runs: Run[] = [];
  rows.forEach((row, y) => {
    for (const match of row.matchAll(/#+/g)) {
      runs.push({ x: match.index ?? 0, y, w: match[0].length });
    }
  });
  return runs;
}

const bodyRuns = rowsToRuns(bodyRows);

const ink = "var(--k-dot-ink)";
const brand = "var(--k-color-brand)";

function Cells({ runs, fill }: { runs: readonly Run[]; fill: string }) {
  return runs.map((run) => (
    <rect fill={fill} height="1" key={`${run.x}-${run.y}`} width={run.w} x={run.x} y={run.y} />
  ));
}

const eyeRuns: Record<DotCharacterProps["mood"], Run[]> = {
  idle: [
    { x: 3, y: 5, w: 1 },
    { x: 3, y: 6, w: 1 },
    { x: 8, y: 5, w: 1 },
    { x: 8, y: 6, w: 1 },
  ],
  working: [
    { x: 4, y: 5, w: 1 },
    { x: 7, y: 5, w: 1 },
    { x: 3, y: 6, w: 2 },
    { x: 7, y: 6, w: 2 },
  ],
  "needs-you": [
    { x: 3, y: 5, w: 2 },
    { x: 3, y: 6, w: 2 },
    { x: 7, y: 5, w: 2 },
    { x: 7, y: 6, w: 2 },
  ],
  sleeping: [
    { x: 3, y: 7, w: 2 },
    { x: 7, y: 7, w: 2 },
  ],
};

/** C · Pixel: grade de 12x12 quadradinhos com olhos de bloco. */
export function DotPixel({ mood, size, decorative }: DotCharacterProps) {
  return (
    <svg
      aria-hidden={decorative || undefined}
      aria-label={dotLabel(mood)}
      className={`${styles.root} ${styles.pixel}`}
      data-mood={mood}
      role="img"
      height={size}
      shapeRendering="crispEdges"
      viewBox="0 0 12 12"
      width={size}
    >
      <g className={styles.body}>
        <Cells fill={brand} runs={bodyRuns} />
        <g className={styles.eyes}>
          <Cells fill={ink} runs={eyeRuns[mood]} />
          {mood === "needs-you" ? (
            <>
              <rect fill={brand} height="1" width="1" x="3" y="5" />
              <rect fill={brand} height="1" width="1" x="7" y="5" />
            </>
          ) : null}
        </g>
      </g>
      {mood === "working" ? (
        <g className={styles.dots}>
          <rect fill={brand} height="1" width="1" x="3" y="0" />
          <rect fill={brand} height="1" width="1" x="5" y="0" />
          <rect fill={brand} height="1" width="1" x="7" y="0" />
        </g>
      ) : null}
      {mood === "needs-you" ? (
        <g className={styles.badge}>
          <rect fill="var(--k-color-attention)" height="2" width="1" x="11" y="0" />
          <rect fill="var(--k-color-attention)" height="1" width="1" x="11" y="3" />
        </g>
      ) : null}
      {mood === "sleeping" ? (
        <g className={styles.zzz}>
          <rect fill="var(--k-color-text-secondary)" height="1" width="1" x="10" y="1" />
          <rect fill="var(--k-color-text-secondary)" height="1" width="1" x="11" y="0" />
        </g>
      ) : null}
    </svg>
  );
}
