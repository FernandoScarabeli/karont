import { ChevronDown } from "lucide-react";
import { type KeyboardEvent, useEffect, useId, useRef, useState } from "react";
import { t } from "../i18n/pt-BR.ts";
import styles from "./ProjectDialog.module.css";
import { getProjectIcon, PROJECT_ICONS } from "./projectIcons.ts";

/**
 * Fica dentro do diálogo, e não num portal: um `<dialog>` modal deixa o resto da página
 * inerte, então o `ComposerPopover` abriria atrás dele.
 */
export function ProjectIconPicker({
  value,
  onChange,
}: {
  value: string;
  onChange: (icon: string) => void;
}) {
  const [open, setOpen] = useState(false);
  const rootRef = useRef<HTMLDivElement>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const panelId = useId();
  const groupName = useId();
  const CurrentIcon = getProjectIcon(value);
  const currentLabel = t.projects.iconNames[value] ?? value;

  useEffect(() => {
    if (!open) return;
    rootRef.current?.querySelector<HTMLInputElement>("input:checked")?.focus();
    const closeOnOutsidePress = (event: PointerEvent) => {
      if (event.target instanceof Node && rootRef.current?.contains(event.target)) return;
      setOpen(false);
    };
    document.addEventListener("pointerdown", closeOnOutsidePress, true);
    return () => document.removeEventListener("pointerdown", closeOnOutsidePress, true);
  }, [open]);

  function closeAndFocusTrigger() {
    setOpen(false);
    triggerRef.current?.focus();
  }

  function handleKeyDown(event: KeyboardEvent) {
    if (!open || (event.key !== "Escape" && event.key !== "Enter")) return;
    // Sem isso, o Esc fecharia o diálogo inteiro e o Enter enviaria o formulário.
    event.preventDefault();
    event.stopPropagation();
    closeAndFocusTrigger();
  }

  return (
    // biome-ignore lint/a11y/noStaticElementInteractions: só captura Esc e Enter vindos dos radios e do botão.
    <div
      className={styles.iconPicker}
      onBlur={(event) => {
        if (event.relatedTarget instanceof Node && !rootRef.current?.contains(event.relatedTarget))
          setOpen(false);
      }}
      onKeyDown={handleKeyDown}
      ref={rootRef}
    >
      <span className={styles.legend}>{t.projects.iconLabel}</span>
      <button
        aria-controls={panelId}
        aria-expanded={open}
        aria-label={t.projects.iconTriggerAccessibleName(currentLabel)}
        className={styles.iconTrigger}
        onClick={() => setOpen((current) => !current)}
        ref={triggerRef}
        title={currentLabel}
        type="button"
      >
        <CurrentIcon aria-hidden="true" size={16} strokeWidth={1.8} />
        <ChevronDown aria-hidden="true" size={14} strokeWidth={1.8} />
      </button>
      {/* Sempre montado para ter saída animada; fechado, `visibility: hidden` tira do foco e do leitor de tela. */}
      <fieldset
        aria-label={t.projects.iconLabel}
        className={styles.iconPanel}
        data-open={open}
        id={panelId}
      >
        {PROJECT_ICONS.map(({ name, Icon }) => {
          const label = t.projects.iconNames[name] ?? name;
          return (
            <label className={styles.iconOption} key={name} title={label}>
              <input
                aria-label={label}
                checked={value === name}
                className={styles.choiceInput}
                name={groupName}
                onChange={() => onChange(name)}
                onClick={(event) => {
                  // Seta do teclado também gera clique, com detail 0; só o mouse fecha.
                  if (event.detail > 0) closeAndFocusTrigger();
                }}
                type="radio"
                value={name}
              />
              <span className={styles.iconFace}>
                <Icon aria-hidden="true" size={16} strokeWidth={1.8} />
              </span>
            </label>
          );
        })}
      </fieldset>
    </div>
  );
}
