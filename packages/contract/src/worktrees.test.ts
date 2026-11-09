import assert from "node:assert/strict";
import { test } from "node:test";
import { events } from "./events.ts";
import { parseEvent, parseRequest, parseResult } from "./validate.ts";

const worktree = {
  id: "w1",
  projectId: null,
  repoRoot: "/repo",
  path: "/data/worktrees/repo-abcdef",
  branch: "karont/repo-abcdef",
  baseCommit: "abc",
  createdAt: "2026-11-08T10:00:00.000Z",
  mergedAt: null,
};

test("worktrees.*: pedidos e resultados seguem o contrato", () => {
  for (const [method, params] of [
    ["worktrees.list", { projectId: "p" }],
    ["worktrees.create", { projectId: "p" }],
    ["worktrees.status", { id: "w1" }],
    ["worktrees.remove", { id: "w1", force: true }],
    ["worktrees.mergePreview", { id: "w1" }],
    ["worktrees.merge", { id: "w1" }],
    ["conversation.create", { agent: "claude", cwd: "/x", worktreeId: "w1" }],
  ] as const) {
    assert.equal(parseRequest({ type: "request", id: "1", method, params }).ok, true, method);
  }
  assert.equal(
    parseRequest({ type: "request", id: "1", method: "worktrees.remove", params: { id: "" } }).ok,
    false,
  );
  assert.equal(parseResult("worktrees.create", { worktree }).ok, true);
  assert.equal(parseResult("worktrees.list", { worktrees: [worktree] }).ok, true);
  assert.equal(
    parseResult("worktrees.status", {
      dirtyFiles: 1,
      unmergedCommits: 0,
      busyConversations: 0,
      missing: false,
    }).ok,
    true,
  );
  assert.equal(parseResult("worktrees.remove", { removed: true, branchKept: true }).ok, true);
  assert.equal(parseResult("worktrees.remove", { removed: false, branchKept: true }).ok, false);
  const preview = {
    targetBranch: "main",
    commits: 2,
    uncommittedFiles: 1,
    changedFiles: 3,
    conflicts: ["a.txt"],
    blocked: null,
    targetDirtyFiles: [],
  };
  assert.equal(parseResult("worktrees.mergePreview", preview).ok, true);
  assert.equal(
    parseResult("worktrees.mergePreview", { ...preview, blocked: "target-dirty" }).ok,
    true,
  );
  assert.equal(parseResult("worktrees.mergePreview", { ...preview, blocked: "outro" }).ok, false);
  assert.equal(parseResult("worktrees.mergePreview", { ...preview, targetBranch: null }).ok, true);
  assert.equal(
    parseResult("worktrees.merge", { merged: true, commit: "abc", targetBranch: "main" }).ok,
    true,
  );
  assert.equal(
    parseResult("worktrees.merge", { merged: false, commit: "abc", targetBranch: "main" }).ok,
    false,
  );
});

test("worktrees.changed: evento com projeto e lista", () => {
  assert.ok("worktrees.changed" in events);
  assert.equal(
    parseEvent({
      type: "event",
      event: "worktrees.changed",
      payload: { projectId: "p", worktrees: [worktree] },
    }).ok,
    true,
  );
});
