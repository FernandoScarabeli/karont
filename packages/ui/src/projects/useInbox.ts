import type { InboxItem } from "@karont/contract";
import { useSyncExternalStore } from "react";
import { getBridge } from "../bridge/index.ts";
import { isStaleListResponse } from "./inboxState.ts";

type Snapshot = { items: InboxItem[]; total: number; loading: boolean; error: boolean };

let snapshot: Snapshot = { items: [], total: 0, loading: true, error: false };
const listeners = new Set<() => void>();
let connected = false;
/** Sobe a cada evento; uma resposta de `inbox.list` mais velha é descartada. */
let version = 0;

function publish(next: Snapshot) {
  snapshot = next;
  for (const listener of listeners) listener();
}

function connect() {
  if (connected) return;
  connected = true;
  const bridge = getBridge();
  if (!bridge) {
    publish({ items: [], total: 0, loading: false, error: false });
    return;
  }
  bridge.onEvent((event) => {
    if (event.event !== "inbox.changed") return;
    version += 1;
    publish({
      items: event.payload.items,
      total: event.payload.total,
      loading: false,
      error: false,
    });
  });
  const requestedAt = version;
  void bridge
    .request("inbox.list", {})
    .then((result) => {
      if (isStaleListResponse(requestedAt, version)) return;
      publish({ items: result.items, total: result.total, loading: false, error: false });
    })
    .catch(() => {
      if (isStaleListResponse(requestedAt, version)) return;
      publish({ ...snapshot, loading: false, error: true });
    });
}

function subscribe(listener: () => void) {
  listeners.add(listener);
  connect();
  return () => {
    listeners.delete(listener);
  };
}

export function useInbox(): Snapshot {
  return useSyncExternalStore(
    subscribe,
    () => snapshot,
    () => snapshot,
  );
}
