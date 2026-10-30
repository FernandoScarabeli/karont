import React, { useCallback, useEffect, useState } from 'react';
import type { UiChatDetails, UiDelivery, UiMessage, UiRun } from '../../lib/api';
import type { TerminalEvent } from '../../../../../../packages/contracts/src';
import type { useChatDraft } from './useChatDraft';

function deliveriesByMessage(messages: UiMessage[], deliveries: UiDelivery[]) {
  const result: Record<string, UiDelivery[]> = Object.fromEntries(
    messages.map((message) => [message.id, []]),
  );
  for (const delivery of deliveries) result[delivery.messageId]?.push(delivery);
  return result;
}

export function useChatHistory(props: {
  initial: UiChatDetails;
  chat: UiChatDetails;
  setChat: React.Dispatch<React.SetStateAction<UiChatDetails>>;
  onChatChange(chat: UiChatDetails): void;
  draft: ReturnType<typeof useChatDraft>;
  composerRef: React.RefObject<HTMLTextAreaElement | null>;
  setMessageError(message: string): void;
}) {
  const [messages, setMessages] = useState<UiMessage[]>([]);
  const [deliveries, setDeliveries] = useState<Record<string, UiDelivery[]>>({});
  const [runs, setRuns] = useState<UiRun[]>([]);
  const [nextCursor, setNextCursor] = useState<string | null>(null);

  const loadMessages = useCallback(async () => {
    const page = await window.karont.messages(props.chat.chat.id);
    setMessages(page.items);
    setNextCursor(page.nextCursor);
    setDeliveries(deliveriesByMessage(page.items, page.deliveries));
  }, [props.chat.chat.id]);

  const loadRuns = useCallback(async () => {
    const page = await window.karont.chatRuns(props.chat.chat.id);
    setRuns(page.items);
  }, [props.chat.chat.id]);

  useEffect(() => {
    let mounted = true;
    setMessages([]);
    setDeliveries({});
    setRuns([]);
    props.composerRef.current?.focus();
    props.draft.setDraft(props.initial.chat.draft);
    props.draft.draftRef.current = props.initial.chat.draft;
    props.draft.revisionRef.current = props.initial.chat.revision;
    void Promise.all([
      window.karont.messages(props.initial.chat.id),
      window.karont.chatRuns(props.initial.chat.id),
    ])
      .then(async ([messagePage, runPage]) => {
        if (!mounted) return;
        setMessages(messagePage.items);
        setNextCursor(messagePage.nextCursor);
        setRuns(runPage.items);
        setDeliveries(deliveriesByMessage(messagePage.items, messagePage.deliveries));
      })
      .catch(() => {
        if (mounted)
          props.setMessageError('Não foi possível carregar o histórico local da conversa.');
      });
    const dispose = window.karont.onEvent((event: TerminalEvent) => {
      if (event.type === 'message.created' && event.chatId === props.initial.chat.id)
        void loadMessages().catch(() => {});
      if (event.type === 'message.delivery.updated' && event.chatId === props.initial.chat.id)
        void window.karont
          .messageDeliveries(event.chatId, event.messageId)
          .then((items) => setDeliveries((current) => ({ ...current, [event.messageId]: items })))
          .catch(() => {});
      if (event.type === 'run.updated' && event.run.chatId === props.initial.chat.id) {
        void loadRuns().catch(() => {});
        void props.draft.draftQueue.current
          .catch(() => {})
          .then(() => window.karont.chat(props.initial.chat.id))
          .then((value) => {
            if (mounted && value.chat.revision > props.draft.revisionRef.current) {
              props.draft.revisionRef.current = value.chat.revision;
              props.setChat(value);
              props.onChatChange(value);
            }
          })
          .catch(() => {});
      }
    });
    return () => {
      mounted = false;
      dispose();
      clearTimeout(props.draft.draftTimer.current);
    };
  }, [props.initial.chat.id]);

  async function loadNextMessages() {
    if (!nextCursor) return;
    try {
      const page = await window.karont.messages(props.chat.chat.id, nextCursor);
      setMessages((current) => [
        ...current,
        ...page.items.filter((item) => !current.some((old) => old.id === item.id)),
      ]);
      setNextCursor(page.nextCursor);
      setDeliveries((current) => ({
        ...current,
        ...deliveriesByMessage(page.items, page.deliveries),
      }));
    } catch {
      props.setMessageError('Não foi possível carregar a próxima página do histórico.');
    }
  }

  return { messages, setMessages, deliveries, setDeliveries, runs, nextCursor, loadNextMessages };
}
