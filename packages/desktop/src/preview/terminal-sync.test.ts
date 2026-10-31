import assert from "node:assert/strict";
import { test } from "node:test";
import {
  completeTerminalAttach,
  consumePendingReconnect,
  createTerminalSyncState,
  decideTerminalEvent,
} from "../../../ui/src/terminal/terminalSync.ts";

function attachedState() {
  return completeTerminalAttach(createTerminalSyncState(), 10);
}

test("applies the next output and ignores duplicates or unrelated terminals", () => {
  const state = attachedState();
  const applied = decideTerminalEvent(state, { type: "output", id: "term-1", seq: 11 }, "term-1");
  assert.equal(applied.decision, "apply");
  assert.equal(applied.state.lastSeq, 11);

  const duplicate = decideTerminalEvent(
    state,
    {
      type: "output",
      id: "term-1",
      seq: 10,
    },
    "term-1",
  );
  assert.equal(duplicate.decision, "ignore");

  const unrelated = decideTerminalEvent(
    state,
    {
      type: "resync",
      id: "term-2",
    },
    "term-1",
  );
  assert.equal(unrelated.decision, "ignore");
});

test("requests one re-attach for a sequence gap, resync, or reconnect", () => {
  const gap = decideTerminalEvent(
    attachedState(),
    { type: "output", id: "term-1", seq: 12 },
    "term-1",
  );
  assert.equal(gap.decision, "reattach");
  assert.equal(gap.state.attaching, true);
  assert.equal(
    decideTerminalEvent(gap.state, { type: "resync", id: "term-1" }, "term-1").decision,
    "ignore",
  );

  const resync = decideTerminalEvent(attachedState(), { type: "resync", id: "term-1" }, "term-1");
  assert.equal(resync.decision, "reattach");

  const disconnected = decideTerminalEvent(
    attachedState(),
    { type: "bridge.status", state: "disconnected" },
    "term-1",
  );
  const reconnected = decideTerminalEvent(
    disconnected.state,
    { type: "bridge.status", state: "connected" },
    "term-1",
  );
  assert.equal(reconnected.decision, "reattach");
});

test("não inicia dois attaches e repete a associação se a ponte reconectar no meio", () => {
  const disconnected = decideTerminalEvent(
    createTerminalSyncState(),
    {
      type: "bridge.status",
      state: "disconnected",
    },
    "term-1",
  );
  const reconnected = decideTerminalEvent(
    disconnected.state,
    { type: "bridge.status", state: "connected" },
    "term-1",
  );
  assert.equal(reconnected.decision, "ignore");
  assert.equal(reconnected.state.reconnectPending, true);

  const completed = completeTerminalAttach(reconnected.state, 4);
  const pending = consumePendingReconnect(completed);
  assert.equal(pending.decision, "reattach");
  assert.equal(pending.state.attaching, true);
  assert.equal(pending.state.reconnectPending, false);
});
