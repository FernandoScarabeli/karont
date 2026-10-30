import React, { useEffect, useRef, useState } from 'react';
import type { Checkpoint, Recovery, UiRun } from '../../lib/api';
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
  const [info, setInfo] = useState<Recovery>();
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const [resumeAllowed, setResumeAllowed] = useState(run.autoResumeEnabled);
  useEffect(() => setResumeAllowed(run.autoResumeEnabled), [run.autoResumeEnabled]);
  const dialog = useRef<HTMLDialogElement>(null);
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
  useEffect(() => {
    if (info) dialog.current?.showModal();
  }, [info]);
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
    <div className="continuity-controls" aria-label={`Continuidade ${run.id.slice(0, 8)}`}>
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
            className="quiet"
            disabled={busy}
            onClick={() => void act(async () => refresh(await window.karont.pauseRun(run.id)))}
          >
            Pausar agendamento
          </button>
        )}
        {run.state === 'paused' && (
          <button
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
            className="quiet"
            disabled={busy}
            onClick={() => void act(async () => setInfo(await window.karont.recovery(run.id)))}
          >
            Retomar
          </button>
        )}
        {['queued', 'paused', 'waiting_quota', 'recovery_needed'].includes(run.state) && (
          <button
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
      {info && (
        <dialog
          ref={dialog}
          className="rollback-dialog recovery-dialog"
          aria-labelledby={`recovery-${run.id}`}
          onCancel={() => setInfo(undefined)}
        >
          <div className="eyebrow">CONTINUIDADE / {run.id.slice(0, 8)}</div>
          <h3 id={`recovery-${run.id}`}>Revisar execução interrompida</h3>
          <p>{info.reason ?? 'A execução terminou com erro.'}</p>
          <dl>
            <dt>Último checkpoint</dt>
            <dd>
              {info.lastCheckpoint
                ? `${new Date(info.lastCheckpoint.createdAt).toLocaleString()} · ${info.lastCheckpoint.origin}`
                : 'Indisponível'}
            </dd>
            <dt>Worktree</dt>
            <dd>
              {info.worktreeAvailable
                ? info.worktreeChanged
                  ? 'Modificada após checkpoint'
                  : 'Disponível para inspeção'
                : 'Indisponível'}
            </dd>
            <dt>Sessão</dt>
            <dd>
              {info.survivingProcess
                ? 'Processo sobrevivente ou identidade não verificável. Revise antes de continuar.'
                : 'PTY anterior indisponível. Continuação nativa não validada.'}
            </dd>
            <dt>Operações incertas</dt>
            <dd>
              {info.uncertainOperations.join(', ') ||
                'Nenhuma operação controlada registrada; efeitos internos da CLI são desconhecidos.'}
            </dd>
          </dl>
          <p className="conflict-note">{info.risk}</p>
          {!info.canStartNewSession && (
            <p>
              Não há retomada segura disponível pelo Karont. Preserve e inspecione a worktree e o
              histórico; nenhuma tarefa será reenviada.
            </p>
          )}
          <p>
            A nova sessão abre a CLI na mesma worktree, sem reenviar a tarefa. Revise o trabalho
            antes de digitar novos comandos.
          </p>
          {error && (
            <p className="inline-error" role="alert">
              {error}
            </p>
          )}
          <div className="dialog-actions">
            <button className="quiet" onClick={() => setInfo(undefined)}>
              Voltar
            </button>
            {info.canStartNewSession && (
              <button
                className="danger"
                disabled={busy}
                onClick={() =>
                  void act(async () => {
                    const resumed = await window.karont.resumeRun(
                      run.id,
                      crypto.randomUUID(),
                      true,
                    );
                    setInfo(undefined);
                    refresh(resumed);
                  })
                }
              >
                Confirmar nova sessão
              </button>
            )}
          </div>
        </dialog>
      )}
    </div>
  );
}
