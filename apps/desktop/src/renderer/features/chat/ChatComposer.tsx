import React from 'react';
import { ArrowUp, Command } from 'lucide-react';

type Props = {
  chatId: string;
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
    <form className="message-composer" onSubmit={(event) => void props.saveMessage(event)}>
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
        placeholder="Escreva sua mensagem…"
      />
      <div className="composer-footer">
        <button
          type="button"
          className="k-icon"
          title="Criar tarefa com /kanban"
          aria-label="Inserir comando criar tarefa"
          onClick={() => {
            props.editDraft('/kanban ');
            props.composerRef.current?.focus();
          }}
        >
          <Command size={16} />
        </button>
        <small>
          {new TextEncoder().encode(props.draft).byteLength > 8000
            ? 'Limite de 8.000 bytes excedido'
            : props.saving
              ? 'Salvando…'
              : 'Registro local · enviar ao terminal é uma ação separada'}
        </small>
        <button
          className="k-icon k-send"
          title="Salvar mensagem"
          aria-label="Salvar mensagem"
          disabled={
            !props.draft.trim() ||
            new TextEncoder().encode(props.draft).byteLength > 8000 ||
            props.saving
          }
        >
          <ArrowUp size={18} />
        </button>
      </div>
    </form>
  );
}
