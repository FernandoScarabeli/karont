import { Columns2, X } from "lucide-react";
import { useRef } from "react";
import { FluidHoverHighlight, useFluidHover } from "../components/FluidHover/FluidHover.tsx";
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
  const toolbarRef = useRef<HTMLFieldSetElement>(null);
  const toolbarHover = useFluidHover(toolbarRef, {
    axis: "x",
    isItemDisabled: (element) => element.matches(":disabled"),
  });

  return (
    <fieldset
      aria-description={t.workspace.panelShortcuts}
      className={styles.toolbar}
      ref={toolbarHover.containerRef}
      title={t.workspace.panelShortcuts}
    >
      <legend className={styles.visuallyHidden}>{t.workspace.panelActions}</legend>
      <FluidHoverHighlight controller={toolbarHover} />
      <IconButton
        disabled={!canSplit}
        icon={<Columns2 aria-hidden="true" size={16} strokeWidth={1.75} />}
        label={t.workspace.split}
        onClick={() => onSplit("row")}
        ref={(element) => {
          toolbarHover.registerItem("split", element);
        }}
        size="sm"
      />

      <IconButton
        icon={<X aria-hidden="true" size={16} strokeWidth={1.75} />}
        label={t.workspace.closePane(paneTitle)}
        onClick={onClosePane}
        ref={(element) => {
          toolbarHover.registerItem("close", element);
        }}
        size="sm"
      />
    </fieldset>
  );
}
