import { useEffect, useMemo, useState } from 'react';
import type { Dispatch, SetStateAction } from 'react';
import type { UiTaskAssignee, UiTaskState, UiTaskSummary, UiWorkspaceProject } from '../../lib/api';

export function useTaskList(options: {
  projects: UiWorkspaceProject[];
  refresh: number;
  setError: Dispatch<SetStateAction<string>>;
}) {
  const { projects, refresh, setError } = options;
  const [tasks, setTasks] = useState<UiTaskSummary[]>([]);
  const [workspaceId, setWorkspaceId] = useState('');
  const [projectId, setProjectId] = useState('');
  const [stateFilter, setStateFilter] = useState<UiTaskState | ''>('');
  const [assigneeFilter, setAssigneeFilter] = useState('');
  const [mode, setMode] = useState<'aggregate' | 'project'>('aggregate');
  const [nextCursor, setNextCursor] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  const selectedAssignee = useMemo(() => {
    if (!assigneeFilter) return undefined;
    const [kind, id] = assigneeFilter.split(':', 2);
    if ((kind !== 'local' && kind !== 'dot') || !id) return undefined;
    return { kind, id } as UiTaskAssignee;
  }, [assigneeFilter]);

  async function loadTasks(cursor?: string, append = false) {
    setLoading(true);
    setError('');
    try {
      const page = await window.karont.tasks({
        ...(workspaceId ? { workspaceId } : {}),
        ...(projectId ? { projectId } : {}),
        ...(mode === 'aggregate' && stateFilter ? { state: stateFilter } : {}),
        ...(mode === 'aggregate' && selectedAssignee ? { assignee: selectedAssignee } : {}),
        ...(cursor ? { cursor } : {}),
        limit: 100,
      });
      setTasks((current) =>
        append
          ? [...current, ...page.items.filter((item) => !current.some((old) => old.id === item.id))]
          : page.items,
      );
      setNextCursor(page.nextCursor);
    } catch {
      setError('Não foi possível carregar as tarefas. Atualize os filtros e tente novamente.');
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    void loadTasks();
  }, [workspaceId, projectId, stateFilter, selectedAssignee, mode, refresh]);

  const boardProject = projects.find((project) => project.id === projectId);
  const visibleTasks =
    mode === 'project' && projectId ? tasks.filter((task) => task.projectId === projectId) : tasks;
  const orderedTasks = [...visibleTasks].sort(
    (a, b) => a.createdAt - b.createdAt || a.id.localeCompare(b.id),
  );

  async function moveTask(task: UiTaskSummary, nextState: UiTaskState) {
    if (task.state === nextState) return;
    setError('');
    try {
      const updated = await window.karont.updateTask({
        taskId: task.id,
        state: nextState,
        expectedRevision: task.revision,
      });
      setTasks((current) =>
        current.map((item) =>
          item.id === task.id
            ? {
                ...item,
                state: updated.state,
                revision: updated.revision,
                updatedAt: updated.updatedAt,
              }
            : item,
        ),
      );
    } catch {
      setError(
        `A tarefa “${task.title}” mudou em outro cliente. O texto local foi preservado; reabra os detalhes para revisar.`,
      );
    }
  }

  const projectsForFilter = projects.filter(
    (project) => !workspaceId || project.workspaceId === workspaceId,
  );

  return {
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
  };
}
