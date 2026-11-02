import { Check, ChevronDown } from "lucide-react";
import {
  type KeyboardEvent,
  type MouseEvent,
  type ReactNode,
  useCallback,
  useEffect,
  useId,
  useRef,
  useState,
} from "react";
import { ComposerPopover, ComposerPopoverHeading } from "../ComposerPopover/ComposerPopover.tsx";
import { useRegisterFluidHoverItem } from "../FluidHover/FluidHover.tsx";
import styles from "./ComposerMenu.module.css";

export type ComposerMenuOption = {
  id: string;
  content: ReactNode;
  selected: boolean;
  onSelect: () => void;
  action?: boolean;
};

export function ComposerMenu({
  label,
  triggerLabel,
  triggerContent,
  triggerClassName,
  options,
  heading,
  open,
  onOpenChange,
  disabled = false,
  iconOnly = false,
}: {
  label: string;
  triggerLabel: string;
  triggerContent: ReactNode;
  triggerClassName?: string;
  options: ComposerMenuOption[];
  heading?: string;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  disabled?: boolean;
  iconOnly?: boolean;
}) {
  const triggerRef = useRef<HTMLButtonElement>(null);
  const optionRefs = useRef<Array<HTMLDivElement | null>>([]);
  const focusIntentRef = useRef<"option" | "popover">("popover");
  const [activeIndex, setActiveIndex] = useState(0);
  const listboxId = useId();
  const setOptionElement = useCallback((index: number, element: HTMLDivElement | null) => {
    optionRefs.current[index] = element;
  }, []);

  useEffect(() => {
    if (open && focusIntentRef.current === "option") optionRefs.current[activeIndex]?.focus();
  }, [activeIndex, open]);

  function close(returnFocus = true) {
    onOpenChange(false);
    if (returnFocus) requestAnimationFrame(() => triggerRef.current?.focus());
  }

  function select(option: ComposerMenuOption) {
    option.onSelect();
    close();
  }

  function openMenu(fromKeyboard: boolean) {
    const selectedIndex = options.findIndex((option) => option.selected);
    setActiveIndex(Math.max(selectedIndex, 0));
    focusIntentRef.current = fromKeyboard ? "option" : "popover";
    onOpenChange(true);
  }

  function handleListKeyDown(event: KeyboardEvent<HTMLDivElement>) {
    const index = activeIndex;
    if (event.key === "ArrowDown") {
      event.preventDefault();
      focusIntentRef.current = "option";
      setActiveIndex((index + 1) % options.length);
    } else if (event.key === "ArrowUp") {
      event.preventDefault();
      focusIntentRef.current = "option";
      setActiveIndex((index - 1 + options.length) % options.length);
    } else if (event.key === "Home") {
      event.preventDefault();
      focusIntentRef.current = "option";
      setActiveIndex(0);
    } else if (event.key === "End") {
      event.preventDefault();
      focusIntentRef.current = "option";
      setActiveIndex(options.length - 1);
    } else if (event.key === "Enter" || event.key === " ") {
      event.preventDefault();
      const option = options[index];
      if (option) select(option);
    }
  }

  function handleTriggerClick(event: MouseEvent<HTMLButtonElement>) {
    if (open) {
      onOpenChange(false);
      return;
    }
    openMenu(event.detail === 0);
  }

  return (
    <div className={styles.wrap}>
      <button
        aria-controls={listboxId}
        aria-expanded={open}
        aria-haspopup="listbox"
        aria-label={triggerLabel}
        className={[styles.trigger, triggerClassName].filter(Boolean).join(" ")}
        data-composer-menu-trigger
        disabled={disabled}
        onClick={handleTriggerClick}
        onKeyDown={(event) => {
          if (!open && (event.key === "ArrowDown" || event.key === "ArrowUp")) {
            event.preventDefault();
            openMenu(true);
          }
        }}
        ref={triggerRef}
        title={triggerLabel}
        type="button"
      >
        {triggerContent}
        {iconOnly ? null : <ChevronDown aria-hidden="true" className={styles.chevron} size={14} />}
      </button>
      <ComposerPopover
        anchorRef={triggerRef}
        initialFocus={() =>
          focusIntentRef.current === "option" ? (optionRefs.current[activeIndex] ?? null) : null
        }
        label={label}
        onClose={() => close(false)}
        open={open}
      >
        {heading ? <ComposerPopoverHeading>{heading}</ComposerPopoverHeading> : null}
        <div
          aria-label={label}
          className={styles.listbox}
          id={listboxId}
          onKeyDown={handleListKeyDown}
          role="listbox"
        >
          {options.map((option, index) => (
            <ComposerMenuOptionRow
              activeIndex={activeIndex}
              index={index}
              key={option.id}
              listboxId={listboxId}
              onFocus={() => setActiveIndex(index)}
              onKeyDown={(event) => {
                event.stopPropagation();
                handleListKeyDown(event);
              }}
              onSelect={() => select(option)}
              option={option}
              setOptionElement={setOptionElement}
            />
          ))}
        </div>
      </ComposerPopover>
    </div>
  );
}

function ComposerMenuOptionRow({
  option,
  index,
  activeIndex,
  listboxId,
  onFocus,
  onKeyDown,
  onSelect,
  setOptionElement,
}: {
  option: ComposerMenuOption;
  index: number;
  activeIndex: number;
  listboxId: string;
  onFocus: () => void;
  onKeyDown: (event: KeyboardEvent<HTMLDivElement>) => void;
  onSelect: () => void;
  setOptionElement: (index: number, element: HTMLDivElement | null) => void;
}) {
  const registerHoverItem = useRegisterFluidHoverItem(option.id);
  const optionRef = useCallback(
    (element: HTMLDivElement | null) => {
      setOptionElement(index, element);
      registerHoverItem(element);
    },
    [index, registerHoverItem, setOptionElement],
  );
  return (
    <div
      aria-selected={option.selected}
      className={[styles.option, option.action ? styles.action : ""].filter(Boolean).join(" ")}
      id={`${listboxId}-${index}`}
      onClick={onSelect}
      onFocus={onFocus}
      onKeyDown={onKeyDown}
      ref={optionRef}
      role="option"
      tabIndex={activeIndex === index ? 0 : -1}
    >
      <span className={styles.optionContent}>{option.content}</span>
      <Check
        aria-hidden="true"
        className={styles.check}
        data-visible={option.selected ? "true" : "false"}
        size={15}
      />
    </div>
  );
}
