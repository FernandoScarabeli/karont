import type { UiTaskState, UiTaskSummary } from '../../lib/api';
import { states } from './taskShared';

export function TaskCard(props: {
  task: UiTaskSummary;
  onOpen(): void;
  onMove(state: UiTaskState): void;
}) {
  return (
    <article className="task-card">
      <button
        className="task-card-open"
        onClick={props.onOpen}
        aria-label={`Abrir tarefa ${props.task.title}`}
      >
        <strong>{props.task.title}</strong>
        <span className="task-card-assignees">
          {props.task.assignees.length
            ? props.task.assignees
                .map((item) => `${item.name}${item.available ? '' : ' · indisponível'}`)
                .join(', ')
            : 'Sem responsável'}
        </span>
        <span className="task-card-origin">
          {props.task.origin.workspaceName} / {props.task.origin.projectName}
          {props.task.origin.chatTitle ? ` · ${props.task.origin.chatTitle}` : ''}
        </span>
        <span className="task-card-links">
          {props.task.origin.chatId ? 'Conversa vinculada' : 'Sem conversa'} · {props.task.runCount}{' '}
          {props.task.runCount === 1 ? 'Run' : 'Runs'}
        </span>
      </button>
      <label className="task-state-control">
        Estado
        <select
          aria-label={`Mover ${props.task.title}`}
          value={props.task.state}
          onChange={(event) => props.onMove(event.target.value as UiTaskState)}
        >
          {states.map((item) => (
            <option key={item.value} value={item.value}>
              {item.label}
            </option>
          ))}
        </select>
      </label>
    </article>
  );
}
