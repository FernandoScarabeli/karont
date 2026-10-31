import { useEffect, useState } from 'react';
import type { UiRun, UiTaskState, UiWorkspaceProject } from '../../lib/api';
import { allPages, overviewRequest } from './workspaceShared';

const taskStates: UiTaskState[] = ['todo', 'in_progress', 'review', 'done'];

type ProjectCounts = {
  conversations: number | null;
  lastActivity: number | null;
  running: number | null;
};

type OverviewState = {
  projects: Record<string, Omit<ProjectCounts, 'running'>>;
  tasks: Record<UiTaskState, number | null>;
  loading: boolean;
  error?: unknown;
};

function emptyTasks(): Record<UiTaskState, number | null> {
  return { todo: null, in_progress: null, review: null, done: null };
}

export function useWorkspaceOverview(
  workspaceId: string | null,
  projects: UiWorkspaceProject[],
  runs: UiRun[] | undefined,
  refresh: number,
  enabled: boolean,
) {
  const [state, setState] = useState<OverviewState>({
    projects: {},
    tasks: emptyTasks(),
    loading: true,
  });

  useEffect(() => {
    let active = true;
    // Só carrega com a tela do workspace visível: com um chat aberto, cada rascunho salvo
    // dispara chat.updated e recarregar tudo sobrecarrega a conexão com o daemon.
    if (!enabled) {
      return () => {
        active = false;
      };
    }
    if (!workspaceId) {
      setState({ projects: {}, tasks: emptyTasks(), loading: false });
      return () => {
        active = false;
      };
    }

    setState({
      projects: Object.fromEntries(
        projects.map((project) => [project.id, { conversations: null, lastActivity: null }]),
      ),
      tasks: emptyTasks(),
      loading: true,
    });

    // Uma requisição por vez: respostas grandes em paralelo enchem o buffer do socket e o
    // daemon derruba a conexão (limite de 64 KiB em wire.ts). Agrupa recargas seguidas.
    const jobs: (() => Promise<
      | { type: 'project'; projectId: string; conversations: number; lastActivity: number | null }
      | { type: 'project'; projectId: string; error: unknown }
      | { type: 'task'; taskState: UiTaskState; count: number }
      | { type: 'task'; taskState: UiTaskState; error: unknown }
    >)[] = [
      ...projects.map((project) => async () => {
        try {
          const chats = await allPages(
            (cursor) =>
              overviewRequest(
                () => window.karont.chats({ projectId: project.id, limit: 100, cursor }),
                () => active,
              ),
            () => active,
          );
          return {
            type: 'project' as const,
            projectId: project.id,
            conversations: chats.length,
            lastActivity: chats.reduce<number | null>(
              (latest, chat) =>
                latest === null || chat.updatedAt > latest ? chat.updatedAt : latest,
              null,
            ),
          };
        } catch (error) {
          return { type: 'project' as const, projectId: project.id, error };
        }
      }),
      ...taskStates.map((taskState) => async () => {
        try {
          const tasks = await allPages(
            (cursor) =>
              overviewRequest(
                () => window.karont.tasks({ workspaceId, state: taskState, limit: 100, cursor }),
                () => active,
              ),
            () => active,
          );
          return { type: 'task' as const, taskState, count: tasks.length };
        } catch (error) {
          return { type: 'task' as const, taskState, error };
        }
      }),
    ];
    const timer = setTimeout(async () => {
      const results = [];
      for (const job of jobs) {
        if (!active) return;
        results.push(await job());
      }
      if (!active) return;
      const nextProjects: OverviewState['projects'] = {};
      const nextTasks = emptyTasks();
      const errors: unknown[] = [];
      for (const result of results) {
        if (result.type === 'project') {
          if ('error' in result) {
            nextProjects[result.projectId] = { conversations: null, lastActivity: null };
            errors.push(result.error);
          } else {
            nextProjects[result.projectId] = {
              conversations: result.conversations,
              lastActivity: result.lastActivity,
            };
          }
        } else if ('error' in result) {
          nextTasks[result.taskState] = null;
          errors.push(result.error);
        } else {
          nextTasks[result.taskState] = result.count;
        }
      }
      setState({
        projects: nextProjects,
        tasks: nextTasks,
        loading: false,
        error: errors[0],
      });
    }, 250);

    return () => {
      active = false;
      clearTimeout(timer);
    };
  }, [workspaceId, projects, refresh, enabled]);

  const projectCounts: Record<string, ProjectCounts> = {};
  for (const project of projects) {
    const counts = state.projects[project.id];
    projectCounts[project.id] = {
      conversations: counts?.conversations ?? null,
      lastActivity: counts?.lastActivity ?? null,
      running: runs
        ? runs.filter(
            (run) => run.projectId === project.id && ['running', 'queued'].includes(run.state),
          ).length
        : null,
    };
  }

  return { ...state, projects: projectCounts };
}
