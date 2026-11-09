import type { ResultOf } from "@karont/contract";
import { CircleAlert } from "lucide-react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { getBridge } from "../bridge/index.ts";
import { useServiceStatus } from "../bridge/useServiceStatus.ts";
import { Button } from "../components/Button/Button.tsx";
import { t } from "../i18n/pt-BR.ts";
import styles from "./DiagnosticsSection.module.css";
import { formatStartedAt, foundClis } from "./diagnostics.ts";

type Diagnostics = ResultOf<"system.diagnostics">;

const LOADING_DELAY_MS = 300;

function errorMessage(error: unknown, fallback: string): string {
  return error instanceof Error && error.message ? error.message : fallback;
}

type Row = { label: string; value: string };

function Group({ title, rows }: { title: string; rows: Row[] }) {
  return (
    <section className={styles.group}>
      <h3 className={styles.groupTitle}>{title}</h3>
      <dl className={styles.list}>
        {rows.map((row) => (
          <div className={styles.row} key={row.label}>
            <dt className={styles.term}>{row.label}</dt>
            <dd className={styles.value}>{row.value}</dd>
          </div>
        ))}
      </dl>
    </section>
  );
}

export function DiagnosticsSection() {
  const bridge = useMemo(() => getBridge(), []);
  const service = useServiceStatus();
  const [data, setData] = useState<Diagnostics | null>(null);
  const [error, setError] = useState("");
  const [isLoading, setIsLoading] = useState(Boolean(bridge));
  const [showLoading, setShowLoading] = useState(false);
  const mountedRef = useRef(false);
  const requestRef = useRef(0);

  const load = useCallback(async () => {
    if (!bridge) return;
    const request = ++requestRef.current;
    setIsLoading(true);
    setError("");
    try {
      const result = await bridge.request("system.diagnostics", {});
      if (!mountedRef.current || request !== requestRef.current) return;
      setData(result);
    } catch (caught) {
      if (!mountedRef.current || request !== requestRef.current) return;
      setError(errorMessage(caught, t.settings.diagnosticsLoadFailed));
    } finally {
      if (mountedRef.current && request === requestRef.current) setIsLoading(false);
    }
  }, [bridge]);

  useEffect(() => {
    mountedRef.current = true;
    void load();
    return () => {
      mountedRef.current = false;
    };
  }, [load]);

  // "Carregando…" só aparece se a resposta demorar.
  useEffect(() => {
    if (!isLoading) {
      setShowLoading(false);
      return;
    }
    const timeout = window.setTimeout(() => setShowLoading(true), LOADING_DELAY_MS);
    return () => window.clearTimeout(timeout);
  }, [isLoading]);

  const stateLabel =
    service.state === "connected"
      ? t.service.connected
      : service.state === "connecting"
        ? t.service.connecting
        : service.state === "disconnected"
          ? t.service.disconnected
          : t.service.noBridge;
  const clis = data ? foundClis(data.agents) : [];

  return (
    <section
      aria-labelledby="settings-diagnostics-title"
      className={styles.section}
      id="settings-diagnostics"
    >
      <div className={styles.header}>
        <h2 className={styles.title} id="settings-diagnostics-title">
          {t.settings.diagnostics}
        </h2>
        <Button disabled={!bridge || isLoading} onClick={() => void load()} size="sm">
          {t.settings.diagnosticsRefresh}
        </Button>
      </div>

      {!bridge ? (
        <p className={styles.message} role="status">
          {t.settings.noBridge}
        </p>
      ) : null}

      {showLoading ? (
        <p className={styles.message} role="status">
          {t.settings.diagnosticsLoading}
        </p>
      ) : null}

      {error ? (
        <p className={styles.errorMessage} role="alert">
          <CircleAlert aria-hidden="true" size={16} strokeWidth={1.8} />
          <span>{error}</span>
        </p>
      ) : null}

      {data ? (
        <>
          <section className={styles.group}>
            <h3 className={styles.groupTitle}>{t.settings.diagnosticsService}</h3>
            <dl className={styles.list}>
              <div className={styles.row}>
                <dt className={styles.term}>{t.settings.diagnosticsState}</dt>
                <dd className={`${styles.value} ${styles.state}`}>
                  <span
                    aria-hidden="true"
                    className={`${styles.dot} ${styles[`dot-${service.state}`]}`}
                  />
                  {stateLabel}
                </dd>
              </div>
              {[
                { label: t.settings.diagnosticsVersion, value: data.serviceVersion },
                {
                  label: t.settings.diagnosticsContractVersion,
                  value: String(data.contractVersion),
                },
                { label: t.settings.diagnosticsNode, value: data.nodeVersion },
                { label: t.settings.diagnosticsSystem, value: data.platform },
                { label: t.settings.diagnosticsProcess, value: String(data.pid) },
                { label: t.settings.diagnosticsStartedAt, value: formatStartedAt(data.startedAt) },
              ].map((row) => (
                <div className={styles.row} key={row.label}>
                  <dt className={styles.term}>{row.label}</dt>
                  <dd className={styles.value}>{row.value}</dd>
                </div>
              ))}
            </dl>
          </section>

          <Group
            rows={[
              { label: t.settings.diagnosticsHomeDir, value: data.paths.homeDir },
              { label: t.settings.diagnosticsDataDir, value: data.paths.dataDir },
              { label: t.settings.diagnosticsDbPath, value: data.paths.dbPath },
              { label: t.settings.diagnosticsRuntimeDir, value: data.paths.runtimeDir },
              { label: t.settings.diagnosticsSocketPath, value: data.paths.socketPath },
            ]}
            title={t.settings.diagnosticsPaths}
          />

          <section className={styles.group}>
            <h3 className={styles.groupTitle}>{t.settings.diagnosticsClis}</h3>
            {clis.length === 0 ? (
              <p className={styles.message}>{t.settings.diagnosticsNoClis}</p>
            ) : (
              <dl className={styles.list}>
                {clis.map((cli) => (
                  <div className={styles.row} key={cli.id}>
                    <dt className={styles.term}>{cli.name}</dt>
                    <dd className={styles.value}>{cli.location}</dd>
                  </div>
                ))}
              </dl>
            )}
          </section>
        </>
      ) : null}
    </section>
  );
}
