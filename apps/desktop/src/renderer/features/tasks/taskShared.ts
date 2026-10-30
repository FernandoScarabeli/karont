import type { UiTaskEvent, UiTaskState } from '../../lib/api';

export const states: { value: UiTaskState; label: string }[] = [
  { value: 'todo', label: 'A fazer' },
  { value: 'in_progress', label: 'Em andamento' },
  { value: 'review', label: 'Em revisão' },
  { value: 'done', label: 'Concluída' },
];
export const stateLabel = (state: UiTaskState) =>
  states.find((item) => item.value === state)?.label ?? state;
export const byteLength = (value: string) => new TextEncoder().encode(value).byteLength;

export function eventLabel(event: UiTaskEvent) {
  switch (event.kind) {
    case 'task.created':
      return `Tarefa criada · estado ${stateLabel(event.metadata.state as UiTaskState)}`;
    case 'task.state_changed':
      return `Estado alterado de ${stateLabel(event.metadata.from as UiTaskState)} para ${stateLabel(event.metadata.to as UiTaskState)}`;
    case 'task.updated':
      return `Campos atualizados: ${event.metadata.fields ?? 'detalhes'}`;
    case 'task.assignees_changed':
      return `Responsáveis alterados${event.metadata.added ? ` · adicionados ${event.metadata.added}` : ''}${event.metadata.removed ? ` · removidos ${event.metadata.removed}` : ''}`;
    case 'task.run_linked':
      return `Run associada · ${event.metadata.runId ?? ''}`;
    case 'task.run_unlinked':
      return `Vínculo de Run removido · ${event.metadata.runId ?? ''}`;
  }
}

export type TaskSeed = {
  nonce: string;
  projectId: string | null;
  title: string;
  description: string;
  originChatId: string | null;
  originMessageId: string | null;
  sourceLabel: string;
};
