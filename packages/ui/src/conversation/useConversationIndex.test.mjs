import assert from "node:assert/strict";
import test from "node:test";
import {
  applyConversationStateChange,
  getConversationSummary,
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

test("consulta o resumo mais recente da conversa pelo índice", () => {
  const conversation = {
    id: "resumo-indexado",
    title: "Pão: história",
    agent: "claude",
    cwd: "/projetos/padaria",
    mode: "read-only",
    model: "haiku",
    effort: "high",
    fast: true,
    plan: true,
    state: "idle",
    createdAt: "2026-11-01T12:00:00.000Z",
    updatedAt: "2026-11-01T12:00:01.000Z",
    pinnedAt: null,
    archivedAt: null,
    unreadAt: null,
  };

  assert.equal(applyConversationStateChange(conversation), true);
  assert.equal(getConversationSummary(conversation.id), conversation);
});
