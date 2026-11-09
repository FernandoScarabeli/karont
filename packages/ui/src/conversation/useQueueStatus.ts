import type { ResultOf } from "@karont/contract";
import { useSyncExternalStore } from "react";
import { getBridge } from "../bridge/index.ts";

type QueueStatus = ResultOf<"queue.status">;
type Snapshot = { status: QueueStatus | null };

let snapshot: Snapshot = { status: null };
const listeners = new Set<() => void>();
let connected = false;
/** Sobe a cada evento; uma resposta de `queue.status` mais velha é descartada. */
let version = 0;

function publish(next: Snapshot) {
  snapshot = next;
  for (const listener of listeners) listener();
}

function connect() {
  if (connected) return;
  connected = true;
  const bridge = getBridge();
  if (!bridge) return;
  bridge.onEvent((event) => {
    if (event.event !== "queue.changed") return;
    version += 1;
    publish({ status: event.payload });
  });
  const requestedAt = version;
  void bridge
    .request("queue.status", {})
    .then((status) => {
      if (version !== requestedAt) return;
      publish({ status });
    })
    .catch(() => {});
}

export function subscribeQueueStatus(listener: () => void) {
  listeners.add(listener);
  connect();
  return () => {
    listeners.delete(listener);
  };
}

/** Estado da fila de agentes; `status` é `null` até a primeira resposta. */
export function useQueueStatus(): Snapshot {
  return useSyncExternalStore(
    subscribeQueueStatus,
    () => snapshot,
    () => snapshot,
  );
}
