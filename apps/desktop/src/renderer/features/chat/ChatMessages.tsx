import React from 'react';
import {
  ArrowUpRight,
  Check,
  CircleDashed,
  CircleHelp,
  Copy,
  ListPlus,
  Pencil,
} from 'lucide-react';
import type { UiChatDetails, UiDelivery, UiMessage, UiRun } from '../../lib/api';
import { modeLabels } from '../runs/runShared';

type Props = {
  chat: UiChatDetails;
  messages: UiMessage[];
  deliveries: Record<string, UiDelivery[]>;
  runs: UiRun[];
  activeRun?: UiRun;
  saving: boolean;
  nextCursor: string | null;
  loadNextMessages(): void;
  setMessageError(message: string): void;
  composerRef: React.RefObject<HTMLTextAreaElement | null>;
  editDraft(value: string): void;
  startTaskFromMessage(message: UiMessage): void;
  sendSavedMessage(message: UiMessage, reviewedUncertain?: boolean): Promise<void>;
};

type HistoryEntry =
  | { kind: 'run'; item: UiRun; createdAt: number; key: string }
  | { kind: 'message'; item: UiMessage; createdAt: number; key: string };

function localTime(createdAt: number) {
  return new Date(createdAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
}

export function ChatMessages(props: Props) {
  const [userInitial, setUserInitial] = React.useState('P');
  React.useEffect(() => {
    let current = true;
    void window.karont
      .systemUser()
      .then(({ name }) => {
        const initial = name.trim().slice(0, 1).toLocaleUpperCase();
        if (current && initial) setUserInitial(initial);
      })
      .catch(() => {
        if (current) setUserInitial('P');
      });
    return () => {
      current = false;
    };
  }, []);
  const entries: HistoryEntry[] = [
    ...props.runs.map((run) => ({
      kind: 'run' as const,
      item: run,
      createdAt: run.createdAt,
      key: `run-${run.id}`,
    })),
    ...props.messages.map((message) => ({
      kind: 'message' as const,
      item: message,
      createdAt: message.createdAt,
      key: `message-${message.id}`,
    })),
  ].sort((a, b) => a.createdAt - b.createdAt || a.key.localeCompare(b.key));

  return (
    <section className="message-history kc-message-history" aria-label="Mensagens salvas">
      {entries.map((entry) => {
        if (entry.kind === 'run') {
          const run = entry.item;
          return (
            <div className="kc-run-event" key={entry.key}>
              <span aria-hidden="true" />
              <span>Run iniciada · {modeLabels[run.permissionMode]}</span>
              <time dateTime={new Date(run.createdAt).toISOString()}>
                {localTime(run.createdAt)}
              </time>
              <span aria-hidden="true" />
            </div>
          );
        }

        const message = entry.item;
        const attempts = props.deliveries[message.id] ?? [];
        const latest = attempts.at(-1);
        const canSend = Boolean(props.activeRun) && latest?.status !== 'sent';
        return (
          <article className="saved-message kc-saved-message" key={entry.key}>
            <div className="saved-message-meta kc-saved-message-meta">
              <span className="kc-user-avatar" aria-hidden="true">
                {userInitial}
              </span>
              <strong>Você</strong>
              <time dateTime={new Date(message.createdAt).toISOString()}>
                {localTime(message.createdAt)}
              </time>
              <div className="k-message-actions kc-message-actions">
                <button
                  type="button"
                  className="k-icon kc-message-action"
                  title="Copiar mensagem"
                  aria-label="Copiar mensagem"
                  onClick={() => {
                    void navigator.clipboard
                      .writeText(message.body)
                      .catch(() =>
                        props.setMessageError(
                          'Não foi possível copiar. Selecione o texto para copiar manualmente.',
                        ),
                      );
                  }}
                >
                  <Copy size={14} aria-hidden="true" />
                </button>
                <button
                  type="button"
                  className="k-icon kc-message-action"
                  title="Editar como nova mensagem"
                  aria-label="Editar como nova mensagem"
                  onClick={() => {
                    props.editDraft(message.body);
                    props.composerRef.current?.focus();
                  }}
                >
                  <Pencil size={14} aria-hidden="true" />
                </button>
                {props.chat.chat.projectId && (
                  <button
                    type="button"
                    className="k-icon kc-message-action"
                    title="Criar tarefa a partir desta mensagem"
                    aria-label="Criar tarefa a partir desta mensagem"
                    onClick={() => props.startTaskFromMessage(message)}
                  >
                    <ListPlus size={14} aria-hidden="true" />
                  </button>
                )}
              </div>
            </div>
            <pre>{message.body}</pre>
            <div className="kc-message-delivery">
              {latest?.status === 'sent' ? (
                <span
                  className="delivery-status kc-delivery-status"
                  title="A escrita no terminal foi confirmada; isso não confirma processamento pelo Dot."
                >
                  <Check size={12} aria-hidden="true" />
                  Enviada ao terminal
                </span>
              ) : latest?.status === 'uncertain' ? (
                <span className="delivery-uncertain kc-delivery-uncertain">
                  <CircleHelp size={12} aria-hidden="true" />
                  Entrega incerta
                </span>
              ) : (
                <span className="delivery-status kc-delivery-status">
                  <CircleDashed size={12} aria-hidden="true" />
                  {latest?.status === 'pending' ? 'Envio pendente' : 'Salva, ainda não enviada'}
                </span>
              )}
              {canSend && (
                <button
                  type="button"
                  className="send-message-button kc-send-message-button"
                  disabled={props.saving || latest?.status === 'pending'}
                  aria-description={
                    latest?.status === 'uncertain'
                      ? 'Revise a saída do terminal antes de tentar novamente.'
                      : 'Escreve a mensagem salva no terminal da Run ativa.'
                  }
                  onClick={() =>
                    void props.sendSavedMessage(message, latest?.status === 'uncertain')
                  }
                >
                  <ArrowUpRight size={14} aria-hidden="true" />
                  {latest?.status === 'uncertain'
                    ? 'Revisar e tentar novamente'
                    : 'Enviar ao terminal'}
                </button>
              )}
            </div>
          </article>
        );
      })}
      {!entries.length && (
        <div className="message-empty kc-message-empty">
          <h1>O que vamos construir?</h1>
          <p>
            {props.chat.chat.projectId
              ? `Esta conversa está no projeto ${props.chat.origin.projectName}.`
              : 'Uma nova ideia começa por aqui.'}
          </p>
        </div>
      )}
      {props.nextCursor && (
        <button
          type="button"
          className="quiet load-more kc-load-more"
          onClick={() => void props.loadNextMessages()}
        >
          Carregar próxima página do histórico
        </button>
      )}
    </section>
  );
}
