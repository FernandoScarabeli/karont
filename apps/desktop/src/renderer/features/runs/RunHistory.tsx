import { ContinuityControls } from '../continuity/Continuity';
import type { UiDot, UiProject, UiRun } from '../../lib/api';

export function RunHistory({
  dots,
  focusRun,
  onOpenDiff,
  projects,
  recent,
  refreshRun,
  setShowHistory,
  showHistory,
}: {
  dots: UiDot[];
  focusRun: (id: string) => void;
  onOpenDiff: (run: UiRun) => void;
  projects: UiProject[];
  recent: UiRun[];
  refreshRun: (run: UiRun) => void;
  setShowHistory: React.Dispatch<React.SetStateAction<boolean>>;
  showHistory: boolean;
}) {
  return (
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
                  {projects.find((project) => project.id === run.projectId)?.name ?? run.projectId}
                </span>
                <button className="quiet" onClick={() => focusRun(run.id)}>
                  Terminal
                </button>
                <code>{run.state}</code>
                <small>
                  {new Date(run.createdAt).toLocaleTimeString([], {
                    hour: '2-digit',
                    minute: '2-digit',
                  })}
                </small>
                <button className="quiet" onClick={() => void onOpenDiff(run)}>
                  Diff
                </button>
                {run.state === 'running' && (
                  <button
                    className="danger-quiet"
                    onClick={() => void window.karont.cancelRun(run.id).then(refreshRun)}
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
  );
}
