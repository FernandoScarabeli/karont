import { Inbox, ListTodo, PanelLeftOpen, Settings, SquarePen } from "lucide-react";
import type { ReactNode, Ref } from "react";
import { Tooltip } from "../components/Tooltip/Tooltip.tsx";
import { t } from "../i18n/pt-BR.ts";
import styles from "./SidebarRail.module.css";

type RailButtonProps = {
  label: string;
  icon: ReactNode;
  onClick?: () => void;
  active?: boolean;
  disabled?: boolean;
  description?: string;
  count?: number;
  buttonRef?: Ref<HTMLButtonElement>;
};

function RailButton({
  label,
  icon,
  onClick,
  active,
  disabled,
  description,
  count,
  buttonRef,
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
        ref={buttonRef}
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

type SidebarRailProps = {
  collapsed: boolean;
  inboxTotal: number;
  inboxActive: boolean;
  newConversationActive: boolean;
  settingsActive: boolean;
  onExpand: () => void;
  onNewConversation: () => void;
  onInbox: () => void;
  onSettings: () => void;
  openButtonRef: Ref<HTMLButtonElement>;
};

/** Faixa fina de ícones da barra lateral recolhida; cada botão faz o mesmo que o item da sidebar. */
export function SidebarRail({
  collapsed,
  inboxTotal,
  inboxActive,
  newConversationActive,
  settingsActive,
  onExpand,
  onNewConversation,
  onInbox,
  onSettings,
  openButtonRef,
}: SidebarRailProps) {
  return (
    <div className={styles.rail} inert={!collapsed}>
      <div className={styles.group}>
        <RailButton
          buttonRef={openButtonRef}
          icon={<PanelLeftOpen aria-hidden="true" size={16} strokeWidth={1.75} />}
          label={t.shell.sidebarOpen}
          onClick={onExpand}
        />
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
      <RailButton
        active={settingsActive}
        icon={<Settings aria-hidden="true" size={16} strokeWidth={1.75} />}
        label={t.shell.settings}
        onClick={onSettings}
      />
    </div>
  );
}
