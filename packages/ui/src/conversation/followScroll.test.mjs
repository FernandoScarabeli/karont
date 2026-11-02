import assert from "node:assert/strict";
import test from "node:test";
import { isSpringSettled, stepCriticalSpring } from "./followScroll.ts";

function simulate(target, frameMs, frames, start = 0) {
  let state = { position: start, velocity: 0 };
  const positions = [];
  for (let index = 0; index < frames; index += 1) {
    state = stepCriticalSpring(state, target, frameMs);
    positions.push(state.position);
  }
  return { state, positions };
}

test("a mola converge ao alvo e assenta dentro de 0,5 px", () => {
  const { state } = simulate(480, 16, 120);
  assert.ok(isSpringSettled(state, 480), `ficou em ${state.position}`);
});

test("com bounce 0 a mola não ultrapassa o alvo, mesmo com quadros grandes", () => {
  for (const frameMs of [4, 8, 16, 33, 50]) {
    const { positions } = simulate(300, frameMs, Math.ceil(2000 / frameMs));
    for (let index = 1; index < positions.length; index += 1) {
      assert.ok(positions[index] <= 300 + 1e-9, `ultrapassou com quadro de ${frameMs} ms`);
      assert.ok(positions[index] >= positions[index - 1] - 1e-9, "a posição recuou");
    }
  }
});

test("o passo é exato: dois passos de 8 ms equivalem a um de 16 ms", () => {
  const start = { position: 10, velocity: 40 };
  const whole = stepCriticalSpring(start, 200, 16);
  const halves = stepCriticalSpring(stepCriticalSpring(start, 200, 8), 200, 8);
  assert.ok(Math.abs(whole.position - halves.position) < 1e-9);
  assert.ok(Math.abs(whole.velocity - halves.velocity) < 1e-9);
});

test("a velocidade acumulada é preservada entre quadros, sem degrau", () => {
  const first = stepCriticalSpring({ position: 0, velocity: 0 }, 100, 16);
  assert.ok(first.velocity > 0, "começa a andar");
  const second = stepCriticalSpring(first, 100, 16);
  assert.ok(second.position > first.position, "continua andando no quadro seguinte");
});

test("sem tempo decorrido o estado não muda", () => {
  const start = { position: 42, velocity: 5 };
  assert.deepEqual(stepCriticalSpring(start, 100, 0), start);
});

test("assentado quando perto do alvo e parado", () => {
  assert.equal(isSpringSettled({ position: 99.8, velocity: 0.1 }, 100), true);
  assert.equal(isSpringSettled({ position: 99.2, velocity: 0 }, 100), false);
  assert.equal(isSpringSettled({ position: 100, velocity: 30 }, 100), false);
});
