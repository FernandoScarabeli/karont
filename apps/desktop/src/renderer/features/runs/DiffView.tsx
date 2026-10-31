import type { UiDiff } from '../../lib/api';
import { X } from 'lucide-react';

export function DiffView({
  diff,
  onOpenDiff,
  onPreviewRollback,
  onRemoveWorktree,
  onClose,
}: {
  diff: UiDiff;
  onOpenDiff: (run: UiDiff['run']) => void;
  onPreviewRollback: () => void;
  onRemoveWorktree: () => void;
  onClose?: () => void;
}) {
  return (
    <section className="diff-view kc-diff-view" aria-labelledby="diff-title">
      <div className="diff-heading">
        <div>
          <div className="eyebrow">REVISÃO / {diff.run.id.slice(0, 8)}</div>
          <h3 id="diff-title">Alterações desta execução</h3>
          <p>
            {diff.totalFiles} arquivos · {diff.files.reduce((n, file) => n + file.additions, 0)}{' '}
            linhas adicionadas · {diff.files.reduce((n, file) => n + file.deletions, 0)} removidas
          </p>
        </div>
        <div className="diff-tools">
          {onClose && (
            <button
              type="button"
              className="quiet kc-diff-close"
              aria-label="Fechar mudanças"
              title="Fechar mudanças"
              onClick={onClose}
            >
              <X size={14} aria-hidden="true" />
            </button>
          )}
          <button type="button" className="quiet" onClick={() => void onOpenDiff(diff.run)}>
            Atualizar
          </button>
          <button
            type="button"
            className="danger"
            onClick={() => void onPreviewRollback()}
            disabled={!diff.totalFiles}
          >
            Desfazer alterações
          </button>
          {diff.totalFiles === 0 && (
            <button type="button" className="danger-quiet" onClick={() => void onRemoveWorktree()}>
              Remover worktree
            </button>
          )}
        </div>
      </div>
      <ul className="file-list">
        {diff.files.map((file) => (
          <li key={file.path}>
            <span className={`change-kind ${file.kind}`}>
              {file.kind === 'created' ? '+' : file.kind === 'deleted' ? '−' : '~'}
            </span>
            <code>{file.path}</code>
            <small>
              +{file.additions} −{file.deletions}
            </small>
          </li>
        ))}
      </ul>
      {diff.filesTruncated && (
        <p className="diff-limit">
          A lista de arquivos foi limitada pelo tamanho máximo do IPC. Revise o diff abaixo antes de
          continuar.
        </p>
      )}
      {diff.diffTruncated && (
        <p className="diff-limit">O diff atingiu o limite de exibição e foi truncado.</p>
      )}
      {diff.diff ? (
        <pre className="diff-content">{diff.diff}</pre>
      ) : (
        <div className="diff-empty">Esta execução não deixou alterações de arquivo.</div>
      )}
    </section>
  );
}
