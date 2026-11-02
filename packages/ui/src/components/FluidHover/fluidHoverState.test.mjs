import assert from "node:assert/strict";
import { test } from "node:test";
import { measureMotion, mergeMeasureKind, pointerMotion, rectsEqual } from "./fluidHoverState.ts";

test("entrar no contêiner abre uma sessão nova, que aparece no lugar", () => {
  assert.equal(pointerMotion({ sessionPending: true, activeKey: null }), "fresh");
  assert.equal(pointerMotion({ sessionPending: true, activeKey: "conversation:3" }), "fresh");
});

test("mover entre itens dentro da sessão desliza", () => {
  assert.equal(pointerMotion({ sessionPending: false, activeKey: "conversation:3" }), "spring");
});

test("sem item ativo, o primeiro movimento é uma sessão nova", () => {
  assert.equal(pointerMotion({ sessionPending: false, activeKey: null }), "fresh");
});

test("redimensionar ou rolar o contêiner sem mover o ponteiro faz snap", () => {
  assert.equal(measureMotion("reflow", true), "snap");
});

test("mudança de tamanho de um item causada pelo hover continua deslizando", () => {
  assert.equal(measureMotion("item", true), "spring");
});

test("medição sem mudança na geometria do item ativo não mexe no destaque", () => {
  assert.equal(measureMotion("reflow", false), "none");
  assert.equal(measureMotion("item", false), "none");
});

test("reflow vence item quando as medições se juntam no mesmo frame", () => {
  assert.equal(mergeMeasureKind(null, "item"), "item");
  assert.equal(mergeMeasureKind("item", "reflow"), "reflow");
  assert.equal(mergeMeasureKind("reflow", "item"), "reflow");
});

test("rectsEqual compara posição e tamanho e trata ausência de retângulo", () => {
  const a = { left: 1, top: 2, width: 3, height: 4 };
  assert.equal(rectsEqual(a, { ...a }), true);
  assert.equal(rectsEqual(a, { ...a, height: 5 }), false);
  assert.equal(rectsEqual(undefined, undefined), true);
  assert.equal(rectsEqual(undefined, a), false);
});
