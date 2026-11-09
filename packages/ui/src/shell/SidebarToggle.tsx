import { PanelLeftClose, PanelLeftOpen } from "lucide-react";
import { Tooltip } from "../components/Tooltip/Tooltip.tsx";
import { t } from "../i18n/pt-BR.ts";
import { useSidebarShell } from "./SidebarShell.tsx";
import styles from "./SidebarToggle.module.css";

/** Abre e fecha a barra lateral. É o mesmo botão nos dois estados, então o foco nunca se perde. */
export function SidebarToggle() {
  const { collapsed, toggle } = useSidebarShell();
  const label = collapsed ? t.shell.sidebarOpen : t.shell.sidebarClose;
  const Icon = collapsed ? PanelLeftOpen : PanelLeftClose;
  return (
    <Tooltip align={collapsed ? "start" : "end"} label={label} side="bottom">
      <button
        aria-label={label}
        className={styles.button}
        data-collapsed={collapsed}
        onClick={toggle}
        type="button"
      >
        <Icon aria-hidden="true" size={16} strokeWidth={1.75} />
      </button>
    </Tooltip>
  );
}
