import { z } from "zod";

export const MAX_PANES = 6;
export const MIN_PANE_SIZE = 15;

export type PaneView =
  | { kind: "new-conversation" }
  | { kind: "terminal"; terminalId: string }
  | { kind: "chat"; conversationId: string };

export type PaneNode = {
  type: "pane";
  id: string;
  view: PaneView;
};

export type SplitNode = {
  type: "split";
  id: string;
  direction: "row" | "column";
  children: LayoutNode[];
  sizes: number[];
};

export type LayoutNode = PaneNode | SplitNode;
export type SplitSide = "before" | "after";
export type PaneEdge = "left" | "right" | "top" | "bottom";

const paneViewSchema = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("new-conversation") }),
  z.object({ kind: z.literal("terminal"), terminalId: z.string().min(1) }),
  z.object({ kind: z.literal("chat"), conversationId: z.string().min(1) }),
]);

const nodeSchema: z.ZodType<LayoutNode> = z.lazy(() =>
  z.discriminatedUnion("type", [
    z.object({ type: z.literal("pane"), id: z.string().min(1), view: paneViewSchema }),
    z.object({
      type: z.literal("split"),
      id: z.string().min(1),
      direction: z.enum(["row", "column"]),
      children: z.array(nodeSchema).min(2).max(MAX_PANES),
      sizes: z.array(z.number().finite().min(0).max(100)).min(2).max(MAX_PANES),
    }),
  ]),
);

export function createInitialLayout(): PaneNode {
  return { type: "pane", id: "pane-1", view: { kind: "new-conversation" } };
}

export function paneCount(tree: LayoutNode): number {
  return tree.type === "pane"
    ? 1
    : tree.children.reduce((total, child) => total + paneCount(child), 0);
}

export function listPanes(tree: LayoutNode): PaneNode[] {
  return tree.type === "pane" ? [tree] : tree.children.flatMap(listPanes);
}

export function findPane(tree: LayoutNode, paneId: string): PaneNode | undefined {
  if (tree.type === "pane") return tree.id === paneId ? tree : undefined;
  for (const child of tree.children) {
    const pane = findPane(child, paneId);
    if (pane) return pane;
  }
  return undefined;
}

export function findPaneByTerminal(tree: LayoutNode, terminalId: string): PaneNode | undefined {
  return listPanes(tree).find(
    (pane) => pane.view.kind === "terminal" && pane.view.terminalId === terminalId,
  );
}

export function findPaneByConversation(
  tree: LayoutNode,
  conversationId: string,
): PaneNode | undefined {
  return listPanes(tree).find(
    (pane) => pane.view.kind === "chat" && pane.view.conversationId === conversationId,
  );
}

export function selectTerminalPane(
  tree: LayoutNode,
  activePaneId: string,
  terminalId: string,
): { tree: LayoutNode; paneId: string } {
  const existingPane = findPaneByTerminal(tree, terminalId);
  if (existingPane) return { tree, paneId: existingPane.id };

  const targetPane = findPane(tree, activePaneId) ?? listPanes(tree)[0];
  if (!targetPane) return { tree, paneId: activePaneId };

  return {
    tree: setView(tree, targetPane.id, { kind: "terminal", terminalId }),
    paneId: targetPane.id,
  };
}

export function setView(tree: LayoutNode, paneId: string, view: PaneView): LayoutNode {
  if (tree.type === "pane") {
    return tree.id === paneId ? { ...tree, view: { ...view } } : tree;
  }
  return {
    ...tree,
    children: tree.children.map((child) => setView(child, paneId, view)),
  };
}

