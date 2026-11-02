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
    hasOlderMessages: false,
    error: "",
    liveText: "",
    responseFinishedId: null,
  };
}

function historyMessage(id, timestamp) {
  return {
    id,
    conversationId: "conversa-1",
    author: "user",
    status: "done",
    parts: [],
    createdAt: timestamp,
    updatedAt: timestamp,
  };
}

test("o reducer anexa páginas antigas antes da janela já aberta", () => {
  const latest = [
    historyMessage("mensagem-3", "2026-11-01T12:00:03.000Z"),
    historyMessage("mensagem-4", "2026-11-01T12:00:04.000Z"),
  ];
  const older = [
    historyMessage("mensagem-1", "2026-11-01T12:00:01.000Z"),
    historyMessage("mensagem-2", "2026-11-01T12:00:02.000Z"),
  ];
  const initial = {
    conversation: null,
    messageIds: [],
    messagesById: {},
    loading: true,
    hasOlderMessages: false,
    error: "",
    liveText: "",
    responseFinishedId: null,
  };
  const loaded = reducer(initial, {
    type: "loaded",
    conversation,
    messages: latest,
    hasOlderMessages: true,
  });
  const paged = reducer(loaded, {
    type: "olderLoaded",
    messages: older,
    hasOlderMessages: false,
  });

  assert.deepEqual(paged.messageIds, ["mensagem-1", "mensagem-2", "mensagem-3", "mensagem-4"]);
  assert.equal(paged.hasOlderMessages, false);
});

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

test("o evento de contexto atualiza o valor sem trocar as mensagens carregadas", () => {
  const state = stateWithStreamingMessage();
  const next = reducer(state, {
    type: "event",
    event: {
      event: "conversation.contextUsage",
      payload: {
        conversationId: "conversa-1",
        usedTokens: 90_000,
        windowTokens: 200_000,
      },
    },
  });

  assert.deepEqual(next.contextUsage, {
    conversationId: "conversa-1",
    value: { usedTokens: 90_000, windowTokens: 200_000 },
  });
  assert.equal(next.messageIds, state.messageIds);
  assert.equal(next.messagesById, state.messagesById);
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

test("a troca mantém a conversa anterior até a nova carregar e descarta falha atrasada", () => {
  const previous = stateWithStreamingMessage();
  const switching = reducer(previous, {
    type: "requesting",
    conversationId: "conversa-2",
  });

  assert.equal(switching.loading, true);
  assert.equal(switching.conversation, conversation);
  assert.deepEqual(switching.messageIds, ["mensagem-1"]);
  assert.equal(switching.requestedConversationId, "conversa-2");

  const staleFailure = reducer(switching, {
    type: "failed",
    conversationId: "conversa-1",
    error: "Falha antiga",
  });
  assert.equal(staleFailure, switching);
});

test("ao carregar a conversa nova, mensagens da anterior não ficam misturadas", () => {
  const previous = stateWithStreamingMessage();
  const switching = reducer(previous, {
    type: "requesting",
    conversationId: "conversa-2",
  });
  const nextConversation = { ...conversation, id: "conversa-2", title: "Nova" };
  const nextMessage = {
    ...historyMessage("mensagem-2", "2026-11-01T12:00:02.000Z"),
    conversationId: "conversa-2",
  };
  const loaded = reducer(switching, {
    type: "loaded",
    conversation: nextConversation,
    messages: [nextMessage],
    hasOlderMessages: false,
  });

  assert.equal(loaded.conversation.id, "conversa-2");
  assert.deepEqual(loaded.messageIds, ["mensagem-2"]);
});

test("ignora deltas já incluídos na foto ao reabrir uma resposta", () => {
  const state = stateWithStreamingMessage();
  state.messagesById["mensagem-1"] = {
    ...state.messagesById["mensagem-1"],
    parts: [{ id: "texto-1", type: "text", markdown: "hello world" }],
  };

  const next = reducer(state, {
    type: "deltas",
    deltas: [
      { messageId: "mensagem-1", partId: "texto-1", startOffset: 0, delta: "hello" },
      { messageId: "mensagem-1", partId: "texto-1", startOffset: 5, delta: " world!" },
    ],
  });

  assert.equal(next.messagesById["mensagem-1"].parts[0].markdown, "hello world!");
  assert.equal(next.liveText, "!");
});
