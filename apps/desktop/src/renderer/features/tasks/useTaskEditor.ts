import { useMemo, useState } from 'react';
import type { Dispatch, FormEvent, SetStateAction } from 'react';
import type {
  UiDot,
  UiRun,
  UiTask,
  UiTaskAssignee,
  UiTaskEvent,
  UiTaskState,
  UiTaskSummary,
  UiWorkspaceProject,
} from '../../lib/api';
import { byteLength } from './taskShared';

export function useTaskEditor(options: {
  projects: UiWorkspaceProject[];
  dots: UiDot[];
  runs: UiRun[];
  setTasks: Dispatch<SetStateAction<UiTaskSummary[]>>;
  setError: Dispatch<SetStateAction<string>>;
}) {
  const { projects, dots, runs, setTasks, setError } = options;
  const [selected, setSelected] = useState<UiTask>();
  const [events, setEvents] = useState<UiTaskEvent[]>([]);
  const [eventsCursor, setEventsCursor] = useState<string | null>(null);
  const [eventMore, setEventMore] = useState(false);
  const [titleDraft, setTitleDraft] = useState('');
  const [descriptionDraft, setDescriptionDraft] = useState('');
  const [stateDraft, setStateDraft] = useState<UiTaskState>('todo');
  const [assigneeKeys, setAssigneeKeys] = useState<string[]>([]);
  const [runCandidateId, setRunCandidateId] = useState('');
  const [saving, setSaving] = useState(false);

  async function openTask(taskId: string) {
    setError('');
    try {
      const detail = await window.karont.task(taskId);
      setSelected(detail);
      setTitleDraft(detail.title);
      setDescriptionDraft(detail.description);
      setStateDraft(detail.state);
      setAssigneeKeys(detail.assignees.map((item) => `${item.kind}:${item.id}`));
      setEvents([]);
      setEventsCursor(null);
      setEventMore(true);
      const page = await window.karont.taskEvents(taskId);
      setEvents(page.items);
      setEventsCursor(page.nextCursor);
      setEventMore(page.nextCursor !== null);
    } catch {
      setError('Não foi possível abrir os detalhes e o histórico desta tarefa.');
    }
  }

  async function saveTask(event: FormEvent) {
    event.preventDefault();
    if (!selected || saving || byteLength(descriptionDraft) > 16000) return;
    setSaving(true);
    setError('');
    try {
      const updated = await window.karont.updateTask({
        taskId: selected.id,
        title: titleDraft,
        description: descriptionDraft,
        state: stateDraft,
        expectedRevision: selected.revision,
      });
      setSelected(updated);
      setTasks((current) =>
        current.map((item) =>
          item.id === updated.id
            ? {
                ...item,
                title: updated.title,
                state: updated.state,
                revision: updated.revision,
                updatedAt: updated.updatedAt,
              }
            : item,
        ),
      );
      const wanted = new Set(assigneeKeys);
      const assigned = new Set(updated.assignees.map((item) => `${item.kind}:${item.id}`));
      if ([...wanted].sort().join('|') !== [...assigned].sort().join('|')) {
        const nextAssignees: UiTaskAssignee[] = [...wanted].map((key) => {
          const split = key.indexOf(':');
          return { kind: key.slice(0, split) as 'local' | 'dot', id: key.slice(split + 1) };
        });
        const withAssignees = await window.karont.setTaskAssignees({
          taskId: updated.id,
          assignees: nextAssignees,
          expectedRevision: updated.revision,
        });
        setSelected(withAssignees);
        setTasks((current) =>
          current.map((item) =>
            item.id === withAssignees.id
              ? {
                  ...item,
                  assignees: withAssignees.assignees,
                  revision: withAssignees.revision,
                  updatedAt: withAssignees.updatedAt,
                }
              : item,
          ),
        );
      }
      const history = await window.karont.taskEvents(selected.id);
      setEvents(history.items);
      setEventsCursor(history.nextCursor);
      setEventMore(history.nextCursor !== null);
    } catch {
      setError(
        'Conflito ao salvar. Seus campos locais foram mantidos; atualize somente depois de revisar a versão atual.',
      );
    } finally {
      setSaving(false);
    }
  }

  async function changeRunLink(runId: string, link: boolean) {
    if (!selected || saving) return;
    setSaving(true);
    setError('');
    try {
      const updated = link
        ? await window.karont.linkTaskRun({
            taskId: selected.id,
            runId,
            expectedRevision: selected.revision,
          })
        : await window.karont.unlinkTaskRun({
            taskId: selected.id,
            runId,
            expectedRevision: selected.revision,
          });
      setSelected(updated);
      setTasks((current) =>
        current.map((item) =>
          item.id === updated.id
            ? {
                ...item,
                runCount: updated.runCount,
                revision: updated.revision,
                updatedAt: updated.updatedAt,
              }
            : item,
        ),
      );
      const history = await window.karont.taskEvents(selected.id);
      setEvents(history.items);
      setEventsCursor(history.nextCursor);
      setEventMore(history.nextCursor !== null);
    } catch {
      setError('O vínculo não foi alterado. Verifique projeto e revisão da tarefa.');
    } finally {
      setSaving(false);
    }
  }

  async function loadNextEvents() {
    if (!selected || !eventsCursor) return;
    try {
      const page = await window.karont.taskEvents(selected.id, eventsCursor);
      setEvents((current) => [...current, ...page.items]);
      setEventsCursor(page.nextCursor);
      setEventMore(page.nextCursor !== null);
    } catch {
      setError('Não foi possível carregar a próxima página do histórico.');
    }
  }

  const assigneeOptions = useMemo(() => {
    const values = new Map<string, { label: string; disabled?: boolean }>();
    values.set('local:local-user', { label: 'Você' });
    const project = projects.find((item) => item.id === selected?.projectId);
    for (const id of project?.dotIds ?? []) {
      const dot = dots.find((item) => item.id === id);
      values.set(`dot:${id}`, { label: dot?.name ?? id });
    }
    if (selected)
      for (const item of selected.assignees) {
        const key = `${item.kind}:${item.id}`;
        if (!values.has(key)) values.set(key, { label: `${item.name} · indisponível` });
      }
    return [...values.entries()];
  }, [projects, dots, selected]);

  const candidates = selected
    ? runs.filter(
        (run) =>
          run.projectId === selected.projectId && !selected.runs.some((item) => item.id === run.id),
      )
    : [];

  return {
    selected,
    setSelected,
    events,
    eventMore,
    titleDraft,
    setTitleDraft,
    descriptionDraft,
    setDescriptionDraft,
    stateDraft,
    setStateDraft,
    assigneeKeys,
    setAssigneeKeys,
    runCandidateId,
    setRunCandidateId,
    saving,
    openTask,
    saveTask,
    changeRunLink,
    loadNextEvents,
    assigneeOptions,
    candidates,
  };
}
