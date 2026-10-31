import assert from "node:assert/strict";
import { test } from "node:test";
import { DeltaCoalescer } from "./coalescer.ts";

function fakeTimers() {
  const callbacks: Array<() => void> = [];
  return {
    callbacks,
    setTimeout: (callback: () => void) => {
      callbacks.push(callback);
      return callbacks.length as unknown as ReturnType<typeof setTimeout>;
    },
    clearTimeout: () => undefined,
  };
}

test("junta texto na janela e end envia o restante", async () => {
  const timers = fakeTimers();
  const flushed: string[] = [];
  const coalescer = new DeltaCoalescer(
    async (text) => {
      flushed.push(text);
    },
    {
      ...timers,
      intervalMs: 50,
    },
  );
  await coalescer.add("um");
  await coalescer.add(" dois");
  timers.callbacks[0]?.();
  await coalescer.end();
  assert.deepEqual(flushed, ["um dois"]);
});

test("respeita maxChunkBytes em UTF-8 sem partir caractere", async () => {
  const flushed: string[] = [];
  const coalescer = new DeltaCoalescer(
    async (text) => {
      flushed.push(text);
    },
    { maxChunkBytes: 4 },
  );
  await coalescer.add("ab😀cd");
  await coalescer.end();
  assert.deepEqual(flushed, ["ab", "😀", "cd"]);
  assert.equal(
    flushed.every((text) => Buffer.byteLength(text, "utf8") <= 4),
    true,
  );
});

test("flush roda um por vez em ordem e propaga backpressure", async () => {
  const started: string[] = [];
  const releases: Array<() => void> = [];
  let active = 0;
  let maxActive = 0;
  const coalescer = new DeltaCoalescer(
    async (text) => {
      active += 1;
      maxActive = Math.max(maxActive, active);
      started.push(text);
      await new Promise<void>((resolve) => releases.push(resolve));
      active -= 1;
    },
    { maxChunkBytes: 4 },
  );

  const first = coalescer.add("abcd");
  await waitUntil(() => started.length === 1);
  const second = coalescer.add("efgh");
  await Promise.resolve();
  assert.deepEqual(started, ["abcd"]);
  releases.shift()?.();
  await first;
  await waitUntil(() => started.length === 2);
  assert.deepEqual(started, ["abcd", "efgh"]);
  releases.shift()?.();
  await second;
  await coalescer.end();
  assert.equal(maxActive, 1);
});

async function waitUntil(condition: () => boolean): Promise<void> {
  for (let attempt = 0; attempt < 20 && !condition(); attempt += 1) {
    await new Promise<void>((resolve) => setImmediate(resolve));
  }
  assert.equal(condition(), true);
}
