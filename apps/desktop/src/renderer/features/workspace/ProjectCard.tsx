import { AlertTriangle, Folder, SquarePen } from 'lucide-react';
import { LiveMoon } from '../../components/LiveMoon';
import type { UiWorkspaceProject } from '../../lib/api';
import type { useWorkspaceOverview } from './useWorkspaceOverview';
import { projectIcons } from './workspaceShared';

type ProjectCounts = ReturnType<typeof useWorkspaceOverview>['projects'][string];

type Props = {
  project: UiWorkspaceProject;
  counts: ProjectCounts;
  busy: boolean;
  onNewChat: (projectId: string) => void;
  onFocusProject: (projectId: string) => void;
};

function formatRoot(root: string) {
  return root.replace(/^\/home\/[^/]+(?=\/|$)/, '~');
}

function activityLabel(updatedAt: number) {
  const elapsed = Math.max(0, Date.now() - updatedAt);
  const minutes = Math.floor(elapsed / 60000);
  if (minutes < 1) return 'agora';
  if (minutes < 60) return `${minutes} min`;
  const hours = Math.floor(elapsed / 3600000);
  if (hours < 24) return `${hours} h`;
  if (hours < 48) return 'ontem';
  const days = Math.floor(elapsed / 86400000);
  if (days < 7) return `${days} dias`;
  return new Intl.DateTimeFormat('pt-BR', { day: 'numeric', month: 'short' })
    .format(new Date(updatedAt))
    .replace(' de ', ' ');
}

function conversationLabel(count: number | null) {
  if (count === null) return '— conversas';
  return `${count} ${count === 1 ? 'conversa' : 'conversas'}`;
}

export function ProjectCard({ project, counts, busy, onNewChat, onFocusProject }: Props) {
  const ProjectIcon = projectIcons[project.icon] ?? Folder;
  const activity =
    counts.conversations === 0
      ? undefined
      : counts.lastActivity === null
        ? counts.conversations === null
          ? '—'
          : undefined
        : activityLabel(counts.lastActivity);
  const disabledReason = 'A pasta deste projeto está indisponível.';

  return (
    <article className="kw-project-card">
      <header className="kw-project-top">
        <button
          type="button"
          className="kw-project-name"
          aria-label={project.name}
          aria-description="Expandir este projeto na sidebar"
          title={`Expandir ${project.name} na sidebar`}
          onClick={() => onFocusProject(project.id)}
        >
          <ProjectIcon size={16} aria-hidden="true" />
          <span>{project.name}</span>
        </button>
        {activity &&
          (counts.lastActivity === null ? (
            <span className="kw-project-activity">{activity}</span>
          ) : (
            <time
              className="kw-project-activity"
              dateTime={new Date(counts.lastActivity).toISOString()}
              title={new Intl.DateTimeFormat('pt-BR', {
                dateStyle: 'long',
                timeStyle: 'short',
              }).format(new Date(counts.lastActivity))}
            >
              {activity}
            </time>
          ))}
      </header>

      <p className="kw-project-root" title={project.root} dir="rtl">
        {formatRoot(project.root)}
      </p>

      <footer className="kw-project-footer">
        {project.available ? (
          <div className="kw-project-stats">
            <span>{conversationLabel(counts.conversations)}</span>
            {counts.running !== 0 && (
              <>
                <span className="kw-separator" aria-hidden="true">
                  ·
                </span>
                {counts.running === null ? (
                  <span>— rodando</span>
                ) : (
                  <span className="kw-running-count">
                    <span className="kw-live-mark" aria-hidden="true" title="Run em andamento">
                      <LiveMoon />
                    </span>
                    {counts.running} rodando
                  </span>
                )}
              </>
            )}
          </div>
        ) : (
          <div className="kw-project-unavailable">
            <AlertTriangle size={14} aria-hidden="true" />
            <span>Pasta indisponível</span>
          </div>
        )}
        <button
          type="button"
          className="kw-project-new-chat"
          aria-label={`Nova conversa no projeto ${project.name}`}
          title={project.available ? 'Abrir uma nova conversa neste projeto' : disabledReason}
          disabled={!project.available || busy}
          onClick={() => onNewChat(project.id)}
        >
          <SquarePen size={14} aria-hidden="true" />
          <span>Nova conversa</span>
        </button>
      </footer>
    </article>
  );
}
