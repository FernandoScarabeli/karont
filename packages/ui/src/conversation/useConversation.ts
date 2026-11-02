import type { AnyEvent, Conversation, ConversationMessage, MessagePart } from "@karont/contract";
import { BridgeError } from "@karont/contract";
import { useCallback, useEffect, useMemo, useReducer } from "react";
import { getBridge } from "../bridge/index.ts";
import { t } from "../i18n/pt-BR.ts";
import { cacheConversationSnapshot, getConversationSnapshot } from "./conversationCache.ts";

export type State = {
  conversation: Conversation | null;
  messageIds: string[];
  messagesById: Record<string, ConversationMessage>;
  loading: boolean;
  error: string;
  liveText: string;
  responseFinishedId: string | null;
};

export type Action =
  | { type: "conversation"; conversation: Conversation }
  | { type: "message"; message: ConversationMessage }
  | { type: "loaded"; conversation: Conversation; messages: ConversationMessage[] }
  | { type: "event"; event: AnyEvent }
  | {
      type: "deltas";
      deltas: Array<{
        partId: string;
        messageId: string;
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

  useEffect(() => {
    if (!state.conversation) return;
    cacheConversationSnapshot({ conversation: state.conversation, messages });
  }, [messages, state.conversation]);

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
      .request("conversation.get", { id: conversationId })
      .then((result) => {
        if (!mounted) return;
        dispatch({ type: "loaded", conversation: result.conversation, messages: result.messages });
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

  return { ...state, messages, addMessage, updateConversation };
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
  };
}

export function reducer(state: State, action: Action): State {
  if (action.type === "message") return upsertMessage(state, action.message);
  if (action.type === "conversation") return { ...state, conversation: action.conversation };
  if (action.type === "loaded") {
    const messagesById: Record<string, ConversationMessage> = {};
    const messageIds: string[] = [];
    for (const message of action.messages) {
      messagesById[message.id] = message;
      messageIds.push(message.id);
    }
    return {
      ...state,
      conversation: action.conversation,
      messageIds,
      messagesById,
      loading: false,
      error: "",
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

  let liveText = "";
  for (const delta of action.deltas) liveText += delta.delta;
  return { ...appendDeltaBatch(state, action.deltas), liveText };
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
    delta: string;
    startedAt?: number;
    endedAt?: number;
  }>,
): State {
  const changedMessages = new Map<string, { message: ConversationMessage; parts: MessagePart[] }>();
  for (const delta of deltas) {
    const current = changedMessages.get(delta.messageId);
    const message = current?.message ?? state.messagesById[delta.messageId];
    if (!message) continue;
    const parts = current?.parts ?? [...message.parts];
    const partIndex = parts.findIndex((part) => part.id === delta.partId);
    if (partIndex < 0) continue;
    const part = parts[partIndex];
    if (part?.type === "text") {
      parts[partIndex] = {
        ...part,
        markdown: `${part.markdown}${delta.delta}`,
        ...(delta.startedAt !== undefined ? { startedAt: delta.startedAt } : {}),
        ...(delta.endedAt !== undefined ? { endedAt: delta.endedAt } : {}),
      };
    } else if (part?.type === "thinking") {
      parts[partIndex] = {
        ...part,
        text: `${part.text}${delta.delta}`,
        ...(delta.startedAt !== undefined ? { startedAt: delta.startedAt } : {}),
        ...(delta.endedAt !== undefined ? { endedAt: delta.endedAt } : {}),
      };
    } else {
      continue;
    }
    changedMessages.set(delta.messageId, { message, parts });
  }
  if (changedMessages.size === 0) return state;
  const messagesById = { ...state.messagesById };
  for (const [id, current] of changedMessages) {
    messagesById[id] = { ...current.message, parts: current.parts };
  }
  return { ...state, messagesById };
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
