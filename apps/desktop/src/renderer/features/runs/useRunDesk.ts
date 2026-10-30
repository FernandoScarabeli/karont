import React, { useEffect, useMemo, useRef, useState } from 'react';
import type { PermissionMode } from '../../../../../../packages/contracts/src';
import type { UiChatDetails, UiDiff, UiDot, UiProject, UiRollback, UiRun } from '../../lib/api';

export function useRunDesk(chat: UiChatDetails['chat'] | undefined, previousOnly: boolean) {
  const [dots, setDots] = useState<UiDot[]>([]),
    [projects, setProjects] = useState<UiProject[]>([]),
    [runs, setRuns] = useState<UiRun[]>([]);
  const [projectId, setProjectId] = useState(''),
    [loading, setLoading] = useState(true),
    [error, setError] = useState('');
  const [diff, setDiff] = useState<UiDiff>(),
    [rollback, setRollback] = useState<UiRollback>(),
    [busy, setBusy] = useState(false);
  const rollbackDialog = useRef<HTMLDialogElement>(null);
  useEffect(
    () => () => {
      void window.karont.detachTerminals().catch(() => {});
    },
    [],
  );
  const loadRuns = React.useCallback(async () => {
    if (chat) return (await window.karont.chatRuns(chat.id)).items;
    const listed = await window.karont.runs(100);
    return previousOnly ? listed.filter((run) => run.chatId === null) : listed;
  }, [chat?.id, previousOnly]);
  useEffect(() => {
    if (rollback) rollbackDialog.current?.showModal();
  }, [rollback]);
  const [modes, setModes] = useState<Record<string, PermissionMode>>({});
  const [connectionError, setConnectionError] = useState('');
  const [notice, setNotice] = useState('');
  const [focusedRun, setFocusedRun] = useState<string>();
  const [showHistory, setShowHistory] = useState(false);
  const refreshRun = React.useCallback(
    (run: UiRun) => setRuns((current) => current.map((item) => (item.id === run.id ? run : item))),
    [],
  );
  useEffect(() => {
    let mounted = true;
    const focus = (id: string) => {
      setFocusedRun(id);
      setTimeout(
        () =>
          document
            .getElementById(`run-${id}`)
            ?.scrollIntoView({ block: 'center', behavior: 'smooth' }),
        100,
      );
    };
    const openRequested = (event: Event) => focus((event as CustomEvent<string>).detail);
    window.addEventListener('karont-open-run', openRequested);
    const unfocus = window.karont.onFocusRun(focus);
    void window.karont.focusTarget().then((id) => {
      if (id) focus(id);
    });
    const dispose = window.karont.onEvent((event) => {
      setConnectionError('');
      if (
        event.type === 'run.updated' &&
        (chat ? event.run.chatId === chat.id : previousOnly ? event.run.chatId === null : true)
      )
        setRuns((current) =>
          current.some((run) => run.id === event.run.id)
            ? current.map((run) => (run.id === event.run.id ? event.run : run))
            : [event.run, ...current].slice(0, 100),
        );
    });
    const projectRequest =
      chat?.projectId && chat.workspaceId
        ? window.karont.projects(chat.workspaceId).then((page) => page.items)
        : window.karont.projects();
    void Promise.all([window.karont.dots(), projectRequest, loadRuns()])
      .then(([nextDots, nextProjects, nextRuns]) => {
        if (!mounted) return;
        setDots(nextDots);
        setProjects(nextProjects);
        setRuns(nextRuns);
        setProjectId(chat?.projectId ?? nextProjects[0]?.id ?? '');
      })
      .catch(() => {
        if (mounted) setError('Não foi possível carregar dots, projetos e execuções.');
      })
      .finally(() => {
        if (mounted) setLoading(false);
      });
    const reconnect = setInterval(() => {
      void loadRuns()
        .then((next) => {
          if (mounted) {
            setRuns(next);
            setConnectionError('');
          }
        })
        .catch(() => {
          if (mounted) setConnectionError('Daemon desconectado. Tentando reconectar…');
        });
    }, 3000);
    return () => {
      mounted = false;
      dispose();
      unfocus();
      window.removeEventListener('karont-open-run', openRequested);
      clearInterval(reconnect);
    };
  }, [chat?.id, chat?.projectId, chat?.workspaceId, loadRuns]);
  const activeCount = runs.filter((run) => run.state === 'running').length;
  // Render a terminal only once its PTY has a session ID. A queued card would
  // attach before launch and then replay again when the PTY starts.
  const terminalRuns = useMemo(
    () =>
      runs
        .filter((run) => run.sessionId)
        .sort(
          (a, b) =>
            Number(b.state === 'running') - Number(a.state === 'running') ||
            b.createdAt - a.createdAt,
        )
        .sort((a, b) => Number(b.id === focusedRun) - Number(a.id === focusedRun))
        .slice(0, 2),
    [runs, focusedRun],
  );
  const queuedRuns = runs.filter((run) => run.state === 'queued');
  const selectedProject = projects.find((project) => project.id === projectId);
  async function start(dot: UiDot) {
    if (!projectId || busy) return;
    const mode = modes[dot.id] ?? 'ask';
    setBusy(true);
    setNotice('');
    setError('');
    try {
      const run = await window.karont.startRun(dot.id, projectId, mode, mode === 'full', chat?.id);
      setRuns((current) => [run, ...current.filter((item) => item.id !== run.id)].slice(0, 100));
    } catch {
      setError('Esta execução não pôde iniciar. Confira o dot, o projeto Git e a CLI configurada.');
    } finally {
      setBusy(false);
    }
  }
  async function openDiff(run: UiRun) {
    setNotice('');
    setError('');
    setRollback(undefined);
    setDiff(undefined);
    try {
      setDiff(await window.karont.diff(run.id));
    } catch {
      setError('O diff desta execução ainda não está disponível.');
    }
  }
  async function previewRollback() {
    if (!diff) return;
    try {
      setRollback(await window.karont.rollbackPreview(diff.run.id));
    } catch {
      setError('Não foi possível preparar a prévia de reversão.');
    }
  }
  async function applyRollback() {
    if (!rollback?.canRollback || busy) return;
    setBusy(true);
    try {
      const result = await window.karont.rollbackApply(rollback.run.id);
      setRollback(undefined);
      setDiff(await window.karont.diff(rollback.run.id));
      setNotice(
        result.applied
          ? 'Reversão registrada no histórico desta execução.'
          : 'Uma alteração mudou durante a confirmação; nenhum arquivo foi revertido.',
      );
    } catch {
      setError(
        'A reversão não foi concluída. Revise a prévia e os arquivos antes de tentar novamente.',
      );
      setRollback(await window.karont.rollbackPreview(rollback.run.id).catch(() => undefined));
    } finally {
      setBusy(false);
    }
  }
  async function removeWorktree() {
    if (
      !diff ||
      !window.confirm(
        'Remover a worktree desta execução? A ação só funciona quando ela não contém alterações pendentes.',
      )
    )
      return;
    try {
      await window.karont.removeWorktree(diff.run.id);
      setDiff(undefined);
      setNotice('Worktree removida; o histórico da execução foi preservado.');
    } catch {
      setError('A worktree ainda contém alterações. Revise ou desfaça o diff antes de removê-la.');
    }
  }
  const recent = [...runs]
    .sort((a, b) => b.createdAt - a.createdAt)
    .slice(0, showHistory ? 100 : 6);
  function focusHistoryRun(id: string) {
    setFocusedRun(id);
    setTimeout(
      () => document.getElementById(`run-${id}`)?.scrollIntoView({ block: 'center' }),
      100,
    );
  }
  return {
    activeCount,
    applyRollback,
    busy,
    connectionError,
    diff,
    dots,
    error,
    focusHistoryRun,
    loading,
    modes,
    notice,
    openDiff,
    previewRollback,
    projectId,
    projects,
    queuedRuns,
    recent,
    refreshRun,
    removeWorktree,
    rollback,
    rollbackDialog,
    runs,
    selectedProject,
    setDiff,
    setModes,
    setProjectId,
    setRollback,
    setShowHistory,
    showHistory,
    start,
    terminalRuns,
  };
}
