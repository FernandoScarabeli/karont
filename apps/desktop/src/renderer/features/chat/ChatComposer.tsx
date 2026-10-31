import type * as React from 'react';
import { ArrowUp, Command } from 'lucide-react';

type Props = {
  chatId: string;
  dotName?: string;
  draft: string;
  saving: boolean;
  composerRef: React.RefObject<HTMLTextAreaElement | null>;
  composing: React.MutableRefObject<boolean>;
  draftRef: React.MutableRefObject<string>;
  saveMessage(event: React.FormEvent): void;
  editDraft(value: string): void;
  persistDraft(value: string): Promise<void>;
};

export function ChatComposer(props: Props) {
  return (
    <form
      className="message-composer kc-chat-composer"
      onSubmit={(event) => void props.saveMessage(event)}
    >
      <label className="sr-only" htmlFor={`draft-${props.chatId}`}>
        Nova mensagem
      </label>
      <textarea
        ref={props.composerRef}
        disabled={props.saving}
        onKeyDown={(event) => {
          if (event.key === 'Enter' && !event.shiftKey && !event.nativeEvent.isComposing) {
            event.preventDefault();
            void props.saveMessage(event);
          }
        }}
        id={`draft-${props.chatId}`}
        maxLength={8000}
        value={props.draft}
        onCompositionStart={() => {
          props.composing.current = true;
        }}
        onCompositionEnd={() => {
          props.composing.current = false;
        }}
        onChange={(event) => props.editDraft(event.target.value)}
        onBlur={() => {
          void props.persistDraft(props.draftRef.current).catch(() => {});
        }}
        placeholder={props.dotName ? `Escreva para o ${props.dotName}` : 'Escreva uma mensagem'}
      />
      <div className="composer-footer kc-composer-footer">
        <button
          type="button"
          className="k-icon kc-task-command"
          title="Criar tarefa com /kanban"
          aria-label="Inserir comando criar tarefa"
          onClick={() => {
            props.editDraft('/kanban ');
            props.composerRef.current?.focus();
          }}
        >
          <span className="kc-command-slash" aria-hidden="true">
            /
          </span>
          <span>Criar tarefa</span>
          <Command size={14} aria-hidden="true" />
        </button>
        <small className="kc-composer-status" role="status">
          {new TextEncoder().encode(props.draft).byteLength > 8000
            ? 'Limite de 8.000 bytes excedido'
            : props.saving
              ? 'Salvando…'
              : 'Registro local · enviar ao terminal é uma ação separada'}
        </small>
        <span className="kc-composer-hint">
          <kbd>Enter</kbd> salva
        </span>
        <button
          type="submit"
          className="k-icon k-send kc-save-message"
          title="Salvar mensagem"
          aria-label="Salvar mensagem"
          disabled={
            !props.draft.trim() ||
            new TextEncoder().encode(props.draft).byteLength > 8000 ||
            props.saving
          }
        >
          <ArrowUp size={18} aria-hidden="true" />
        </button>
      </div>
    </form>
  );
}
