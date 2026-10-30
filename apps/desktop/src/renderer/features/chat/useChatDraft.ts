import React, { useCallback, useRef, useState } from 'react';
import type { UiChatDetails } from '../../lib/api';

export function useChatDraft(props: {
  initial: UiChatDetails;
  onChatChange(chat: UiChatDetails): void;
  setRenameTitle(value: string): void;
  setMessageError(message: string): void;
}) {
  const [chat, setChat] = useState(props.initial);
  const [draft, setDraft] = useState(props.initial.chat.draft);
  const draftRef = useRef(draft);
  const composing = useRef(false);
  const revisionRef = useRef(chat.chat.revision);
  const draftTimer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const draftQueue = useRef(Promise.resolve());

  const acceptChat = useCallback(
    (value: UiChatDetails) => {
      setChat(value);
      revisionRef.current = value.chat.revision;
      draftRef.current = value.chat.draft;
      setDraft(value.chat.draft);
      props.setRenameTitle(value.chat.title);
      props.onChatChange(value);
    },
    [props.onChatChange],
  );

  const persistDraft = useCallback(
    (value: string) => {
      clearTimeout(draftTimer.current);
      const task = draftQueue.current
        .catch(() => {})
        .then(async () => {
          if (value === chat.chat.draft && revisionRef.current === chat.chat.revision) return;
          const updated = await window.karont.saveDraft(chat.chat.id, value, revisionRef.current);
          setChat(updated);
          revisionRef.current = updated.chat.revision;
          props.onChatChange(updated);
          if (draftRef.current === value) setDraft(updated.chat.draft);
        });
      draftQueue.current = task;
      return task;
    },
    [acceptChat, chat.chat.draft, chat.chat.id, chat.chat.revision],
  );

  function editDraft(value: string) {
    draftRef.current = value;
    setDraft(value);
    clearTimeout(draftTimer.current);
    draftTimer.current = setTimeout(() => {
      void persistDraft(value).catch(() =>
        props.setMessageError(
          'O rascunho não foi salvo. Mantenha esta conversa aberta e tente novamente.',
        ),
      );
    }, 350);
  }

  return {
    chat,
    setChat,
    draft,
    setDraft,
    draftRef,
    composing,
    revisionRef,
    draftTimer,
    draftQueue,
    acceptChat,
    persistDraft,
    editDraft,
  };
}
