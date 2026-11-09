import assert from "node:assert/strict";
import test from "node:test";
import { focusAfterRemoval, inboxRemainder, isStaleListResponse } from "./inboxState.ts";

test("foco vai para o próximo item quando o focado sai", () => {
  assert.equal(focusAfterRemoval(["a", "b", "c"], ["a", "c"], "b"), "c");
});

test("foco vai para o anterior quando o último sai", () => {
  assert.equal(focusAfterRemoval(["a", "b", "c"], ["a", "b"], "c"), "b");
});

test("foco pula itens que também saíram", () => {
  assert.equal(focusAfterRemoval(["a", "b", "c", "d"], ["a", "d"], "b"), "d");
});

test("lista vazia manda o foco para o título", () => {
  assert.equal(focusAfterRemoval(["a"], [], "a"), null);
});

test("item que continua na lista mantém o foco", () => {
  assert.equal(focusAfterRemoval(["a", "b"], ["b", "a"], "a"), "a");
});

test("resto da lista", () => {
  assert.equal(inboxRemainder(5, 5), 0);
  assert.equal(inboxRemainder(130, 100), 30);
  assert.equal(inboxRemainder(2, 3), 0);
});

test("resposta de lista velha é descartada", () => {
  assert.equal(isStaleListResponse(1, 2), true);
  assert.equal(isStaleListResponse(2, 2), false);
});
