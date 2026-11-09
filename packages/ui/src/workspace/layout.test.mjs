import assert from "node:assert/strict";
import test from "node:test";
import { isNoOpMove, movePane, splitPane } from "./layout.ts";

const view = (name) => ({ kind: "chat", conversationId: name });
const pane = (id) => ({ type: "pane", id, view: view(id) });
const split = (id, direction, children, sizes) => ({
  type: "split",
  id,
  direction,
  children,
  sizes,
});

// A | B
const ab = split("split-1", "row", [pane("A"), pane("B")], [50, 50]);

test("A | B: mover B para a direita de A, ou A para a esquerda de B, não muda nada", () => {
  assert.equal(isNoOpMove(ab, "B", "A", "right"), true);
  assert.equal(isNoOpMove(ab, "A", "B", "left"), true);
});

test("A | B: mover B para a esquerda de A, ou A para a direita de B, muda", () => {
  assert.equal(isNoOpMove(ab, "B", "A", "left"), false);
  assert.equal(isNoOpMove(ab, "A", "B", "right"), false);
});

test("A | B: mover para cima ou para baixo empilha", () => {
  for (const edge of ["top", "bottom"]) {
    assert.equal(isNoOpMove(ab, "B", "A", edge), false);
    assert.equal(isNoOpMove(ab, "A", "B", edge), false);
  }
});

test("o próprio painel e painéis desconhecidos não mudam nada", () => {
  assert.equal(isNoOpMove(ab, "A", "A", "left"), true);
  assert.equal(isNoOpMove(ab, "A", "Z", "left"), true);
  assert.equal(isNoOpMove(ab, "Z", "A", "left"), true);
});

test("o resultado de um movimento real difere do original", () => {
  const moved = movePane(ab, "B", "A", "left");
  assert.equal(moved.children[0].id, "B");
});

test("A | B | C: só a vizinhança imediata é no-op", () => {
  const abc = split("split-1", "row", [pane("A"), pane("B"), pane("C")], [34, 33, 33]);
  assert.equal(isNoOpMove(abc, "B", "A", "right"), true);
  assert.equal(isNoOpMove(abc, "B", "C", "left"), true);
  assert.equal(isNoOpMove(abc, "A", "B", "left"), true);
  assert.equal(isNoOpMove(abc, "C", "B", "right"), true);
  assert.equal(isNoOpMove(abc, "A", "C", "left"), false);
  assert.equal(isNoOpMove(abc, "C", "A", "right"), false);
  assert.equal(isNoOpMove(abc, "A", "C", "right"), false);
  assert.equal(isNoOpMove(abc, "C", "A", "left"), false);
  assert.equal(isNoOpMove(abc, "B", "A", "left"), false);
});

test("layout aninhado: A | (B sobre C)", () => {
  const nested = split(
    "split-1",
    "row",
    [pane("A"), split("split-2", "column", [pane("B"), pane("C")], [50, 50])],
    [50, 50],
  );
  assert.equal(isNoOpMove(nested, "B", "C", "top"), true);
  assert.equal(isNoOpMove(nested, "C", "B", "bottom"), true);
  assert.equal(isNoOpMove(nested, "B", "C", "bottom"), false);
  assert.equal(isNoOpMove(nested, "A", "B", "left"), false);
  assert.equal(isNoOpMove(nested, "A", "B", "right"), false);
  assert.equal(isNoOpMove(nested, "B", "A", "right"), false);
  assert.equal(isNoOpMove(nested, "C", "A", "right"), false);
});

test("tamanhos e ids de grupos gerados não contam", () => {
  const resized = split("split-9", "row", [pane("A"), pane("B")], [30, 70]);
  assert.equal(isNoOpMove(resized, "B", "A", "right"), true);
  const pair = splitPane(ab, "A", "column", "after", view("N"));
  assert.equal(isNoOpMove(pair, "N", "A", "bottom"), true);
});