export function splitPane(
  tree: LayoutNode,
  paneId: string,
  direction: "row" | "column",
  side: SplitSide,
  newView: PaneView,
): LayoutNode {
  if (!findPane(tree, paneId) || paneCount(tree) >= MAX_PANES) return tree;

  const newPaneId = nextId(tree, "pane");
  const splitId = nextId(tree, "split");
  const newPane: PaneNode = { type: "pane", id: newPaneId, view: { ...newView } };
  const replace = (node: LayoutNode): LayoutNode => {
    if (node.type === "pane") {
      if (node.id !== paneId) return node;
      const children = side === "before" ? [newPane, node] : [node, newPane];
      return { type: "split", id: splitId, direction, children, sizes: [50, 50] };
    }
    return { ...node, children: node.children.map(replace) };
  };

  return normalize(replace(tree));
}

export function closePane(tree: LayoutNode, paneId: string): LayoutNode {
  if (!findPane(tree, paneId)) return tree;
  if (tree.type === "pane") {
    return { ...tree, view: { kind: "new-conversation" } };
  }

  const remove = (node: LayoutNode): LayoutNode | null => {
    if (node.type === "pane") return node.id === paneId ? null : node;

    const children: LayoutNode[] = [];
    const sizes: number[] = [];
    node.children.forEach((child, index) => {
      const nextChild = remove(child);
      if (nextChild) {
        children.push(nextChild);
        sizes.push(node.sizes[index] ?? 0);
      }
    });

    if (children.length === 0) return null;
    if (children.length === 1) return children[0] ?? null;
    return { ...node, children, sizes: constrainSizes(sizes) };
  };

  return normalize(remove(tree) ?? createInitialLayout());
}

export function movePane(
  tree: LayoutNode,
  paneId: string,
  targetPaneId: string,
  edge: PaneEdge,
): LayoutNode {
  if (paneId === targetPaneId || !findPane(tree, paneId) || !findPane(tree, targetPaneId)) {
    return tree;
  }

  const paneToMove = findPane(tree, paneId);
  if (!paneToMove) return tree;
  const remaining = removePaneNode(tree, paneId);
  if (!remaining || !findPane(remaining, targetPaneId)) return tree;

  const direction = edge === "left" || edge === "right" ? "row" : "column";
  const before = edge === "left" || edge === "top";
  const splitId = nextId(tree, "split");
  const insert = (node: LayoutNode): LayoutNode => {
    if (node.type === "pane") {
      if (node.id !== targetPaneId) return node;
      const children = before ? [paneToMove, node] : [node, paneToMove];
      return { type: "split", id: splitId, direction, children, sizes: [50, 50] };
    }
    return { ...node, children: node.children.map(insert) };
  };

  return normalize(insert(remaining));
}

export function setSizes(tree: LayoutNode, splitId: string, sizes: number[]): LayoutNode {
  if (tree.type === "pane") return tree;
  if (tree.id === splitId) {
    if (sizes.length !== tree.children.length) return tree;
    return normalize({ ...tree, sizes: constrainSizes(sizes) });
  }
  return {
    ...tree,
    children: tree.children.map((child) => setSizes(child, splitId, sizes)),
  };
}

export function normalize(tree: LayoutNode): LayoutNode {
  return normalizeNode(tree) ?? createInitialLayout();
}

function normalizeNode(tree: LayoutNode): LayoutNode | null {
  if (tree.type === "pane") return { ...tree, view: { ...tree.view } };

  const children: LayoutNode[] = [];
  const sizes: number[] = [];
  tree.children.forEach((child, index) => {
    const normalizedChild = normalizeNode(child);
    if (!normalizedChild) return;
    const parentSize = tree.sizes[index] ?? 0;
    if (normalizedChild.type === "split" && normalizedChild.direction === tree.direction) {
      normalizedChild.children.forEach((grandchild, grandchildIndex) => {
        children.push(grandchild);
        sizes.push((parentSize * (normalizedChild.sizes[grandchildIndex] ?? 0)) / 100);
      });
    } else {
      children.push(normalizedChild);
      sizes.push(parentSize);
    }
  });

  if (children.length === 0) return null;
  if (children.length === 1) return children[0] ?? null;
  return {
    ...tree,
    children,
    sizes: constrainSizes(sizes),
  };
}

