import type { RefObject } from 'react';
import { ChevronRight, Plus } from 'lucide-react';
import { AttentionDot } from '../../components/AttentionDot';
import { LiveMoon } from '../../components/LiveMoon';
import type { UiWorkspace, UiWorkspaceProject } from '../../lib/api';
import { HomeComposer } from './HomeComposer';
import { HomeHeading } from './HomeHeading';
import { ProjectCard } from './ProjectCard';
import { TaskOverviewSection } from './TaskOverviewSection';
import type { useWorkspaceOverview } from './useWorkspaceOverview';

type Props = {
  page: string;
  workspaceName: string;
  workspaceId: string | null;
  workspaces: UiWorkspace[];
  projects: UiWorkspaceProject[];
  overview: ReturnType<typeof useWorkspaceOverview>;
  runningCount: number | null;
  attentionCount: number | null;
  hasStatusError: boolean;
  onOpenAttention: () => void;
  onNewProject: () => void;
  onFocusProject: (projectId: string) => void;
  onOpenTasks: () => void;
  draft: string;
  setDraft: (draft: string) => void;
  draftRef: RefObject<HTMLTextAreaElement | null>;
  newChat: (projectId?: string | null, seed?: string, workspaceId?: string | null) => Promise<void>;
  busy: boolean;
  loading: boolean;
};

function countLabel(count: number | null, singular: string, plural: string) {
  if (count === null) return `— ${plural}`;
  return `${count} ${count === 1 ? singular : plural}`;
}

export function HomeView({
  page,
  workspaceName,
  workspaceId,
  workspaces,
  projects,
  overview,
  runningCount,
  attentionCount,
  hasStatusError,
  onOpenAttention,
  onNewProject,
  onFocusProject,
  onOpenTasks,
  draft,
  setDraft,
  draftRef,
  newChat,
  busy,
  loading,
}: Props) {
  if (page !== 'home') return null;

  if (loading) {
    return (
      <section className="kw-home" aria-live="polite">
        <div className="kw-sheet">
          <h1>Abrindo seu workspace…</h1>
        </div>
      </section>
    );
  }

  return (
    <section className="kw-home">
      <div className="kw-sheet">
        <HomeHeading title={workspaceName || 'Workspace'}>
          <span className="kw-separator" aria-hidden="true">
            ·
          </span>
          {runningCount === 0 ? (
            <span>Nada rodando</span>
          ) : runningCount === null ? (
            <span>— rodando</span>
          ) : (
            <span className="kw-running-count">
              <span className="kw-live-mark" aria-hidden="true" title="Run em andamento">
                <LiveMoon />
              </span>
              {countLabel(runningCount, 'rodando', 'rodando')}
            </span>
          )}
          {attentionCount !== 0 && (
            <>
              <span className="kw-separator" aria-hidden="true">
                ·
              </span>
              <button
                type="button"
                className="kw-attention-action"
                aria-description={
                  attentionCount === null
                    ? 'A contagem de atenção está indisponível. Abre Configurações e ferramentas; este destino é provisório.'
                    : `${countLabel(attentionCount, 'precisa de você', 'precisam de você')}. Abre Configurações e ferramentas; este destino é provisório.`
                }
                onClick={onOpenAttention}
              >
                <span className="kw-attention-mark" aria-hidden="true" title="Precisa de você">
                  <AttentionDot />
                </span>
                {countLabel(attentionCount, 'precisa de você', 'precisam de você')}
                <ChevronRight size={14} aria-hidden="true" />
              </button>
            </>
          )}
        </HomeHeading>

        <HomeComposer
          variant="workspace"
          projects={projects}
          workspaces={workspaces}
          currentWorkspaceId={workspaceId}
          draft={draft}
          setDraft={setDraft}
          draftRef={draftRef}
          newChat={newChat}
          busy={busy}
        />

        <section className="kw-section" aria-label="Projetos">
          <header className="kw-section-heading">
            <h2 id="kw-projects-title">Projetos</h2>
            {projects.length > 0 && (
              <button type="button" className="kw-section-action" onClick={onNewProject}>
                <Plus size={14} aria-hidden="true" />
                <span>Novo projeto</span>
              </button>
            )}
          </header>
          {projects.length > 0 ? (
            <div className="kw-project-grid">
              {projects.map((project) => (
                <ProjectCard
                  key={project.id}
                  project={project}
                  counts={
                    overview.projects[project.id] ?? {
                      conversations: null,
                      lastActivity: null,
                      running: null,
                    }
                  }
                  busy={busy}
                  onNewChat={(projectId) => void newChat(projectId)}
                  onFocusProject={onFocusProject}
                />
              ))}
            </div>
          ) : overview.loading ? (
            <div className="kw-loading-projects" role="status">
              Carregando projetos…
            </div>
          ) : (
            <div className="kw-project-empty">
              <span>Nenhum projeto ainda</span>
              <button type="button" className="kw-empty-new-project" onClick={onNewProject}>
                <Plus size={14} aria-hidden="true" />
                <span>Novo projeto</span>
              </button>
            </div>
          )}
        </section>

        <TaskOverviewSection
          title="Tarefas"
          headingId="kw-tasks-title"
          counts={overview.tasks}
          onOpenTasks={onOpenTasks}
        />

        {(overview.error || hasStatusError) && (
          <p className="kw-overview-error" role="status">
            Algumas contagens não puderam ser carregadas.
          </p>
        )}
      </div>
    </section>
  );
}
