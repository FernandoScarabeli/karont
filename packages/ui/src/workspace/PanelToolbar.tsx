import { Columns2, X } from "lucide-react";
import { type KeyboardEvent, useEffect, useRef, useState } from "react";
import { IconButton } from "../components/IconButton/IconButton.tsx";
import { t } from "../i18n/pt-BR.ts";
import styles from "./PanelToolbar.module.css";

type PanelToolbarProps = {
  paneTitle: string;
  canSplit: boolean;
  onSplit: (direction: "row" | "column") => void;
  onClosePane: () => void;
};

export function PanelToolbar({ paneTitle, canSplit, onSplit, onClosePane }: PanelToolbarProps) {
  const [isSplitOpen, setIsSplitOpen] = useState(false);
  const splitTrigger = useRef<HTMLButtonElement>(null);
  const menuRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!isSplitOpen) return;
    menuRef.current?.querySelector<HTMLButtonElement>("button:not(:disabled)")?.focus();
  }, [isSplitOpen]);

  function closeMenu(restoreFocus = true) {
    setIsSplitOpen(false);
    if (!restoreFocus) return;
    window.requestAnimationFrame(() => splitTrigger.current?.focus());
  }

  function handleMenuKeyDown(event: KeyboardEvent<HTMLDivElement>) {
    if (event.key === "Escape") {
      event.preventDefault();
      closeMenu();
      return;
    }

    const items = Array.from(
      menuRef.current?.querySelectorAll<HTMLButtonElement>("button:not(:disabled)") ?? [],
    );
    const currentIndex = items.indexOf(document.activeElement as HTMLButtonElement);
    if (
      event.key === "ArrowDown" ||
      event.key === "ArrowUp" ||
      event.key === "Home" ||
      event.key === "End"
    ) {
      event.preventDefault();
      const nextIndex =
        event.key === "Home"
          ? 0
          : event.key === "End"
            ? items.length - 1
            : (currentIndex + (event.key === "ArrowDown" ? 1 : -1) + items.length) % items.length;
      items[nextIndex]?.focus();
    }
  }

  return (
    <fieldset
      aria-description={t.workspace.panelShortcuts}
      className={styles.toolbar}
      title={t.workspace.panelShortcuts}
    >
      <legend className={styles.visuallyHidden}>{t.workspace.panelActions}</legend>
      <div className={styles.menuWrap}>
        <IconButton
          aria-expanded={isSplitOpen}
          aria-haspopup="menu"
          icon={<Columns2 aria-hidden="true" size={16} strokeWidth={1.75} />}
          label={t.workspace.split}
          onClick={() => setIsSplitOpen((open) => !open)}
          ref={splitTrigger}
          size="sm"
        />
        {isSplitOpen ? (
          <div
            aria-label={t.workspace.split}
            className={styles.menu}
            onKeyDown={handleMenuKeyDown}
            ref={menuRef}
            role="menu"
          >
            <button
              className={styles.menuItem}
              disabled={!canSplit}
              onClick={() => {
                closeMenu(false);
                onSplit("row");
              }}
              role="menuitem"
              type="button"
            >
              {t.workspace.splitRight}
            </button>
            <button
              className={styles.menuItem}
              disabled={!canSplit}
              onClick={() => {
                closeMenu(false);
                onSplit("column");
              }}
              role="menuitem"
              type="button"
            >
              {t.workspace.splitBelow}
            </button>
            {!canSplit ? <p className={styles.menuNote}>{t.workspace.panelLimit}</p> : null}
          </div>
        ) : null}
      </div>

      <IconButton
        icon={<X aria-hidden="true" size={16} strokeWidth={1.75} />}
        label={t.workspace.closePane(paneTitle)}
        onClick={onClosePane}
        size="sm"
      />
    </fieldset>
  );
}
