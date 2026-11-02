import type { AnyEvent, Conversation, ConversationMessage, MessagePart } from "@karont/contract";
import { BridgeError } from "@karont/contract";
import { useCallback, useEffect, useMemo, useReducer, useRef } from "react";
import { getBridge } from "../bridge/index.ts";
import { t } from "../i18n/pt-BR.ts";
import { cacheConversationSnapshot, getConversationSnapshot } from "./conversationCache.ts";
import { INITIAL_MESSAGE_WINDOW_SIZE } from "./messageWindow.ts";

export type State = {
  conversation: Conversation | null;
  messageIds: string[];
  messagesById: Record<string, ConversationMessage>;
  loading: boolean;
  hasOlderMessages: boolean;
  error: string;
  liveText: string;
  responseFinishedId: string | null;
};

export type Action =
  | { type: "conversation"; conversation: Conversation }
  | { type: "message"; message: ConversationMessage }
  | {
      type: "loaded";
      conversation: Conversation;
      messages: ConversationMessage[];
      hasOlderMessages: boolean;
    }
  | { type: "olderLoaded"; messages: ConversationMessage[]; hasOlderMessages: boolean }
  | { type: "event"; event: AnyEvent }
  | {
      type: "deltas";
      deltas: Array<{
        partId: string;
        messageId: string;
        startOffset?: number;
        delta: string;
        startedAt?: number;
        endedAt?: number;
      }>;
    }
  | { type: "failed"; error: string };

const initialState: State = {
  conversation: null,
  messageIds: [],
  messagesById: {},
  loading: true,
  hasOlderMessages: false,
  error: "",
  liveText: "",
  responseFinishedId: null,
};

export function useConversation(conversationId: string) {
  const [state, dispatch] = useReducer(reducer, conversationId, createInitialState);

  const messages = useMemo(
    () =>
      state.messageIds
        .map((id) => state.messagesById[id])
        .filter((message): message is ConversationMessage => message !== undefined),
    [state.messageIds, state.messagesById],
  );
  const messagesRef = useRef(messages);
  messagesRef.current = messages;
  const hasOlderMessagesRef = useRef(state.hasOlderMessages);
  hasOlderMessagesRef.current = state.hasOlderMessages;
  const conversationIdRef = useRef(conversationId);
  conversationIdRef.current = conversationId;

  useEffect(() => {
    if (!state.conversation) return;
    cacheConversationSnapshot({
      conversation: state.conversation,
      messages,
      hasOlderMessages: state.hasOlderMessages,
    });
  }, [messages, state.conversation, state.hasOlderMessages]);

  useEffect(() => {
    const bridge = getBridge();
    if (!bridge) {
      dispatch({ type: "failed", error: t.conversation.noBridge });
      return;
    }

    let mounted = true;
    let loaded = false;
    let queued: AnyEvent[] = [];
    const pendingDeltas = new Map<
      string,
      {
        partId: string;
        messageId: string;
        startOffset: number;
        delta: string;
        startedAt?: number;
        endedAt?: number;
      }
    >();
    let flushTimer: number | null = null;

    const flushDeltas = () => {
      if (flushTimer !== null) window.clearTimeout(flushTimer);
      flushTimer = null;
      if (!mounted || pendingDeltas.size === 0) return;
      dispatch({ type: "deltas", deltas: [...pendingDeltas.values()] });
      pendingDeltas.clear();
    };

    const dispatchEvent = (event: AnyEvent) => {
      if (event.event === "conversation.partUpdated" && event.payload.kind === "delta") {
        const key = `${event.payload.messageId}:${event.payload.partId}`;
        const current = pendingDeltas.get(key);
        pendingDeltas.set(key, {
          partId: event.payload.partId,
          messageId: event.payload.messageId,
          startOffset: current?.startOffset ?? event.payload.startOffset,
          delta: `${current?.delta ?? ""}${event.payload.delta}`,
          ...(current?.startedAt !== undefined || event.payload.startedAt !== undefined
            ? { startedAt: current?.startedAt ?? event.payload.startedAt }
            : {}),
          ...(event.payload.endedAt !== undefined || current?.endedAt !== undefined
            ? { endedAt: event.payload.endedAt ?? current?.endedAt }
            : {}),
        });
        if (flushTimer === null) {
          flushTimer = window.setTimeout(flushDeltas, 64);
        }
        return;
      }
      flushDeltas();
      dispatch({ type: "event", event });
    };

    const unsubscribe = bridge.onEvent((event) => {
      if (!isConversationEvent(event, conversationId)) return;
      if (!loaded) {
        queued.push(event);
        return;
      }
      dispatchEvent(event);
    });

    void bridge
      .request("conversation.get", { id: conversationId, limit: INITIAL_MESSAGE_WINDOW_SIZE })
      .then((result) => {
        if (!mounted) return;
        dispatch({
          type: "loaded",
          conversation: result.conversation,
          messages: result.messages,
          hasOlderMessages: result.hasOlderMessages,
        });
        loaded = true;
        for (const event of queued) dispatchEvent(event);
        queued = [];
      })
      .catch((error: unknown) => {
        if (!mounted) return;
        dispatch({
          type: "failed",
          error: error instanceof BridgeError && error.message ? error.message : t.chat.loadFailed,
        });
      });

    return () => {
      mounted = false;
      unsubscribe();
      if (flushTimer !== null) window.clearTimeout(flushTimer);
    };
  }, [conversationId]);

  const addMessage = useCallback(
    (message: ConversationMessage) => dispatch({ type: "message", message }),
    [],
  );
  const updateConversation = useCallback(
    (conversation: Conversation) => dispatch({ type: "conversation", conversation }),
    [],
  );
  const fetchOlderMessages = useCallback(
    async (before: string): Promise<number | null> => {
      const bridge = getBridge();
      if (!bridge) return null;
      try {
        const result = await bridge.request("conversation.get", {
          id: conversationId,
          limit: INITIAL_MESSAGE_WINDOW_SIZE,
          before,
        });
        dispatch({
          type: "olderLoaded",
          messages: result.messages,
          hasOlderMessages: result.hasOlderMessages,
        });
        return result.messages.length;
      } catch {
        return null;
      }
    },
    [conversationId],
  );

  const fetchAllOlderMessages = useCallback(async (): Promise<number | null> => {
    const bridge = getBridge();
    if (!bridge) return null;

    let before = messagesRef.current[0]?.id;
    let hasOlderMessages = hasOlderMessagesRef.current;
    const olderMessages: ConversationMessage[] = [];

    try {
      while (before && hasOlderMessages) {
        const result = await bridge.request("conversation.get", {
          id: conversationId,
          limit: 100,
          before,
        });
        if (conversationIdRef.current !== conversationId) return null;
        if (result.messages.length === 0) {
          hasOlderMessages = false;
          break;
        }
        olderMessages.unshift(...result.messages);
        before = result.messages[0]?.id;
        hasOlderMessages = result.hasOlderMessages;
      }
      if (conversationIdRef.current !== conversationId) return null;
      dispatch({ type: "olderLoaded", messages: olderMessages, hasOlderMessages });
      return olderMessages.length;
    } catch {
      return null;
    }
  }, [conversationId]);

  return {
    ...state,
    messages,
    addMessage,
    updateConversation,
    fetchOlderMessages,
    fetchAllOlderMessages,
  };
}

