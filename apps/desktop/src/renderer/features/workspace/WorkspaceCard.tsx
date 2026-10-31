import { ArrowRight, Layers } from 'lucide-react';
import { AttentionDot } from '../../components/AttentionDot';
import { LiveMoon } from '../../components/LiveMoon';
import type { UiWorkspace } from '../../lib/api';
import { formatActivityLabel } from './workspaceShared';

export function WorkspaceCard({
  workspace,
  projectCount,
  conversations,
  lastActivity,
  running,
  attention,
  statusError,
  onOpen,
}: {
  workspace: UiWorkspace;
  projectCount: number;
  conversations: number | null;
  lastActivity: number | null;
  running: number | null;
  attention: number | null;
  statusError: boolean;
  onOpen: () => void;
}) {
  const activity = lastActivity === null ? '—' : formatActivityLabel(lastActivity);
  const conversationLabel =
    conversations === null
      ? '— conversas'
      : `${conversations} ${conversations === 1 ? 'conversa' : 'conversas'}`;

  return (
    <article className="kw-project-card kw-workspace-card">
      <header className="kw-project-top">
        <div className="kw-workspace-name">
          <Layers size={16} aria-hidden="true" />
          <span>{workspace.name}</span>
        </div>
        <span className="kw-workspace-activity" title="Última atividade">
          {activity}
        </span>
      </header>
      <p className="kw-workspace-counts">
        {projectCount} {projectCount === 1 ? 'projeto' : 'projetos'} · {conversationLabel}
      </p>
      <footer className="kw-project-footer kw-workspace-footer">
        <div className="kw-workspace-status" aria-live="polite">
          {statusError || running === null || attention === null ? (
            <span>—</span>
          ) : running > 0 ? (
            <span className="kw-workspace-status-item">
              <span aria-hidden="true" title="Run em andamento">
                <LiveMoon />
              </span>
              {running} rodando
            </span>
          ) : attention > 0 ? (
            <span className="kw-workspace-status-item">
              <span aria-hidden="true" title="Precisa de você">
                <AttentionDot />
              </span>
              {attention} {attention === 1 ? 'precisa de você' : 'precisam de você'}
            </span>
          ) : (
            <span className="kw-workspace-status-empty">Nada rodando</span>
          )}
        </div>
        <button
          type="button"
          className="kw-workspace-open"
          aria-label={`Abrir ${workspace.name}`}
          onClick={onOpen}
        >
          <span>Abrir</span>
          <ArrowRight size={14} aria-hidden="true" />
        </button>
      </footer>
    </article>
  );
}
