import type { ConversationMessage } from "@karont/contract";
import { History } from "lucide-react";
import {
  type KeyboardEvent,
  memo,
  useCallback,
  useId,
  useLayoutEffect,
  useRef,
  useState,
} from "react";
import { ComposerPopover } from "../components/ComposerPopover/ComposerPopover.tsx";
import { IconButton } from "../components/IconButton/IconButton.tsx";
import { Tooltip } from "../components/Tooltip/Tooltip.tsx";
import { t } from "../i18n/pt-BR.ts";
import styles from "./ConversationHistory.module.css";
import type { ConversationHistoryEntry } from "./conversationHistory.ts";

export const ConversationHistory = memo(function ConversationHistory({
  entries,
  messageCount,
  open,
  onOpenChange,
  onSelectMessage,
}: {
  entries: ConversationHistoryEntry[];
  messageCount: number;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onSelectMessage: (messageId: string) => void;
}) {
  const buttonRef = useRef<HTMLButtonElement>(null);
  const optionRefs = useRef(new Map<string, HTMLDivElement>());
  const optionRefCallbacks = useRef(new Map<string, (element: HTMLDivElement | null) => void>());
  const popoverId = useId();
  const [activeIndex, setActiveIndex] = useState(0);
  const activeMessageId = entries[activeIndex]?.message.id;

  function optionRefFor(messageId: string) {
    let callback = optionRefCallbacks.current.get(messageId);
    if (!callback) {
      callback = (element) => {
        if (element) optionRefs.current.set(messageId, element);
        else optionRefs.current.delete(messageId);
      };
      optionRefCallbacks.current.set(messageId, callback);
    }
    return callback;
  }

  const focusActiveOption = useCallback(() => {
    const option = optionRefs.current.get(activeMessageId ?? "");
    option?.focus({ preventScroll: true });
    option?.scrollIntoView({ block: "nearest" });
  }, [activeMessageId]);

  useLayoutEffect(() => {
    if (!open) return;
    focusActiveOption();
  }, [focusActiveOption, open]);

  const handleOpenChange = useCallback(
    (nextOpen: boolean) => {
      if (nextOpen) setActiveIndex(Math.max(messageCount - 1, 0));
      onOpenChange(nextOpen);
    },
    [messageCount, onOpenChange],
  );

  const selectMessage = useCallback(
    (message: ConversationMessage) => {
      onSelectMessage(message.id);
      onOpenChange(false);
      buttonRef.current?.focus({ preventScroll: true });
    },
    [onOpenChange, onSelectMessage],
  );

  const handleOptionKeyDown = useCallback(
    (event: KeyboardEvent<HTMLDivElement>, index: number) => {
      if (event.key === "ArrowUp" || event.key === "ArrowDown") {
        event.preventDefault();
        const direction = event.key === "ArrowUp" ? -1 : 1;
        setActiveIndex(Math.max(0, Math.min(entries.length - 1, index + direction)));
      } else if (event.key === "Enter" || event.key === " ") {
        event.preventDefault();
        const entry = entries[index];
        if (entry) selectMessage(entry.message);
      }
    },
    [entries, selectMessage],
  );

  return (
    <>
      <Tooltip align="end" label={t.conversationHistory.button}>
        <IconButton
          aria-controls={popoverId}
          aria-expanded={open}
          aria-haspopup="listbox"
          className={styles.trigger}
          data-composer-menu-trigger
          icon={<History aria-hidden="true" size={16} strokeWidth={1.8} />}
          label={t.conversationHistory.button}
          onClick={() => handleOpenChange(!open)}
          onKeyDown={(event) => {
            if (open || (event.key !== "ArrowDown" && event.key !== "ArrowUp")) return;
            event.preventDefault();
            handleOpenChange(true);
          }}
          ref={buttonRef}
        />
      </Tooltip>
      {open ? (
        <ComposerPopover
          anchorRef={buttonRef}
          className={styles.popover}
          id={popoverId}
          initialFocus={() =>
            optionRefs.current.get(entries[activeIndex]?.message.id ?? "") ?? null
          }
          label={t.conversationHistory.listAccessibleName}
          onClose={() => onOpenChange(false)}
          open={open}
          restoreFocusOnOutside={false}
          role="listbox"
        >
          {entries.map(({ message, preview }, index) => (
            <HistoryOption
              active={index === activeIndex}
              index={index}
              key={message.id}
              message={message}
              messageLabel={t.conversationHistory.messageLabel(preview)}
              onSelectMessage={selectMessage}
              onKeyDown={handleOptionKeyDown}
              setActiveIndex={setActiveIndex}
              setOptionRef={optionRefFor(message.id)}
              preview={preview}
            />
          ))}
        </ComposerPopover>
      ) : null}
    </>
  );
});

const HistoryOption = memo(function HistoryOption({
  active,
  index,
  message,
  messageLabel,
  onKeyDown,
  onSelectMessage,
  preview,
  setActiveIndex,
  setOptionRef,
}: {
  active: boolean;
  index: number;
  message: ConversationMessage;
  messageLabel: string;
  onKeyDown: (event: KeyboardEvent<HTMLDivElement>, index: number) => void;
  onSelectMessage: (message: ConversationMessage) => void;
  preview: string;
  setActiveIndex: (index: number) => void;
  setOptionRef: (element: HTMLDivElement | null) => void;
}) {
  return (
    <div
      aria-label={messageLabel}
      aria-selected={active}
      className={styles.option}
      onClick={() => onSelectMessage(message)}
      onFocus={() => setActiveIndex(index)}
      onKeyDown={(event) => onKeyDown(event, index)}
      ref={setOptionRef}
      role="option"
      tabIndex={active ? 0 : -1}
    >
      <span aria-hidden="true" className={styles.preview}>
        {preview}
      </span>
    </div>
  );
});
