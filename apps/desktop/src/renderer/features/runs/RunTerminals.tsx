import type { UiDot, UiProject, UiRun } from '../../lib/api';
import { TerminalPane } from './TerminalPane';

export function RunTerminals({
  activeCount,
  dots,
  projects,
  queuedRuns,
  refreshRun,
  terminalRuns,
}: {
  activeCount: number;
  dots: UiDot[];
  projects: UiProject[];
  queuedRuns: UiRun[];
  refreshRun: (run: UiRun) => void;
  terminalRuns: UiRun[];
}) {
  return (
    <>
      <div className="terminal-heading">
        <h3>
          Terminais <span>{activeCount}/2 ativos</span>
        </h3>
        <p>
          Fechar a janela mantém estes processos no daemon. A CLI controla as próprias aprovações.
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
    </>
  );
}
