import assert from "node:assert/strict";
import test from "node:test";

const handlers = new Set();
const listRequests = [];
globalThis.window = {
  karont: {
    request(method, params) {
      if (method !== "worktrees.list") return Promise.reject(new Error(method));
      return new Promise((resolve) => listRequests.push({ params, resolve }));
    },
    onEvent(handler) {
      handlers.add(handler);
      return () => handlers.delete(handler);
    },
  },
};

const { getWorktreesSnapshot, removeWorktreeFromStore, subscribeWorktrees, upsertWorktree } =
  await import("./useWorktrees.ts");
const { applyConversationStateChange, getConversationIndexEntry, subscribeConversationIndex } =
  await import("../conversation/useConversationIndex.ts");

const tick = () => new Promise((resolve) => setImmediate(resolve));

function worktree(id, projectId = "p") {
  return {
    id,
    projectId,
    repoRoot: "/repo",
    path: `/copias/${id}`,
    branch: `karont/${id}`,
    baseCommit: "abc",
    createdAt: "2026-11-08T12:00:00.000Z",
    mergedAt: null,
  };
}

test("worktrees.changed vence a resposta atrasada de worktrees.list", async () => {
  const unsubscribe = subscribeWorktrees("p", () => {});
  assert.equal(getWorktreesSnapshot("p").loading, true);
  assert.equal(listRequests.length, 1);
  assert.deepEqual(listRequests[0].params, { projectId: "p" });

  for (const handler of handlers) {
    handler({
      event: "worktrees.changed",
      payload: { projectId: "p", worktrees: [worktree("novo")] },
    });
  }
  listRequests[0].resolve({ worktrees: [worktree("velho")] });
  await tick();

  const snapshot = getWorktreesSnapshot("p");
  assert.deepEqual(
    snapshot.worktrees.map((item) => item.id),
    ["novo"],
  );
  assert.equal(snapshot.loading, false);
  unsubscribe();
});

test("uma requisição por projeto, sem polling", () => {
  const before = listRequests.length;
  const first = subscribeWorktrees("q", () => {});
  const second = subscribeWorktrees("q", () => {});
  assert.equal(listRequests.length, before + 1);
  assert.equal(getWorktreesSnapshot("q"), getWorktreesSnapshot("q"), "snapshot estável");
  first();
  second();
});

test("sem projeto não há cópias nem requisição", () => {
  const before = listRequests.length;
  const unsubscribe = subscribeWorktrees(undefined, () => {});
  assert.equal(listRequests.length, before);
  assert.deepEqual(getWorktreesSnapshot(undefined).worktrees, []);
  unsubscribe();
});

function conversation(id, projectId, worktreeId) {
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
    worktreeId,
  };
}

test("remover cópia tira o worktreeId das conversas daquele projeto", () => {
  const unsubscribe = subscribeConversationIndex("active", () => {});
  upsertWorktree(worktree("w-a", "r"));
  upsertWorktree(worktree("w-b", "r"));
  applyConversationStateChange(conversation("c-a", "r", "w-a"));
  applyConversationStateChange(conversation("c-b", "r", "w-b"));
  applyConversationStateChange(conversation("c-outro", "s", "w-a"));

  removeWorktreeFromStore("r", "w-a");

  assert.equal(getConversationIndexEntry("c-a").worktreeId, undefined);
  assert.equal(getConversationIndexEntry("c-a").updatedAt, "2026-11-01T12:00:01.000Z");
  assert.equal(getConversationIndexEntry("c-b").worktreeId, "w-b");
  assert.equal(getConversationIndexEntry("c-outro").worktreeId, "w-a", "outro projeto fica");
  assert.deepEqual(
    getWorktreesSnapshot("r").worktrees.map((item) => item.id),
    ["w-b"],
  );
  unsubscribe();
});
