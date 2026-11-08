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
const loadGeneration: Record<Bucket, number> = { active: 0, archived: 0 };

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
  const generation = loadGeneration[bucket];
  void bridge
    .request("conversation.list", { archived: bucket === "archived", limit: 500 })
    .then((result) => {
      if (loadGeneration[bucket] !== generation) return;
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
      if (loadGeneration[bucket] !== generation) return;
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
    if (event.event === "conversation.deletedAll") {
      clearAllConversationsFromIndex();
      return;
    }
    if (event.event === "conversation.removed") {
      removeConversationFromIndex(event.payload.id);
      return;
    }
    if (event.event === "projects.changed") {
      pruneRemovedProjects(new Set(event.payload.projects.map((project) => project.id)));
      return;
    }
    if (event.event !== "conversation.stateChanged") return;
    applyConversationStateChange(event.payload.conversation);
  });
  loadBucket("active");
}

export function subscribeConversationIndex(bucket: Bucket, listener: () => void) {
  listeners[bucket].add(listener);
  connect();
  if (bucket === "archived") loadBucket("archived");
  return () => {
    listeners[bucket].delete(listener);
  };
}

export function useConversationIndex(archived = false) {
  const bucket: Bucket = archived ? "archived" : "active";
  return useSyncExternalStore(
    (listener) => subscribeConversationIndex(bucket, listener),
    () => snapshots[bucket],
    () => snapshots[bucket],
  );
}

export function getConversationIndexEntry(id: string): Conversation | null {
  if (deletedIds.has(id)) return null;
  return (
    latestConversations.get(id) ??
    snapshots.active.conversations.find((conversation) => conversation.id === id) ??
    snapshots.archived.conversations.find((conversation) => conversation.id === id) ??
    null
  );
}

export function useConversationIndexEntry(id: string): Conversation | null {
  return useSyncExternalStore(
    (listener) => {
      listeners.active.add(listener);
      listeners.archived.add(listener);
      connect();
      return () => {
        listeners.active.delete(listener);
        listeners.archived.delete(listener);
      };
    },
    () => getConversationIndexEntry(id),
    () => getConversationIndexEntry(id),
  );
}

export function upsertConversation(conversation: Conversation) {
  latestConversations.set(conversation.id, conversation);
  deletedIds.delete(conversation.id);
  applyToBucket("active", conversation);
  applyToBucket("archived", conversation);
}

export function applyConversationStateChange(conversation: Conversation): boolean {
  if (deletedIds.has(conversation.id)) return false;
  latestConversations.set(conversation.id, conversation);
  applyToBucket("active", conversation);
  applyToBucket("archived", conversation);
  return true;
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

function withoutProjectId(conversation: Conversation): Conversation {
  const { projectId: _removed, ...rest } = conversation;
  return rest;
}

/**
 * Remover um projeto não emite `conversation.stateChanged` e o `updatedAt` não muda,
 * então recarregar a lista não corrigiria a cópia local. Tiramos o `projectId` que
 * não existe mais, sem mexer em `updatedAt`.
 */
export function pruneRemovedProjects(existingProjectIds: ReadonlySet<string>) {
  const isStale = (conversation: Conversation) =>
    conversation.projectId !== undefined && !existingProjectIds.has(conversation.projectId);

  for (const [id, conversation] of latestConversations) {
    if (isStale(conversation)) latestConversations.set(id, withoutProjectId(conversation));
  }
  for (const bucket of ["active", "archived"] as const) {
    const current = snapshots[bucket];
    if (!current.conversations.some(isStale)) continue;
    snapshots[bucket] = {
      ...current,
      conversations: current.conversations.map((conversation) =>
        isStale(conversation) ? withoutProjectId(conversation) : conversation,
      ),
    };
    notify(bucket);
  }
}

export function clearAllConversationsFromIndex() {
  for (const id of latestConversations.keys()) deletedIds.add(id);
  latestConversations.clear();
  for (const bucket of ["active", "archived"] as const) {
    loadGeneration[bucket] += 1;
    for (const conversation of snapshots[bucket].conversations) deletedIds.add(conversation.id);
    snapshots[bucket] = { conversations: [], loading: false, error: false };
    notify(bucket);
  }
  activeRequested = true;
  archivedRequested = true;
}

export function conversationIndexErrorText() {
  return t.shell.conversationsLoadError;
}
