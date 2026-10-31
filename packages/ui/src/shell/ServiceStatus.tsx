import { useServiceStatus } from "../bridge/useServiceStatus.ts";
import { t } from "../i18n/pt-BR.ts";
import styles from "./ServiceStatus.module.css";

export function ServiceStatus() {
  const status = useServiceStatus();
  const label =
    status.state === "connected"
      ? t.service.connected
      : status.state === "connecting"
        ? t.service.connecting
        : status.state === "disconnected"
          ? t.service.disconnected
          : t.service.noBridge;

  return (
    <div className={styles.status} role="status">
      <span aria-hidden="true" className={`${styles.dot} ${styles[status.state]}`} />
      <span className={styles.label}>{label}</span>
      {status.state === "connected" && status.info ? (
        <span className={styles.version}>
          {t.service.versionPrefix}
          {status.info.serviceVersion}
        </span>
      ) : null}
    </div>
  );
}
