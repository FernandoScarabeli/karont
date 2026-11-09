import { useServiceStatus } from "../bridge/useServiceStatus.ts";
import { Tooltip } from "../components/Tooltip/Tooltip.tsx";
import { t } from "../i18n/pt-BR.ts";
import styles from "./ServiceStatus.module.css";

export function ServiceStatus() {
  const status = useServiceStatus();

  if (status.state === "connected") {
    // Conectado: só a bolinha. O texto fica no DOM, escondido só para a vista.
    return (
      <div className={styles.status} role="status">
        <Tooltip align="start" label={t.service.connectedTooltip}>
          {/* biome-ignore lint/a11y/noNoninteractiveTabindex: a bolinha recebe foco para mostrar a dica por teclado. */}
          <span className={`${styles.dot} ${styles.dotFocusable} ${styles.connected}`} tabIndex={0}>
            <span className={styles.visuallyHidden}>{t.service.connected}</span>
          </span>
        </Tooltip>
      </div>
    );
  }

  const label =
    status.state === "connecting"
      ? t.service.connecting
      : status.state === "disconnected"
        ? t.service.disconnected
        : t.service.noBridge;

  return (
    <div className={styles.status} role="status">
      <span aria-hidden="true" className={`${styles.dot} ${styles[status.state]}`} />
      <span className={styles.label}>{label}</span>
    </div>
  );
}
