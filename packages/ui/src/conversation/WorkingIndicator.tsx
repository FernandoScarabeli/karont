import type { MessagePart } from "@karont/contract";
import { memo, useEffect, useState } from "react";
import styles from "./WorkingIndicator.module.css";
import { deriveWorkingLabel, type WorkingActionPart } from "./workingLabel.ts";

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
  // Enquanto o texto da resposta é digitado, o cursor já indica o estado.
  if (active && !stopping && lastPart?.type === "text") return null;

  const label = deriveWorkingLabel(lastPart, actions, stopping);

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
        <svg aria-hidden="true" className={styles.spiral} fill="none" viewBox="0 0 16 16">
          <path
            d="M8 8c0-1.1 1.7-1.1 1.7 0 0 2.2-3.5 2.2-3.5 0s5.4-3.6 5.4 0-7.2 4.8-7.2 0 9-6 9 0"
            stroke="currentColor"
            strokeLinecap="round"
            strokeWidth="1.4"
          />
        </svg>
        <span className={styles.step}>
          <span className={styles.shimmer}>
            <span className={styles.shimmerBase}>{label}</span>
            <span aria-hidden="true" className={styles.shimmerBand}>
              <span className={styles.shimmerHighlight}>{label}</span>
            </span>
          </span>
        </span>
      </div>
    </div>
  );
});
