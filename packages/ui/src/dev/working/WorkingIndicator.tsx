import type { MessagePart } from "@karont/contract";
import { FileText } from "lucide-react";
import styles from "./WorkingShowcase.module.css";
import { currentActionFiles, deriveWorkingLabel, lastThinkingSentence } from "./workingLabel.ts";

export type WorkingVariant = "minimal" | "reasoning" | "complete";
const dotIds = [
  "top-left",
  "top-center",
  "top-right",
  "middle-right",
  "bottom-right",
  "bottom-center",
  "bottom-left",
  "middle-left",
  "center",
];

export function WorkingIndicator({
  parts,
  variant,
  inline = false,
}: {
  parts: readonly MessagePart[];
  variant: WorkingVariant;
  inline?: boolean;
}) {
  const label = deriveWorkingLabel(parts);
  if (!label) return null;

  const currentPart = parts.at(-1);
  const thinkingPart = currentPart?.type === "thinking" ? currentPart : undefined;
  const sentence = thinkingPart ? lastThinkingSentence(thinkingPart) : "";
  const files = currentActionFiles(parts);
  const indicatorClass = inline
    ? `${styles.indicator} ${styles.inlineIndicator}`
    : styles.indicator;

  return (
    <span className={indicatorClass} role="status" aria-atomic="true">
      <span className={styles.mainLine}>
        <span className={styles.dots} aria-hidden="true">
          {dotIds.map((dotId) => (
            <span className={styles.dot} data-position={dotId} key={dotId} />
          ))}
        </span>
        <span className={styles.step}>
          <span className={styles.shimmer} key={label}>
            {label}
          </span>
        </span>
      </span>
      {variant === "complete" ? (
        <span className={styles.chipsRow} aria-hidden="true">
          {files.length > 0 ? <FileChips files={files} key={currentPart?.id ?? "files"} /> : null}
        </span>
      ) : null}

      {variant !== "minimal" ? (
        <span className={styles.ticker} aria-hidden="true">
          <span className={styles.tickerText} data-empty={!sentence} key={sentence || "empty"}>
            {sentence || "\u00a0"}
          </span>
        </span>
      ) : null}
    </span>
  );
}

function FileChips({ files }: { files: string[] }) {
  const visibleFiles = files.slice(0, 3);
  const overflow = files.length - visibleFiles.length;

  return (
    <span className={styles.chips}>
      {visibleFiles.map((file) => (
        <span className={styles.chip} key={file}>
          <FileText aria-hidden="true" className={styles.fileIcon} />
          <span className={styles.chipName}>{file}</span>
        </span>
      ))}
      {overflow > 0 ? <span className={styles.moreChips}>+{overflow}</span> : null}
    </span>
  );
}
