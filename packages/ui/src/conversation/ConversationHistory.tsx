import type { ConversationMessage } from "@karont/contract";
import { History } from "lucide-react";
import {
  memo,
  type KeyboardEvent as ReactKeyboardEvent,
  type RefObject,
  useCallback,
  useEffect,
  useId,
  useLayoutEffect,
  useRef,
  useState,
} from "react";
import { createPortal } from "react-dom";
import { IconButton } from "../components/IconButton/IconButton.tsx";
import { Tooltip } from "../components/Tooltip/Tooltip.tsx";
import { t } from "../i18n/pt-BR.ts";
import styles from "./ConversationHistory.module.css";
import type { ConversationHistoryEntry } from "./conversationHistory.ts";

export const ConversationHistory = memo(function ConversationHistory({
  entries,
  open,
  onOpenChange,
  onSelectMessage,
  popupContainerRef,
}: {
  entries: ConversationHistoryEntry[];
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onSelectMessage: (messageId: string) => void;
  popupContainerRef: RefObject<HTMLElement | null>;
}) {
  const buttonRef = useRef<HTMLButtonElement>(null);
  const listRef = useRef<HTMLDivElement>(null);
  const optionRefs = useRef(new Map<string, HTMLDivElement>());
  const optionRefCallbacks = useRef(new Map<string, (element: HTMLDivElement | null) => void>());
  const popoverId = useId();
  const [activeIndex, setActiveIndex] = useState(0);
  const [hasItemsAbove, setHasItemsAbove] = useState(false);
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
    const list = listRef.current;
    if (!option || !list) return;
    option.focus({ preventScroll: true });
    option.scrollIntoView({ block: "nearest" });
    setHasItemsAbove(list.scrollTop > 0);
  }, [activeMessageId]);

  useLayoutEffect(() => {
    if (!open) return;
    const list = listRef.current;
    if (!list) return;
    list.scrollTop = list.scrollHeight;
    setHasItemsAbove(list.scrollTop > 0);
  }, [open]);

  useLayoutEffect(() => {
    if (!open) return;
    focusActiveOption();
  }, [focusActiveOption, open]);

  const handleOpenChange = useCallback(
    (nextOpen: boolean) => {
      if (nextOpen) {
        setActiveIndex(Math.max(entries.length - 1, 0));
        setHasItemsAbove(false);
      }
      onOpenChange(nextOpen);
    },
    [entries.length, onOpenChange],
  );

  const selectMessage = useCallback(
    (message: ConversationMessage) => {
      onSelectMessage(message.id);
      onOpenChange(false);
      buttonRef.current?.focus({ preventScroll: true });
    },
    [onOpenChange, onSelectMessage],
  );

  useEffect(() => {
    if (!open) return;

    const handlePointerDown = (event: PointerEvent) => {
      const target = event.target;
      if (!(target instanceof Element)) return;
      if (listRef.current?.contains(target) || buttonRef.current?.contains(target)) return;
      onOpenChange(false);
    };
    const handleKeyDown = (event: globalThis.KeyboardEvent) => {
      if (event.key !== "Escape") return;
      event.preventDefault();
      onOpenChange(false);
      buttonRef.current?.focus({ preventScroll: true });
    };

    document.addEventListener("pointerdown", handlePointerDown, true);
    document.addEventListener("keydown", handleKeyDown, true);
    return () => {
      document.removeEventListener("pointerdown", handlePointerDown, true);
      document.removeEventListener("keydown", handleKeyDown, true);
    };
  }, [onOpenChange, open]);

  const handleOptionKeyDown = useCallback(
    (event: ReactKeyboardEvent<HTMLDivElement>, index: number) => {
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
      <Tooltip align="end" label={t.conversationHistory.button} open={open}>
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
      {open && popupContainerRef.current
        ? createPortal(
            <div
              aria-label={t.conversationHistory.listAccessibleName}
              aria-multiselectable="false"
              className={styles.popover}
              data-has-items-above={hasItemsAbove}
              id={popoverId}
              ref={listRef}
              role="listbox"
              onScroll={(event) => setHasItemsAbove(event.currentTarget.scrollTop > 0)}
              tabIndex={-1}
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
            </div>,
            popupContainerRef.current,
          )
        : null}
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
  onKeyDown: (event: ReactKeyboardEvent<HTMLDivElement>, index: number) => void;
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
