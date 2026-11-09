import assert from "node:assert/strict";
import test from "node:test";
import {
  buildSearchGroups,
  createLatestGate,
  decideSearchShortcut,
  flattenSearchGroups,
  moveSearchSelection,
  selectionAfterResponse,
} from "./searchPanelState.ts";

const base = {
  key: "k",
  ctrlKey: true,
  metaKey: false,
  altKey: false,
  shiftKey: false,
  repeat: false,
  isComposing: false,
  inTerminal: false,
  searchOpen: false,
};

test("Ctrl K abre a busca fora do terminal", () => {
  assert.equal(decideSearchShortcut(base), "open");
  assert.equal(decideSearchShortcut({ ...base, key: "K" }), "open");
});

test("Ctrl K fica com o terminal quando o foco está nele", () => {
  assert.equal(decideSearchShortcut({ ...base, inTerminal: true }), "ignore");
});

test("Ctrl K com a busca aberta fecha", () => {
  assert.equal(decideSearchShortcut({ ...base, searchOpen: true }), "close");
});

test("outras teclas e combinações não mexem na busca", () => {
  assert.equal(decideSearchShortcut({ ...base, key: "j" }), "ignore");
  assert.equal(decideSearchShortcut({ ...base, ctrlKey: false }), "ignore");
  assert.equal(decideSearchShortcut({ ...base, shiftKey: true }), "ignore");
  assert.equal(decideSearchShortcut({ ...base, altKey: true }), "ignore");
  assert.equal(decideSearchShortcut({ ...base, repeat: true }), "ignore");
  assert.equal(decideSearchShortcut({ ...base, isComposing: true }), "ignore");
});

const result = {
  conversations: [
    { conversationId: "c1", title: "A", workspaceId: "w", agent: "claude", archived: false },
    { conversationId: "c2", title: "B", workspaceId: "w", agent: "codex", archived: true },
  ],
  projects: [{ projectId: "p1", name: "P", icon: "", workspaceId: "w" }],
  messages: [{ messageId: "m1", conversationId: "c1" }],
};

test("grupos na ordem e a lista achatada pula os títulos", () => {
  const groups = buildSearchGroups(result);
  assert.deepEqual(
    groups.map((group) => group.kind),
    ["conversation", "project", "message"],
  );
  assert.deepEqual(
    flattenSearchGroups(groups).map((entry) => entry.key),
    ["conversation:c1", "conversation:c2", "project:p1", "message:m1"],
  );
});

test("grupo vazio não aparece e sem resultado a lista é vazia", () => {
  const groups = buildSearchGroups({ ...result, conversations: [], messages: [] });
  assert.deepEqual(
    groups.map((group) => group.kind),
    ["project"],
  );
  assert.deepEqual(buildSearchGroups(null), []);
});

test("setas passam de grupo em grupo e dão a volta", () => {
  const keys = flattenSearchGroups(buildSearchGroups(result)).map((entry) => entry.key);
  assert.equal(moveSearchSelection(keys, "conversation:c2", "next"), "project:p1");
  assert.equal(moveSearchSelection(keys, "message:m1", "next"), "conversation:c1");
  assert.equal(moveSearchSelection(keys, "conversation:c1", "previous"), "message:m1");
  assert.equal(moveSearchSelection(keys, null, "next"), "conversation:c1");
  assert.equal(moveSearchSelection([], null, "next"), null);
});

test("resposta nova seleciona a primeira linha", () => {
  const next = selectionAfterResponse({ keys: [], selectedKey: null, moved: false }, ["a", "b"]);
  assert.deepEqual(next, { keys: ["a", "b"], selectedKey: "a", moved: false });
  assert.equal(selectionAfterResponse(next, []).selectedKey, null);
});

test("mesma lista depois das setas mantém a seleção", () => {
  const moved = { keys: ["a", "b", "c"], selectedKey: "c", moved: true };
  assert.equal(selectionAfterResponse(moved, ["a", "b", "c"]).selectedKey, "c");
});

test("lista diferente volta para a primeira linha, mesmo depois das setas", () => {
  const moved = { keys: ["a", "b", "c"], selectedKey: "c", moved: true };
  assert.equal(selectionAfterResponse(moved, ["a", "b"]).selectedKey, "a");
  assert.equal(selectionAfterResponse(moved, ["c", "b", "a"]).selectedKey, "c");
});

test("mesma lista sem ter mexido nas setas continua na primeira", () => {
  const still = { keys: ["a", "b"], selectedKey: "a", moved: false };
  assert.equal(selectionAfterResponse(still, ["a", "b"]).selectedKey, "a");
});

test("resposta antiga é descartada: quem pediu por último ganha", () => {
  const gate = createLatestGate();
  const first = gate.begin();
  const second = gate.begin();
  assert.equal(gate.isCurrent(first), false);
  assert.equal(gate.isCurrent(second), true);
});

test("cancelar invalida o pedido pendente", () => {
  const gate = createLatestGate();
  const token = gate.begin();
  gate.cancel();
  assert.equal(gate.isCurrent(token), false);
});
