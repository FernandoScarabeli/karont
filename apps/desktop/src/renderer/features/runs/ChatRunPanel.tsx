import { useEffect, useRef, useState } from 'react';
import type { RefObject } from 'react';
import { FileDiff, GitBranch, Keyboard, Pause, ShieldCheck, Square } from 'lucide-react';
import type { TerminalEvent } from '../../../../../../packages/contracts/src';
import type { UiChatDetails, UiRun } from '../../lib/api';
import { Attention } from '../attention/Attention';
import { LiveMoon } from '../../components/LiveMoon';
import { DiffView } from './DiffView';
import { DotLauncher } from './DotLauncher';
import { RollbackDialog } from './RollbackDialog';
import { RunHistory } from './RunHistory';
import { TerminalPane } from './TerminalPane';
import { modeLabels, runStateLabels } from './runShared';
import { useRunDesk } from './useRunDesk';

type Props = {
  chat: UiChatDetails['chat'];
  open: boolean;
  onClose(): void;
  panelRef: RefObject<HTMLElement | null>;
  triggerRef: RefObject<HTMLButtonElement | null>;
};

const continuingStates: UiRun['state'][] = [
  'queued',
  'running',
  'paused',
  'waiting_quota',
  'waiting_approval',
  'recovery_needed',
];

function minutesSince(timestamp: number) {
  return Math.max(0, Math.floor((Date.now() - timestamp) / 60_000));
}

