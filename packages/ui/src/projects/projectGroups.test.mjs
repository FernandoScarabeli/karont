import assert from "node:assert/strict";
import test from "node:test";
import { groupConversations } from "./projectGroups.ts";

const conversation = (id, projectId) => ({
  id,
  title: id,
  agent: "claude",
  mode: "edit",
  state: "idle",
  createdAt: "2026-11-01T12:00:00.000Z",
  updatedAt: "2026-11-01T12:00:00.000Z",
  pinnedAt: null,
  archivedAt: null,
  unreadAt: null,
  ...(projectId ? { projectId } : {}),
});
const project = (id) => ({
  id,
  name: id,
  icon: "folder",
  path: `/tmp/${id}`,
  defaultAgent: null,
  createdAt: "2026-11-01T12:00:00.000Z",
  updatedAt: "2026-11-01T12:00:00.000Z",
});

test("separa por projeto e soltas, mantendo a ordem recebida", () => {
  const list = [
    conversation("a", "p1"),
    conversation("b"),
    conversation("c", "p2"),
    conversation("d", "p1"),
    conversation("e"),
  ];
  const { byProject, loose } = groupConversations(list, [project("p1"), project("p2")], false);
  assert.deepEqual(
    byProject.get("p1").map((item) => item.id),
    ["a", "d"],
  );
  assert.deepEqual(
    byProject.get("p2").map((item) => item.id),
    ["c"],
  );
  assert.deepEqual(
    loose.map((item) => item.id),
    ["b", "e"],
  );
});

test("projeto sem conversas aparece com grupo vazio", () => {
  const { byProject } = groupConversations([], [project("p1")], false);
  assert.deepEqual(byProject.get("p1"), []);
});

test("projectId de projeto inexistente vai para as soltas", () => {
  const { loose, byProject } = groupConversations(
    [conversation("a", "removido"), conversation("b")],
    [project("p1")],
    false,
  );
  assert.deepEqual(
    loose.map((item) => item.id),
    ["a", "b"],
  );
  assert.deepEqual(byProject.get("p1"), []);
});

test("enquanto os projetos carregam, conversa com projectId não aparece nas soltas", () => {
  const { loose, byProject } = groupConversations(
    [conversation("a", "p1"), conversation("b")],
    [],
    true,
  );
  assert.deepEqual(
    loose.map((item) => item.id),
    ["b"],
  );
  assert.equal(byProject.size, 0);
});
