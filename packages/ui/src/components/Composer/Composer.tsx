import { ArrowUp, Square } from "lucide-react";
import {
  type ClipboardEventHandler,
  type DragEventHandler,
  type FormEvent,
  type KeyboardEvent,
  type ReactNode,
  useLayoutEffect,
  useRef,
} from "react";
import styles from "./Composer.module.css";

export type ComposerProps = {
  value: string;
  onChange: (value: string) => void;
  onSubmit: () => void;
  placeholder: string;
  submitLabel: string;
  ariaDescription?: string;
  submitDisabled?: boolean;
  leading: ReactNode;
  trailing?: ReactNode;
  disabled?: boolean;
  hint?: string;
  mono?: boolean;
  busy?: boolean;
  onStop?: () => void;
  attachments?: ReactNode;
  dragActive?: boolean;
  dropMessage?: string;
  onPaste?: ClipboardEventHandler<HTMLTextAreaElement>;
  onDragEnter?: DragEventHandler<HTMLFormElement>;
  onDragLeave?: DragEventHandler<HTMLFormElement>;
  onDragOver?: DragEventHandler<HTMLFormElement>;
  onDrop?: DragEventHandler<HTMLFormElement>;
  below?: ReactNode;
};

export function Composer({
  value,
  onChange,
  onSubmit,
  placeholder,
  submitLabel,
  ariaDescription,
  submitDisabled = false,
  leading,
  trailing,
  disabled = false,
  hint,
  mono = false,
  busy = false,
  onStop,
  attachments,
  dragActive = false,
  dropMessage,
  onPaste,
  onDragEnter,
  onDragLeave,
  onDragOver,
  onDrop,
  below,
}: ComposerProps) {
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const cannotSubmit = !busy && (disabled || submitDisabled);

  useLayoutEffect(() => {
    const textarea = textareaRef.current;
    if (!textarea) return;

    textarea.style.height = "auto";
    const maxHeight = Number.parseFloat(getComputedStyle(textarea).maxHeight);
    const nextHeight = Math.min(textarea.scrollHeight, maxHeight);
    textarea.style.height = `${nextHeight}px`;
    textarea.style.overflowY = textarea.scrollHeight > maxHeight ? "auto" : "hidden";
  });

  function submit(event?: FormEvent<HTMLFormElement>) {
    event?.preventDefault();
    if (busy) {
      onStop?.();
      return;
    }
    if (cannotSubmit) return;
    onSubmit();
  }

  function handleKeyDown(event: KeyboardEvent<HTMLTextAreaElement>) {
    if (busy) return;
    if (
      event.key !== "Enter" ||
      event.shiftKey ||
      event.nativeEvent.isComposing ||
      event.nativeEvent.keyCode === 229
    ) {
      return;
    }

    event.preventDefault();
    submit();
  }

  return (
    <div className={styles.wrapper}>
      <form
        className={`${styles.card} ${dragActive ? styles.dragActive : ""}`}
        onDragEnter={onDragEnter}
        onDragLeave={onDragLeave}
        onDragOver={onDragOver}
        onDrop={onDrop}
        onSubmit={submit}
      >
        {attachments ? <div className={styles.attachments}>{attachments}</div> : null}
        <textarea
          aria-description={ariaDescription}
          aria-label={placeholder}
          className={`${styles.textarea} ${mono ? styles.mono : ""}`}
          disabled={disabled}
          onChange={(event) => onChange(event.currentTarget.value)}
          onKeyDown={handleKeyDown}
          onPaste={onPaste}
          placeholder={placeholder}
          ref={textareaRef}
          rows={2}
          value={value}
        />
        {dragActive && dropMessage ? (
          <div className={styles.dropNotice} role="status">
            {dropMessage}
          </div>
        ) : null}
        <div className={styles.footer}>
          <div className={styles.leading}>{leading}</div>
          <div className={styles.actions}>
            {trailing ? <div className={styles.trailing}>{trailing}</div> : null}
            <button
              aria-disabled={cannotSubmit}
              aria-label={submitLabel}
              className={styles.submit}
              onClick={(event) => {
                if (busy) {
                  event.preventDefault();
                  onStop?.();
                } else if (cannotSubmit) {
                  event.preventDefault();
                }
              }}
              title={submitLabel}
              type="submit"
            >
              {busy ? (
                <Square aria-hidden="true" size={14} strokeWidth={2.2} />
              ) : (
                <ArrowUp aria-hidden="true" size={18} strokeWidth={2} />
              )}
            </button>
          </div>
        </div>
      </form>
      {below}
      {hint ? <p className={styles.hint}>{hint}</p> : null}
    </div>
  );
}
