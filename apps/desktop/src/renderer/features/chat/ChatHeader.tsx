import React from 'react';
import { Folder, Pencil, Star, X } from 'lucide-react';
import type { UiChatDetails, UiDot } from '../../lib/api';

type Props = {
  chat: UiChatDetails;
  dots: UiDot[];
  renaming: boolean;
  renameTitle: string;
  setRenameTitle(value: string): void;
  renameChat(event: React.FormEvent): void;
  setRenaming(value: boolean): void;
  toggleFavorite(): void;
  openMove(): void;
  onClose(): void;
};

export function ChatHeader(props: Props) {
  return (
    <header className="chat-heading">
      <div className="chat-heading-title">
        {props.renaming ? (
          <form className="rename-chat-form" onSubmit={(event) => void props.renameChat(event)}>
            <label className="sr-only" htmlFor={`rename-${props.chat.chat.id}`}>
              Título da conversa
            </label>
            <input
              id={`rename-${props.chat.chat.id}`}
              autoFocus
              maxLength={120}
              value={props.renameTitle}
              onChange={(event) => props.setRenameTitle(event.target.value)}
            />
            <button className="primary">Salvar</button>
            <button type="button" className="quiet" onClick={() => props.setRenaming(false)}>
              Cancelar
            </button>
          </form>
        ) : (
          <h2>{props.chat.chat.title}</h2>
        )}
        <p>
          {props.chat.origin.workspaceName ?? 'Global'}
          {props.chat.origin.projectName
            ? ` / ${props.chat.origin.projectName}`
            : ' / Conversa livre'}
          {props.chat.chat.dotId
            ? ` · ${props.dots.find((dot) => dot.id === props.chat.chat.dotId)?.name ?? props.chat.chat.dotId}`
            : ''}
        </p>
      </div>
      <div className="chat-heading-actions">
        <button
          className="k-icon"
          title={props.chat.chat.favorite ? 'Remover favorito' : 'Favoritar conversa'}
          aria-label={props.chat.chat.favorite ? 'Remover favorito' : 'Favoritar conversa'}
          aria-pressed={props.chat.chat.favorite}
          onClick={() => void props.toggleFavorite()}
        >
          <Star size={16} fill={props.chat.chat.favorite ? 'currentColor' : 'none'} />
        </button>
        <button
          className="k-icon"
          title="Renomear conversa"
          aria-label="Renomear conversa"
          onClick={() => props.setRenaming(true)}
        >
          <Pencil size={16} />
        </button>
        {!props.chat.chat.projectId && (
          <button
            className="k-icon"
            title="Vincular a projeto"
            aria-label="Vincular a projeto"
            onClick={() => void props.openMove()}
          >
            <Folder size={16} />
          </button>
        )}
        <button
          className="k-icon"
          title="Fechar conversa"
          aria-label="Fechar conversa"
          onClick={props.onClose}
        >
          <X size={16} />
        </button>
      </div>
    </header>
  );
}
