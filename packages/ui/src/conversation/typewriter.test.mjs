import assert from "node:assert/strict";
import test from "node:test";
import {
  alignRevealEnd,
  DRAIN_MS,
  getCharsPerSecond,
  getRevealCeiling,
  planCharRelease,
  smoothRate,
} from "./typewriter.ts";

test("ritmo base é 75 caracteres por segundo, sem acelerar até cerca de 3 s de atraso", () => {
  assert.equal(getCharsPerSecond(0), 75);
  assert.equal(getCharsPerSecond(225), 75);
});

test("acelera devagar acima de 3 s de atraso e satura em 400", () => {
  assert.equal(getCharsPerSecond(325), 75 + 100 * 0.6);
  assert.ok(getCharsPerSecond(400) > getCharsPerSecond(300));
  assert.equal(getCharsPerSecond(1_000_000), 400);
});

test("a curva cresce sem degrau: cada caractere a mais soma o mesmo acréscimo", () => {
  const step = getCharsPerSecond(601) - getCharsPerSecond(600);
  assert.ok(Math.abs(step - 0.6) < 1e-9);
});

test("a suavização aproxima o ritmo do alvo com constante de 300 ms", () => {
  // Depois de 300 ms, cerca de 63% do caminho do ritmo atual até o alvo.
  const after300 = smoothRate(75, 400, 300);
  assert.ok(Math.abs(after300 - (75 + 325 * (1 - Math.exp(-1)))) < 1e-9);
  assert.equal(smoothRate(75, 75, 100), 75);
});

test("o ritmo suavizado não salta quando o atraso cresce de repente", () => {
  const plan = planCharRelease({ backlogChars: 2000, elapsedMs: 16, rateCps: 75 });
  // Alvo 400 com atraso de 2000; em 16 ms a suavização avança só cerca de 5%.
  assert.ok(plan.rateCps < 75 + 325 * 0.06, `saltou para ${plan.rateCps}`);
  assert.ok(plan.rateCps > 75, "não está acelerando");
});

test("libera caracteres no ritmo e guarda a fração para o próximo quadro", () => {
  // Atraso de 220 caracteres (abaixo de 3 s): ritmo base de 75 por segundo.
  let carry = 0;
  let rate = 75;
  let released = 0;
  for (let frame = 0; frame < 63; frame += 1) {
    const plan = planCharRelease({
      backlogChars: 220,
      elapsedMs: 16,
      carryChars: carry,
      rateCps: rate,
    });
    carry = plan.carryChars;
    rate = plan.rateCps;
    released += plan.count;
  }
  assert.ok(released >= 70 && released <= 80, `liberou ${released} em ~1 s`);
});

test("sem atraso não libera nada", () => {
  assert.deepEqual(planCharRelease({ backlogChars: 0, elapsedMs: 16, done: true }), {
    count: 0,
    carryChars: 0,
    drainMsLeft: DRAIN_MS,
    rateCps: 75,
  });
});

test("depois de done, o atraso escoa em até 1,2 s, mesmo com muito texto", () => {
  for (const backlog of [5, 300, 4000, 20000]) {
    let remaining = backlog;
    let drainMsLeft = DRAIN_MS;
    let carry = 0;
    let elapsedTotal = 0;
    while (remaining > 0 && elapsedTotal < 5000) {
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
    assert.ok(elapsedTotal <= DRAIN_MS + 16, `backlog ${backlog} levou ${elapsedTotal} ms`);
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
