import { useEffect, useState } from 'react';
import type { TerminalEvent } from '../../../../../../packages/contracts/src';
import type { Approval } from '../../../../../../packages/contracts/src';
import type { UiRun, UiWorkspaceProject } from '../../lib/api';
import { overviewRequest } from './workspaceShared';

type WorkspaceStatus = Record<string, { running: number; attention: number }>;

export function useWorkspaceStatus(projectIndex: UiWorkspaceProject[]) {
  const [workspaceStatus, setWorkspaceStatus] = useState<WorkspaceStatus>({});
  const [runningChatIds, setRunningChatIds] = useState<Set<string>>(() => new Set());
  const [runs, setRuns] = useState<UiRun[]>();
  const [approvals, setApprovals] = useState<Approval[]>();
  const [ready, setReady] = useState(false);
  const [error, setError] = useState<unknown>();
  const [reloadVersion, setReloadVersion] = useState(0);

  useEffect(() => {
    let active = true;
    let timer: ReturnType<typeof setTimeout> | undefined;
    let requestVersion = 0;
    setReady(false);
    setRuns(undefined);
    setApprovals(undefined);

    async function refresh() {
      const currentVersion = ++requestVersion;
      try {
        const runList = await overviewRequest(
          () => window.karont.runs(100),
          () => active,
        );
        const approvalList = await overviewRequest(
          () => window.karont.approvals(),
          () => active,
        );
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

        for (const run of runList) {
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
        for (const approval of approvalList) {
          const workspaceId = projectsById.get(approval.projectId);
          if (workspaceId && approval.status === 'pending') add(workspaceId, 'attention');
        }

        setWorkspaceStatus(next);
        setRunningChatIds(runningChats);
        setRuns(runList);
        setApprovals(approvalList);
        setReady(true);
        setError(undefined);
      } catch (cause) {
        if (!active || currentVersion !== requestVersion) return;
        setWorkspaceStatus({});
        setRunningChatIds(new Set());
        setRuns(undefined);
        setApprovals(undefined);
        setReady(true);
        setError(cause);
      }
    }

    const scheduleRefresh = (event: TerminalEvent) => {
      if (event.type !== 'run.updated' && event.type !== 'approval.updated') return;
      if (timer) clearTimeout(timer);
      timer = setTimeout(() => void refresh(), 250);
    };

    const unsubscribe = window.karont.onEvent(scheduleRefresh);
    void refresh();
    return () => {
      active = false;
      if (timer) clearTimeout(timer);
      unsubscribe();
    };
  }, [projectIndex, reloadVersion]);

  return {
    workspaceStatus,
    runningChatIds,
    runs,
    approvals,
    ready,
    error,
    reload: () => setReloadVersion((version) => version + 1),
  };
}
