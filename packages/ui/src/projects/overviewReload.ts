/** Eventos que mudam os números das telas. Delta de texto nunca está aqui. */
const RELOAD_EVENTS = new Set([
  "conversation.stateChanged",
  "projects.changed",
  "workspaces.changed",
  "conversations.workspaceMoved",
]);

export function isOverviewReloadEvent(eventName: string): boolean {
  return RELOAD_EVENTS.has(eventName);
}

export type ReloadScheduler = {
  /** Algo mudou: recarrega no máximo a cada `minIntervalMs`, uma requisição por vez. */
  markDirty: () => void;
  /** A tela voltou a poder carregar (ficou visível): faz a recarga que estava pendente. */
  resume: () => void;
  dispose: () => void;
};

export type ReloadSchedulerOptions = {
  load: () => Promise<void>;
  canRun: () => boolean;
  minIntervalMs: number;
  now: () => number;
  setTimer: (callback: () => void, ms: number) => unknown;
  clearTimer: (handle: unknown) => void;
};

/**
 * Agrupa recargas: no máximo uma requisição em andamento; eventos durante ela viram só mais uma
 * ao terminar; entre o início de duas recargas passa pelo menos `minIntervalMs`. Sem timer
 * periódico: o timer só existe enquanto há recarga pendente.
 */
export function createReloadScheduler(options: ReloadSchedulerOptions): ReloadScheduler {
  let dirty = false;
  let inFlight = false;
  let timer: unknown;
  let hasTimer = false;
  let lastStart = Number.NEGATIVE_INFINITY;
  let disposed = false;

  function clearPending() {
    if (!hasTimer) return;
    options.clearTimer(timer);
    hasTimer = false;
  }

  function schedule() {
    if (disposed || !dirty || inFlight || hasTimer || !options.canRun()) return;
    const wait = Math.max(0, lastStart + options.minIntervalMs - options.now());
    if (wait === 0) {
      run();
      return;
    }
    hasTimer = true;
    timer = options.setTimer(() => {
      hasTimer = false;
      run();
    }, wait);
  }

  function run() {
    if (disposed || !dirty || inFlight || !options.canRun()) return;
    dirty = false;
    inFlight = true;
    lastStart = options.now();
    options
      .load()
      .catch(() => undefined)
      .finally(() => {
        inFlight = false;
        schedule();
      });
  }

  return {
    markDirty() {
      dirty = true;
      schedule();
    },
    resume: schedule,
    dispose() {
      disposed = true;
      clearPending();
    },
  };
}
