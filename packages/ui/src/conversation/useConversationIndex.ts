import type { Conversation } from "@karont/contract";
import { useSyncExternalStore } from "react";
import { getBridge } from "../bridge/index.ts";
import { t } from "../i18n/pt-BR.ts";

type Snapshot = { conversations: Conversation[]; loading: boolean; error: boolean };
let snapshot: Snapshot = { conversations: [], loading: true, error: false };
const listeners = new Set<() => void>();
let initialized = false;

function notify() {
  for (const listener of listeners) listener();
}

function sort(conversations: Conversation[]) {
  return conversations.sort((left, right) => right.updatedAt.localeCompare(left.updatedAt));
}

function upsert(conversation: Conversation) {
  const next = snapshot.conversations.filter((item) => item.id !== conversation.id);
  next.push(conversation);
  snapshot = { ...snapshot, conversations: sort(next) };
  notify();
}

function connect() {
  if (initialized) return;
  initialized = true;
  const bridge = getBridge();
  if (!bridge) {
    snapshot = { conversations: [], loading: false, error: false };
    notify();
    return;
  }

  bridge.onEvent((event) => {
    if (event.event === "conversation.stateChanged") upsert(event.payload.conversation);
  });

  void bridge
    .request("conversation.list", { limit: 500 })
    .then((result) => {
      const merged = new Map(
        result.conversations.map((conversation) => [conversation.id, conversation]),
      );
      for (const current of snapshot.conversations) {
        const fetched = merged.get(current.id);
        if (!fetched || fetched.updatedAt < current.updatedAt) merged.set(current.id, current);
      }
      snapshot = {
        conversations: sort([...merged.values()]),
        loading: false,
        error: false,
      };
      notify();
    })
    .catch(() => {
      snapshot = { ...snapshot, loading: false, error: true };
      notify();
    });
}

export function useConversationIndex() {
  return useSyncExternalStore(
    (listener) => {
      listeners.add(listener);
      connect();
      return () => listeners.delete(listener);
    },
    () => snapshot,
    () => snapshot,
  );
}

export function upsertConversation(conversation: Conversation) {
  connect();
  upsert(conversation);
}

export function conversationIndexErrorText() {
  return t.shell.conversationsLoadError;
}
