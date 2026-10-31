import assert from "node:assert/strict";
import test from "node:test";
import {
  closePane,
  createInitialLayout,
  findPaneByTerminal,
  type LayoutNode,
  listPanes,
  movePane,
  normalize,
  paneCount,
  selectTerminalPane,
  setSizes,
  setView,
  splitPane,
  validate,
} from "../../../ui/src/workspace/layout.ts";

test("divide painéis antes ou depois e achata divisões na mesma direção", () => {
  const initial = createInitialLayout();
  const right = splitPane(initial, "pane-1", "row", "after", {
    kind: "terminal",
    terminalId: "t-1",
  });
  assert.deepEqual(
    listPanes(right).map((pane) => pane.id),
    ["pane-1", "pane-2"],
  );
  assert.equal(right.type, "split");
  if (right.type !== "split") return;
  assert.deepEqual(right.sizes, [50, 50]);

  const three = splitPane(right, "pane-2", "row", "before", { kind: "new-conversation" });
  assert.equal(three.type, "split");
  if (three.type !== "split") return;
  assert.equal(three.children.length, 3);
  assert.ok(three.children.every((child) => child.type === "pane"));
  assert.ok(Math.abs(three.sizes.reduce((sum, size) => sum + size, 0) - 100) < 0.01);
});

test("fecha um painel sem fechar o terminal e o painel único volta para Nova conversa", () => {
  const split = splitPane(createInitialLayout(), "pane-1", "row", "after", {
    kind: "terminal",
    terminalId: "t-1",
  });
  const remaining = closePane(split, "pane-1");
  assert.equal(paneCount(remaining), 1);
  assert.equal(findPaneByTerminal(remaining, "t-1")?.id, "pane-2");

  const onlyPane = closePane(remaining, "pane-2");
  assert.deepEqual(onlyPane, { type: "pane", id: "pane-2", view: { kind: "new-conversation" } });
});

test("move uma conversa para cada direção da borda alvo", () => {
  const twoPanes = splitPane(createInitialLayout(), "pane-1", "row", "after", {
    kind: "terminal",
    terminalId: "t-1",
  });
  for (const [edge, direction] of [
    ["left", "row"],
    ["right", "row"],
    ["top", "column"],
    ["bottom", "column"],
  ] as const) {
    const moved = movePane(twoPanes, "pane-2", "pane-1", edge);
    assert.equal(moved.type, "split");
    if (moved.type !== "split") continue;
    assert.equal(moved.direction, direction);
    assert.deepEqual(
      moved.children.map((child) => child.id),
      edge === "left" || edge === "top" ? ["pane-2", "pane-1"] : ["pane-1", "pane-2"],
    );
    assert.equal(movePane(moved, "pane-2", "pane-2", "left"), moved);
  }
});

test("atualiza a conversa e os tamanhos com o mínimo de 15%", () => {
  const split = splitPane(createInitialLayout(), "pane-1", "row", "after", {
    kind: "new-conversation",
  });
  const withTerminal = setView(split, "pane-2", { kind: "terminal", terminalId: "t-2" });
  assert.equal(findPaneByTerminal(withTerminal, "t-2")?.id, "pane-2");
  if (withTerminal.type !== "split") return;

  const resized = setSizes(withTerminal, withTerminal.id, [2, 98]);
  assert.equal(resized.type, "split");
  if (resized.type !== "split") return;
  assert.deepEqual(resized.sizes, [15, 85]);
});

