import assert from "node:assert/strict";
import test from "node:test";
import { chatMood } from "./chatMood.ts";

const mood = (isLatest, conversationState, messageStatus) =>
  chatMood({ isLatest, conversationState, messageStatus });

test("mensagem que não é a última fica em idle, seja qual for o estado", () => {
  assert.equal(mood(false, "waiting", "streaming"), "idle");
  assert.equal(mood(false, "working", "done"), "idle");
});

test("última com a conversa esperando o usuário pede atenção, mesmo em streaming", () => {
  assert.equal(mood(true, "waiting", "done"), "needs-you");
  assert.equal(mood(true, "waiting", "streaming"), "needs-you");
});

test("última em streaming ou com a conversa trabalhando fica em working", () => {
  assert.equal(mood(true, "idle", "streaming"), "working");
  assert.equal(mood(true, "working", "done"), "working");
});

test("qualquer outro caso é idle", () => {
  assert.equal(mood(true, "idle", "done"), "idle");
  assert.equal(mood(true, "error", "error"), "idle");
  assert.equal(mood(true, "queued", "interrupted"), "idle");
  assert.equal(mood(true, undefined, "done"), "idle");
});
