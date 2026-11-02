// Plugin rehype que põe o cursor de bloco dentro do último elemento de texto do
// bloco. Assim o cursor fica na mesma linha, logo depois do último caractere.

type HastNode = {
  type: string;
  value?: string;
  tagName?: string;
  properties?: Record<string, unknown>;
  children?: HastNode[];
};

export function rehypeCaret({ className }: { className: string }) {
  return (tree: HastNode) => {
    const host = findLastTextHost(tree);
    if (!host) return;
    host.children ??= [];
    host.children.push({
      type: "element",
      tagName: "span",
      properties: { className: [className], ariaHidden: true },
      children: [],
    });
  };
}

function findLastTextHost(node: HastNode): HastNode | null {
  const children = node.children ?? [];
  for (let index = children.length - 1; index >= 0; index -= 1) {
    const child = children[index];
    if (!child) continue;
    if (child.type === "text") {
      if ((child.value ?? "").trim() !== "") return node;
      continue;
    }
    if (child.type === "element") {
      const host = findLastTextHost(child);
      if (host) return host;
    }
  }
  return null;
}
