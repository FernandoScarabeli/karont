import { useEffect, useState } from 'react';
import type { TerminalEvent } from '../../../../../../packages/contracts/src';
import type { UiWorkspaceProject } from '../../lib/api';

type WorkspaceStatus = Record<string, { running: number; attention: number }>;

export function useWorkspaceStatus(projectIndex: UiWorkspaceProject[]) {
  const [workspaceStatus, setWorkspaceStatus] = useState<WorkspaceStatus>({});
  const [runningChatIds, setRunningChatIds] = useState<Set<string>>(() => new Set());
  const [error, setError] = useState<unknown>();

  useEffect(() => {
    let active = true;
    let timer: ReturnType<typeof setTimeout> | undefined;
    let requestVersion = 0;

    async function refresh() {
      const currentVersion = ++requestVersion;
      try {
        const [runs, approvals] = await Promise.all([
          window.karont.runs(100),
          window.karont.approvals(),
        ]);
        if (!active || currentVersion !== requestVersion) return;
        const projectsById = new Map(
          projectIndex.map((project) => [project.id, project.workspaceId]),
        );
        const next: WorkspaceStatus = {};
        const runningChats = new Set<string>();
        const add = (workspaceId: string, kind: 'running' | 'attention') => {
          let status = next[workspaceId];
          if (!status) {
            status = { running: 0, attention: 0 };
            next[workspaceId] = status;
          }
          status[kind] += 1;
        };

        for (const run of runs) {
          if ((run.state === 'running' || run.state === 'queued') && run.chatId)
            runningChats.add(run.chatId);
          const workspaceId = projectsById.get(run.projectId);
          if (!workspaceId) continue;
          if (run.state === 'running' || run.state === 'queued') {
            add(workspaceId, 'running');
          } else if (run.state === 'recovery_needed') {
            add(workspaceId, 'attention');
          }
        }
        for (const approval of approvals) {
          const workspaceId = projectsById.get(approval.projectId);
          if (workspaceId && approval.status === 'pending') add(workspaceId, 'attention');
        }

        setWorkspaceStatus(next);
        setRunningChatIds(runningChats);
        setError(undefined);
      } catch (cause) {
        if (!active || currentVersion !== requestVersion) return;
        setWorkspaceStatus({});
        setRunningChatIds(new Set());
        setError(cause);
      }
    }

    const scheduleRefresh = (event: TerminalEvent) => {
      if (event.type !== 'run.updated' && event.type !== 'approval.updated') return;
      if (timer) clearTimeout(timer);
      timer = setTimeout(() => void refresh(), 150);
    };

    const unsubscribe = window.karont.onEvent(scheduleRefresh);
    void refresh();
    return () => {
      active = false;
      if (timer) clearTimeout(timer);
      unsubscribe();
    };
  }, [projectIndex]);

  return { workspaceStatus, runningChatIds, error };
}