export function ChatRunPanel({ chat, open, onClose, panelRef, triggerRef }: Props) {
  const desk = useRunDesk(chat, false);
  const [narrow, setNarrow] = useState(() => window.matchMedia('(max-width: 1100px)').matches);
  const [actionError, setActionError] = useState('');
  const statesById = useRef(new Map<string, UiRun['state']>());
  const selectedRunRef = useRef<string | undefined>(undefined);
  const wasDrawerOpen = useRef(false);

  useEffect(() => {
    const media = window.matchMedia('(max-width: 1100px)');
    const update = (event: MediaQueryListEvent) => setNarrow(event.matches);
    setNarrow(media.matches);
    media.addEventListener('change', update);
    return () => media.removeEventListener('change', update);
  }, []);

  const focusedRun = desk.runs.find((run) => run.id === desk.focusedRun);
  const latestContinuingRun = [...desk.runs]
    .filter((run) => continuingStates.includes(run.state))
    .sort((a, b) => b.createdAt - a.createdAt)[0];
  const latestRun = [...desk.runs].sort((a, b) => b.createdAt - a.createdAt)[0];
  const selectedRun = focusedRun ?? latestContinuingRun ?? latestRun;
  const terminalCandidate = focusedRun ?? latestContinuingRun;
  const terminalRun = terminalCandidate?.sessionId
    ? (desk.terminalRuns.find((run) => run.id === terminalCandidate.id) ?? terminalCandidate)
    : undefined;
  const panelVisible = !narrow || open;

  useEffect(() => {
    selectedRunRef.current = selectedRun?.id;
    for (const run of desk.runs) {
      if (!statesById.current.has(run.id)) statesById.current.set(run.id, run.state);
    }
  }, [desk.runs, selectedRun?.id]);

  useEffect(() => {
    if (panelVisible && selectedRun) void desk.loadDiffSummary(selectedRun.id, true);
  }, [desk.loadDiffSummary, panelVisible, selectedRun?.id]);

  useEffect(() => {
    const dispose = window.karont.onEvent((event: TerminalEvent) => {
      if (event.type !== 'run.updated' || event.run.chatId !== chat.id) return;
      const previous = statesById.current.get(event.run.id);
      statesById.current.set(event.run.id, event.run.state);
      if (
        previous !== undefined &&
        previous !== event.run.state &&
        event.run.id === selectedRunRef.current
      )
        void desk.loadDiffSummary(event.run.id, true);
    });
    return dispose;
  }, [chat.id, desk.loadDiffSummary]);

  useEffect(() => {
    if (narrow && open) {
      wasDrawerOpen.current = true;
      requestAnimationFrame(() => panelRef.current?.focus());
      return;
    }
    if (wasDrawerOpen.current && !open) {
      wasDrawerOpen.current = false;
      triggerRef.current?.focus();
    }
  }, [narrow, open, panelRef, triggerRef]);

  async function pauseRun(run: UiRun) {
    if (desk.busy) return;
    setActionError('');
    try {
      desk.refreshRun(await window.karont.pauseRun(run.id));
    } catch {
      setActionError('Não foi possível pausar o agendamento desta Run.');
    }
  }

  async function stopRun(run: UiRun) {
    if (desk.busy) return;
    setActionError('');
    try {
      desk.refreshRun(await window.karont.cancelRun(run.id));
    } catch {
      setActionError('Não foi possível parar esta Run.');
    }
  }

  const diffSummary = desk.diffSummary?.run.id === selectedRun?.id ? desk.diffSummary : undefined;
  const additions = diffSummary?.files.reduce((total, file) => total + file.additions, 0);
  const deletions = diffSummary?.files.reduce((total, file) => total + file.deletions, 0);
  const pendingHistory = desk.showHistory;

  return (
    <section
      id="chat-run-panel"
      ref={panelRef}
      className={`run-desk k-run-context kc-chat-run-desk${narrow ? ' kc-run-desk-drawer' : ''}${open ? ' is-open' : ''}`}
      aria-label="Painel da Run"
      aria-hidden={narrow && !open}
      tabIndex={-1}
      onKeyDown={(event) => {
        if (event.key === 'Escape' && narrow && open) {
          event.stopPropagation();
          onClose();
        }
      }}
    >
      <h2 className="kc-run-visually-hidden">Execuções desta conversa</h2>
      {desk.loading ? (
        <p className="kc-run-loading" role="status">
          Carregando execução…
        </p>
      ) : (
        <>
          <header className="kc-run-header">
            <div className="kc-run-header-line">
              <div className="kc-run-status">
                {selectedRun?.state === 'running' && (
                  <span className="kc-run-live-mark" aria-hidden="true">
                    <LiveMoon />
                  </span>
                )}
                <span className="kc-run-state-label">
                  {selectedRun ? runStateLabels[selectedRun.state] : 'Nenhuma Run ativa'}
                </span>
                {selectedRun?.state === 'running' && (
                  <time className="kc-run-elapsed">
                    há {minutesSince(selectedRun.startedAt ?? selectedRun.createdAt)} min
                  </time>
                )}
              </div>
              <div className="kc-run-controls">
                {selectedRun?.state === 'queued' && (
                  <button
                    type="button"
                    className="kc-run-control"
                    disabled={desk.busy}
                    onClick={() => void pauseRun(selectedRun)}
                  >
                    <Pause size={14} aria-hidden="true" />
                    Pausar
                  </button>
                )}
                {selectedRun &&
                  ['running', 'queued', 'paused', 'waiting_quota', 'recovery_needed'].includes(
                    selectedRun.state,
                  ) && (
                    <button
                      type="button"
                      className="kc-run-control"
                      disabled={desk.busy}
                      onClick={() => void stopRun(selectedRun)}
                    >
                      <Square size={14} aria-hidden="true" />
                      Parar
                    </button>
                  )}
              </div>
            </div>
            <div className="kc-run-meta">
              <span>
                <GitBranch size={14} aria-hidden="true" />
                {selectedRun?.branch ?? (selectedRun ? 'worktree preparando' : 'Sem branch ativa')}
              </span>
              {selectedRun && (
                <span>
                  <ShieldCheck size={14} aria-hidden="true" />
                  {modeLabels[selectedRun.permissionMode]}
                </span>
              )}
            </div>
            {(desk.connectionError || desk.error || desk.notice || actionError) && (
              <div
                className="kc-run-feedback"
                role={desk.error || actionError ? 'alert' : 'status'}
              >
                {desk.connectionError || desk.error || actionError || desk.notice}
              </div>
            )}
          </header>

          <div className="kc-run-stage">
            {selectedRun && (
              <div className="kc-run-approval-provisional">
                <Attention key={selectedRun.id} runId={selectedRun.id} />
              </div>
            )}
            {selectedRun && terminalRun ? (
              <TerminalPane
                run={terminalRun}
                dot={desk.dots.find((dot) => dot.id === terminalRun.dotId)}
                project={desk.projects.find((project) => project.id === terminalRun.projectId)}
                refreshRun={desk.refreshRun}
                compact
              />
            ) : terminalCandidate ? (
              <p className="kc-run-waiting" role="status">
                {terminalCandidate.state === 'queued'
                  ? 'A Run está na fila e ainda não tem terminal.'
                  : 'Aguardando o terminal desta Run.'}
              </p>
            ) : !focusedRun && !latestContinuingRun ? (
              <div className="kc-run-launcher-provisional">
                <DotLauncher
                  chat={chat}
                  dots={desk.dots}
                  modes={desk.modes}
                  projects={desk.projects}
                  projectId={desk.projectId}
                  runs={desk.runs}
                  selectedProject={desk.selectedProject}
                  busy={desk.busy}
                  activeCount={desk.activeCount}
                  setModes={desk.setModes}
                  start={desk.start}
                />
              </div>
            ) : (
              <p className="kc-run-waiting" role="status">
                Esta Run não tem um terminal disponível.
              </p>
            )}
          </div>

          {terminalRun && (
            <div className="kc-terminal-hint">
              <Keyboard size={14} aria-hidden="true" />
              <span>Clique no terminal para digitar direto nele</span>
            </div>
          )}

          <footer className="kc-run-changes">
            <div className="kc-run-changes-copy">
              <strong>Mudanças desta Run</strong>
              <span className="kc-run-change-counts">
                {diffSummary ? `${diffSummary.totalFiles} arquivos` : 'Mudanças não carregadas'}
                {diffSummary && <b className="kc-positive">+{additions}</b>}
                {diffSummary && <b className="kc-negative">−{deletions}</b>}
              </span>
            </div>
            <button
              type="button"
              className="kc-run-history-toggle"
              aria-expanded={pendingHistory}
              onClick={() => desk.setShowHistory((show) => !show)}
            >
              Execuções anteriores
            </button>
            <button
              type="button"
              className="kc-run-diff-button"
              disabled={!selectedRun}
              onClick={() => selectedRun && void desk.openDiff(selectedRun)}
            >
              <FileDiff size={14} aria-hidden="true" />
              Ver mudanças
            </button>
          </footer>

          {pendingHistory && (
            <div className="kc-run-history-popover">
              <RunHistory
                dots={desk.dots}
                focusRun={desk.focusHistoryRun}
                onOpenDiff={desk.openDiff}
                projects={desk.projects}
                recent={desk.recent}
                refreshRun={desk.refreshRun}
                setShowHistory={desk.setShowHistory}
                showHistory={desk.showHistory}
              />
            </div>
          )}
          {desk.diff && (
            <section className="kc-run-diff-layer" aria-label="Ver mudanças">
              <DiffView
                diff={desk.diff}
                onOpenDiff={desk.openDiff}
                onPreviewRollback={desk.previewRollback}
                onRemoveWorktree={desk.removeWorktree}
                onClose={() => desk.setDiff(undefined)}
              />
            </section>
          )}
        </>
      )}
      {desk.rollback && (
        <RollbackDialog
          busy={desk.busy}
          onApplyRollback={desk.applyRollback}
          rollback={desk.rollback}
          rollbackDialog={desk.rollbackDialog}
          setRollback={desk.setRollback}
        />
      )}
    </section>
  );
}
