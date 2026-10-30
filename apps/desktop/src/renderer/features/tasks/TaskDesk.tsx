import { useState } from 'react';
import type { UiTaskState } from '../../lib/api';
import { TaskCard } from './TaskCard';
import { TaskCreationDialog } from './TaskCreationDialog';
import { TaskDetailsDialog } from './TaskDetailsDialog';
import { states } from './taskShared';
import { useTaskCatalog } from './useTaskCatalog';
import { useTaskEditor } from './useTaskEditor';
import { useTaskList } from './useTaskList';

export { TaskCreationDialog };
export type { TaskSeed } from './taskShared';

export function TaskDesk(props: { onOpenConversation(chatId: string): void }) {
  const catalog = useTaskCatalog();
  const { workspaces, projects, dots, runs, error, setError, refresh, setRefresh } = catalog;
  const taskList = useTaskList({ projects, refresh, setError });
  const {
    tasks,
    setTasks,
    workspaceId,
    setWorkspaceId,
    projectId,
    setProjectId,
    stateFilter,
    setStateFilter,
    assigneeFilter,
    setAssigneeFilter,
    mode,
    setMode,
    nextCursor,
    loading,
    loadTasks,
    boardProject,
    orderedTasks,
    moveTask,
    projectsForFilter,
  } = taskList;
  const editor = useTaskEditor({ projects, dots, runs, setTasks, setError });
  const {
    selected,
    setSelected,
    events,
    eventMore,
    titleDraft,
    setTitleDraft,
    descriptionDraft,
    setDescriptionDraft,
    stateDraft,
    setStateDraft,
    assigneeKeys,
    setAssigneeKeys,
    runCandidateId,
    setRunCandidateId,
    saving,
    openTask,
    saveTask,
    changeRunLink,
    loadNextEvents,
    assigneeOptions,
    candidates,
  } = editor;
  const [createOpen, setCreateOpen] = useState(false);
  const [createNonce, setCreateNonce] = useState('closed');

  return (
    <section className="task-desk" aria-label="Tarefas Kanban">
      <header className="task-desk-heading">
        <div>
          <div className="eyebrow">KARONT / ORGANIZAÇÃO DO TRABALHO</div>
          <h2>Tarefas</h2>
          <p>
            Tarefas são acompanhamentos explícitos. Atribuir ou mover uma tarefa não inicia uma
            execução.
          </p>
        </div>
        <div className="task-mode-actions">
          <button
            className={mode === 'aggregate' ? 'primary' : 'quiet'}
            aria-pressed={mode === 'aggregate'}
            onClick={() => setMode('aggregate')}
          >
            Visão agregada
          </button>
          <button
            className={mode === 'project' ? 'primary' : 'quiet'}
            aria-pressed={mode === 'project'}
            disabled={!projectId}
            onClick={() => setMode('project')}
          >
            Quadro do projeto
          </button>
          <button
            className="primary"
            onClick={() => {
              setCreateNonce(crypto.randomUUID());
              setCreateOpen(true);
            }}
          >
            Nova tarefa
          </button>
        </div>
      </header>
      <div className="task-filters">
        <label>
          Workspace
          <select
            value={workspaceId}
            onChange={(event) => {
              setWorkspaceId(event.target.value);
              setProjectId('');
              setMode('aggregate');
            }}
          >
            <option value="">Todos</option>
            {workspaces.map((workspace) => (
              <option key={workspace.id} value={workspace.id}>
                {workspace.name}
              </option>
            ))}
          </select>
        </label>
        <label>
          Projeto
          <select value={projectId} onChange={(event) => setProjectId(event.target.value)}>
            <option value="">Todos os projetos</option>
            {projectsForFilter.map((project) => (
              <option key={project.id} value={project.id}>
                {project.name}
              </option>
            ))}
          </select>
        </label>
        <label>
          Estado
          <select
            disabled={mode === 'project'}
            value={stateFilter}
            onChange={(event) => setStateFilter(event.target.value as UiTaskState | '')}
          >
            <option value="">Todos</option>
            {states.map((item) => (
              <option key={item.value} value={item.value}>
                {item.label}
              </option>
            ))}
          </select>
        </label>
        <label>
          Responsável
          <select
            disabled={mode === 'project'}
            value={assigneeFilter}
            onChange={(event) => setAssigneeFilter(event.target.value)}
          >
            <option value="">Todos</option>
            <option value="local:local-user">Você</option>
            {dots.map((dot) => (
              <option key={dot.id} value={`dot:${dot.id}`}>
                {dot.name}
              </option>
            ))}
          </select>
        </label>
      </div>
      {error && (
        <p className="workspace-error" role="alert">
          {error}
        </p>
      )}
      {mode === 'project' && !projectId && (
        <p className="task-empty">Selecione um projeto para abrir o quadro.</p>
      )}
      {mode === 'project' && projectId && (
        <div className="task-board" aria-label={`Quadro do projeto ${boardProject?.name ?? ''}`}>
          {states.map((status) => {
            const column = orderedTasks.filter((task) => task.state === status.value);
            return (
              <section
                className="task-column"
                key={status.value}
                aria-label={`${status.label}, ${column.length} tarefas`}
              >
                <header>
                  <h3>{status.label}</h3>
                  <span>
                    {column.length}
                    {nextCursor ? '+' : ''}
                  </span>
                </header>
                {column.map((task) => (
                  <TaskCard
                    key={task.id}
                    task={task}
                    onOpen={() => void openTask(task.id)}
                    onMove={(state) => void moveTask(task, state)}
                  />
                ))}
                {!column.length && <p className="task-column-empty">Sem tarefas</p>}
              </section>
            );
          })}
        </div>
      )}
      {mode === 'aggregate' && (
        <section className="task-list" aria-label="Lista agregada de tarefas">
          <div className="task-list-heading">
            <strong>
              {tasks.length}
              {nextCursor ? '+' : ''} tarefas carregadas
            </strong>
            {loading && <span>Carregando…</span>}
          </div>
          {tasks.map((task) => (
            <TaskCard
              key={task.id}
              task={task}
              onOpen={() => void openTask(task.id)}
              onMove={(state) => void moveTask(task, state)}
            />
          ))}
          {!loading && !tasks.length && (
            <p className="task-empty">Nenhuma tarefa corresponde aos filtros.</p>
          )}
          {nextCursor && (
            <button
              className="quiet load-more"
              disabled={loading}
              onClick={() => void loadTasks(nextCursor, true)}
            >
              Carregar próxima página
            </button>
          )}
        </section>
      )}
      {mode === 'project' && nextCursor && (
        <button
          className="quiet load-more"
          disabled={loading}
          onClick={() => void loadTasks(nextCursor, true)}
        >
          Carregar próxima página do quadro
        </button>
      )}
      {mode === 'project' && loading && <p aria-live="polite">Carregando tarefas…</p>}

      <TaskCreationDialog
        key={createNonce}
        open={createOpen}
        projects={projects}
        dots={dots}
        fixedProjectId={mode === 'project' ? projectId || undefined : undefined}
        onClose={() => setCreateOpen(false)}
        onCreated={(task) => {
          setCreateOpen(false);
          setProjectId((value) => value || task.projectId);
          setMode('project');
          setRefresh((value) => value + 1);
        }}
      />

      <TaskDetailsDialog
        task={selected}
        onOpenConversation={props.onOpenConversation}
        projects={projects}
        runs={runs}
        title={titleDraft}
        description={descriptionDraft}
        state={stateDraft}
        assigneeKeys={assigneeKeys}
        assigneeOptions={assigneeOptions}
        candidates={candidates}
        runCandidateId={runCandidateId}
        events={events}
        eventMore={eventMore}
        saving={saving}
        error={error}
        onClose={() => setSelected(undefined)}
        onTitle={setTitleDraft}
        onDescription={setDescriptionDraft}
        onState={setStateDraft}
        onAssignees={setAssigneeKeys}
        onRunCandidate={setRunCandidateId}
        onSave={(event) => void saveTask(event)}
        onLinkRun={() => {
          if (runCandidateId) void changeRunLink(runCandidateId, true);
        }}
        onUnlinkRun={(runId) => void changeRunLink(runId, false)}
        onLoadEvents={() => void loadNextEvents()}
      />
    </section>
  );
}
