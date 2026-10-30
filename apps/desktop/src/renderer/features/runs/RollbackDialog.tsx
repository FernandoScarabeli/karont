import type { RefObject } from 'react';
import type { UiRollback } from '../../lib/api';

export function RollbackDialog({
  busy,
  onApplyRollback,
  rollback,
  rollbackDialog,
  setRollback,
}: {
  busy: boolean;
  onApplyRollback: () => void;
  rollback: UiRollback;
  rollbackDialog: RefObject<HTMLDialogElement | null>;
  setRollback: React.Dispatch<React.SetStateAction<UiRollback | undefined>>;
}) {
  return (
    <dialog
      ref={rollbackDialog}
      className="rollback-dialog"
      aria-labelledby="rollback-title"
      onCancel={() => {
        if (rollback.approvalId)
          void window.karont.decideApproval(rollback.approvalId, false).catch(() => {});
        setRollback(undefined);
      }}
    >
      <div className="eyebrow">CONFIRMAÇÃO / WORKTREE</div>
      <h3 id="rollback-title">Desfazer alterações desta execução?</h3>
      <p>
        A reversão afeta somente os arquivos desta worktree. Comandos e efeitos externos da CLI não
        são revertidos.
      </p>
      <ul>
        {rollback.files.map((file) => (
          <li key={file.path}>
            <code>{file.path}</code>
            <span>{file.kind}</span>
          </li>
        ))}
      </ul>
      {rollback.filesTruncated && (
        <p className="conflict-note" role="alert">
          A prévia excede o limite atual do protocolo. Revise o diff completo e deixe a lista abaixo
          dentro do limite antes de desfazer.
        </p>
      )}
      {rollback.applied && (
        <p className="rollback-done" role="status">
          Esta execução já foi revertida. O registro permanece no histórico.
        </p>
      )}
      {rollback.conflicts.length > 0 && (
        <p className="conflict-note" role="alert">
          Conflito detectado em: {rollback.conflicts.join(', ')}. Atualize e revise os arquivos
          manualmente.
        </p>
      )}
      {rollback.conflictsTruncated && (
        <p className="conflict-note" role="alert">
          Há conflitos adicionais que excedem a prévia.
        </p>
      )}
      <div className="dialog-actions">
        <button
          className="quiet"
          onClick={() => {
            if (rollback.approvalId)
              void window.karont.decideApproval(rollback.approvalId, false).catch(() => {});
            setRollback(undefined);
          }}
        >
          Voltar
        </button>
        <button
          className="danger"
          disabled={
            !rollback.canRollback || rollback.filesTruncated || rollback.conflictsTruncated || busy
          }
          onClick={() => void onApplyRollback()}
        >
          {busy ? 'Revertendo…' : rollback.applied ? 'Já revertida' : 'Confirmar reversão'}
        </button>
      </div>
    </dialog>
  );
}
