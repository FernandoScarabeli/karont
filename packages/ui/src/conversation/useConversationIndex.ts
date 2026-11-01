import type { Conversation } from "@karont/contract";
import { useSyncExternalStore } from "react";
import { getBridge } from "../bridge/index.ts";
import { t } from "../i18n/pt-BR.ts";

type Snapshot = { conversations: Conversation[]; loading: boolean; error: boolean };
type Bucket = "active" | "archived";

const snapshots: Record<Bucket, Snapshot> = {
  active: { conversations: [], loading: true, error: false },
  archived: { conversations: [], loading: true, error: false },
};
const listeners: Record<Bucket, Set<() => void>> = {
  active: new Set(),
  archived: new Set(),
};
const latestConversations = new Map<string, Conversation>();
const deletedIds = new Set<string>();
let connected = false;
let activeRequested = false;
let archivedRequested = false;

function notify(bucket: Bucket) {
  for (const listener of listeners[bucket]) listener();
}

function sort(conversations: Conversation[]) {
  return conversations.sort((left, right) => {
    if (left.pinnedAt && right.pinnedAt) return right.pinnedAt.localeCompare(left.pinnedAt);
    if (left.pinnedAt) return -1;
    if (right.pinnedAt) return 1;
    return right.updatedAt.localeCompare(left.updatedAt);
  });
}

function belongsTo(conversation: Conversation, bucket: Bucket) {
  return Boolean(conversation.archivedAt) === (bucket === "archived");
}

function applyToBucket(bucket: Bucket, conversation: Conversation) {
  const current = snapshots[bucket];
  const exists = current.conversations.some((item) => item.id === conversation.id);
  if (!belongsTo(conversation, bucket) && !exists) return;
  const next = current.conversations.filter((item) => item.id !== conversation.id);
  if (belongsTo(conversation, bucket)) next.push(conversation);
  snapshots[bucket] = { ...current, conversations: sort(next) };
  notify(bucket);
}

function loadBucket(bucket: Bucket) {
  if (bucket === "active") {
    if (activeRequested) return;
    activeRequested = true;
  } else {
    if (archivedRequested) return;
    archivedRequested = true;
  }

  const bridge = getBridge();
  if (!bridge) {
    snapshots[bucket] = { conversations: [], loading: false, error: false };
    notify(bucket);
    return;
  }

  snapshots[bucket] = { ...snapshots[bucket], loading: true, error: false };
  notify(bucket);
  void bridge
    .request("conversation.list", { archived: bucket === "archived", limit: 500 })
    .then((result) => {
      const merged = new Map(
        result.conversations.map((conversation) => [conversation.id, conversation]),
      );
      for (const [id, latest] of latestConversations) {
        if (deletedIds.has(id)) {
          merged.delete(id);
          continue;
        }
        const fetched = merged.get(id);
        if (!fetched || latest.updatedAt >= fetched.updatedAt) {
          merged.delete(id);
          if (belongsTo(latest, bucket)) merged.set(id, latest);
        }
      }
      snapshots[bucket] = {
        conversations: sort([...merged.values()]),
        loading: false,
        error: false,
      };
      notify(bucket);
    })
    .catch(() => {
      snapshots[bucket] = { ...snapshots[bucket], loading: false, error: true };
      notify(bucket);
    });
}

function connect() {
  if (connected) return;
  connected = true;
  const bridge = getBridge();
  if (!bridge) {
    snapshots.active = { conversations: [], loading: false, error: false };
    notify("active");
    return;
  }

  bridge.onEvent((event) => {
    if (event.event !== "conversation.stateChanged") return;
    const conversation = event.payload.conversation;
    latestConversations.set(conversation.id, conversation);
    deletedIds.delete(conversation.id);
    applyToBucket("active", conversation);
    applyToBucket("archived", conversation);
  });
  loadBucket("active");
}

export function useConversationIndex(archived = false) {
  const bucket: Bucket = archived ? "archived" : "active";
  return useSyncExternalStore(
    (listener) => {
      listeners[bucket].add(listener);
      connect();
      if (archived) loadBucket("archived");
      return () => listeners[bucket].delete(listener);
    },
    () => snapshots[bucket],
    () => snapshots[bucket],
  );
}

export function upsertConversation(conversation: Conversation) {
  latestConversations.set(conversation.id, conversation);
  deletedIds.delete(conversation.id);
  applyToBucket("active", conversation);
  applyToBucket("archived", conversation);
}

export function removeConversationFromIndex(id: string) {
  deletedIds.add(id);
  latestConversations.delete(id);
  for (const bucket of ["active", "archived"] as const) {
    const current = snapshots[bucket];
    const conversations = current.conversations.filter((conversation) => conversation.id !== id);
    if (conversations.length === current.conversations.length) continue;
    snapshots[bucket] = { ...current, conversations };
    notify(bucket);
  }
}

export function conversationIndexErrorText() {
  return t.shell.conversationsLoadError;
}
