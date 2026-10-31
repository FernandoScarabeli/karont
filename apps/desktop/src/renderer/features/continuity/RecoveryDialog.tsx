import { useEffect, useRef, useState } from 'react';
import type { Recovery, UiRun } from '../../lib/api';

export function RecoveryDialog({
  run,
  onClose,
  onResumed,
}: {
  run?: UiRun;
  onClose: () => void;
  onResumed: (run: UiRun) => void;
}) {
  const [info, setInfo] = useState<Recovery>();
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const dialog = useRef<HTMLDialogElement>(null);
  const runId = run?.id;

  useEffect(() => {
    let active = true;
    setInfo(undefined);
    setError('');
    if (!runId) {
      dialog.current?.close();
      return () => {
        active = false;
      };
    }
    setBusy(true);
    void window.karont
      .recovery(runId)
      .then((recovery) => {
        if (active) setInfo(recovery);
      })
      .catch(() => {
        if (active) setError('Não foi possível carregar a recuperação da Run.');
      })
      .finally(() => {
        if (active) setBusy(false);
      });
    return () => {
      active = false;
    };
  }, [runId]);

  useEffect(() => {
    if (run && (info || error)) dialog.current?.showModal();
  }, [error, info, runId]);

  async function resume() {
    if (!run || busy) return;
    setBusy(true);
    setError('');
    try {
      const resumed = await window.karont.resumeRun(run.id, crypto.randomUUID(), true);
      dialog.current?.close();
      onClose();
      onResumed(resumed);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Não foi possível retomar a Run.');
    } finally {
      setBusy(false);
    }
  }

  if (!run) return null;
  return (
    <dialog
      ref={dialog}
      className="rollback-dialog recovery-dialog"
      aria-labelledby={`recovery-${run.id}`}
      onCancel={(event) => {
        event.preventDefault();
        onClose();
      }}
    >
      <div className="eyebrow">CONTINUIDADE / {run.id.slice(0, 8)}</div>
      <h3 id={`recovery-${run.id}`}>Revisar execução interrompida</h3>
      {busy && !info ? (
        <p role="status">Carregando recuperação…</p>
      ) : info ? (
        <>
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
        </>
      ) : null}
      {error && (
        <p className="inline-error" role="alert">
          {error}
        </p>
      )}
      <div className="dialog-actions">
        <button type="button" className="quiet" onClick={onClose}>
          Voltar
        </button>
        {info?.canStartNewSession && (
          <button type="button" className="danger" disabled={busy} onClick={() => void resume()}>
            Confirmar nova sessão
          </button>
        )}
      </div>
    </dialog>
  );
}
