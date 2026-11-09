import { ChartNoAxesColumn } from "lucide-react";
import { useCallback, useId, useRef, useState } from "react";
import { ComposerPopover } from "../components/ComposerPopover/ComposerPopover.tsx";
import { IconButton } from "../components/IconButton/IconButton.tsx";
import { t } from "../i18n/pt-BR.ts";
import styles from "./UsageButton.module.css";
import { UsagePanel } from "./UsagePanel.tsx";

/** Botão do rodapé da sidebar. O painel (e tudo que ele assina) só existe aberto. */
export function UsageButton() {
  const [open, setOpen] = useState(false);
  const anchorRef = useRef<HTMLButtonElement>(null);
  const panelId = useId();
  const close = useCallback(() => setOpen(false), []);

  return (
    <>
      <IconButton
        aria-controls={open ? panelId : undefined}
        aria-expanded={open}
        aria-haspopup="dialog"
        className={styles.trigger}
        icon={<ChartNoAxesColumn aria-hidden="true" size={16} strokeWidth={1.75} />}
        label={t.usage.title}
        onClick={() => setOpen((value) => !value)}
        ref={anchorRef}
        size="sm"
      />
      <ComposerPopover
        anchorRef={anchorRef}
        id={panelId}
        label={t.usage.title}
        onClose={close}
        open={open}
        placement="above"
        role="dialog"
      >
        <UsagePanel />
      </ComposerPopover>
    </>
  );
}
