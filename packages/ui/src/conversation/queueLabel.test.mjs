import assert from "node:assert/strict";
import test from "node:test";
import { queueLabel } from "./queueLabel.ts";

const status = (running, queuedConversationIds) => ({
  limit: 4,
  running,
  queuedConversationIds,
});

test("a primeira da fila mostra só quantos agentes trabalham", () => {
  assert.equal(queueLabel(status(4, ["a", "b"]), "a"), "Na fila: 4 agentes trabalhando");
});

test("da segunda em diante mostra a posição", () => {
  assert.equal(queueLabel(status(4, ["a", "b"]), "b"), "Na fila, posição 2: 4 agentes trabalhando");
});

test("usa o singular com um agente", () => {
  assert.equal(queueLabel(status(1, ["a"]), "a"), "Na fila: 1 agente trabalhando");
});

test("sem agente rodando mostra só Na fila", () => {
  assert.equal(queueLabel(status(0, ["a", "b"]), "b"), "Na fila");
});

test("sem status carregado mostra só Na fila", () => {
  assert.equal(queueLabel(null, "a"), "Na fila");
});
