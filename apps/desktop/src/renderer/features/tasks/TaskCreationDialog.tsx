import React, { useEffect, useRef, useState } from 'react';
import type { UiDot, UiTask, UiTaskAssignee, UiTaskState, UiWorkspaceProject } from '../../lib/api';
import { byteLength, states } from './taskShared';
import type { TaskSeed } from './taskShared';

export function TaskCreationDialog(props: {
  open: boolean;
  projects: UiWorkspaceProject[];
  dots: UiDot[];
  fixedProjectId?: string;
  seed?: TaskSeed;
  onClose(): void;
  onCreated(task: UiTask): void;
}) {
  const dialog = useRef<HTMLDialogElement>(null);
  const descriptionInput = useRef<HTMLTextAreaElement>(null);
  const descriptionRef = useRef(props.seed?.description ?? '');
  const operationId = useRef(crypto.randomUUID());
  const [projectId, setProjectId] = useState(props.fixedProjectId ?? props.seed?.projectId ?? '');
  const [title, setTitle] = useState(props.seed?.title ?? '');
  const [description, setDescription] = useState(props.seed?.description ?? '');
  const [state, setState] = useState<UiTaskState>('todo');
  const [assignees, setAssignees] = useState<UiTaskAssignee[]>([]);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');

  useEffect(() => {
    if (props.open && !dialog.current?.open) dialog.current?.showModal();
    if (!props.open && dialog.current?.open) dialog.current?.close();
  }, [props.open]);

  const project = props.projects.find((item) => item.id === projectId);
  const availableDots = project ? props.dots.filter((dot) => project.dotIds.includes(dot.id)) : [];

  function toggleAssignee(next: UiTaskAssignee) {
    const key = `${next.kind}:${next.id}`;
    setAssignees((current) =>
      current.some((item) => `${item.kind}:${item.id}` === key)
        ? current.filter((item) => `${item.kind}:${item.id}` !== key)
        : [...current, next],
    );
  }

  async function submit(event: React.FormEvent) {
    event.preventDefault();
    const descriptionValue = descriptionInput.current?.value ?? descriptionRef.current;
    if (saving || !projectId || !title.trim() || byteLength(descriptionValue) > 16000) return;
    setSaving(true);
    setError('');
    try {
      const created = await window.karont.createTask(
        {
          projectId,
          title: title.trim(),
          description: descriptionValue,
          state,
          assignees,
          originChatId: props.seed?.originChatId ?? null,
          originMessageId: props.seed?.originMessageId ?? null,
        },
        operationId.current,
      );
      props.onCreated(created);
    } catch {
      setError(
        'Não foi possível criar a tarefa. Confira o projeto, os responsáveis e tente revisar os campos.',
      );
      setSaving(false);
    }
  }

  return (
    <dialog
      ref={dialog}
      className="workspace-dialog task-dialog"
      aria-label={props.seed ? 'Prévia da nova tarefa' : 'Nova tarefa'}
      onCancel={(event) => {
        event.preventDefault();
        props.onClose();
      }}
      onClick={(event) => {
        if (event.target === dialog.current) props.onClose();
      }}
    >
      <div className="workspace-dialog-heading">
        <h2>{props.seed ? 'Revisar nova tarefa' : 'Nova tarefa'}</h2>
        <button type="button" className="icon-button" aria-label="Fechar" onClick={props.onClose}>
          ×
        </button>
      </div>
      <form onSubmit={(event) => void submit(event)}>
        {props.fixedProjectId ? (
          <p className="task-project-context">
            <strong>Projeto:</strong> {project?.name ?? 'Projeto não disponível'}
          </p>
        ) : (
          <label>
            Projeto
            <select
              autoFocus
              value={projectId}
              onChange={(event) => setProjectId(event.target.value)}
            >
              <option value="">Selecione o projeto</option>
              {props.projects.map((item) => (
                <option key={item.id} value={item.id}>
                  {item.name}
                </option>
              ))}
            </select>
          </label>
        )}
        {props.seed?.sourceLabel && (
          <p className="task-project-context">
            <strong>Origem:</strong> {props.seed.sourceLabel}
          </p>
        )}
        <label>
          Título
          <input
            autoFocus={!props.fixedProjectId}
            maxLength={120}
            value={title}
            onChange={(event) => setTitle(event.target.value)}
          />
        </label>
        <label>
          Descrição
          <textarea
            ref={descriptionInput}
            maxLength={16000}
            defaultValue={props.seed?.description ?? ''}
            onChange={(event) => {
              descriptionRef.current = event.target.value;
              setDescription(event.target.value);
            }}
          />
        </label>
        <small className="task-byte-count">{byteLength(description)}/16.000 bytes UTF-8</small>
        <label>
          Estado inicial
          <select value={state} onChange={(event) => setState(event.target.value as UiTaskState)}>
            {states.map((item) => (
              <option key={item.value} value={item.value}>
                {item.label}
              </option>
            ))}
          </select>
        </label>
        <fieldset className="grant-list">
          <legend>Responsáveis (opcional)</legend>
          <label>
            <input
              type="checkbox"
              checked={assignees.some((item) => item.kind === 'local')}
              onChange={() => toggleAssignee({ kind: 'local', id: 'local-user' })}
            />
            Você
          </label>
          {availableDots.map((dot) => (
            <label key={dot.id}>
              <input
                type="checkbox"
                checked={assignees.some((item) => item.kind === 'dot' && item.id === dot.id)}
                onChange={() => toggleAssignee({ kind: 'dot', id: dot.id })}
              />
              {dot.name}
            </label>
          ))}
          {project && !availableDots.length && (
            <small>
              Nenhum Dot está autorizado para este projeto. Isso não afeta a criação da tarefa.
            </small>
          )}
        </fieldset>
        {error && (
          <p className="workspace-error" role="alert">
            {error}
          </p>
        )}
        <div className="dialog-actions">
          <button type="button" className="quiet" onClick={props.onClose}>
            Cancelar
          </button>
          <button
            className="primary"
            disabled={saving || !projectId || !title.trim() || byteLength(description) > 16000}
          >
            {saving ? 'Criando…' : props.seed ? 'Confirmar e criar tarefa' : 'Criar tarefa'}
          </button>
        </div>
      </form>
    </dialog>
  );
}
