import type { MessagePart } from "@karont/contract";
import { FileText } from "lucide-react";
import { memo, useEffect, useState } from "react";
import styles from "./WorkingIndicator.module.css";
import {
  currentActionFiles,
  deriveWorkingLabel,
  lastThinkingSentence,
  type WorkingActionPart,
} from "./workingLabel.ts";

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

export const WorkingIndicator = memo(function WorkingIndicator({
  active,
  actions,
  lastPart,
  onExitComplete,
  stopping = false,
}: {
  active: boolean;
  actions: readonly WorkingActionPart[];
  lastPart?: MessagePart;
  onExitComplete?: () => void;
  stopping?: boolean;
}) {
  const [wasActive, setWasActive] = useState(active);

  useEffect(() => {
    if (active) {
      setWasActive(true);
      return;
    }
    if (!wasActive) return;

    const reduceMotion = window.matchMedia("(prefers-reduced-motion: reduce)");
    if (reduceMotion.matches) {
      setWasActive(false);
      onExitComplete?.();
      return;
    }

    const handleMotionPreference = () => {
      if (reduceMotion.matches) {
        setWasActive(false);
        onExitComplete?.();
      }
    };
    reduceMotion.addEventListener("change", handleMotionPreference);
    return () => reduceMotion.removeEventListener("change", handleMotionPreference);
  }, [active, onExitComplete, wasActive]);

  if (!active && !wasActive) return null;

  const label = deriveWorkingLabel(lastPart, actions, stopping);
  const thinkingPart = lastPart?.type === "thinking" ? lastPart : undefined;
  const sentence = lastThinkingSentence(thinkingPart);
  const files = currentActionFiles(actions);

  return (
    <div
      className={styles.indicator}
      data-exiting={!active || undefined}
      onAnimationEnd={(event) => {
        if (event.target === event.currentTarget && !active) {
          setWasActive(false);
          onExitComplete?.();
        }
      }}
    >
      <div
        aria-atomic={active ? "true" : undefined}
        className={styles.mainLine}
        role={active ? "status" : undefined}
      >
        <span aria-hidden="true" className={styles.dots}>
          {dotIds.map((dotId) => (
            <span className={styles.dot} data-position={dotId} key={dotId} />
          ))}
        </span>
        <span className={styles.step}>
          <span className={styles.shimmer}>{label}</span>
        </span>
      </div>
      <div aria-hidden="true" className={styles.ticker}>
        <span className={styles.tickerText} data-empty={!sentence || undefined}>
          {sentence || "\u00a0"}
        </span>
      </div>
      <div aria-hidden="true" className={styles.chipsRow}>
        {files.length > 0 ? <FileChips files={files} /> : null}
      </div>
    </div>
  );
});

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
