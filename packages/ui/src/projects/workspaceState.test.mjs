import assert from "node:assert/strict";
import test from "node:test";
import {
  filterByWorkspace,
  groupTerminals,
  isAffectedByWorkspaceMove,
  LOCAL_WORKSPACE_KEY,
  layoutSettingKey,
  pickActiveWorkspaceId,
  removalTarget,
  restoreWorkspaceLayouts,
  sortWorkspaces,
  workspaceMarks,
} from "./workspaceState.ts";

const workspace = (id, position) => ({
  id,
  name: id,
  icon: "folder",
  position,
  createdAt: "2026-11-01T12:00:00.000Z",
  updatedAt: "2026-11-01T12:00:00.000Z",
});

const chatLayout = (conversationId) => ({
  type: "pane",
  id: "pane-1",
  view: { kind: "chat", conversationId },
});

test("o ativo salvo vale; se sumiu, cai no primeiro da lista por position", () => {
  const list = [workspace("c", 2), workspace("a", 0), workspace("b", 1)];
  assert.equal(pickActiveWorkspaceId(list, "b"), "b");
  assert.equal(pickActiveWorkspaceId(list, "apagado"), "a");
  assert.equal(pickActiveWorkspaceId(list, null), "a");
  assert.equal(pickActiveWorkspaceId(list, undefined), "a");
  assert.equal(pickActiveWorkspaceId([], "a"), null);
});

test("a ordem desempata pela ordem recebida", () => {
  const list = [workspace("x", 1), workspace("y", 1), workspace("z", 0)];
  assert.deepEqual(
    sortWorkspaces(list).map((item) => item.id),
    ["z", "x", "y"],
  );
});

test("o destino de um workspace apagado é o de menor position que sobrar", () => {
  const list = [workspace("a", 0), workspace("b", 1), workspace("c", 2)];
  assert.equal(removalTarget(list, "a")?.id, "b");
  assert.equal(removalTarget(list, "c")?.id, "a");
  assert.equal(removalTarget([workspace("a", 0)], "a"), null);
});

test("filtra por workspace e não devolve nada de outro", () => {
  const items = [
    { id: 1, workspaceId: "a" },
    { id: 2, workspaceId: "b" },
    { id: 3, workspaceId: "a" },
  ];
  assert.deepEqual(
    filterByWorkspace(items, "a").map((item) => item.id),
    [1, 3],
  );
  assert.deepEqual(filterByWorkspace(items, "z"), []);
  assert.equal(filterByWorkspace(items, null).length, 3);
});

test("terminal de projeto entra no projeto; os outros ficam soltos", () => {
  const terminals = [
    { id: "t1", projectId: "p1" },
    { id: "t2" },
    { id: "t3", projectId: "p-de-outro-workspace" },
    { id: "t4", projectId: "p1" },
  ];
  const groups = groupTerminals(terminals, [{ id: "p1" }, { id: "p2" }], false);
  assert.deepEqual(
    groups.byProject.get("p1").map((item) => item.id),
    ["t1", "t4"],
  );
  assert.deepEqual(groups.byProject.get("p2"), []);
  assert.deepEqual(
    groups.loose.map((item) => item.id),
    ["t2", "t3"],
  );
});

test("enquanto os projetos carregam, terminal de projeto espera em vez de ir para os soltos", () => {
  const groups = groupTerminals([{ id: "t1", projectId: "p1" }, { id: "t2" }], [], true);
  assert.deepEqual(
    groups.loose.map((item) => item.id),
    ["t2"],
  );
});

test("marca da aba: precisa de você vence trabalhando; o resto não marca", () => {
  const marks = workspaceMarks([
    { workspaceId: "a", state: "working" },
    { workspaceId: "a", state: "waiting" },
    { workspaceId: "a", state: "working" },
    { workspaceId: "b", state: "working" },
    { workspaceId: "c", state: "idle" },
    { workspaceId: "c", state: "error" },
    { workspaceId: "c", state: "queued" },
  ]);
  assert.equal(marks.get("a"), "waiting");
  assert.equal(marks.get("b"), "working");
  assert.equal(marks.has("c"), false);
  assert.equal(workspaceMarks([]).size, 0);
});

test("workspaceMoved: por workspace de origem ou por projeto", () => {
  const conversation = (workspaceId, projectId) => ({ workspaceId, projectId });
  const fromMove = { workspaceId: "b", fromWorkspaceId: "a" };
  assert.equal(isAffectedByWorkspaceMove(conversation("a"), fromMove), true);
  assert.equal(isAffectedByWorkspaceMove(conversation("c"), fromMove), false);
  assert.equal(isAffectedByWorkspaceMove(conversation("b"), fromMove), false);
  const projectMove = { workspaceId: "b", projectId: "p" };
  assert.equal(isAffectedByWorkspaceMove(conversation("a", "p"), projectMove), true);
  assert.equal(isAffectedByWorkspaceMove(conversation("a", "q"), projectMove), false);
  assert.equal(isAffectedByWorkspaceMove(conversation("a"), projectMove), false);
  assert.equal(isAffectedByWorkspaceMove(conversation("b", "p"), projectMove), false);
});

test("a chave do layout respeita o formato das chaves de settings", () => {
  const key = layoutSettingKey("0a1b2c3d-1111-2222-3333-444455556666");
  assert.equal(key, "workspace.layout.0a1b2c3d111122223333444455556666");
  assert.match(key, /^[a-z][a-zA-Z0-9.]{0,63}$/);
  assert.equal(layoutSettingKey(LOCAL_WORKSPACE_KEY), "workspace.layout");
});

test("migração: o layout da chave antiga vira o do workspace ativo, uma vez", () => {
  const legacy = chatLayout("conversa-antiga");
  const restored = restoreWorkspaceLayouts({
    workspaceIds: ["a", "b"],
    activeId: "b",
    saved: {},
    legacy,
    terminalIds: null,
  });
  assert.equal(restored.migratedLegacy, true);
  assert.equal(restored.layouts.b.view.conversationId, "conversa-antiga");
  assert.equal(restored.hadLayout.b, true);
  assert.equal(restored.layouts.a.view.kind, "new-conversation");
  assert.equal(restored.hadLayout.a, false);
  assert.equal(restored.activePaneIds.b, "pane-1");
});

test("com layout próprio salvo, a chave antiga não é usada", () => {
  const restored = restoreWorkspaceLayouts({
    workspaceIds: ["a", "b"],
    activeId: "a",
    saved: { a: chatLayout("conversa-propria") },
    legacy: chatLayout("conversa-antiga"),
    terminalIds: null,
  });
  assert.equal(restored.migratedLegacy, false);
  assert.equal(restored.layouts.a.view.conversationId, "conversa-propria");
  assert.equal(restored.layouts.b.view.kind, "new-conversation");
});

test("layout salvo inválido cai no inicial; terminal que não existe mais vira nova conversa", () => {
  const restored = restoreWorkspaceLayouts({
    workspaceIds: ["a", "b"],
    activeId: "a",
    saved: {
      a: { type: "lixo" },
      b: { type: "pane", id: "pane-1", view: { kind: "terminal", terminalId: "morto" } },
    },
    legacy: null,
    terminalIds: new Set(["vivo"]),
  });
  assert.equal(restored.layouts.a.view.kind, "new-conversation");
  assert.equal(restored.hadLayout.a, false);
  assert.equal(restored.layouts.b.view.kind, "new-conversation");
  assert.equal(restored.hadLayout.b, true);
});
