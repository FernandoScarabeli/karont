import { useEffect, useMemo, useRef, useState } from 'react';
import type { TerminalEvent } from '../../../../../../packages/contracts/src';
import type { UiTaskState, UiWorkspace, UiWorkspaceProject } from '../../lib/api';
import { allPages, overviewRequest } from './workspaceShared';

const taskStates: UiTaskState[] = ['todo', 'in_progress', 'review', 'done'];

type WorkspaceCounts = {
  conversations: number | null;
  lastActivity: number | null;
};

type OverviewState = {
  workspaces: Record<string, WorkspaceCounts>;
  tasks: Record<UiTaskState, number | null>;
  chatTitles: Record<string, string>;
  loading: boolean;
  error?: unknown;
};

function emptyTasks(): Record<UiTaskState, number | null> {
  return { todo: null, in_progress: null, review: null, done: null };
}

export function useAllWorkspacesOverview(
  workspaces: UiWorkspace[],
  projects: UiWorkspaceProject[],
  enabled: boolean,
) {
  const [state, setState] = useState<OverviewState>({
    workspaces: {},
    tasks: emptyTasks(),
    chatTitles: {},
    loading: true,
  });
  const workspacesRef = useRef(workspaces);
  workspacesRef.current = workspaces;
  const scheduleRef = useRef<() => void>(() => {});
  const dataKey = useMemo(
    () =>
      `${workspaces.map((workspace) => `${workspace.id}:${workspace.name}`).join('|')}#${projects
        .map(
          (project) => `${project.id}:${project.workspaceId}:${project.name}:${project.available}`,
        )
        .join('|')}`,
    [projects, workspaces],
  );

  useEffect(() => {
    if (!enabled) return;
    let active = true;
    let timer: ReturnType<typeof setTimeout> | undefined;
    let loading = false;
    let rerun = false;

    async function load() {
      if (!active) return;
      if (loading) {
        rerun = true;
        return;
      }
      loading = true;
      setState((current) => ({ ...current, loading: true }));
      do {
        rerun = false;
        const nextWorkspaces: OverviewState['workspaces'] = {};
        const nextTasks = emptyTasks();
        const chatTitles: Record<string, string> = {};
        const errors: unknown[] = [];
        const currentWorkspaces = workspacesRef.current;

        for (const workspace of currentWorkspaces) {
          if (!active) return;
          try {
            const chats = await allPages(
              (cursor) =>
                overviewRequest(
                  () => window.karont.chats({ workspaceId: workspace.id, limit: 100, cursor }),
                  () => active,
                ),
              () => active,
            );
            nextWorkspaces[workspace.id] = {
              conversations: chats.length,
              lastActivity: chats.reduce<number | null>(
                (latest, chat) =>
                  latest === null || chat.updatedAt > latest ? chat.updatedAt : latest,
                null,
              ),
            };
            for (const chat of chats) chatTitles[chat.id] = chat.title;
          } catch (error) {
            nextWorkspaces[workspace.id] = { conversations: null, lastActivity: null };
            errors.push(error);
          }
        }

        for (const taskState of taskStates) {
          if (!active) return;
          try {
            const tasks = await allPages(
              (cursor) =>
                overviewRequest(
                  () => window.karont.tasks({ state: taskState, limit: 100, cursor }),
                  () => active,
                ),
              () => active,
            );
            nextTasks[taskState] = tasks.length;
          } catch (error) {
            nextTasks[taskState] = null;
            errors.push(error);
          }
        }

        if (!active) return;
        setState({
          workspaces: nextWorkspaces,
          tasks: nextTasks,
          chatTitles,
          loading: false,
          error: errors[0],
        });
      } while (rerun && active);
      loading = false;
    }

    function schedule() {
      if (timer) clearTimeout(timer);
      timer = setTimeout(() => void load(), 250);
    }

    const unsubscribe = window.karont.onEvent((event: TerminalEvent) => {
      if (
        event.type === 'project.updated' ||
        event.type === 'workspace.updated' ||
        event.type === 'chat.updated' ||
        event.type === 'task.updated'
      )
        schedule();
    });

    scheduleRef.current = schedule;
    schedule();
    return () => {
      active = false;
      if (timer) clearTimeout(timer);
      unsubscribe();
      scheduleRef.current = () => {};
    };
  }, [enabled]);

  useEffect(() => {
    if (enabled) scheduleRef.current();
  }, [dataKey, enabled]);

  const projectCounts = useMemo(() => {
    const result: Record<string, number> = {};
    for (const project of projects)
      result[project.workspaceId] = (result[project.workspaceId] ?? 0) + 1;
    return result;
  }, [projects]);

  return { ...state, projectCounts };
}
