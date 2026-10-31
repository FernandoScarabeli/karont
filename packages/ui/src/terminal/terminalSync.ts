export type TerminalSyncState = {
  attached: boolean;
  attaching: boolean;
  disconnected: boolean;
  reconnectPending: boolean;
  lastSeq: number;
};

export type TerminalSyncEvent =
  | { type: "output"; id: string; seq: number }
  | { type: "resync"; id: string }
  | { type: "bridge.status"; state: "connecting" | "connected" | "disconnected" };

export type TerminalSyncDecision = {
  decision: "apply" | "ignore" | "reattach";
  state: TerminalSyncState;
};

export function createTerminalSyncState(): TerminalSyncState {
  return {
    attached: false,
    attaching: true,
    disconnected: false,
    reconnectPending: false,
    lastSeq: -1,
  };
}

export function decideTerminalEvent(
  state: TerminalSyncState,
  event: TerminalSyncEvent,
  terminalId: string,
): TerminalSyncDecision {
  if (event.type === "bridge.status") {
    if (event.state === "disconnected") {
      return { decision: "ignore", state: { ...state, disconnected: true } };
    }
    if (event.state !== "connected" || !state.disconnected) {
      return { decision: "ignore", state };
    }

    const nextState = { ...state, disconnected: false };
    if (state.attaching) {
      return { decision: "ignore", state: { ...nextState, reconnectPending: true } };
    }
    return { decision: "reattach", state: { ...nextState, attaching: true } };
  }

  if (event.id !== terminalId || !state.attached || state.attaching) {
    return { decision: "ignore", state };
  }
  if (event.type === "resync") {
    return { decision: "reattach", state: { ...state, attaching: true } };
  }
  if (event.seq <= state.lastSeq) return { decision: "ignore", state };
  if (event.seq > state.lastSeq + 1) {
    return { decision: "reattach", state: { ...state, attaching: true } };
  }
  return { decision: "apply", state: { ...state, lastSeq: event.seq } };
}

export function completeTerminalAttach(state: TerminalSyncState, seq: number): TerminalSyncState {
  return { ...state, attached: true, attaching: false, lastSeq: seq };
}

export function failTerminalAttach(state: TerminalSyncState): TerminalSyncState {
  return { ...state, attaching: false };
}

export function consumePendingReconnect(state: TerminalSyncState): TerminalSyncDecision {
  if (!state.reconnectPending || state.attaching) return { decision: "ignore", state };
  return {
    decision: "reattach",
    state: { ...state, attaching: true, reconnectPending: false },
  };
}
