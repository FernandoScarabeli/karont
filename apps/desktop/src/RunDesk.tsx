import { ContinuityControls } from './Continuity';
import React, { useEffect, useMemo, useRef, useState } from 'react';
import { Terminal } from '@xterm/xterm';
import { FitAddon } from '@xterm/addon-fit';
import '@xterm/xterm/css/xterm.css';
import type { TerminalEvent, PermissionMode } from '../../../packages/contracts/src';
import type {
  UiChatDetails,
  UiDiff,
  UiDot,
  UiProject,
  UiRollback,
  UiRun,
  UiWorkspaceProject,
} from './api';

export const modeLabels: Record<PermissionMode, string> = {
  ask: 'Pedir aprovação',
  auto: 'Aprovar por mim',
  full: 'Acesso total',
  readOnly: 'Somente leitura',
};

function TerminalPane({
  run,
  dot,
  project,
  refreshRun,
}: {
  run: UiRun;
  dot?: UiDot;
  project?: UiProject;
  refreshRun: (run: UiRun) => void;
}) {
  const host = useRef<HTMLDivElement>(null);
  const term = useRef<Terminal | undefined>(undefined);
  const task = useRef<HTMLInputElement>(null);
  const [sending, setSending] = useState(false);
  const [message, setMessage] = useState('');
  useEffect(() => {
    if (!host.current) return;
    const terminal = new Terminal({
      cursorBlink: true,
      convertEol: true,
      scrollback: 3000,
      fontFamily: 'ui-monospace, SFMono-Regular, Consolas, monospace',
      fontSize: 12,
      theme: {
        background: '#0e1311',
        foreground: '#d7e1d8',
        cursor: '#c1df85',
        selectionBackground: '#53684c',
      },
      screenReaderMode: true,
    });
    const fit = new FitAddon();
    terminal.loadAddon(fit);
    terminal.open(host.current);
    fit.fit();
    term.current = terminal;
    let restoring = true,
      restored = false,
      replay = '';
    const pending: string[] = [];
    const dispose = window.eros.onEvent((event: TerminalEvent) => {
      if (event.type === 'terminal.output' && event.runId === run.id) {
        if (restoring) pending.push(event.data);
        else terminal.write(event.data);
      }
      if (event.type === 'terminal.snapshot' && event.runId === run.id) {
        if (restored) {
          restored = false;
          restoring = true;
          replay = '';
        }
        replay += event.data;
        if (event.final && !restored) {
          restored = true;
          terminal.reset();
          terminal.write(replay);
          for (const data of pending) terminal.write(data);
          pending.length = 0;
          restoring = false;
        }
      }
      if (event.type === 'run.updated' && event.run.id === run.id) refreshRun(event.run);
    });
    let inputBuffer = '',
      inputTimer: ReturnType<typeof setTimeout> | undefined;
    const flushInput = () => {
      inputTimer = undefined;
      const data = inputBuffer;
      inputBuffer = '';
      if (data)
        void window.eros
          .writeTerminal(run.id, data)
          .catch(() =>
            setMessage('O terminal encerrou; a saída continua disponível para revisão.'),
          );
    };
    const input = terminal.onData((data) => {
      inputBuffer += data;
      if (!inputTimer) inputTimer = setTimeout(flushInput, 20);
    });
    let resizeTimer: ReturnType<typeof setTimeout> | undefined;
    const observer = new ResizeObserver(() => {
      try {
        fit.fit();
        clearTimeout(resizeTimer);
        resizeTimer = setTimeout(
          () => void window.eros.resizeTerminal(run.id, terminal.cols, terminal.rows),
          100,
        );
      } catch {}
    });
    observer.observe(host.current);
    let retry: ReturnType<typeof setTimeout> | undefined,
      stopped = false;
    const attach = () =>
      void window.eros.attachTerminal(run.id).catch(() => {
        if (!stopped) retry = setTimeout(attach, 2000);
      });
    attach();
    return () => {
      stopped = true;
      clearTimeout(retry);
      dispose();
      input.dispose();
      observer.disconnect();
      clearTimeout(inputTimer);
      clearTimeout(resizeTimer);
      term.current = undefined;
      terminal.dispose();
    };
  }, [run.id, run.sessionId, refreshRun]);
  async function sendTask(event: React.FormEvent) {
    event.preventDefault();
    const value = task.current?.value.trim();
    if (!value || sending) return;
    setSending(true);
    setMessage('');
    const prompt = `${dot?.role ? `${dot.role}\n\n` : ''}${value}\r`;
    try {
      await window.eros.writeTerminal(run.id, prompt);
      if (task.current) task.current.value = '';
    } catch {
      setMessage('O terminal ainda não está pronto para receber a instrução.');
    } finally {
      setSending(false);
    }
  }
  return (
    <article
      id={`run-${run.id}`}
      className="run-card"
      aria-label={`Execução ${dot?.name ?? run.dotId}`}
    >
      <header className="run-card-head">
        <div className="run-title">
          <span className={`state-dot ${run.state}`} aria-hidden="true" />
          <div>
            <h3>{dot?.name ?? run.dotId}</h3>
            <p>
              {project?.name ?? run.projectId} · {run.branch ?? 'worktree preparando'}
            </p>
          </div>
        </div>
        <span className={`run-state ${run.state}`}>
          {run.state} · inicial: {modeLabels[run.permissionMode]}
        </span>
      </header>
      {dot?.role && (
        <p className="dot-role" title={dot.role}>
          {dot.role}
        </p>
      )}
      <div
        className="terminal-shell"
        ref={host}
        aria-label={`Terminal de ${dot?.name ?? run.dotId}`}
      />
      {run.state === 'running' && (
        <form className="terminal-task" onSubmit={(e) => void sendTask(e)}>
          <label className="sr-only" htmlFor={`task-${run.id}`}>
            Instrução para {dot?.name ?? run.dotId}
          </label>
          <input
            id={`task-${run.id}`}
            ref={task}
            placeholder="Digite a tarefa para este dot"
            maxLength={4000}
          />
          <button type="submit" className="quiet" disabled={sending}>
            Enviar
          </button>
        </form>
      )}
      {message && (
        <p className="inline-error" role="status">
          {message}
        </p>
      )}
      <footer className="run-actions">
        <small>
          PID {run.pid ?? '—'}
          {run.exitCode !== null ? ` · código ${run.exitCode}` : ''}
        </small>
        <button className="quiet" onClick={() => refreshRun(run)}>
          Ver diff
        </button>
        {run.state === 'running' && (
          <button
            className="danger-quiet"
            onClick={() => void window.eros.cancelRun(run.id).then(refreshRun)}
          >
            Cancelar
          </button>
        )}
      </footer>
    </article>
  );
}

