import { useEffect, useRef } from 'react';
import type { FormEvent, RefObject } from 'react';
import { Folder, Pencil, Star, Terminal } from 'lucide-react';
import { DotBadge } from '../../components/DotBadge';
import type { UiChatDetails } from '../../lib/api';

type Props = {
  chat: UiChatDetails;
  dotName?: string;
  renaming: boolean;
  renameTitle: string;
  setRenameTitle(value: string): void;
  renameChat(event: FormEvent): void;
  setRenaming(value: boolean): void;
  toggleFavorite(): void;
  openMove(): void;
  runPanelOpen: boolean;
  onToggleRunPanel(): void;
  runPanelButtonRef: RefObject<HTMLButtonElement | null>;
};

export function ChatHeader(props: Props) {
  const origin = props.chat.origin;
  const renameInput = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (props.renaming) renameInput.current?.focus();
  }, [props.renaming]);

  return (
    <header className="chat-heading kc-chat-heading">
      <div className="chat-heading-title kc-chat-heading-title">
        {props.renaming ? (
          <form
            className="rename-chat-form kc-rename-chat-form"
            onSubmit={(event) => void props.renameChat(event)}
          >
            <label className="sr-only" htmlFor={`rename-${props.chat.chat.id}`}>
              Título da conversa
            </label>
            <input
              id={`rename-${props.chat.chat.id}`}
              ref={renameInput}
              maxLength={120}
              value={props.renameTitle}
              onChange={(event) => props.setRenameTitle(event.target.value)}
            />
            <button type="submit" className="primary kc-rename-save">
              Salvar
            </button>
            <button
              type="button"
              className="quiet kc-rename-cancel"
              onClick={() => props.setRenaming(false)}
            >
              Cancelar
            </button>
          </form>
        ) : (
          <h2>{props.chat.chat.title}</h2>
        )}
        <p className="kc-chat-origin">
          <span>
            {origin.workspaceName ?? 'Workspace'}
            {origin.projectName ? ` / ${origin.projectName}` : ' / Conversa livre'}
          </span>
          {props.chat.chat.dotId && (
            <span className="kc-chat-dot">
              <DotBadge name={props.dotName ?? props.chat.chat.dotId} />
              <span>{props.dotName ?? props.chat.chat.dotId}</span>
            </span>
          )}
        </p>
      </div>
      <div className="chat-heading-actions kc-chat-heading-actions">
        {props.chat.chat.projectId && (
          <button
            ref={props.runPanelButtonRef}
            type="button"
            className="kc-terminal-trigger"
            aria-label="Terminal"
            aria-expanded={props.runPanelOpen}
            aria-controls="chat-run-panel"
            onClick={props.onToggleRunPanel}
          >
            <Terminal size={14} aria-hidden="true" />
            <span>Terminal</span>
          </button>
        )}
        <button
          type="button"
          className="k-icon kc-chat-icon-button"
          title={props.chat.chat.favorite ? 'Remover favorito' : 'Favoritar conversa'}
          aria-label={props.chat.chat.favorite ? 'Remover favorito' : 'Favoritar conversa'}
          aria-pressed={props.chat.chat.favorite}
          aria-description={
            props.chat.chat.favorite ? 'Remover dos favoritos' : 'Adicionar aos favoritos'
          }
          onClick={() => void props.toggleFavorite()}
        >
          <Star size={16} fill={props.chat.chat.favorite ? 'currentColor' : 'none'} />
        </button>
        <button
          type="button"
          className="k-icon kc-chat-icon-button"
          title="Renomear conversa"
          aria-label="Renomear conversa"
          onClick={() => props.setRenaming(true)}
        >
          <Pencil size={16} />
        </button>
        {!props.chat.chat.projectId && (
          <button
            type="button"
            className="k-icon kc-chat-icon-button"
            title="Vincular a projeto"
            aria-label="Vincular a projeto"
            onClick={() => void props.openMove()}
          >
            <Folder size={16} />
          </button>
        )}
      </div>
    </header>
  );
}
