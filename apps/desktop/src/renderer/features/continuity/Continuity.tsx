import { useEffect, useState } from 'react';
import type { Checkpoint, UiRun } from '../../lib/api';
import { RecoveryDialog } from './RecoveryDialog';
const labels: Record<UiRun['state'], string> = {
  queued: 'Na fila',
  running: 'Em execução',
  paused: 'Agendamento pausado',
  waiting_quota: 'Aguardando limite',
  waiting_approval: 'Aguardando aprovação',
  recovery_needed: 'Recuperação necessária',
  completed: 'Concluída',
  failed: 'Falhou',
  cancelled: 'Cancelada',
};
export function ContinuityControls({
  run,
  refresh,
}: {
  run: UiRun;
  refresh: (run: UiRun) => void;
}) {
  const [latest, setLatest] = useState<Checkpoint>();
  const [recoveryRun, setRecoveryRun] = useState<UiRun>();
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const [resumeAllowed, setResumeAllowed] = useState(run.autoResumeEnabled);
  useEffect(() => setResumeAllowed(run.autoResumeEnabled), [run.autoResumeEnabled]);
  useEffect(() => {
    let current = true;
    void window.karont
      .checkpoints(run.id)
      .then((items) => {
        if (current) setLatest(items[0]);
      })
      .catch(() => {});
    return () => {
      current = false;
    };
  }, [run.id, run.state]);
  const act = async (fn: () => Promise<void>) => {
    if (busy) return;
    setBusy(true);
    setError('');
    try {
      await fn();
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Não foi possível concluir');
    } finally {
      setBusy(false);
    }
  };
  return (
    <div
      className="continuity-controls"
      role="group"
      aria-label={`Continuidade ${run.id.slice(0, 8)}`}
    >
      <div className="continuity-summary">
        <strong>{labels[run.state]}</strong>
        <span>
          Último checkpoint:{' '}
          {latest
            ? `${new Date(latest.createdAt).toLocaleString()} · ${labels[latest.state]} · ${latest.origin === 'manual' ? 'manual' : 'automático'}`
            : 'indisponível'}
        </span>
      </div>
      <div className="continuity-actions">
        <button
          type="button"
          className="quiet"
          disabled={busy}
          onClick={() =>
            void act(async () => {
              const items = await window.karont.checkpoint(run.id, crypto.randomUUID());
              setLatest(items[0]);
            })
          }
        >
          Criar checkpoint
        </button>
        {run.state === 'queued' && (
          <button
            type="button"
            className="quiet"
            disabled={busy}
            onClick={() => void act(async () => refresh(await window.karont.pauseRun(run.id)))}
          >
            Pausar agendamento
          </button>
        )}
        {run.state === 'paused' && (
          <button
            type="button"
            className="quiet"
            disabled={busy}
            onClick={() =>
              void act(async () =>
                refresh(await window.karont.resumeRun(run.id, crypto.randomUUID())),
              )
            }
          >
            Retomar agendamento
          </button>
        )}
        {['recovery_needed', 'failed'].includes(run.state) && (
          <button
            type="button"
            className="quiet"
            disabled={busy}
            onClick={() => setRecoveryRun(run)}
          >
            Retomar
          </button>
        )}
        {['queued', 'paused', 'waiting_quota', 'recovery_needed'].includes(run.state) && (
          <button
            type="button"
            className="danger-quiet"
            disabled={busy}
            onClick={() => void act(async () => refresh(await window.karont.cancelRun(run.id)))}
          >
            Cancelar
          </button>
        )}
        <small>Auto Resume indisponível · cota/reset não verificáveis</small>
        <label>
          <input
            type="checkbox"
            checked={!resumeAllowed}
            disabled={busy}
            onChange={(event) => {
              const enabled = !event.target.checked;
              setResumeAllowed(enabled);
              void act(async () => {
                try {
                  await window.karont.autoResume(run.id, enabled);
                  const current = (await window.karont.runs(100)).find(
                    (item) => item.id === run.id,
                  );
                  if (current) refresh(current);
                } catch (error) {
                  setResumeAllowed(run.autoResumeEnabled);
                  throw error;
                }
              });
            }}
          />{' '}
          Impedir retomada automática nesta Run
        </label>
      </div>
      {error && (
        <p className="inline-error" role="alert">
          {error}
        </p>
      )}
      <RecoveryDialog
        run={recoveryRun}
        onClose={() => setRecoveryRun(undefined)}
        onResumed={refresh}
      />
    </div>
  );
}
