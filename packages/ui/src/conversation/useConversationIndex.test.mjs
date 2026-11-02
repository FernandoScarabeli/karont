import assert from "node:assert/strict";
import test from "node:test";
import {
  applyConversationStateChange,
  getConversationIndexEntry,
  removeConversationFromIndex,
} from "./useConversationIndex.ts";

test("stateChanged atrasado não reintroduz conversa removida", () => {
  const conversation = {
    id: "conversa-removida",
    title: "Conversa removida",
    agent: "claude",
    mode: "edit",
    state: "error",
    createdAt: "2026-11-01T12:00:00.000Z",
    updatedAt: "2026-11-01T12:00:01.000Z",
    pinnedAt: null,
    archivedAt: null,
    unreadAt: null,
  };

  removeConversationFromIndex(conversation.id);

  assert.equal(applyConversationStateChange(conversation), false);
});

test("o índice expõe o resumo necessário ao composer sem carregar mensagens", () => {
  const conversation = {
    id: "conversa-resumo",
    title: "Conversa nova",
    agent: "codex",
    model: "gpt-6.1-sol",
    effort: "high",
    mode: "edit",
    fast: true,
    plan: true,
    cwd: "/tmp/projeto",
    state: "idle",
    createdAt: "2026-11-01T12:00:00.000Z",
    updatedAt: "2026-11-01T12:00:01.000Z",
    pinnedAt: null,
    archivedAt: null,
    unreadAt: null,
  };

  assert.equal(applyConversationStateChange(conversation), true);
  assert.equal(getConversationIndexEntry(conversation.id), conversation);
});