function createInitialState(conversationId: string): State {
  const snapshot = getConversationSnapshot(conversationId);
  if (!snapshot) return initialState;
  const messagesById: Record<string, ConversationMessage> = {};
  const messageIds: string[] = [];
  for (const message of snapshot.messages) {
    messagesById[message.id] = message;
    messageIds.push(message.id);
  }
  return {
    ...initialState,
    conversation: snapshot.conversation,
    messageIds,
    messagesById,
    hasOlderMessages: snapshot.hasOlderMessages,
  };
}

export function reducer(state: State, action: Action): State {
  if (action.type === "message") return upsertMessage(state, action.message);
  if (action.type === "conversation") return { ...state, conversation: action.conversation };
  if (action.type === "loaded") {
    const sameConversation = state.conversation?.id === action.conversation.id;
    const currentMessages = sameConversation
      ? state.messageIds.flatMap((id) => {
          const message = state.messagesById[id];
          return message ? [message] : [];
        })
      : [];
    const merged = mergeLatestMessages(currentMessages, action.messages);
    return {
      ...state,
      conversation: action.conversation,
      messageIds: merged.map((message) => message.id),
      messagesById: Object.fromEntries(merged.map((message) => [message.id, message])),
      loading: false,
      hasOlderMessages: action.hasOlderMessages,
      error: "",
    };
  }

  if (action.type === "olderLoaded") {
    const currentMessages = state.messageIds.flatMap((id) => {
      const message = state.messagesById[id];
      return message ? [message] : [];
    });
    const merged = mergeOlderMessages(action.messages, currentMessages);
    return {
      ...state,
      messageIds: merged.map((message) => message.id),
      messagesById: Object.fromEntries(merged.map((message) => [message.id, message])),
      hasOlderMessages: action.hasOlderMessages,
    };
  }

  if (action.type === "failed") return { ...state, loading: false, error: action.error };

  if (action.type === "event") {
    if (action.event.event === "conversation.messageCreated") {
      return upsertMessage(state, action.event.payload.message);
    }
    if (
      action.event.event === "conversation.partUpdated" &&
      action.event.payload.kind === "upsert"
    ) {
      return updatePart(state, action.event.payload.messageId, action.event.payload.part);
    }
    if (action.event.event === "conversation.stateChanged") {
      let next = { ...state, conversation: action.event.payload.conversation };
      if ("messageId" in action.event.payload) {
        const message = next.messagesById[action.event.payload.messageId];
        if (message) {
          const { messageStartedAt, messageEndedAt } = action.event.payload;
          next = {
            ...next,
            messagesById: {
              ...next.messagesById,
              [message.id]: {
                ...message,
                status: action.event.payload.messageStatus,
                ...(messageStartedAt !== undefined ? { startedAt: messageStartedAt } : {}),
                ...(messageEndedAt !== undefined ? { endedAt: messageEndedAt } : {}),
              },
            },
          };
        }
        if (
          action.event.payload.messageStatus === "done" ||
          action.event.payload.messageStatus === "error"
        ) {
          next = { ...next, responseFinishedId: action.event.payload.messageId };
        }
      }
      return next;
    }
    return state;
  }

  const { state: next, liveText } = appendDeltaBatch(state, action.deltas);
  return { ...next, liveText };
}

