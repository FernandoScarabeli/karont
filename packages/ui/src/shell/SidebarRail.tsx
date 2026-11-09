import { Inbox, ListTodo, Settings, SquarePen } from "lucide-react";
import type { ReactNode } from "react";
import { Tooltip } from "../components/Tooltip/Tooltip.tsx";
import { t } from "../i18n/pt-BR.ts";
import { useUsageData, useUsageLayout } from "../usage/UsageContext.tsx";
import { UsageRing } from "../usage/UsageRing.tsx";
import { useMinuteClock } from "../usage/useMinuteClock.ts";
import styles from "./SidebarRail.module.css";
import { useSidebarShell } from "./SidebarShell.tsx";

type RailButtonProps = {
  label: string;
  icon: ReactNode;
  onClick?: () => void;
  active?: boolean;
  disabled?: boolean;
  description?: string;
  count?: number;
};

function RailButton({
  label,
  icon,
  onClick,
  active,
  disabled,
  description,
  count,
}: RailButtonProps) {
  return (
    <Tooltip label={label} side="end">
      <button
        aria-current={active ? "page" : undefined}
        aria-description={description}
        aria-label={label}
        className={styles.button}
        disabled={disabled}
        onClick={onClick}
        type="button"
      >
        {icon}
        {count && count > 0 ? (
          <span aria-hidden="true" className={styles.count}>
            {count}
          </span>
        ) : null}
      </button>
    </Tooltip>
  );
}

/** Anéis de uso, sempre compactos. Sem dados, não existe (nem espaço). O relógio fica aqui dentro. */
function RailUsage() {
  const { rows } = useUsageData();
  const { setCompact } = useUsageLayout();
  const { collapsed, toggle } = useSidebarShell();
  const now = useMinuteClock();
  if (rows.length === 0) return null;

  const open = () => {
    setCompact(false);
    if (collapsed) toggle();
  };

  return (
    <ul className={styles.rings}>
      {rows.map((row) => (
        <li className={styles.ringItem} key={row.agent}>
          <UsageRing now={now} onClick={open} row={row} tooltipSide="end" />
        </li>
      ))}
    </ul>
  );
}

type SidebarRailProps = {
  collapsed: boolean;
  inboxTotal: number;
  inboxActive: boolean;
  newConversationActive: boolean;
  settingsActive: boolean;
  onNewConversation: () => void;
  onInbox: () => void;
  onSettings: () => void;
};

/** Faixa fina de ícones da barra lateral recolhida; cada botão faz o mesmo que o item da sidebar. */
export function SidebarRail({
  collapsed,
  inboxTotal,
  inboxActive,
  newConversationActive,
  settingsActive,
  onNewConversation,
  onInbox,
  onSettings,
}: SidebarRailProps) {
  return (
    <div className={styles.rail} inert={!collapsed}>
      <div className={styles.group}>
        <RailButton
          active={newConversationActive}
          icon={<SquarePen aria-hidden="true" size={16} strokeWidth={1.75} />}
          label={t.shell.newConversation}
          onClick={onNewConversation}
        />
        <RailButton
          active={inboxActive}
          count={inboxTotal}
          description={inboxTotal > 0 ? t.shell.inboxCount(inboxTotal) : undefined}
          icon={<Inbox aria-hidden="true" size={16} strokeWidth={1.75} />}
          label={t.shell.inbox}
          onClick={onInbox}
        />
        <RailButton
          description={t.shell.availableSoon}
          disabled
          icon={<ListTodo aria-hidden="true" size={16} strokeWidth={1.75} />}
          label={t.shell.tasks}
        />
      </div>
      <div className={styles.bottom}>
        <RailUsage />
        <RailButton
          active={settingsActive}
          icon={<Settings aria-hidden="true" size={16} strokeWidth={1.75} />}
          label={t.shell.settings}
          onClick={onSettings}
        />
      </div>
    </div>
  );
}
