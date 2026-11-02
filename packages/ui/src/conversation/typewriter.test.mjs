import assert from "node:assert/strict";
import test from "node:test";
import {
  alignRevealEnd,
  DRAIN_MS,
  getCharsPerSecond,
  getRevealCeiling,
  planCharRelease,
} from "./typewriter.ts";

test("ritmo base é cerca de 220 caracteres por segundo e cresce com o atraso", () => {
  assert.equal(getCharsPerSecond(0), 220);
  assert.ok(getCharsPerSecond(100) > getCharsPerSecond(10));
  assert.equal(getCharsPerSecond(1_000_000), 1200);
});

test("libera caracteres no ritmo e guarda a fração para o próximo quadro", () => {
  // Atraso pequeno: 220 caracteres por segundo, ou 0,22 por milissegundo.
  let carry = 0;
  let released = 0;
  const frames = [];
  for (let frame = 0; frame < 10; frame += 1) {
    const plan = planCharRelease({ backlogChars: 10, elapsedMs: 1, carryChars: carry });
    carry = plan.carryChars;
    released += plan.count;
    frames.push(plan.count);
  }
  assert.equal(
    frames.slice(0, 4).every((count) => count === 0),
    true,
  );
  assert.equal(released, 2, `liberou ${released} em 10 ms`);
});

test("sem atraso não libera nada", () => {
  assert.deepEqual(planCharRelease({ backlogChars: 0, elapsedMs: 16, done: true }), {
    count: 0,
    carryChars: 0,
    drainMsLeft: DRAIN_MS,
  });
});

test("depois de done, o atraso escoa em até 400 ms", () => {
  for (const backlog of [5, 300, 4000, 20000]) {
    let remaining = backlog;
    let drainMsLeft = DRAIN_MS;
    let carry = 0;
    let elapsedTotal = 0;
    while (remaining > 0 && elapsedTotal < 1000) {
      const plan = planCharRelease({
        backlogChars: remaining,
        elapsedMs: 16,
        done: true,
        carryChars: carry,
        drainMsLeft,
      });
      remaining -= plan.count;
      carry = plan.carryChars;
      drainMsLeft = plan.drainMsLeft;
      elapsedTotal += 16;
    }
    assert.equal(remaining, 0, `backlog ${backlog} não escoou`);
    assert.ok(elapsedTotal <= 400, `backlog ${backlog} levou ${elapsedTotal} ms`);
  }
});

test("fora de done, o ritmo nunca reinicia o prazo de escoamento", () => {
  const plan = planCharRelease({ backlogChars: 50, elapsedMs: 16, done: false, drainMsLeft: 10 });
  assert.equal(plan.drainMsLeft, DRAIN_MS);
});

test("cerca de código incompleta fica de fora até a quebra de linha", () => {
  assert.equal(getRevealCeiling("texto\n```"), "texto\n".length);
  assert.equal(getRevealCeiling("texto\n```ts"), "texto\n".length);
  assert.equal(getRevealCeiling("texto\n~~"), "texto\n".length);
  assert.equal(getRevealCeiling("texto\ncódigo"), "texto\ncódigo".length);
  assert.equal(getRevealCeiling("texto\n```ts"), "texto\n".length);
});

test("com done, a cerca incompleta não é mais segurada", () => {
  assert.equal(getRevealCeiling("texto\n```", true), "texto\n```".length);
});

test("não corta um par substituto no meio", () => {
  const text = "a😀b";
  assert.equal(alignRevealEnd(text, 2), 3);
  assert.equal(alignRevealEnd(text, 3), 3);
  assert.equal(alignRevealEnd(text, 99), text.length);
  assert.equal(alignRevealEnd(text, -4), 0);
});