export function validate(value: unknown): LayoutNode {
  const parsed = parseValidLayout(value);
  return parsed ? normalize(parsed) : createInitialLayout();
}

export function isValidLayout(value: unknown): value is LayoutNode {
  return parseValidLayout(value) !== null;
}

function parseValidLayout(value: unknown): LayoutNode | null {
  const parsed = nodeSchema.safeParse(value);
  if (!parsed.success || paneCount(parsed.data) > MAX_PANES) return null;
  return hasValidIdsAndSizes(parsed.data) ? parsed.data : null;
}

function hasValidIdsAndSizes(tree: LayoutNode): boolean {
  const ids = new Set<string>();
  let valid = true;

  const visit = (node: LayoutNode) => {
    if (ids.has(node.id)) valid = false;
    ids.add(node.id);
    if (node.type === "pane") return;
    if (node.children.length !== node.sizes.length) valid = false;
    const sum = node.sizes.reduce((total, size) => total + size, 0);
    if (Math.abs(sum - 100) > 0.01 || node.sizes.some((size) => size <= 0)) valid = false;
    node.children.forEach(visit);
  };

  visit(tree);
  return valid;
}

function removePaneNode(tree: LayoutNode, paneId: string): LayoutNode | null {
  if (tree.type === "pane") return tree.id === paneId ? null : tree;

  const children: LayoutNode[] = [];
  const sizes: number[] = [];
  tree.children.forEach((child, index) => {
    const nextChild = removePaneNode(child, paneId);
    if (nextChild) {
      children.push(nextChild);
      sizes.push(tree.sizes[index] ?? 0);
    }
  });

  if (children.length === 0) return null;
  if (children.length === 1) return children[0] ?? null;
  return { ...tree, children, sizes: constrainSizes(sizes) };
}

function nextId(tree: LayoutNode, prefix: "pane" | "split"): string {
  let highest = 0;
  const visit = (node: LayoutNode) => {
    const match = new RegExp(`^${prefix}-(\\d+)$`).exec(node.id);
    if (match?.[1]) highest = Math.max(highest, Number(match[1]));
    if (node.type === "split") node.children.forEach(visit);
  };
  visit(tree);
  return `${prefix}-${highest + 1}`;
}

function constrainSizes(sizes: number[]): number[] {
  if (sizes.length === 0) return [];
  if (sizes.length * MIN_PANE_SIZE > 100) {
    return sizes.map(() => 100 / sizes.length);
  }

  const weights = sizes.map((size) => (Number.isFinite(size) && size > 0 ? size : 0));
  const total = weights.reduce((sum, size) => sum + size, 0);
  const scaled =
    total > 0 ? weights.map((size) => (size / total) * 100) : weights.map(() => 100 / sizes.length);
  const fixed = new Set<number>();
  const result = [...scaled];

  while (true) {
    const undersized = result.findIndex((size, index) => !fixed.has(index) && size < MIN_PANE_SIZE);
    if (undersized < 0) break;
    fixed.add(undersized);
    result[undersized] = MIN_PANE_SIZE;
    const remaining = 100 - fixed.size * MIN_PANE_SIZE;
    const flexibleWeight = result.reduce(
      (sum, size, index) => sum + (fixed.has(index) ? 0 : size),
      0,
    );
    if (flexibleWeight === 0) break;
    result.forEach((size, index) => {
      if (!fixed.has(index)) result[index] = (size / flexibleWeight) * remaining;
    });
  }

  const rounding = 100 - result.reduce((sum, size) => sum + size, 0);
  let lastFlexible = -1;
  for (let index = result.length - 1; index >= 0; index -= 1) {
    if (!fixed.has(index)) {
      lastFlexible = index;
      break;
    }
  }
  const lastIndex = lastFlexible >= 0 ? lastFlexible : result.length - 1;
  result[lastIndex] = (result[lastIndex] ?? 0) + rounding;
  return result;
}
