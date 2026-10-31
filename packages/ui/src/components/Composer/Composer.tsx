import { ArrowUp } from "lucide-react";
import { type FormEvent, type KeyboardEvent, type ReactNode, useLayoutEffect, useRef } from "react";
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
}: ComposerProps) {
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const cannotSubmit = disabled || submitDisabled;

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
    if (cannotSubmit) return;
    onSubmit();
  }

  function handleKeyDown(event: KeyboardEvent<HTMLTextAreaElement>) {
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
      <form className={styles.card} onSubmit={submit}>
        <textarea
          aria-description={ariaDescription}
          aria-label={placeholder}
          className={`${styles.textarea} ${mono ? styles.mono : ""}`}
          disabled={disabled}
          onChange={(event) => onChange(event.currentTarget.value)}
          onKeyDown={handleKeyDown}
          placeholder={placeholder}
          ref={textareaRef}
          rows={2}
          value={value}
        />
        <div className={styles.footer}>
          <div className={styles.leading}>{leading}</div>
          <div className={styles.actions}>
            {trailing ? <div className={styles.trailing}>{trailing}</div> : null}
            <button
              aria-disabled={cannotSubmit}
              aria-label={submitLabel}
              className={styles.submit}
              onClick={(event) => {
                if (cannotSubmit) event.preventDefault();
              }}
              title={submitLabel}
              type="submit"
            >
              <ArrowUp aria-hidden="true" size={18} strokeWidth={2} />
            </button>
          </div>
        </div>
      </form>
      {hint ? <p className={styles.hint}>{hint}</p> : null}
    </div>
  );
}
