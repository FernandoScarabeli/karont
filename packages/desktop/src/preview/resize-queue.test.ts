import assert from "node:assert/strict";
import { test } from "node:test";
import {
  createResizeQueueState,
  flushResize,
  queueResize,
  type ResizeQueueState,
  type TerminalSize,
} from "../../../ui/src/terminal/resizeQueue.ts";

class FakeTimers {
  now = 0;
  #nextId = 0;
  #tasks = new Map<number, { at: number; callback: () => void }>();

  setTimeout(callback: () => void, delay: number): number {
    const id = this.#nextId++;
    this.#tasks.set(id, { at: this.now + delay, callback });
    return id;
  }

  clearTimeout(id: number): void {
    this.#tasks.delete(id);
  }

  advance(milliseconds: number): void {
    const end = this.now + milliseconds;
    while (true) {
      const next = [...this.#tasks.entries()]
        .filter(([, task]) => task.at <= end)
        .sort((left, right) => left[1].at - right[1].at)[0];
      if (!next) break;
      const [id, task] = next;
      this.#tasks.delete(id);
      this.now = task.at;
      task.callback();
    }
    this.now = end;
  }
}

test("cancel the pending resize when returning to the last sent size", () => {
  const timers = new FakeTimers();
  const sent: TerminalSize[] = [];
  let state = createResizeQueueState();
  let timerId: number | undefined;

  const schedule = (size: TerminalSize) => {
    const update = queueResize(state, size, timers.now);
    state = update.state;
    if (update.cancelTimer && timerId !== undefined) timers.clearTimeout(timerId);
    timerId = undefined;
    if (update.scheduleAfter === null) return;
    timerId = timers.setTimeout(() => {
      timerId = undefined;
      const flushed = flushResize(state, timers.now);
      state = flushed.state;
      if (flushed.size) sent.push(flushed.size);
    }, update.scheduleAfter);
  };

  schedule({ cols: 100, rows: 30 });
  timers.advance(0);
  schedule({ cols: 120, rows: 30 });
  timers.advance(20);
  schedule({ cols: 100, rows: 30 });
  assert.equal(state.queuedSize, null);
  timers.advance(200);

  assert.deepEqual(sent, [{ cols: 100, rows: 30 }]);
});

test("send the latest queued size after the resize interval", () => {
  const timers = new FakeTimers();
  let state: ResizeQueueState = createResizeQueueState();
  let sent: TerminalSize | null = null;

  const initial = queueResize(state, { cols: 100, rows: 30 }, timers.now);
  state = initial.state;
  timers.setTimeout(() => {
    const flushed = flushResize(state, timers.now);
    state = flushed.state;
    sent = flushed.size;
  }, initial.scheduleAfter ?? 0);
  timers.advance(0);
  assert.deepEqual(sent, { cols: 100, rows: 30 });

  const next = queueResize(state, { cols: 120, rows: 32 }, timers.now);
  state = next.state;
  timers.setTimeout(() => {
    const flushed = flushResize(state, timers.now);
    state = flushed.state;
    sent = flushed.size;
  }, next.scheduleAfter ?? 0);
  timers.advance(99);
  assert.deepEqual(sent, { cols: 100, rows: 30 });
  timers.advance(1);
  assert.deepEqual(sent, { cols: 120, rows: 32 });
});
