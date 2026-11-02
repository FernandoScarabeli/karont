import {
  type KeyboardEvent,
  memo,
  type ReactNode,
  type RefObject,
  useCallback,
  useEffect,
  useId,
  useMemo,
  useRef,
  useState,
} from "react";
import { ComposerPopover } from "../ComposerPopover/ComposerPopover.tsx";
import { useRegisterFluidHoverItem } from "../FluidHover/FluidHover.tsx";
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

export const ActionMenu = memo(function ActionMenu({
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
  items: ActionMenuItem[] | (() => ActionMenuItem[]);
  triggerRef?: RefObject<HTMLButtonElement | null>;
}) {
  const localTriggerRef = useRef<HTMLButtonElement>(null);
  const itemRefs = useRef<Array<HTMLButtonElement | null>>([]);
  const [activeIndex, setActiveIndex] = useState(0);
  const [itemsAtOpen, setItemsAtOpen] = useState<ActionMenuItem[] | null>(null);
  const menuId = useId();
  const buttonRef = triggerRef ?? localTriggerRef;
  const menuItems = useMemo(() => {
    if (!open) return [];
    if (itemsAtOpen) return itemsAtOpen;
    return typeof items === "function" ? items() : items;
  }, [items, itemsAtOpen, open]);
  const setItemElement = useCallback((index: number, element: HTMLButtonElement | null) => {
    itemRefs.current[index] = element;
  }, []);

  const enabledIndices = useCallback(
    (source: ActionMenuItem[] = menuItems) =>
      source.flatMap((item, index) => ("separator" in item || item.disabled ? [] : [index])),
    [menuItems],
  );

  useEffect(() => {
    if (!open) return;
    const enabled = enabledIndices();
    const focusIndex = enabled.includes(activeIndex) ? activeIndex : (enabled[0] ?? 0);
    if (focusIndex !== activeIndex) setActiveIndex(focusIndex);
    itemRefs.current[focusIndex]?.focus();
  }, [activeIndex, enabledIndices, open]);

  function focusRelative(direction: 1 | -1) {
    const enabled = enabledIndices();
    if (enabled.length === 0) return;
    const current = enabled.indexOf(activeIndex);
    const next = current === -1 ? 0 : (current + direction + enabled.length) % enabled.length;
    setActiveIndex(enabled[next] ?? enabled[0] ?? 0);
  }

  const openMenu = useCallback(() => {
    const nextItems = typeof items === "function" ? items() : items;
    setItemsAtOpen(nextItems);
    const first = enabledIndices(nextItems)[0] ?? 0;
    setActiveIndex(first);
    onOpenChange(true);
  }, [enabledIndices, items, onOpenChange]);

  const closeMenu = useCallback(
    (restoreFocus: boolean) => {
      onOpenChange(false);
      setItemsAtOpen(null);
      if (restoreFocus) {
        requestAnimationFrame(() => {
          if (buttonRef.current?.isConnected && !document.querySelector("dialog[open]")) {
            buttonRef.current.focus();
          }
        });
      }
    },
    [buttonRef, onOpenChange],
  );
  const toggleMenu = useCallback(
    () => (open ? closeMenu(false) : openMenu()),
    [closeMenu, open, openMenu],
  );

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
        onClick={toggleMenu}
        ref={buttonRef}
        size="sm"
      />
      {open ? (
        <ComposerPopover
          anchorPoint={anchorPoint}
          anchorRef={buttonRef}
          fluidHoverGapClick={{ maxDistance: 6 }}
          fluidHoverNearest
          id={menuId}
          initialFocus={() => itemRefs.current[activeIndex] ?? null}
          label={label}
          onClose={() => closeMenu(false)}
          open
          role="menu"
        >
          <div className={styles.items}>
            {menuItems.map((item, index) =>
              "separator" in item ? (
                <hr className={styles.separator} key={item.id} />
              ) : (
                <ActionMenuButton
                  activeIndex={activeIndex}
                  index={index}
                  item={item}
                  key={item.id}
                  onFocus={() => setActiveIndex(index)}
                  onKeyDown={onMenuKeyDown}
                  onSelect={() => {
                    if (item.disabled) return;
                    item.onSelect();
                    closeMenu(true);
                  }}
                  setItemElement={setItemElement}
                />
              ),
            )}
          </div>
        </ComposerPopover>
      ) : null}
    </>
  );
});

function ActionMenuButton({
  item,
  index,
  activeIndex,
  onFocus,
  onKeyDown,
  onSelect,
  setItemElement,
}: {
  item: Extract<ActionMenuItem, { label: string }>;
  index: number;
  activeIndex: number;
  onFocus: () => void;
  onKeyDown: (event: KeyboardEvent<HTMLElement>) => void;
  onSelect: () => void;
  setItemElement: (index: number, element: HTMLButtonElement | null) => void;
}) {
  const registerHoverItem = useRegisterFluidHoverItem(item.id);
  const itemRef = useCallback(
    (element: HTMLButtonElement | null) => {
      setItemElement(index, element);
      registerHoverItem(element);
    },
    [index, registerHoverItem, setItemElement],
  );
  return (
    <button
      aria-disabled={item.disabled || undefined}
      className={`${styles.item} ${item.danger ? styles.danger : ""}`}
      disabled={item.disabled}
      onClick={onSelect}
      onFocus={onFocus}
      onKeyDown={onKeyDown}
      ref={itemRef}
      role="menuitem"
      tabIndex={activeIndex === index ? 0 : -1}
      type="button"
    >
      <span aria-hidden="true" className={styles.icon}>
        {item.icon}
      </span>
      <span className={styles.itemLabel}>{item.label}</span>
    </button>
  );
}
