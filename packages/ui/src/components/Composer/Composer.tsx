import { ArrowUp, Square } from "lucide-react";
import {
  type ClipboardEventHandler,
  type DragEventHandler,
  type FormEvent,
  type KeyboardEvent,
  memo,
  type ReactNode,
  useCallback,
  useEffect,
  useId,
  useLayoutEffect,
  useRef,
  useState,
} from "react";
import { ComposerPopover } from "../ComposerPopover/ComposerPopover.tsx";
import { useRegisterFluidHoverItem } from "../FluidHover/FluidHover.tsx";
import { Tooltip } from "../Tooltip/Tooltip.tsx";
import styles from "./Composer.module.css";
import { composerAutocompleteKeyAction } from "./composerKeyboard.ts";

export type ComposerAutocompleteOption = {
  id: string;
  type: "file" | "skill" | "command";
  primary: string;
  secondary?: string;
  detail?: string;
};

export type ComposerAutocompleteState = {
  open: boolean;
  label: string;
  options: readonly ComposerAutocompleteOption[];
  activeIndex: number;
  loading?: boolean;
  loadingLabel: string;
  emptyLabel: string;
  onActiveIndexChange: (index: number) => void;
  onSelect: (option: ComposerAutocompleteOption) => void;
  onClose: () => void;
};

export type ComposerProps = {
  value: string;
  onChange: (value: string) => void;
  onSubmit: () => void;
  placeholder: string;
  /** Texto curto para painéis estreitos; a troca é feita por container query, sem re-render. */
  shortPlaceholder?: string;
  submitLabel: string;
  submitTooltipLabel?: string;
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
  animatedPlaceholder?: ReactNode;
  autocomplete?: ComposerAutocompleteState;
  onCaretChange?: (value: string, position: number) => void;
};

