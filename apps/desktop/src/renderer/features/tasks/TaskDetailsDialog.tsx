import React, { useEffect, useRef } from 'react';
import type { UiRun, UiTask, UiTaskEvent, UiTaskState, UiWorkspaceProject } from '../../lib/api';
import { byteLength, eventLabel, states } from './taskShared';

export function TaskDetailsDialog(props: {
  task?: UiTask;
  projects: UiWorkspaceProject[];
  runs: UiRun[];
  title: string;
  description: string;
  state: UiTaskState;
  assigneeKeys: string[];
  assigneeOptions: [string, { label: string; disabled?: boolean }][];
  candidates: UiRun[];
  runCandidateId: string;
  events: UiTaskEvent[];
  eventMore: boolean;
  saving: boolean;
  error: string;
  onClose(): void;
  onOpenConversation(chatId: string): void;
  onTitle(value: string): void;
  onDescription(value: string): void;
  onState(value: UiTaskState): void;
  onAssignees(value: string[]): void;
  onRunCandidate(value: string): void;
  onSave(event: React.FormEvent): void;
  onLinkRun(): void;
  onUnlinkRun(id: string): void;
  onLoadEvents(): void;
}) {
  const dialog = useRef<HTMLDialogElement>(null);
  useEffect(() => {
    if (props.task && !dialog.current?.open) dialog.current?.showModal();
    if (!props.task && dialog.current?.open) dialog.current?.close();
  }, [props.task?.id]);
  const project = props.projects.find((item) => item.id === props.task?.projectId);
  return (
    <dialog
      ref={dialog}
      className="workspace-dialog task-details-dialog"
      aria-label="Detalhes da tarefa"
      onCancel={(event) => {
        event.preventDefault();
        props.onClose();
      }}
      onClick={(event) => {
        if (event.target === dialog.current) props.onClose();
      }}
    >
      {props.task && (
        <>
          <div className="workspace-dialog-heading">
            <h2>Detalhes da tarefa</h2>
            <button
              type="button"
              className="icon-button"
              aria-label="Fechar"
              onClick={props.onClose}
            >
              ×
            </button>
          </div>
          <p className="task-project-context">
            <strong>Projeto:</strong> {props.task.origin.workspaceName} /{' '}
            {props.task.origin.projectName} · tarefa e projeto permanecem vinculados.
          </p>
          <form className="task-detail-form" onSubmit={props.onSave}>
            <label>
              Título
              <input
                maxLength={120}
                value={props.title}
                onChange={(event) => props.onTitle(event.target.value)}
              />
            </label>
            <label>
              Descrição
              <textarea
                maxLength={16000}
                value={props.description}
                onChange={(event) => props.onDescription(event.target.value)}
              />
            </label>
            <small className="task-byte-count">
              {byteLength(props.description)}/16.000 bytes UTF-8
            </small>
            <label>
              Estado da tarefa
              <select
                value={props.state}
                onChange={(event) => props.onState(event.target.value as UiTaskState)}
              >
                {states.map((item) => (
                  <option key={item.value} value={item.value}>
                    {item.label}
                  </option>
                ))}
              </select>
            </label>
            <fieldset className="grant-list">
              <legend>Responsáveis</legend>
              {props.assigneeOptions.map(([key, item]) => (
                <label key={key}>
                  <input
                    type="checkbox"
                    disabled={item.disabled}
                    checked={props.assigneeKeys.includes(key)}
                    onChange={(event) =>
                      props.onAssignees(
                        event.target.checked
                          ? [...props.assigneeKeys, key]
                          : props.assigneeKeys.filter((value) => value !== key),
                      )
                    }
                  />
                  {item.label}
                </label>
              ))}
              {!props.assigneeOptions.length && <small>Nenhum responsável está disponível.</small>}
            </fieldset>
            <p className="task-run-note">
              Estado da tarefa é independente do estado das Runs. Nenhuma alteração inicia ou
              modifica uma Run.
            </p>
            {props.error && (
              <p className="workspace-error" role="alert">
                {props.error}
              </p>
            )}
            <div className="dialog-actions">
              <button type="button" className="quiet" onClick={props.onClose}>
                Fechar
              </button>
              <button
                className="primary"
                disabled={
                  props.saving || !props.title.trim() || byteLength(props.description) > 16000
                }
              >
                {props.saving ? 'Salvando…' : 'Salvar alterações'}
              </button>
            </div>
          </form>
          {props.task.origin.chatId && (
            <div className="task-origin-actions">
              <p>
                <strong>Conversa de origem:</strong> {props.task.origin.chatTitle ?? 'Conversa'}
              </p>
              <button
                className="quiet"
                onClick={() => {
                  const chatId = props.task?.origin.chatId;
                  if (chatId) props.onOpenConversation(chatId);
                  props.onClose();
                }}
              >
                Abrir conversa
              </button>
            </div>
          )}
          {props.task.runs.length > 0 && (
            <section className="task-related-runs">
              <h3>Runs relacionadas</h3>
              {props.task.runs.map((run) => (
                <div key={run.id} className="task-run-row">
                  <span>
                    <strong>{run.dotName ?? run.dotId}</strong> · estado da Run: {run.state} ·{' '}
                    {new Date(run.createdAt).toLocaleString()}
                  </span>
                  <button
                    className="quiet"
                    disabled={props.saving}
                    onClick={() => props.onUnlinkRun(run.id)}
                  >
                    Remover vínculo
                  </button>
                </div>
              ))}
            </section>
          )}
          <div className="task-run-link">
            <label>
              Associar Run existente deste projeto
              <select
                value={props.runCandidateId}
                onChange={(event) => props.onRunCandidate(event.target.value)}
              >
                <option value="">Selecione uma Run</option>
                {props.candidates.map((run) => (
                  <option key={run.id} value={run.id}>
                    {run.id.slice(0, 8)} · {run.state} · {run.dotId}
                  </option>
                ))}
              </select>
            </label>
            <button
              className="quiet"
              disabled={!props.runCandidateId || props.saving}
              onClick={props.onLinkRun}
            >
              Associar Run
            </button>
            {props.runs.filter((run) => run.projectId !== props.task!.projectId).length > 0 && (
              <small>Runs de outros projetos não podem ser vinculadas.</small>
            )}
          </div>
          <section className="task-history">
            <h3>Histórico</h3>
            {props.events.map((event) => (
              <article key={event.id}>
                <time>{new Date(event.createdAt).toLocaleString()}</time>
                <span>{eventLabel(event)}</span>
              </article>
            ))}
            {!props.events.length && <p>Sem alterações registradas.</p>}
            {props.eventMore && (
              <button className="quiet" onClick={props.onLoadEvents}>
                Carregar próximo trecho do histórico
              </button>
            )}
          </section>
        </>
      )}
    </dialog>
  );
}
