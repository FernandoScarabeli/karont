import { useEffect, useState } from 'react';
import type { RefObject } from 'react';
import { ArrowUp, ChevronDown, ChevronRight, Folder, Plus } from 'lucide-react';
import { AttentionDot } from '../../components/AttentionDot';
import { LiveMoon } from '../../components/LiveMoon';
import type { UiWorkspaceProject } from '../../lib/api';
import { ProjectCard } from './ProjectCard';
import type { useWorkspaceOverview } from './useWorkspaceOverview';

type Props = {
  page: string;
  workspaceName: string;
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
  newChat: (projectId?: string | null, seed?: string) => Promise<void>;
  busy: boolean;
  loading: boolean;
};

function workspaceDate() {
  const parts = new Intl.DateTimeFormat('pt-BR', {
    weekday: 'long',
    day: 'numeric',
    month: 'long',
  }).formatToParts(new Date());
  const weekday = (parts.find((part) => part.type === 'weekday')?.value ?? '').replace(
    /-feira$/,
    '',
  );
  const day = parts.find((part) => part.type === 'day')?.value;
  const month = parts.find((part) => part.type === 'month')?.value;
  const capitalized = weekday ? `${weekday[0].toLocaleUpperCase('pt-BR')}${weekday.slice(1)}` : '';
  return `${capitalized}, ${day} de ${month}`;
}

function countLabel(count: number | null, singular: string, plural: string) {
  if (count === null) return `— ${plural}`;
  return `${count} ${count === 1 ? singular : plural}`;
}

function taskCount(count: number | null) {
  return count === null ? '—' : count;
}

export function HomeView({
  page,
  workspaceName,
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
  const [selectedProjectId, setSelectedProjectId] = useState('');
  const projectId =
    projects.find((project) => project.id === selectedProjectId && project.available)?.id ?? null;
  const byteLength = new TextEncoder().encode(draft).byteLength;
  const tooLong = byteLength > 8000;

  useEffect(() => {
    if (
      selectedProjectId &&
      !projects.some((project) => project.id === selectedProjectId && project.available)
    )
      setSelectedProjectId('');
  }, [projects, selectedProjectId]);

  if (page !== 'home') return null;

  function openDraft() {
    if (draft.trim()) void newChat(projectId, draft);
  }

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
        <header className="kw-workspace-heading">
          <h1>{workspaceName || 'Workspace'}</h1>
          <div className="kw-workspace-summary">
            <time dateTime={new Date().toISOString()}>{workspaceDate()}</time>
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
          </div>
        </header>

        <form
          className={`kw-composer ${draft ? 'has-draft' : ''}`}
          onSubmit={(event) => {
            event.preventDefault();
            openDraft();
          }}
        >
          <textarea
            ref={draftRef}
            aria-label="Nova ideia"
            placeholder="Vamos começar uma nova ideia?"
            value={draft}
            maxLength={8000}
            aria-invalid={tooLong}
            aria-describedby="kw-home-draft-limit"
            onChange={(event) => setDraft(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === 'Enter' && !event.shiftKey && !event.nativeEvent.isComposing) {
                event.preventDefault();
                openDraft();
              }
            }}
          />
          <div className="kw-composer-actions">
            <div className="kw-composer-left">
              <button
                type="button"
                className="kw-add-context"
                title="Anexos ainda não disponíveis neste adaptador"
                aria-label="Adicionar contexto — em breve"
                disabled
              >
                <Plus size={16} aria-hidden="true" />
              </button>
              <label className="kw-project-select">
                <Folder size={14} aria-hidden="true" />
                <select
                  aria-label="Projeto da nova conversa"
                  value={projectId ?? ''}
                  onChange={(event) => setSelectedProjectId(event.target.value)}
                >
                  <option value="">Sem projeto</option>
                  {projects.map((project) => (
                    <option key={project.id} value={project.id} disabled={!project.available}>
                      {project.name}
                      {project.available ? '' : ' (pasta indisponível)'}
                    </option>
                  ))}
                </select>
                <ChevronDown size={14} aria-hidden="true" />
              </label>
            </div>
            <div className="kw-composer-right">
              <span className="kw-send-hint">
                <kbd>Enter</kbd>
                <span>para enviar</span>
              </span>
              <button
                type="submit"
                className="kw-send"
                title="Abrir conversa com este rascunho"
                aria-label="Abrir conversa com este rascunho"
                disabled={!draft.trim() || busy || tooLong}
              >
                <ArrowUp size={16} aria-hidden="true" />
              </button>
            </div>
          </div>
          <span
            id="kw-home-draft-limit"
            className={tooLong ? 'kw-form-error' : 'kw-sr-only'}
            role="status"
          >
            {tooLong
              ? 'Limite de 8.000 bytes excedido. Reduza o texto para continuar.'
              : 'Limite de 8.000 bytes.'}
          </span>
        </form>

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

        <section className="kw-section" aria-labelledby="kw-tasks-title">
          <header className="kw-section-heading">
            <h2 id="kw-tasks-title">Tarefas</h2>
            <button type="button" className="kw-section-action" onClick={onOpenTasks}>
              <span>Abrir quadro</span>
            </button>
          </header>
          <div className="kw-task-counts">
            <div className="kw-task-count">
              <span>A fazer</span>
              <strong>{taskCount(overview.tasks.todo)}</strong>
            </div>
            <div className="kw-task-count">
              <span>Em andamento</span>
              <strong>{taskCount(overview.tasks.in_progress)}</strong>
            </div>
            <div className="kw-task-count">
              <span>Revisão</span>
              <strong>{taskCount(overview.tasks.review)}</strong>
            </div>
            <div className="kw-task-count">
              <span>Feito</span>
              <strong>{taskCount(overview.tasks.done)}</strong>
            </div>
          </div>
        </section>

        {(overview.error || hasStatusError) && (
          <p className="kw-overview-error" role="status">
            Algumas contagens não puderam ser carregadas.
          </p>
        )}
      </div>
    </section>
  );
}
