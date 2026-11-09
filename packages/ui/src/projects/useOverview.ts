import type { OverviewWorkspace } from "@karont/contract";
import { useEffect, useSyncExternalStore } from "react";
import { getBridge } from "../bridge/index.ts";
import { createReloadScheduler, isOverviewReloadEvent } from "./overviewReload.ts";
import { localDayKey, startOfLocalDay } from "./overviewSummary.ts";

type Snapshot = { workspaces: OverviewWorkspace[] | null; error: boolean };

const RELOAD_INTERVAL_MS = 1000;

let snapshot: Snapshot = { workspaces: null, error: false };
let loadedDay = "";
/** Quantas telas que mostram o resumo estão à vista agora. */
let activeScreens = 0;
let started = false;
const listeners = new Set<() => void>();

function publish(next: Snapshot) {
  snapshot = next;
  for (const listener of listeners) listener();
}

async function load() {
  const bridge = getBridge();
  if (!bridge) return;
  const now = new Date();
  try {
    // `since` é recalculado a cada requisição: o dia pode virar com o app aberto.
    const result = await bridge.request("overview.get", { since: startOfLocalDay(now) });
    loadedDay = localDayKey(now);
    publish({ workspaces: result.workspaces, error: false });
  } catch {
    // Os números anteriores continuam na tela; só avisa se nunca houve nenhum.
    publish({ ...snapshot, error: true });
  }
}

const scheduler = createReloadScheduler({
  load,
  canRun: () => activeScreens > 0 && document.visibilityState === "visible",
  minIntervalMs: RELOAD_INTERVAL_MS,
  now: () => Date.now(),
  setTimer: (callback, ms) => window.setTimeout(callback, ms),
  clearTimer: (handle) => window.clearTimeout(handle as number),
});

function start() {
  if (started) return;
  started = true;
  scheduler.markDirty();
  getBridge()?.onEvent((event) => {
    if (isOverviewReloadEvent(event.event)) scheduler.markDirty();
  });
  document.addEventListener("visibilitychange", () => {
    if (document.visibilityState === "visible") wake();
  });
}

function wake() {
  if (loadedDay && loadedDay !== localDayKey(new Date())) scheduler.markDirty();
  else scheduler.resume();
}

function subscribe(listener: () => void) {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

/**
 * Resumo agregado por workspace e projeto. Use só em telas à vista: enquanto nenhuma está, nada é
 * pedido. Os números ficam guardados entre uma tela e outra, então trocar de tela não pisca.
 */
export function useOverview(): Snapshot {
  useEffect(() => {
    activeScreens += 1;
    start();
    wake();
    return () => {
      activeScreens -= 1;
    };
  }, []);
  return useSyncExternalStore(
    subscribe,
    () => snapshot,
    () => snapshot,
  );
}