function mergeLatestMessages(
  current: ConversationMessage[],
  latestPage: ConversationMessage[],
): ConversationMessage[] {
  if (current.length === 0) return latestPage;
  const latestIds = new Set(latestPage.map((message) => message.id));
  const overlapIndex = current.findIndex((message) => latestIds.has(message.id));
  const preserved = overlapIndex < 0 ? [] : current.slice(0, overlapIndex);
  return mergeInOrder(preserved, latestPage);
}

function mergeOlderMessages(
  olderPage: ConversationMessage[],
  current: ConversationMessage[],
): ConversationMessage[] {
  return mergeInOrder(olderPage, current);
}

function mergeInOrder(
  earlier: ConversationMessage[],
  later: ConversationMessage[],
): ConversationMessage[] {
  const messagesById = new Map<string, ConversationMessage>();
  const ids: string[] = [];
  for (const message of [...earlier, ...later]) {
    if (!messagesById.has(message.id)) ids.push(message.id);
    messagesById.set(message.id, message);
  }
  return ids.flatMap((id) => {
    const message = messagesById.get(id);
    return message ? [message] : [];
  });
}

function upsertMessage(state: State, message: ConversationMessage): State {
  const current = state.messagesById[message.id];
  if (
    current &&
    (message.status === "streaming" ||
      current.updatedAt > message.updatedAt ||
      current.parts.length > message.parts.length)
  ) {
    return state;
  }
  const exists = current !== undefined;
  return {
    ...state,
    messageIds: exists ? state.messageIds : [...state.messageIds, message.id],
    messagesById: { ...state.messagesById, [message.id]: message },
  };
}

function updatePart(state: State, messageId: string, part: MessagePart): State {
  const message = state.messagesById[messageId];
  if (!message) return state;
  const partIndex = message.parts.findIndex((current) => current.id === part.id);
  const parts = [...message.parts];
  if (partIndex < 0) parts.push(part);
  else parts[partIndex] = part;
  return {
    ...state,
    messagesById: { ...state.messagesById, [messageId]: { ...message, parts } },
  };
}

function appendDeltaBatch(
  state: State,
  deltas: Array<{
    partId: string;
    messageId: string;
    startOffset?: number;
    delta: string;
    startedAt?: number;
    endedAt?: number;
  }>,
): { state: State; liveText: string } {
  const changedMessages = new Map<string, { message: ConversationMessage; parts: MessagePart[] }>();
  let liveText = "";
  for (const delta of deltas) {
    const current = changedMessages.get(delta.messageId);
    const message = current?.message ?? state.messagesById[delta.messageId];
    if (!message) continue;
    const parts = current?.parts ?? [...message.parts];
    const partIndex = parts.findIndex((part) => part.id === delta.partId);
    if (partIndex < 0) continue;
    const part = parts[partIndex];
    if (part?.type === "text") {
      const skipped =
        delta.startOffset === undefined ? 0 : Math.max(0, part.markdown.length - delta.startOffset);
      const appended = delta.delta.slice(skipped);
      if (!appended) continue;
      parts[partIndex] = {
        ...part,
        markdown: `${part.markdown}${appended}`,
        ...(delta.startedAt !== undefined ? { startedAt: delta.startedAt } : {}),
        ...(delta.endedAt !== undefined ? { endedAt: delta.endedAt } : {}),
      };
      liveText += appended;
    } else if (part?.type === "thinking") {
      const skipped =
        delta.startOffset === undefined ? 0 : Math.max(0, part.text.length - delta.startOffset);
      const appended = delta.delta.slice(skipped);
      if (!appended) continue;
      parts[partIndex] = {
        ...part,
        text: `${part.text}${appended}`,
        ...(delta.startedAt !== undefined ? { startedAt: delta.startedAt } : {}),
        ...(delta.endedAt !== undefined ? { endedAt: delta.endedAt } : {}),
      };
      liveText += appended;
    } else {
      continue;
    }
    changedMessages.set(delta.messageId, { message, parts });
  }
  if (changedMessages.size === 0) return { state, liveText };
  const messagesById = { ...state.messagesById };
  for (const [id, current] of changedMessages) {
    messagesById[id] = { ...current.message, parts: current.parts };
  }
  return { state: { ...state, messagesById }, liveText };
}

function isConversationEvent(event: AnyEvent, conversationId: string): boolean {
  if (event.event === "conversation.messageCreated")
    return event.payload.conversationId === conversationId;
  if (event.event === "conversation.partUpdated")
    return event.payload.conversationId === conversationId;
  if (event.event === "conversation.stateChanged")
    return event.payload.conversation.id === conversationId;
  return false;
}

export type { Conversation, ConversationMessage, MessagePart };
