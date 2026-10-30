import React, { useEffect, useRef, useState } from 'react';
import { Terminal } from '@xterm/xterm';
import { FitAddon } from '@xterm/addon-fit';
import type { TerminalEvent } from '../../../../../../packages/contracts/src';
import type { UiDot, UiProject, UiRun } from '../../lib/api';
import { modeLabels } from './runShared';

export function TerminalPane({
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
    const dispose = window.karont.onEvent((event: TerminalEvent) => {
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
        void window.karont
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
          () => void window.karont.resizeTerminal(run.id, terminal.cols, terminal.rows),
          100,
        );
      } catch {
        // fit() falha se o terminal já foi desmontado ou está oculto; o próximo resize ajusta.
      }
    });
    observer.observe(host.current);
    let retry: ReturnType<typeof setTimeout> | undefined,
      stopped = false;
    const attach = () =>
      void window.karont.attachTerminal(run.id).catch(() => {
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
      await window.karont.writeTerminal(run.id, prompt);
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
            onClick={() => void window.karont.cancelRun(run.id).then(refreshRun)}
          >
            Cancelar
          </button>
        )}
      </footer>
    </article>
  );
}