export function RunDesk({
  chat,
  previousOnly = false,
}: {
  chat?: UiChatDetails['chat'];
  previousOnly?: boolean;
}) {
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
      void window.eros.detachTerminals().catch(() => {});
    },
    [],
  );
  const loadRuns = React.useCallback(async () => {
    if (chat) return (await window.eros.chatRuns(chat.id)).items;
    const listed = await window.eros.runs(100);
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
    window.addEventListener('eros-open-run', openRequested);
    const unfocus = window.eros.onFocusRun(focus);
    void window.eros.focusTarget().then((id) => {
      if (id) focus(id);
    });
    const dispose = window.eros.onEvent((event) => {
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
        ? window.eros.projects(chat.workspaceId).then((page) => page.items)
        : window.eros.projects();
    void Promise.all([window.eros.dots(), projectRequest, loadRuns()])
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
      window.removeEventListener('eros-open-run', openRequested);
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
      const run = await window.eros.startRun(dot.id, projectId, mode, mode === 'full', chat?.id);
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
      setDiff(await window.eros.diff(run.id));
    } catch {
      setError('O diff desta execução ainda não está disponível.');
    }
  }
  async function previewRollback() {
    if (!diff) return;
    try {
      setRollback(await window.eros.rollbackPreview(diff.run.id));
    } catch {
      setError('Não foi possível preparar a prévia de reversão.');
    }
  }
  async function applyRollback() {
    if (!rollback?.canRollback || busy) return;
    setBusy(true);
    try {
      const result = await window.eros.rollbackApply(rollback.run.id);
      setRollback(undefined);
      setDiff(await window.eros.diff(rollback.run.id));
      setNotice(
        result.applied
          ? 'Reversão registrada no histórico desta execução.'
          : 'Uma alteração mudou durante a confirmação; nenhum arquivo foi revertido.',
      );
    } catch {
      setError(
        'A reversão não foi concluída. Revise a prévia e os arquivos antes de tentar novamente.',
      );
      setRollback(await window.eros.rollbackPreview(rollback.run.id).catch(() => undefined));
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
      await window.eros.removeWorktree(diff.run.id);
      setDiff(undefined);
      setNotice('Worktree removida; o histórico da execução foi preservado.');
    } catch {
      setError('A worktree ainda contém alterações. Revise ou desfaça o diff antes de removê-la.');
    }
  }
  const recent = [...runs]
    .sort((a, b) => b.createdAt - a.createdAt)
    .slice(0, showHistory ? 100 : 6);
  return (
    <section className="run-desk" aria-labelledby="runs-title">
      <div className="desk-heading">
        <div>
          <div className="eyebrow">EROS / EXECUÇÕES LOCAIS</div>
          <h2 id="runs-title">
            {chat
              ? 'Execuções desta conversa'
              : previousOnly
                ? 'Execuções anteriores'
                : 'Bancada de agentes'}
          </h2>
          <p>
            {chat
              ? 'A execução fica vinculada a esta conversa; o terminal continua ativo ao trocar de contexto.'
              : 'Dois dots em paralelo, cada um no próprio Git worktree.'}
          </p>
        </div>
        {!chat && (
          <label className="project-picker">
            Projeto Git{' '}
            <select
              aria-label="Projeto Git"
              value={projectId}
              disabled={!projects.length}
              onChange={(event) => setProjectId(event.target.value)}
            >
              <option value="">Selecione</option>
              {projects.map((project) => (
                <option key={project.id} value={project.id}>
                  {project.name}
                </option>
              ))}
            </select>
          </label>
        )}
      </div>
      {connectionError && (
        <p className="desk-alert" role="alert">
          {connectionError}
        </p>
      )}
      {notice && (
        <p className="desk-notice" role="status">
          {notice}
        </p>
      )}
      {error && (
        <p className="desk-alert" role="alert">
          {error}
        </p>
      )}
      {loading ? (
        <p className="desk-empty">Carregando configuração local…</p>
      ) : (
        <>
          {!projects.length || !dots.length ? (
            <div className="desk-empty">
              <strong>Configure os primeiros dots</strong>
              <p>
                Crie <code>~/.config/eros/dots.json</code> a partir de{' '}
                <code>config/dots.example.json</code>, ajuste os diretórios e a CLI. O arquivo fica
                fora do repositório e não contém credenciais.
              </p>
            </div>
          ) : (
            <div
              className="dot-launchers"
              aria-label={chat ? 'Dot desta conversa' : 'Dots configurados'}
            >
              {(chat
                ? dots.filter((dot) =>
                    chat.dotId
                      ? dot.id === chat.dotId
                      : (
                          (selectedProject as UiWorkspaceProject | undefined)?.dotIds ??
                          dot.projectIds
                        ).includes(dot.id) || dot.projectIds.includes(chat.projectId ?? ''),
                  )
                : dots
              ).map((dot) => (
                <article className="dot-launcher" key={dot.id}>
                  <div className="dot-avatar" aria-hidden="true">
                    {dot.name.slice(0, 1).toUpperCase()}
                  </div>
                  <div className="dot-info">
                    <strong>{dot.name}</strong>
                    <p title={dot.role}>{dot.role}</p>
                    <label>
                      Permissão{' '}
                      <select
                        aria-label={`Permissão de ${dot.name}`}
                        value={modes[dot.id] ?? 'ask'}
                        onChange={(e) =>
                          setModes({ ...modes, [dot.id]: e.target.value as PermissionMode })
                        }
                      >
                        {dot.capabilities.map((cap) => (
                          <option
                            key={cap.mode}
                            value={cap.mode}
                            disabled={cap.status === 'unavailable'}
                          >
                            {modeLabels[cap.mode]}
                            {cap.status === 'unavailable'
                              ? ' · indisponível'
                              : cap.status === 'partial'
                                ? ' · parcial'
                                : ''}
                          </option>
                        ))}
                      </select>
                    </label>
                    <small className="permission-detail">
                      {
                        dot.capabilities.find((cap) => cap.mode === (modes[dot.id] ?? 'ask'))
                          ?.detail
                      }
                    </small>
                  </div>
                  <button
                    className="primary"
                    disabled={
                      busy ||
                      !projectId ||
                      !dot.projectIds.includes(projectId) ||
                      (chat
                        ? runs.some(
                            (run) =>
                              run.state !== 'completed' &&
                              run.state !== 'failed' &&
                              run.state !== 'cancelled',
                          )
                        : false) ||
                      dot.capabilities.find((cap) => cap.mode === (modes[dot.id] ?? 'ask'))
                        ?.status === 'unavailable'
                    }
                    onClick={() => void start(dot)}
                  >
                    {chat &&
                    runs.some(
                      (run) =>
                        run.state !== 'completed' &&
                        run.state !== 'failed' &&
                        run.state !== 'cancelled',
                    )
                      ? 'Execução vinculada em andamento'
                      : !dot.projectIds.includes(projectId)
                        ? 'Sem acesso'
                        : activeCount >= 2
                          ? 'Enfileirar dot'
                          : chat
                            ? 'Iniciar execução'
                            : 'Iniciar dot'}
                  </button>
                </article>
              ))}
            </div>
          )}
          <div className="terminal-heading">
            <h3>
              Terminais <span>{activeCount}/2 ativos</span>
            </h3>
            <p>
              Fechar a janela mantém estes processos no daemon. A CLI controla as próprias
              aprovações.
            </p>
          </div>
          <div className="run-grid">
            {terminalRuns.map((run) => (
              <TerminalPane
                key={run.id}
                run={run}
                dot={dots.find((dot) => dot.id === run.dotId)}
                project={projects.find((project) => project.id === run.projectId)}
                refreshRun={refreshRun}
              />
            ))}
          </div>
          {queuedRuns.length > 0 && (
            <div className="queued-runs" aria-live="polite">
              <h3>Fila · {queuedRuns.length} aguardando</h3>
              {queuedRuns.map((run) => (
                <p key={run.id}>
                  {dots.find((dot) => dot.id === run.dotId)?.name ?? run.dotId} · aguardando PTY…
                </p>
              ))}
            </div>
          )}
          {terminalRuns.length === 0 && queuedRuns.length === 0 && (
            <div className="no-terminal">
              Nenhuma execução ativa. Inicie um dot acima; cada execução receberá uma branch e uma
              worktree próprias.
            </div>
          )}
          <section className="run-history" aria-labelledby="history-title">
            <div className="history-heading">
              <h3 id="history-title">Execuções recentes</h3>
              <button className="quiet" onClick={() => setShowHistory(!showHistory)}>
                {showHistory ? 'Mostrar menos' : 'Ver histórico'}
              </button>
            </div>
            {!recent.length ? (
              <p className="history-empty">Ainda não há execuções.</p>
            ) : (
              <div className="history-list">
                {recent.map((run) => (
                  <div key={run.id} className="history-entry">
                    <article className="history-row">
                      <span className={`state-dot ${run.state}`} aria-hidden="true" />
                      <strong>{dots.find((dot) => dot.id === run.dotId)?.name ?? run.dotId}</strong>
                      <span>
                        {projects.find((project) => project.id === run.projectId)?.name ??
                          run.projectId}
                      </span>
                      <button
                        className="quiet"
                        onClick={() => {
                          setFocusedRun(run.id);
                          setTimeout(
                            () =>
                              document
                                .getElementById(`run-${run.id}`)
                                ?.scrollIntoView({ block: 'center' }),
                            100,
                          );
                        }}
                      >
                        Terminal
                      </button>
                      <code>{run.state}</code>
                      <small>
                        {new Date(run.createdAt).toLocaleTimeString([], {
                          hour: '2-digit',
                          minute: '2-digit',
                        })}
                      </small>
                      <button className="quiet" onClick={() => void openDiff(run)}>
                        Diff
                      </button>
                      {run.state === 'running' && (
                        <button
                          className="danger-quiet"
                          onClick={() => void window.eros.cancelRun(run.id).then(refreshRun)}
                        >
                          Cancelar
                        </button>
                      )}
                    </article>
                    <ContinuityControls run={run} refresh={refreshRun} />
                  </div>
                ))}
              </div>
            )}
          </section>
          {diff && (
            <section className="diff-view" aria-labelledby="diff-title">
              <div className="diff-heading">
                <div>
                  <div className="eyebrow">REVISÃO / {diff.run.id.slice(0, 8)}</div>
                  <h3 id="diff-title">Alterações desta execução</h3>
                  <p>
                    {diff.totalFiles} arquivos ·{' '}
                    {diff.files.reduce((n, file) => n + file.additions, 0)} linhas adicionadas ·{' '}
                    {diff.files.reduce((n, file) => n + file.deletions, 0)} removidas
                  </p>
                </div>
                <div className="diff-tools">
                  <button className="quiet" onClick={() => void openDiff(diff.run)}>
                    Atualizar
                  </button>
                  <button
                    className="danger"
                    onClick={() => void previewRollback()}
                    disabled={!diff.totalFiles}
                  >
                    Desfazer alterações
                  </button>
                  {diff.totalFiles === 0 && (
                    <button className="danger-quiet" onClick={() => void removeWorktree()}>
                      Remover worktree
                    </button>
                  )}
                </div>
              </div>
              <ul className="file-list">
                {diff.files.map((file) => (
                  <li key={file.path}>
                    <span className={`change-kind ${file.kind}`}>
                      {file.kind === 'created' ? '+' : file.kind === 'deleted' ? '−' : '~'}
                    </span>
                    <code>{file.path}</code>
                    <small>
                      +{file.additions} −{file.deletions}
                    </small>
                  </li>
                ))}
              </ul>
              {diff.filesTruncated && (
                <p className="diff-limit">
                  A lista de arquivos foi limitada pelo tamanho máximo do IPC. Revise o diff abaixo
                  antes de continuar.
                </p>
              )}
              {diff.diffTruncated && (
                <p className="diff-limit">O diff atingiu o limite de exibição e foi truncado.</p>
              )}
              {diff.diff ? (
                <pre className="diff-content">{diff.diff}</pre>
              ) : (
                <div className="diff-empty">Esta execução não deixou alterações de arquivo.</div>
              )}
            </section>
          )}
        </>
      )}
      {rollback && (
        <dialog
          ref={rollbackDialog}
          className="rollback-dialog"
          aria-labelledby="rollback-title"
          onCancel={() => {
            if (rollback.approvalId)
              void window.eros.decideApproval(rollback.approvalId, false).catch(() => {});
            setRollback(undefined);
          }}
        >
          <div className="eyebrow">CONFIRMAÇÃO / WORKTREE</div>
          <h3 id="rollback-title">Desfazer alterações desta execução?</h3>
          <p>
            A reversão afeta somente os arquivos desta worktree. Comandos e efeitos externos da CLI
            não são revertidos.
          </p>
          <ul>
            {rollback.files.map((file) => (
              <li key={file.path}>
                <code>{file.path}</code>
                <span>{file.kind}</span>
              </li>
            ))}
          </ul>
          {rollback.filesTruncated && (
            <p className="conflict-note" role="alert">
              A prévia excede o limite atual do protocolo. Revise o diff completo e deixe a lista
              abaixo dentro do limite antes de desfazer.
            </p>
          )}
          {rollback.applied && (
            <p className="rollback-done" role="status">
              Esta execução já foi revertida. O registro permanece no histórico.
            </p>
          )}
          {rollback.conflicts.length > 0 && (
            <p className="conflict-note" role="alert">
              Conflito detectado em: {rollback.conflicts.join(', ')}. Atualize e revise os arquivos
              manualmente.
            </p>
          )}
          {rollback.conflictsTruncated && (
            <p className="conflict-note" role="alert">
              Há conflitos adicionais que excedem a prévia.
            </p>
          )}
          <div className="dialog-actions">
            <button
              className="quiet"
              onClick={() => {
                if (rollback.approvalId)
                  void window.eros.decideApproval(rollback.approvalId, false).catch(() => {});
                setRollback(undefined);
              }}
            >
              Voltar
            </button>
            <button
              className="danger"
              disabled={
                !rollback.canRollback ||
                rollback.filesTruncated ||
                rollback.conflictsTruncated ||
                busy
              }
              onClick={() => void applyRollback()}
            >
              {busy ? 'Revertendo…' : rollback.applied ? 'Já revertida' : 'Confirmar reversão'}
            </button>
          </div>
        </dialog>
      )}
    </section>
  );
}
