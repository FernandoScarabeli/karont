import React from 'react';
import { Copy, Pencil } from 'lucide-react';
import type { UiChatDetails, UiDelivery, UiMessage, UiRun } from '../../lib/api';

type Props = {
  chat: UiChatDetails;
  messages: UiMessage[];
  deliveries: Record<string, UiDelivery[]>;
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

export function ChatMessages(props: Props) {
  return (
    <section className="message-history" aria-label="Mensagens salvas">
      {props.messages.map((message) => {
        const attempts = props.deliveries[message.id] ?? [];
        const latest = attempts.at(-1);
        return (
          <article className="saved-message" key={message.id}>
            <div className="saved-message-meta">
              <strong>Você</strong>
              <time>
                {new Date(message.createdAt).toLocaleTimeString([], {
                  hour: '2-digit',
                  minute: '2-digit',
                })}
              </time>
            </div>
            <pre>{message.body}</pre>
            <div className="k-message-actions">
              <button
                className="k-icon"
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
                <Copy size={14} />
              </button>
              <button
                className="k-icon"
                title="Editar como nova mensagem"
                aria-label="Editar como nova mensagem"
                onClick={() => {
                  props.editDraft(message.body);
                  props.composerRef.current?.focus();
                }}
              >
                <Pencil size={14} />
              </button>
            </div>
            {latest?.status === 'sent' && (
              <p className="delivery-status">
                Enviado ao terminal. Isso confirma a escrita, não o processamento pelo agente.
              </p>
            )}
            {latest?.status === 'pending' && (
              <p className="delivery-status">Tentativa de envio pendente.</p>
            )}
            {latest?.status === 'uncertain' && (
              <p className="delivery-uncertain">
                Entrega incerta. Revise a saída do terminal antes de tentar novamente.
              </p>
            )}
            {props.chat.chat.projectId && (
              <button
                className="quiet create-task-from-message"
                onClick={() => props.startTaskFromMessage(message)}
              >
                Criar tarefa a partir desta mensagem
              </button>
            )}
            {props.chat.chat.projectId && props.activeRun && latest?.status !== 'sent' && (
              <button
                className="send-message-button"
                disabled={props.saving}
                onClick={() => void props.sendSavedMessage(message, latest?.status === 'uncertain')}
              >
                {latest?.status === 'uncertain' ? 'Revisar e tentar novamente' : 'Enviar ao agente'}
              </button>
            )}
          </article>
        );
      })}
      {!props.messages.length && (
        <div className="message-empty">
          <h1>O que vamos construir?</h1>
          <p>
            {props.chat.chat.projectId
              ? `Esta conversa está no projeto ${props.chat.origin.projectName}.`
              : 'Uma nova ideia começa por aqui.'}
          </p>
        </div>
      )}
      {props.nextCursor && (
        <button className="quiet load-more" onClick={() => void props.loadNextMessages()}>
          Carregar próxima página do histórico
        </button>
      )}
    </section>
  );
}
