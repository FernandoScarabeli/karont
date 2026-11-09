import assert from "node:assert/strict";
import test from "node:test";
import { VEIL_FACE_Y, veilPath } from "./veil.ts";

const numbers = (d) => (d.match(/-?\d+(?:\.\d+)?/g) ?? []).map(Number);
const topOf = (d) => d.split(" C").slice(0, 3).join(" C");
/* maior e menor x entre todos os pontos (pares x y) do contorno */
const xs = (d) => {
  const v = numbers(d);
  return v.filter((_, i) => i % 2 === 0);
};

test("veilPath: um contorno fechado, sem NaN nem infinito", () => {
  for (const args of [
    [0, 0, 0],
    [12, 3, 0],
    [-12, 5.5, 6, 1.6],
    [0, 100, 0, 0],
  ]) {
    const d = veilPath(...args);
    assert.match(d, /^M14 46 /);
    assert.match(d, / Z$/);
    assert.ok(numbers(d).every(Number.isFinite), d);
  }
});

test("veilPath: o topo fica fixo, qualquer que seja o pano", () => {
  const rest = topOf(veilPath(0, 0, 0));
  for (const args of [
    [10, 1, 0],
    [-10, 2, 5],
    [4, 6, 8, 2],
  ]) {
    assert.equal(topOf(veilPath(...args)), rest);
  }
});

test("veilPath: a inclinação arrasta a barra para o lado", () => {
  const rest = xs(veilPath(0, 0, 0, 0));
  const right = xs(veilPath(10, 0, 0, 0));
  const left = xs(veilPath(-10, 0, 0, 0));
  assert.ok(Math.max(...right) > Math.max(...rest));
  assert.ok(Math.min(...left) < Math.min(...rest));
  assert.ok(Math.max(...left) <= Math.max(...rest) + 1e-9);
});

test("veilPath: a abertura alarga a barra dos dois lados", () => {
  const closed = xs(veilPath(0, 0, 0, 0));
  const open = xs(veilPath(0, 0, 6, 0));
  assert.ok(Math.max(...open) > Math.max(...closed) + 5);
  assert.ok(Math.min(...open) < Math.min(...closed) - 5);
});

test("veilPath: a ondulação muda com a fase e some com energia zero", () => {
  assert.notEqual(veilPath(0, 0, 0), veilPath(0, 1.7, 0));
  assert.equal(veilPath(0, 0, 0, 0), veilPath(0, 1.7, 0, 0));
  /* a mesma entrada dá sempre o mesmo desenho */
  assert.equal(veilPath(3, 2, 1), veilPath(3, 2, 1));
});

test("o rosto repousa no terço de cima da cabeça", () => {
  assert.ok(VEIL_FACE_Y > 8 && VEIL_FACE_Y < 60);
});
