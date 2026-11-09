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
  pruneRemovedWorktrees,
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

test("worktrees.changed tira o worktreeId só das conversas daquele projeto, sem requisição", () => {
  const inCopy = projectConversation("conversa-na-copia", "projeto-w", { worktreeId: "w1" });
  const kept = projectConversation("conversa-na-outra", "projeto-w", { worktreeId: "w2" });
  const elsewhere = projectConversation("conversa-em-outro", "projeto-x", { worktreeId: "w1" });
  const plain = projectConversation("conversa-sem-copia", "projeto-w");
  for (const item of [inCopy, kept, elsewhere, plain]) applyConversationStateChange(item);
  let notified = 0;
  const unsubscribe = subscribeConversationIndex("active", () => {
    notified += 1;
  });
  const requestsBefore = listRequests.length;
  notified = 0;

  for (const handler of bridgeHandlers) {
    handler({
      event: "worktrees.changed",
      payload: { projectId: "projeto-w", worktrees: [{ id: "w2" }] },
    });
  }

  const updated = getConversationIndexEntry("conversa-na-copia");
  assert.equal(updated.worktreeId, undefined);
  assert.equal(updated.updatedAt, inCopy.updatedAt);
  assert.equal(getConversationIndexEntry("conversa-na-outra"), kept);
  assert.equal(getConversationIndexEntry("conversa-em-outro"), elsewhere);
  assert.equal(getConversationIndexEntry("conversa-sem-copia"), plain);
  assert.equal(notified, 1);
  assert.equal(listRequests.length, requestsBefore);

  pruneRemovedWorktrees("projeto-w", new Set(["w2"]));
  assert.equal(notified, 1, "sem mudança não notifica");
  unsubscribe();
});

test("conversations.workspaceMoved troca o workspace das conversas locais sem requisição nem updatedAt", () => {
  const inA1 = projectConversation("mover-a1", "projeto-m1", { workspaceId: "ws-a" });
  const inA2 = projectConversation("mover-a2", undefined, { workspaceId: "ws-a" });
  const inB = projectConversation("mover-b", "projeto-m2", { workspaceId: "ws-b" });
  const inC = projectConversation("mover-c", "projeto-m1", { workspaceId: "ws-c" });
  for (const item of [inA1, inA2, inB, inC]) applyConversationStateChange(item);
  let notified = 0;
  const unsubscribe = subscribeConversationIndex("active", () => {
    notified += 1;
  });
  const requestsBefore = listRequests.length;
  notified = 0;

  // Apagar o workspace A: tudo que era dele vai para B.
  for (const handler of bridgeHandlers) {
    handler({
      event: "conversations.workspaceMoved",
      payload: { workspaceId: "ws-b", fromWorkspaceId: "ws-a" },
    });
  }
  assert.equal(getConversationIndexEntry("mover-a1").workspaceId, "ws-b");
  assert.equal(getConversationIndexEntry("mover-a2").workspaceId, "ws-b");
  assert.equal(getConversationIndexEntry("mover-a1").updatedAt, inA1.updatedAt);
  assert.equal(getConversationIndexEntry("mover-b"), inB);
  assert.equal(getConversationIndexEntry("mover-c"), inC);
  assert.equal(notified, 1);

  // Mover o projeto m1 para o workspace D: só as conversas dele trocam.
  for (const handler of bridgeHandlers) {
    handler({
      event: "conversations.workspaceMoved",
      payload: { workspaceId: "ws-d", projectId: "projeto-m1" },
    });
  }
  assert.equal(getConversationIndexEntry("mover-a1").workspaceId, "ws-d");
  assert.equal(getConversationIndexEntry("mover-c").workspaceId, "ws-d");
  assert.equal(getConversationIndexEntry("mover-a2").workspaceId, "ws-b");
  assert.equal(getConversationIndexEntry("mover-b"), inB);
  assert.equal(getConversationIndexEntry("mover-c").updatedAt, inC.updatedAt);
  assert.equal(notified, 2);
  assert.equal(listRequests.length, requestsBefore);

  // Repetir o evento não muda nada nem notifica.
  for (const handler of bridgeHandlers) {
    handler({
      event: "conversations.workspaceMoved",
      payload: { workspaceId: "ws-d", projectId: "projeto-m1" },
    });
  }
  assert.equal(notified, 2);
  unsubscribe();
});
