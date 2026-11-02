import type { ConversationContextUsage } from "@karont/contract";
import { memo, useCallback, useId, useRef, useState } from "react";
import {
  ComposerPopover,
  ComposerPopoverHeading,
} from "../components/ComposerPopover/ComposerPopover.tsx";
import { IconButton } from "../components/IconButton/IconButton.tsx";
import { Tooltip } from "../components/Tooltip/Tooltip.tsx";
import { t } from "../i18n/pt-BR.ts";
import styles from "./ConversationContextUsage.module.css";
import {
  contextUsagePercent,
  formatContextUsage,
  formatContextUsageDetail,
} from "./contextUsage.ts";

export const ConversationContextUsageControl = memo(function ConversationContextUsageControl({
  initialUsage,
  compactAvailable,
  compacting,
  onCompact,
}: {
  initialUsage?: ConversationContextUsage;
  compactAvailable: boolean;
  compacting: boolean;
  onCompact: () => void;
}) {
  const buttonRef = useRef<HTMLButtonElement>(null);
  const compactButtonRef = useRef<HTMLButtonElement>(null);
  const popoverId = useId();
  const [popoverOpen, setPopoverOpen] = useState(false);
  const usage = initialUsage;
  const percent = usage ? contextUsagePercent(usage) : 0;
  const label = usage ? formatContextUsage(usage) : t.chat.contextTitle;

  const closePopover = useCallback(() => setPopoverOpen(false), []);

  if (!usage) return null;

  return (
    <>
      <Tooltip align="end" label={label} open={popoverOpen}>
        <IconButton
          aria-controls={popoverId}
          aria-expanded={popoverOpen}
          aria-haspopup="dialog"
          className={styles.trigger}
          data-composer-menu-trigger
          icon={<ContextRing usage={usage} />}
          label={label}
          onClick={() => setPopoverOpen((open) => !open)}
          ref={buttonRef}
        />
      </Tooltip>
      <ComposerPopover
        anchorRef={buttonRef}
        initialFocus={compactAvailable ? () => compactButtonRef.current : undefined}
        label={t.chat.contextTitle}
        onClose={closePopover}
        open={popoverOpen}
        id={popoverId}
        role="dialog"
      >
        <ComposerPopoverHeading>{t.chat.contextTitle}</ComposerPopoverHeading>
        <div className={styles.detail}>
          <div className={styles.largeRing}>
            <ContextRing large usage={usage} />
            <span aria-hidden="true" className={styles.largePercent}>
              {percent}%
            </span>
          </div>
          <p className={styles.detailText}>{formatContextUsageDetail(usage)}</p>
          {compactAvailable ? (
            <button
              className={styles.compactButton}
              disabled={compacting}
              onClick={onCompact}
              ref={compactButtonRef}
              type="button"
            >
              {compacting ? t.chat.compacting : t.chat.compactContext}
            </button>
          ) : null}
        </div>
      </ComposerPopover>
    </>
  );
});

function ContextRing({
  usage,
  large = false,
}: {
  usage: ConversationContextUsage;
  large?: boolean;
}) {
  const percent = contextUsagePercent(usage);
  const visualPercent = Math.min(100, Math.max(0, percent));
  const radius = 6.5;
  const circumference = 2 * Math.PI * radius;
  return (
    <svg
      aria-hidden="true"
      className={styles.ring}
      data-attention={percent >= 80 ? "true" : undefined}
      data-large={large ? "true" : undefined}
      viewBox="0 0 16 16"
    >
      <circle className={styles.track} cx="8" cy="8" r={radius} vectorEffect="non-scaling-stroke" />
      <circle
        className={styles.progress}
        cx="8"
        cy="8"
        r={radius}
        data-attention={percent >= 80 ? "true" : undefined}
        strokeDasharray={`${circumference}`}
        strokeDashoffset={`${circumference * (1 - visualPercent / 100)}`}
        vectorEffect="non-scaling-stroke"
      />
    </svg>
  );
}
