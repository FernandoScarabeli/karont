import assert from "node:assert/strict";
import test from "node:test";

const bridgeHandlers = new Set();
const listRequests = [];
globalThis.window = {
  karont: {
    request(method, params) {
      if (method !== "conversation.list") return Promise.reject(new Error(method));
      return new Promise((resolve) => listRequests.push({ params, resolve }));
    },
    onEvent(handler) {
      bridgeHandlers.add(handler);
      return () => bridgeHandlers.delete(handler);
    },
  },
};

const {
  applyConversationStateChange,
  getConversationIndexEntry,
  pruneRemovedProjects,
  removeConversationFromIndex,
  subscribeConversationIndex,
} = await import("./useConversationIndex.ts");

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

function projectConversation(id, projectId, extra = {}) {
  return {
    id,
    title: id,
    agent: "claude",
    mode: "edit",
    state: "idle",
    createdAt: "2026-11-01T12:00:00.000Z",
    updatedAt: "2026-11-01T12:00:01.000Z",
    pinnedAt: null,
    archivedAt: null,
    unreadAt: null,
    projectId,
    ...extra,
  };
}

test("remover projeto tira o projectId local sem mudar updatedAt e sem criar requisição", () => {
  const conversation = projectConversation("conversa-do-projeto", "projeto-a");
  const other = projectConversation("conversa-do-outro", "projeto-b");
  applyConversationStateChange(conversation);
  applyConversationStateChange(other);
  const requestsBefore = listRequests.length;
  let notified = 0;
  const unsubscribe = subscribeConversationIndex("active", () => {
    notified += 1;
  });
  const requestsAfterSubscribe = listRequests.length;
  notified = 0;

  for (const handler of bridgeHandlers) {
    handler({ event: "projects.changed", payload: { projects: [{ id: "projeto-b" }] } });
  }

  const updated = getConversationIndexEntry("conversa-do-projeto");
  assert.equal(updated.projectId, undefined);
  assert.equal(updated.updatedAt, conversation.updatedAt);
  assert.equal(getConversationIndexEntry("conversa-do-outro"), other);
  assert.equal(notified, 1);
  assert.ok(requestsAfterSubscribe >= requestsBefore);
  assert.equal(listRequests.length, requestsAfterSubscribe);

  pruneRemovedProjects(new Set(["projeto-b"]));
  assert.equal(notified, 1, "sem mudança não notifica");
  unsubscribe();
});

test("conversation.list com o mesmo updatedAt não devolve o projectId removido", async () => {
  const archived = projectConversation("conversa-arquivada", "projeto-c", {
    archivedAt: "2026-11-01T12:00:02.000Z",
  });
  applyConversationStateChange(archived);
  pruneRemovedProjects(new Set());

  const unsubscribe = subscribeConversationIndex("archived", () => {});
  const request = listRequests.at(-1);
  assert.equal(request.params.archived, true);
  request.resolve({ conversations: [archived] });
  await new Promise((resolve) => setImmediate(resolve));

  const entry = getConversationIndexEntry("conversa-arquivada");
  assert.equal(entry.projectId, undefined);
  assert.equal(entry.updatedAt, archived.updatedAt);
  unsubscribe();
});