test("normaliza divisões adjacentes e limita o layout a seis painéis", () => {
  const nested = {
    type: "split" as const,
    id: "split-root",
    direction: "row" as const,
    sizes: [25, 75],
    children: [
      {
        type: "split" as const,
        id: "split-inner",
        direction: "row" as const,
        sizes: [50, 50],
        children: [
          { type: "pane" as const, id: "pane-1", view: { kind: "new-conversation" as const } },
          { type: "pane" as const, id: "pane-2", view: { kind: "new-conversation" as const } },
        ],
      },
      { type: "pane" as const, id: "pane-3", view: { kind: "new-conversation" as const } },
    ],
  };
  const flat = normalize(nested);
  assert.equal(flat.type, "split");
  if (flat.type !== "split") return;
  assert.equal(flat.children.length, 3);
  assert.ok(flat.sizes.every((size) => size >= 15));
  assert.ok(Math.abs(flat.sizes.reduce((sum, size) => sum + size, 0) - 100) < 0.01);

  const withEmptyChild = {
    type: "split" as const,
    id: "split-parent",
    direction: "row" as const,
    sizes: [20, 80],
    children: [
      {
        type: "split" as const,
        id: "split-empty",
        direction: "row" as const,
        sizes: [],
        children: [],
      },
      { type: "pane" as const, id: "pane-only", view: { kind: "new-conversation" as const } },
    ],
  } as unknown as LayoutNode;
  assert.deepEqual(normalize(withEmptyChild), {
    type: "pane",
    id: "pane-only",
    view: { kind: "new-conversation" },
  });

  let six: LayoutNode = createInitialLayout();
  for (let index = 0; index < 5; index += 1) {
    const lastPane = listPanes(six).at(-1);
    assert.ok(lastPane);
    six = splitPane(six, lastPane.id, "row", "after", { kind: "new-conversation" });
  }
  assert.equal(paneCount(six), 6);
  const unchanged = splitPane(six, "pane-1", "row", "after", { kind: "new-conversation" });
  assert.equal(unchanged, six);
});

test("substitui árvores inválidas por Nova conversa e aceita a view de chat do M2", () => {
  assert.deepEqual(validate({ type: "split", children: [] }), createInitialLayout());
  const tree = validate({
    type: "pane",
    id: "pane-chat",
    view: { kind: "chat", conversationId: "c-1" },
  });
  assert.deepEqual(tree, {
    type: "pane",
    id: "pane-chat",
    view: { kind: "chat", conversationId: "c-1" },
  });
});

test("selecionar um terminal já aberto ativa seu painel sem substituir outras conversas nem tamanhos", () => {
  let tree: LayoutNode = createInitialLayout();
  tree = splitPane(tree, "pane-1", "row", "after", {
    kind: "terminal",
    terminalId: "terminal-b",
  });
  tree = setView(tree, "pane-1", { kind: "terminal", terminalId: "terminal-a" });
  const rootSplit = tree;
  assert.equal(rootSplit.type, "split");
  if (rootSplit.type !== "split") return;

  tree = splitPane(tree, "pane-2", "column", "after", { kind: "new-conversation" });
  const updatedRoot = tree;
  assert.equal(updatedRoot.type, "split");
  if (updatedRoot.type !== "split") return;
  const nestedSplit = updatedRoot.children.find((child) => child.type === "split");
  assert.ok(nestedSplit && nestedSplit.type === "split");

  tree = setSizes(tree, updatedRoot.id, [38, 62]);
  tree = setSizes(tree, nestedSplit.id, [67, 33]);
  const saved = validate(tree);
  const selected = selectTerminalPane(saved, "pane-3", "terminal-a");

  assert.equal(selected.paneId, "pane-1");
  assert.strictEqual(selected.tree, saved);
  assert.equal(paneCount(selected.tree), 3);
  assert.equal(findPaneByTerminal(selected.tree, "terminal-b")?.id, "pane-2");
  assert.deepEqual(
    listPanes(selected.tree).map((pane) => pane.view.kind),
    ["terminal", "terminal", "new-conversation"],
  );
  assert.equal(selected.tree.type, "split");
  if (selected.tree.type !== "split") return;
  assert.deepEqual(selected.tree.sizes, [38, 62]);
  const selectedNestedSplit = selected.tree.children.find((child) => child.type === "split");
  assert.ok(selectedNestedSplit && selectedNestedSplit.type === "split");
  assert.deepEqual(selectedNestedSplit.sizes, [67, 33]);
});
