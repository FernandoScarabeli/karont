import {
  type KeyboardEvent,
  type ReactNode,
  type RefObject,
  useEffect,
  useId,
  useRef,
  useState,
} from "react";
import { ComposerPopover } from "../ComposerPopover/ComposerPopover.tsx";
import { IconButton } from "../IconButton/IconButton.tsx";
import styles from "./ActionMenu.module.css";

export type ActionMenuItem =
  | { id: string; separator: true }
  | {
      id: string;
      label: string;
      icon: ReactNode;
      onSelect: () => void;
      danger?: boolean;
      disabled?: boolean;
    };

export function ActionMenu({
  label,
  triggerLabel,
  triggerIcon,
  triggerClassName,
  anchorPoint,
  open,
  onOpenChange,
  items,
  triggerRef,
}: {
  label: string;
  triggerLabel: string;
  triggerIcon: ReactNode;
  triggerClassName?: string;
  anchorPoint?: { x: number; y: number };
  open: boolean;
  onOpenChange: (open: boolean) => void;
  items: ActionMenuItem[];
  triggerRef?: RefObject<HTMLButtonElement | null>;
}) {
  const localTriggerRef = useRef<HTMLButtonElement>(null);
  const itemRefs = useRef<Array<HTMLButtonElement | null>>([]);
  const [activeIndex, setActiveIndex] = useState(0);
  const menuId = useId();
  const buttonRef = triggerRef ?? localTriggerRef;

  useEffect(() => {
    if (open) itemRefs.current[activeIndex]?.focus();
  }, [activeIndex, open]);

  function enabledIndices() {
    return items.flatMap((item, index) => ("separator" in item || item.disabled ? [] : [index]));
  }

  function focusRelative(direction: 1 | -1) {
    const enabled = enabledIndices();
    if (enabled.length === 0) return;
    const current = enabled.indexOf(activeIndex);
    const next = current === -1 ? 0 : (current + direction + enabled.length) % enabled.length;
    setActiveIndex(enabled[next] ?? enabled[0] ?? 0);
  }

  function openMenu() {
    const first = enabledIndices()[0] ?? 0;
    setActiveIndex(first);
    onOpenChange(true);
  }

  function closeMenu(restoreFocus: boolean) {
    onOpenChange(false);
    if (restoreFocus) {
      requestAnimationFrame(() => {
        if (buttonRef.current?.isConnected && !document.querySelector("dialog[open]")) {
          buttonRef.current.focus();
        }
      });
    }
  }

  function onMenuKeyDown(event: KeyboardEvent<HTMLElement>) {
    if (event.key === "ArrowDown") {
      event.preventDefault();
      focusRelative(1);
    } else if (event.key === "ArrowUp") {
      event.preventDefault();
      focusRelative(-1);
    } else if (event.key === "Home" || event.key === "End") {
      event.preventDefault();
      const enabled = enabledIndices();
      setActiveIndex(event.key === "Home" ? (enabled[0] ?? 0) : (enabled.at(-1) ?? 0));
    } else if (event.key === "Enter" || event.key === " ") {
      event.preventDefault();
      itemRefs.current[activeIndex]?.click();
    }
  }

  return (
    <>
      <IconButton
        aria-controls={menuId}
        aria-expanded={open}
        aria-haspopup="menu"
        className={triggerClassName}
        data-composer-menu-trigger
        icon={triggerIcon}
        label={triggerLabel}
        onClick={() => (open ? closeMenu(false) : openMenu())}
        ref={buttonRef}
        size="sm"
      />
      <ComposerPopover
        anchorPoint={anchorPoint}
        anchorRef={buttonRef}
        id={menuId}
        initialFocus={() => itemRefs.current[activeIndex] ?? null}
        label={label}
        onClose={() => closeMenu(false)}
        open={open}
        role="menu"
      >
        <div className={styles.items}>
          {items.map((item, index) =>
            "separator" in item ? (
              <hr className={styles.separator} key={item.id} />
            ) : (
              <button
                aria-disabled={item.disabled || undefined}
                className={`${styles.item} ${item.danger ? styles.danger : ""}`}
                disabled={item.disabled}
                key={item.id}
                onClick={() => {
                  if (item.disabled) return;
                  item.onSelect();
                  closeMenu(true);
                }}
                onFocus={() => setActiveIndex(index)}
                onKeyDown={onMenuKeyDown}
                ref={(element) => {
                  itemRefs.current[index] = element;
                }}
                role="menuitem"
                tabIndex={activeIndex === index ? 0 : -1}
                type="button"
              >
                <span aria-hidden="true" className={styles.icon}>
                  {item.icon}
                </span>
                <span className={styles.itemLabel}>{item.label}</span>
              </button>
            ),
          )}
        </div>
      </ComposerPopover>
    </>
  );
}
