export type TerminalSize = { cols: number; rows: number };

export type ResizeQueueState = {
  queuedSize: TerminalSize | null;
  lastSentSize: TerminalSize | null;
  lastResizeAt: number | null;
  timerScheduled: boolean;
};

export type ResizeQueueUpdate = {
  state: ResizeQueueState;
  cancelTimer: boolean;
  scheduleAfter: number | null;
};

export function createResizeQueueState(): ResizeQueueState {
  return {
    queuedSize: null,
    lastSentSize: null,
    lastResizeAt: null,
    timerScheduled: false,
  };
}

export function queueResize(
  state: ResizeQueueState,
  size: TerminalSize,
  now: number,
  interval = 100,
): ResizeQueueUpdate {
  const cancelTimer = state.timerScheduled;
  if (sameSize(size, state.lastSentSize)) {
    return {
      state: { ...state, queuedSize: null, timerScheduled: false },
      cancelTimer,
      scheduleAfter: null,
    };
  }

  const scheduleAfter =
    state.lastResizeAt === null ? 0 : Math.max(0, interval - (now - state.lastResizeAt));
  return {
    state: { ...state, queuedSize: size, timerScheduled: true },
    cancelTimer,
    scheduleAfter,
  };
}

export function flushResize(
  state: ResizeQueueState,
  now: number,
): { state: ResizeQueueState; size: TerminalSize | null } {
  if (!state.timerScheduled || !state.queuedSize) {
    return { state: { ...state, queuedSize: null, timerScheduled: false }, size: null };
  }

  const size = state.queuedSize;
  return {
    state: {
      ...state,
      queuedSize: null,
      lastSentSize: size,
      lastResizeAt: now,
      timerScheduled: false,
    },
    size,
  };
}

function sameSize(left: TerminalSize | null, right: TerminalSize | null): boolean {
  return left !== null && right !== null && left.cols === right.cols && left.rows === right.rows;
}
