import type { UiTaskState } from '../../lib/api';

const labels: Record<UiTaskState, string> = {
  todo: 'A fazer',
  in_progress: 'Em andamento',
  review: 'Revisão',
  done: 'Feito',
};

export function TaskCounts({ counts }: { counts: Record<UiTaskState, number | null> }) {
  return (
    <div className="kw-task-counts">
      {(['todo', 'in_progress', 'review', 'done'] as const).map((state) => (
        <div className="kw-task-count" key={state}>
          <span>{labels[state]}</span>
          <strong>{counts[state] ?? '—'}</strong>
        </div>
      ))}
    </div>
  );
}
