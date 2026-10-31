import { useMemo } from 'react';
import type { RefObject } from 'react';
import { Plus } from 'lucide-react';
import { LiveMoon } from '../../components/LiveMoon';
import type { UiDot, UiWorkspace, UiWorkspaceProject } from '../../lib/api';
import { AttentionList } from './AttentionList';
import { HomeComposer } from './HomeComposer';
import { HomeHeading } from './HomeHeading';
import { TaskOverviewSection } from './TaskOverviewSection';
import { WorkspaceCard } from './WorkspaceCard';
import type { useAllWorkspacesOverview } from './useAllWorkspacesOverview';
import type { useWorkspaceStatus } from './useWorkspaceStatus';

type Props = {
  page: string;
  workspaces: UiWorkspace[];
  projects: UiWorkspaceProject[];
  currentWorkspaceId: string | null;
  status: ReturnType<typeof useWorkspaceStatus>;
  overview: ReturnType<typeof useAllWorkspacesOverview>;
  draft: string;
  setDraft: (value: string) => void;
  draftRef: RefObject<HTMLTextAreaElement | null>;
  newChat: (projectId?: string | null, seed?: string, workspaceId?: string | null) => Promise<void>;
  busy: boolean;
  loading: boolean;
  dots: UiDot[];
  onCreateWorkspace: () => void;
  onOpenWorkspace: (workspaceId: string) => void;
  onOpenChat: (chatId: string) => void;
  onOpenTasks: () => void;
  onOpenSettings: () => void;
};

export function HomeAllView({
  page,
  workspaces,
  projects,
  currentWorkspaceId,
  status,
  overview,
  draft,
  setDraft,
  draftRef,
  newChat,
  busy,
  loading,
  dots,
  onCreateWorkspace,
  onOpenWorkspace,
  onOpenChat,
  onOpenTasks,
  onOpenSettings,
}: Props) {
  const runningCount = useMemo(
    () =>
      status.ready && !status.error
        ? Object.values(status.workspaceStatus).reduce((total, item) => total + item.running, 0)
        : null,
    [status.error, status.ready, status.workspaceStatus],
  );

  if (page !== 'start') return null;

  return (
    <section className="kw-home" aria-label="Início">
      <div className="kw-sheet">
        <HomeHeading title="Início">
          <span className="kw-separator" aria-hidden="true">
            ·
          </span>
          <span>
            {workspaces.length} {workspaces.length === 1 ? 'workspace' : 'workspaces'}
          </span>
          <span className="kw-separator" aria-hidden="true">
            ·
          </span>
          {runningCount === null ? (
            <span>— rodando</span>
          ) : runningCount === 0 ? (
            <span>Nada rodando</span>
          ) : (
            <span className="kw-running-count">
              <span className="kw-live-mark" aria-hidden="true" title="Run em andamento">
                <LiveMoon />
              </span>
              {runningCount} rodando
            </span>
          )}
        </HomeHeading>

        <HomeComposer
          variant="all"
          projects={projects}
          workspaces={workspaces}
          currentWorkspaceId={currentWorkspaceId}
          draft={draft}
          setDraft={setDraft}
          draftRef={draftRef}
          newChat={newChat}
          busy={busy || loading}
        />

        <AttentionList
          approvals={status.approvals ?? []}
          runs={status.runs ?? []}
          dots={dots}
          projects={projects}
          workspaces={workspaces}
          chatTitles={overview.chatTitles}
          onOpenChat={onOpenChat}
          onOpenSettings={onOpenSettings}
          reloadStatus={status.reload}
        />

        <section className="kw-section" aria-labelledby="kw-workspaces-title">
          <header className="kw-section-heading">
            <h2 id="kw-workspaces-title">Workspaces</h2>
            <button
              type="button"
              className="kw-section-action"
              aria-label="Novo workspace"
              onClick={onCreateWorkspace}
            >
              <Plus size={14} aria-hidden="true" />
              <span>Novo workspace</span>
            </button>
          </header>
          {workspaces.length ? (
            <div className="kw-project-grid kw-workspace-grid">
              {workspaces.map((workspace) => {
                const counts = overview.workspaces[workspace.id];
                const workspaceStatus = status.workspaceStatus[workspace.id];
                return (
                  <WorkspaceCard
                    key={workspace.id}
                    workspace={workspace}
                    projectCount={overview.projectCounts[workspace.id] ?? 0}
                    conversations={counts?.conversations ?? null}
                    lastActivity={counts?.lastActivity ?? null}
                    running={status.ready && !status.error ? (workspaceStatus?.running ?? 0) : null}
                    attention={
                      status.ready && !status.error ? (workspaceStatus?.attention ?? 0) : null
                    }
                    statusError={!status.ready || Boolean(status.error)}
                    onOpen={() => onOpenWorkspace(workspace.id)}
                  />
                );
              })}
            </div>
          ) : loading ? (
            <div className="kw-loading-projects" role="status">
              Carregando workspaces…
            </div>
          ) : (
            <div className="kw-project-empty">
              <span>Nenhum workspace ainda</span>
              <button type="button" className="kw-empty-new-project" onClick={onCreateWorkspace}>
                <Plus size={14} aria-hidden="true" />
                <span>Novo workspace</span>
              </button>
            </div>
          )}
        </section>

        <TaskOverviewSection
          title="Tarefas de todos os workspaces"
          headingId="kw-all-tasks-title"
          counts={overview.tasks}
          onOpenTasks={onOpenTasks}
        />

        {Boolean(overview.error || status.error) && (
          <p className="kw-overview-error" role="status">
            Algumas contagens ou estados não puderam ser carregados.
          </p>
        )}
      </div>
    </section>
  );
}
