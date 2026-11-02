import assert from "node:assert/strict";
import test from "node:test";
import { reducer } from "./useConversation.ts";

const conversation = {
  id: "conversa-1",
  title: "Teste",
  agent: "claude",
  mode: "edit",
  state: "working",
  createdAt: "2026-11-01T12:00:00.000Z",
  updatedAt: "2026-11-01T12:00:00.000Z",
  pinnedAt: null,
  archivedAt: null,
  unreadAt: null,
};

function stateWithStreamingMessage() {
  const message = {
    id: "mensagem-1",
    conversationId: "conversa-1",
    author: "agent",
    status: "streaming",
    parts: [],
    startedAt: 1_000,
    createdAt: "2026-11-01T12:00:00.000Z",
    updatedAt: "2026-11-01T12:00:00.000Z",
  };
  return {
    conversation,
    messageIds: [message.id],
    messagesById: { [message.id]: message },
    loading: false,
    error: "",
    liveText: "",
    responseFinishedId: null,
  };
}

test("a conclusão ao vivo mantém startedAt e endedAt da mensagem", () => {
  const next = reducer(stateWithStreamingMessage(), {
    type: "event",
    event: {
      event: "conversation.stateChanged",
      payload: {
        conversation: { ...conversation, state: "idle" },
        messageId: "mensagem-1",
        messageStatus: "done",
        messageStartedAt: 1_000,
        messageEndedAt: 19_000,
      },
    },
  });

  const message = next.messagesById["mensagem-1"];
  assert.equal(message.status, "done");
  assert.equal(message.startedAt, 1_000);
  assert.equal(message.endedAt, 19_000);
  assert.equal(next.responseFinishedId, "mensagem-1");
});

test("um aviso de estado sem horário não apaga o horário já conhecido", () => {
  const state = stateWithStreamingMessage();
  state.messagesById["mensagem-1"] = { ...state.messagesById["mensagem-1"], endedAt: 19_000 };
  const next = reducer(state, {
    type: "event",
    event: {
      event: "conversation.stateChanged",
      payload: {
        conversation,
        messageId: "mensagem-1",
        messageStatus: "interrupted",
      },
    },
  });

  const message = next.messagesById["mensagem-1"];
  assert.equal(message.status, "interrupted");
  assert.equal(message.startedAt, 1_000);
  assert.equal(message.endedAt, 19_000);
});
