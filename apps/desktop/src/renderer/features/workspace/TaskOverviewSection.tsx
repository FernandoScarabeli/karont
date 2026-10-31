import type { UiTaskState } from '../../lib/api';
import { TaskCounts } from './TaskCounts';

export function TaskOverviewSection({
  title,
  headingId,
  counts,
  onOpenTasks,
}: {
  title: string;
  headingId: string;
  counts: Record<UiTaskState, number | null>;
  onOpenTasks: () => void;
}) {
  return (
    <section className="kw-section" aria-labelledby={headingId}>
      <header className="kw-section-heading">
        <h2 id={headingId}>{title}</h2>
        <button type="button" className="kw-section-action" onClick={onOpenTasks}>
          <span>Abrir quadro</span>
        </button>
      </header>
      <TaskCounts counts={counts} />
    </section>
  );
}
