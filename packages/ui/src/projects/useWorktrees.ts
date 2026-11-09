import type { Worktree } from "@karont/contract";
import { useCallback, useSyncExternalStore } from "react";
import { getBridge } from "../bridge/index.ts";
import { pruneRemovedWorktrees } from "../conversation/useConversationIndex.ts";

type Snapshot = { worktrees: Worktree[]; loading: boolean; error: boolean };

const NO_PROJECT: Snapshot = { worktrees: [], loading: false, error: false };
const NOT_LOADED: Snapshot = { worktrees: [], loading: true, error: false };

const snapshots = new Map<string, Snapshot>();
const requested = new Set<string>();
/** Sobe a cada mudança local ou evento do projeto; uma resposta de `worktrees.list` mais velha é descartada. */
const versions = new Map<string, number>();
const listeners = new Set<() => void>();
let connected = false;

function publish(projectId: string, next: Snapshot) {
  snapshots.set(projectId, next);
  for (const listener of listeners) listener();
}

function bump(projectId: string) {
  const version = (versions.get(projectId) ?? 0) + 1;
  versions.set(projectId, version);
  return version;
}

function replaceWorktrees(projectId: string, worktrees: Worktree[]) {
  bump(projectId);
  publish(projectId, { worktrees, loading: false, error: false });
}

function loadWorktrees(projectId: string) {
  if (requested.has(projectId)) return;
  requested.add(projectId);
  const bridge = getBridge();
  if (!bridge) {
    publish(projectId, { worktrees: [], loading: false, error: false });
    return;
  }
  const requestedAt = versions.get(projectId) ?? 0;
  void bridge
    .request("worktrees.list", { projectId })
    .then((result) => {
      if ((versions.get(projectId) ?? 0) !== requestedAt) return;
      publish(projectId, { worktrees: result.worktrees, loading: false, error: false });
    })
    .catch(() => {
      if ((versions.get(projectId) ?? 0) !== requestedAt) return;
      // Deixa tentar de novo na próxima vez que alguém pedir este projeto.
      requested.delete(projectId);
      publish(projectId, { worktrees: [], loading: false, error: true });
    });
}

function connect() {
  if (connected) return;
  connected = true;
  getBridge()?.onEvent((event) => {
    if (event.event === "worktrees.changed") {
      replaceWorktrees(event.payload.projectId, event.payload.worktrees);
    }
  });
}

export function subscribeWorktrees(projectId: string | undefined, listener: () => void) {
  listeners.add(listener);
  connect();
  if (projectId) loadWorktrees(projectId);
  return () => {
    listeners.delete(listener);
  };
}

export function getWorktreesSnapshot(projectId: string | undefined): Snapshot {
  if (!projectId) return NO_PROJECT;
  return snapshots.get(projectId) ?? NOT_LOADED;
}

export function useWorktrees(projectId: string | undefined): Snapshot {
  const subscribe = useCallback(
    (listener: () => void) => subscribeWorktrees(projectId, listener),
    [projectId],
  );
  const getSnapshot = useCallback(() => getWorktreesSnapshot(projectId), [projectId]);
  return useSyncExternalStore(subscribe, getSnapshot, getSnapshot);
}

/** Usado logo depois de `worktrees.create`, para a tela não esperar o evento chegar. */
export function upsertWorktree(worktree: Worktree) {
  const projectId = worktree.projectId;
  if (!projectId) return;
  const current = snapshots.get(projectId)?.worktrees ?? [];
  replaceWorktrees(projectId, [...current.filter((item) => item.id !== worktree.id), worktree]);
}

/** Usado logo depois de `worktrees.remove`. Tira o `worktreeId` das conversas locais. */
export function removeWorktreeFromStore(projectId: string, id: string) {
  const remaining = (snapshots.get(projectId)?.worktrees ?? []).filter((item) => item.id !== id);
  replaceWorktrees(projectId, remaining);
  pruneRemovedWorktrees(projectId, new Set(remaining.map((item) => item.id)));
}