export const Composer = memo(function Composer({
  value,
  onChange,
  onSubmit,
  placeholder,
  shortPlaceholder,
  submitLabel,
  submitTooltipLabel,
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
  animatedPlaceholder,
  autocomplete,
  onCaretChange,
}: ComposerProps) {
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const [isFocused, setIsFocused] = useState(false);
  const listboxId = useId();
  const cannotSubmit = !busy && (disabled || submitDisabled);

  /**
   * A altura só é recalculada quando o texto muda, ou quando a largura muda e há texto (aí a
   * quantidade de linhas pode mudar). Vazio, a altura vem do CSS: arrastar o painel não mede nada.
   */
  const valueRef = useRef(value);
  valueRef.current = value;
  const fitHeight = useCallback(() => {
    const textarea = textareaRef.current;
    if (!textarea) return;
    if (valueRef.current === "") {
      textarea.style.removeProperty("height");
      textarea.style.overflowY = "hidden";
      return;
    }
    textarea.style.height = "auto";
    const maxHeight = Number.parseFloat(getComputedStyle(textarea).maxHeight);
    const nextHeight = Math.min(textarea.scrollHeight, maxHeight);
    textarea.style.height = `${nextHeight}px`;
    textarea.style.overflowY = textarea.scrollHeight > maxHeight ? "auto" : "hidden";
  }, []);

  // biome-ignore lint/correctness/useExhaustiveDependencies: refaz a altura quando o texto muda.
  useLayoutEffect(fitHeight, [value, fitHeight]);

  useEffect(() => {
    const textarea = textareaRef.current;
    if (!textarea) return;
    let lastWidth = textarea.clientWidth;
    let frame = 0;
    // Só olha a largura: escrever a altura não dispara o observador de novo.
    const observer = new ResizeObserver(() => {
      const width = textarea.clientWidth;
      if (width === lastWidth) return;
      lastWidth = width;
      if (valueRef.current === "") return;
      cancelAnimationFrame(frame);
      frame = requestAnimationFrame(fitHeight);
    });
    observer.observe(textarea);
    return () => {
      cancelAnimationFrame(frame);
      observer.disconnect();
    };
  }, [fitHeight]);

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
    if (event.nativeEvent.isComposing || event.nativeEvent.keyCode === 229) return;
    const autocompleteAction = composerAutocompleteKeyAction(
      event.key,
      autocomplete?.open === true,
    );
    if (autocomplete?.open && autocompleteAction) {
      if (autocompleteAction === "down" || autocompleteAction === "up") {
        event.preventDefault();
        const count = autocomplete.options.length;
        if (count > 0) {
          const direction = autocompleteAction === "down" ? 1 : -1;
          const current = Math.max(0, autocomplete.activeIndex);
          autocomplete.onActiveIndexChange((current + direction + count) % count);
        }
        return;
      }
      if (autocompleteAction === "select") {
        event.preventDefault();
        const option = autocomplete.options[autocomplete.activeIndex];
        if (option) autocomplete.onSelect(option);
        return;
      }
      if (autocompleteAction === "close") {
        event.preventDefault();
        autocomplete.onClose();
        return;
      }
    }
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

  function reportCaret(textarea: HTMLTextAreaElement) {
    onCaretChange?.(textarea.value, textarea.selectionStart);
  }

  const activeOption = autocomplete?.options[autocomplete.activeIndex];
  const animatedShown = Boolean(animatedPlaceholder) && !value && !isFocused && !disabled;
  const showOverlay = animatedShown || (Boolean(shortPlaceholder) && !value);

  return (
    <div className={styles.wrapper} data-composer-root>
      <form
        className={`${styles.card} ${dragActive ? styles.dragActive : ""}`}
        onDragEnter={onDragEnter}
        onDragLeave={onDragLeave}
        onDragOver={onDragOver}
        onDrop={onDrop}
        onSubmit={submit}
      >
        {attachments ? <div className={styles.attachments}>{attachments}</div> : null}
        <div className={styles.textareaWrap}>
          <textarea
            aria-description={ariaDescription}
            aria-activedescendant={
              autocomplete?.open && activeOption
                ? `${listboxId}-${autocomplete.activeIndex}`
                : undefined
            }
            aria-autocomplete={autocomplete?.open ? "list" : undefined}
            aria-controls={autocomplete?.open ? listboxId : undefined}
            aria-label={placeholder}
            className={`${styles.textarea} ${mono ? styles.mono : ""} ${showOverlay ? styles.animatedPlaceholderInput : ""}`}
            disabled={disabled}
            onBlur={() => setIsFocused(false)}
            onChange={(event) => {
              onChange(event.currentTarget.value);
              reportCaret(event.currentTarget);
            }}
            onClick={(event) => reportCaret(event.currentTarget)}
            onFocus={() => setIsFocused(true)}
            onKeyDown={handleKeyDown}
            onKeyUp={(event) => reportCaret(event.currentTarget)}
            onPaste={onPaste}
            placeholder={placeholder}
            onSelect={(event) => reportCaret(event.currentTarget)}
            ref={textareaRef}
            rows={1}
            value={value}
          />
          {showOverlay ? (
            <div
              aria-hidden="true"
              className={styles.placeholderOverlay}
              data-has-short={shortPlaceholder ? "true" : undefined}
            >
              <span className={styles.placeholderWide}>
                {animatedShown ? animatedPlaceholder : placeholder}
              </span>
              {shortPlaceholder ? (
                <span className={styles.placeholderNarrow}>{shortPlaceholder}</span>
              ) : null}
            </div>
          ) : null}
          {autocomplete?.open ? (
            <ComposerPopover
              anchorRef={textareaRef}
              className={styles.suggestions}
              id={listboxId}
              initialFocus={() => textareaRef.current}
              label={autocomplete.label}
              onClose={autocomplete.onClose}
              open
              placement="above"
              role="listbox"
            >
              {autocomplete.loading ? (
                <div
                  aria-label={autocomplete.label}
                  className={styles.suggestionStatus}
                  role="status"
                >
                  {autocomplete.loadingLabel}
                </div>
              ) : autocomplete.options.length === 0 ? (
                <div className={styles.suggestionStatus} role="status">
                  {autocomplete.emptyLabel}
                </div>
              ) : (
                <div className={styles.suggestionList}>
                  {autocomplete.options.map((option, index) => (
                    <ComposerSuggestionOption
                      active={index === autocomplete.activeIndex}
                      index={index}
                      key={option.id}
                      listboxId={listboxId}
                      onActive={() => autocomplete.onActiveIndexChange(index)}
                      onSelect={() => autocomplete.onSelect(option)}
                      option={option}
                    />
                  ))}
                </div>
              )}
            </ComposerPopover>
          ) : null}
        </div>
        {dragActive && dropMessage ? (
          <div className={styles.dropNotice} role="status">
            {dropMessage}
          </div>
        ) : null}
        <div className={styles.footer}>
          <div className={styles.leading}>{leading}</div>
          <div className={styles.actions}>
            {trailing ? <div className={styles.trailing}>{trailing}</div> : null}
            <Tooltip align="end" label={submitTooltipLabel ?? submitLabel}>
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
                type="submit"
              >
                {busy ? (
                  <Square aria-hidden="true" size={14} strokeWidth={2.2} />
                ) : (
                  <ArrowUp aria-hidden="true" size={18} strokeWidth={2} />
                )}
              </button>
            </Tooltip>
          </div>
        </div>
      </form>
      {below}
      {hint ? <p className={styles.hint}>{hint}</p> : null}
    </div>
  );
});

function ComposerSuggestionOption({
  option,
  index,
  listboxId,
  active,
  onActive,
  onSelect,
}: {
  option: ComposerAutocompleteOption;
  index: number;
  listboxId: string;
  active: boolean;
  onActive: () => void;
  onSelect: () => void;
}) {
  const registerHoverItem = useRegisterFluidHoverItem(option.id);
  return (
    <div
      aria-label={
        option.type === "file"
          ? (option.detail ?? option.primary)
          : [option.primary, option.secondary].filter(Boolean).join(" · ")
      }
      aria-selected={active}
      className={styles.suggestionOption}
      id={`${listboxId}-${index}`}
      onClick={onSelect}
      onKeyDown={(event) => {
        if (event.key === "Enter" || event.key === " ") {
          event.preventDefault();
          onSelect();
        }
      }}
      onMouseMove={onActive}
      ref={registerHoverItem}
      role="option"
      tabIndex={-1}
    >
      <span className={styles.suggestionCopy}>
        {option.type === "file" && option.secondary ? (
          <>
            <span className={styles.suggestionPrimary}>{option.primary}</span>
            <span className={styles.suggestionDirectory}>{option.secondary}</span>
          </>
        ) : (
          <span className={styles.suggestionPrimary}>{option.primary}</span>
        )}
        {option.type !== "file" && option.secondary ? (
          <span className={styles.suggestionSecondary}>{option.secondary}</span>
        ) : null}
      </span>
    </div>
  );
}
