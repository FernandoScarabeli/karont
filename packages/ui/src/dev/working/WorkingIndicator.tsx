import type { MessagePart } from "@karont/contract";
import { FileText } from "lucide-react";
import styles from "./WorkingShowcase.module.css";
import { currentActionFiles, deriveWorkingLabel, lastThinkingSentence } from "./workingLabel.ts";

export type WorkingVariant = "minimal" | "reasoning" | "complete";
const dotIds = [
  "top-left",
  "top-center",
  "top-right",
  "middle-left",
  "center",
  "middle-right",
  "bottom-left",
  "bottom-center",
  "bottom-right",
];

export function WorkingIndicator({
  parts,
  variant,
}: {
  parts: readonly MessagePart[];
  variant: WorkingVariant;
}) {
  const label = deriveWorkingLabel(parts);
  if (!label) return null;

  const currentPart = parts.at(-1);
  const thinkingPart = currentPart?.type === "thinking" ? currentPart : undefined;
  const sentence = thinkingPart ? lastThinkingSentence(thinkingPart) : "";
  const files = currentActionFiles(parts);

  return (
    <div className={styles.indicator} role="status" aria-atomic="true">
      <span className={styles.dots} aria-hidden="true">
        {dotIds.map((dotId) => (
          <span className={styles.dot} key={dotId} />
        ))}
      </span>
      <span className={styles.step}>
        <span className={styles.shimmer} key={label}>
          {label}
        </span>
      </span>

      {variant !== "minimal" && sentence ? (
        <span className={styles.ticker} aria-hidden="true">
          <span className={styles.tickerText} key={sentence}>
            {sentence}
          </span>
        </span>
      ) : null}

      {variant === "complete" && files.length > 0 ? (
        <FileChips files={files} key={currentPart?.id ?? "files"} />
      ) : null}
    </div>
  );
}

function FileChips({ files }: { files: string[] }) {
  const visibleFiles = files.slice(0, 3);
  const overflow = files.length - visibleFiles.length;

  return (
    <span className={styles.chips} aria-hidden="true">
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
