type ManagedStyle = {
  element: HTMLStyleElement;
  sheet: CSSStyleSheet;
  owner: HTMLElement | null;
  detached: boolean;
};

const mutationOptions: MutationObserverInit = {
  childList: true,
  subtree: true,
  characterData: true,
};

const activeContainers = new Set<HTMLElement>();
const managedStyles = new Map<HTMLStyleElement, ManagedStyle>();
const xtermStyles = new WeakSet<HTMLStyleElement>();
const xtermNodeOwners = new WeakMap<Node, HTMLElement>();
const styleAttributePatched = new WeakSet<HTMLSpanElement>();
let styleObserver: MutationObserver | null = null;
let headAppendDescriptor: PropertyDescriptor | undefined;
let headAppendIntercepted = false;
let insertionHooks: Array<() => void> = [];

/**
 * Redirects xterm's dynamically inserted stylesheets through constructed sheets.
 * Temporary insertion hooks only intercept styles headed into an active terminal
 * tree; calls for every other destination use the original DOM methods. The
 * hooks are restored when the last terminal unmounts.
 */
export function connectXtermCspStyles(container: HTMLElement): () => void {
  activeContainers.add(container);
  ensureObserver();
  installInsertionHooks();
  interceptXtermStylesInHead();
  styleObserver?.observe(container, mutationOptions);

  let connected = true;
  return () => {
    if (!connected) return;
    connected = false;
    activeContainers.delete(container);

    for (const [style, entry] of managedStyles) {
      if (entry.owner === container) removeManagedStyle(style);
    }

    if (activeContainers.size === 0) {
      styleObserver?.disconnect();
      styleObserver = null;
      for (const style of managedStyles.keys()) removeManagedStyle(style);
      restoreHeadAppend();
      restoreInsertionHooks();
      return;
    }

    observeActiveRoots();
  };
}

/**
 * xterm uses documentOverride for the DOM renderer. Tagging spans at creation
 * lets us replace its one setAttribute("style", ...) path without patching
 * Element.prototype or changing style writes elsewhere in the app.
 */
export function createXtermCspDocument(container: HTMLElement): Document {
  return new Proxy(document, {
    get(target, property) {
      if (property === "createElement") {
        return (tagName: string, options?: ElementCreationOptions) => {
          const element = target.createElement(tagName, options);
          if (element instanceof HTMLStyleElement) xtermStyles.add(element);
          if (element instanceof HTMLElement) {
            xtermNodeOwners.set(element, container);
            if (element instanceof HTMLSpanElement) interceptStyleAttribute(element);
          }
          return element;
        };
      }
      if (property === "createDocumentFragment") {
        return () => {
          const fragment = target.createDocumentFragment();
          xtermNodeOwners.set(fragment, container);
          return fragment;
        };
      }

      const value = Reflect.get(target, property, target) as unknown;
      return typeof value === "function" ? value.bind(target) : value;
    },
  });
}

function ensureObserver(): void {
  if (styleObserver) return;
  styleObserver = new MutationObserver(handleStyleMutations);
  observeActiveRoots();
}

function observeActiveRoots(): void {
  if (!styleObserver) return;
  styleObserver.disconnect();
  styleObserver.observe(document.head, mutationOptions);
  for (const style of document.head.querySelectorAll("style")) synchronizeStyle(style);
  for (const container of activeContainers) {
    styleObserver.observe(container, mutationOptions);
    for (const style of container.querySelectorAll("style")) synchronizeStyle(style);
  }
  for (const entry of managedStyles.values()) {
    if (entry.detached) styleObserver.observe(entry.element, mutationOptions);
  }
}

function handleStyleMutations(records: MutationRecord[]): void {
  for (const record of records) {
    const changedStyle = getStyleElement(record.target);
    if (changedStyle) synchronizeStyle(changedStyle);

    for (const node of record.addedNodes) scanForStyles(node);
  }

  for (const style of managedStyles.keys()) {
    const entry = managedStyles.get(style);
    if (entry && !entry.detached && !style.isConnected) removeManagedStyle(style);
  }
}

function scanForStyles(node: Node): void {
  if (!(node instanceof Element)) return;
  if (node instanceof HTMLStyleElement) synchronizeStyle(node);
  for (const style of node.querySelectorAll("style")) synchronizeStyle(style);
}

function getStyleElement(node: Node): HTMLStyleElement | null {
  if (node instanceof HTMLStyleElement) return node;
  if (node instanceof Element) return node.closest("style");
  return node.parentElement?.closest("style") ?? null;
}

function synchronizeStyle(style: HTMLStyleElement): void {
  let entry = managedStyles.get(style);
  if (!entry) {
    const owner = findContainer(style);
    if (!owner && !isXtermStyleInHead(style)) return;
    entry = createManagedStyle(style, owner, false);
  }

  try {
    entry.sheet.replaceSync(style.textContent ?? "");
  } catch {
    // Keep the last valid stylesheet if xterm is midway through updating it.
  }
}

function createManagedStyle(
  element: HTMLStyleElement,
  owner: HTMLElement | null,
  detached: boolean,
): ManagedStyle {
  const sheet = new CSSStyleSheet();
  const entry = { element, sheet, owner, detached };
  managedStyles.set(element, entry);
  document.adoptedStyleSheets = [...document.adoptedStyleSheets, sheet];
  if (detached) styleObserver?.observe(element, mutationOptions);
  return entry;
}

function registerDetachedStyle(element: HTMLStyleElement, owner: HTMLElement | null): void {
  let entry = managedStyles.get(element);
  if (!entry) entry = createManagedStyle(element, owner, true);
  else {
    entry.owner = owner;
    entry.detached = true;
  }
  synchronizeStyle(element);

  const originalRemove = element.remove.bind(element);
  Object.defineProperty(element, "remove", {
    configurable: true,
    value: () => {
      removeManagedStyle(element);
      originalRemove();
    },
  });
}

function removeManagedStyle(style: HTMLStyleElement): void {
  const entry = managedStyles.get(style);
  if (!entry) return;
  managedStyles.delete(style);
  document.adoptedStyleSheets = document.adoptedStyleSheets.filter(
    (candidate) => candidate !== entry.sheet,
  );
}

function findContainer(style: HTMLStyleElement): HTMLElement | null {
  for (const container of activeContainers) {
    if (container.contains(style)) return container;
  }
  return null;
}

function isXtermStyleInHead(style: HTMLStyleElement): boolean {
  if (!document.head.contains(style)) return false;
  return isXtermStylesheetText(style.textContent ?? "");
}

function isXtermStylesheetText(cssText: string): boolean {
  return /(?:\.xterm(?:[-\s.#:[\w]|$)|xterm-)/i.test(cssText);
}

function installInsertionHooks(): void {
  if (insertionHooks.length > 0) return;

  const appendDescriptor = Object.getOwnPropertyDescriptor(Node.prototype, "appendChild");
  const originalAppend = Node.prototype.appendChild;
  Object.defineProperty(Node.prototype, "appendChild", {
    ...appendDescriptor,
    value: function <T extends Node>(this: Node, node: T): T {
      const owner = findActiveContainerForNode(this);
      if (node instanceof HTMLStyleElement && owner) {
        registerDetachedStyle(node, owner);
        return node;
      }
      if (owner) prepareOwnedSubtree(node, owner);
      return originalAppend.call(this, node) as T;
    },
  });
  insertionHooks.push(() => restoreDescriptor(Node.prototype, "appendChild", appendDescriptor));

  const insertDescriptor = Object.getOwnPropertyDescriptor(Node.prototype, "insertBefore");
  const originalInsert = Node.prototype.insertBefore;
  Object.defineProperty(Node.prototype, "insertBefore", {
    ...insertDescriptor,
    value: function <T extends Node>(this: Node, node: T, referenceNode: Node | null): T {
      const owner = findActiveContainerForNode(this);
      if (node instanceof HTMLStyleElement && owner) {
        registerDetachedStyle(node, owner);
        return node;
      }
      if (owner) prepareOwnedSubtree(node, owner);
      return originalInsert.call(this, node, referenceNode) as T;
    },
  });
  insertionHooks.push(() => restoreDescriptor(Node.prototype, "insertBefore", insertDescriptor));

  installParentAppendHook(Element.prototype);
  installParentAppendHook(DocumentFragment.prototype);
}

function installParentAppendHook(prototype: object): void {
  const descriptor = Object.getOwnPropertyDescriptor(prototype, "append");
  if (typeof descriptor?.value !== "function") return;
  const originalAppend = descriptor.value as (...nodes: (Node | string)[]) => void;

  Object.defineProperty(prototype, "append", {
    ...descriptor,
    value: function (this: Node, ...nodes: (Node | string)[]): void {
      const owner = findActiveContainerForNode(this);
      if (!owner) {
        originalAppend.apply(this, nodes);
        return;
      }

      const remainingNodes: Array<Node | string> = [];
      for (const node of nodes) {
        if (node instanceof HTMLStyleElement) {
          registerDetachedStyle(node, owner);
        } else {
          if (typeof node !== "string") prepareOwnedSubtree(node, owner);
          remainingNodes.push(node);
        }
      }
      originalAppend.apply(this, remainingNodes);
    },
  });
  insertionHooks.push(() => restoreDescriptor(prototype, "append", descriptor));
}

function restoreInsertionHooks(): void {
  for (const restore of insertionHooks.reverse()) restore();
  insertionHooks = [];
}

function restoreDescriptor(
  prototype: object,
  property: string,
  descriptor?: PropertyDescriptor,
): void {
  if (descriptor) Object.defineProperty(prototype, property, descriptor);
  else Reflect.deleteProperty(prototype, property);
}

function findActiveContainerForNode(node: Node): HTMLElement | null {
  let current: Node | null = node;
  while (current) {
    const owner = xtermNodeOwners.get(current);
    if (owner && activeContainers.has(owner)) return owner;

    for (const container of activeContainers) {
      if (container === current || container.contains(current)) return container;
    }
    current = current.parentNode;
  }
  return null;
}

function markOwnedSubtree(node: Node, owner: HTMLElement): void {
  xtermNodeOwners.set(node, owner);
  if (node instanceof Element || node instanceof DocumentFragment) {
    for (const child of node.children) markOwnedSubtree(child, owner);
  }
}

function prepareOwnedSubtree(node: Node, owner: HTMLElement): void {
  markOwnedSubtree(node, owner);
  if (!(node instanceof Element || node instanceof DocumentFragment)) return;
  if (node instanceof HTMLStyleElement) registerDetachedStyle(node, owner);
  for (const style of node.querySelectorAll("style")) registerDetachedStyle(style, owner);
}

function interceptXtermStylesInHead(): void {
  if (headAppendIntercepted) return;
  headAppendIntercepted = true;

  const head = document.head;
  headAppendDescriptor = Object.getOwnPropertyDescriptor(head, "appendChild");
  const originalAppend = head.appendChild.bind(head);
  Object.defineProperty(head, "appendChild", {
    configurable: true,
    value: (node: Node) => {
      if (
        node instanceof HTMLStyleElement &&
        (xtermStyles.has(node) || isXtermStylesheetText(node.textContent ?? ""))
      ) {
        registerDetachedStyle(node, findContainer(node));
        return node;
      }
      return originalAppend(node);
    },
  });
}

function restoreHeadAppend(): void {
  if (!headAppendIntercepted) return;
  if (headAppendDescriptor) {
    Object.defineProperty(document.head, "appendChild", headAppendDescriptor);
  } else {
    Reflect.deleteProperty(document.head, "appendChild");
  }
  headAppendDescriptor = undefined;
  headAppendIntercepted = false;
}

function interceptStyleAttribute(element: HTMLSpanElement): void {
  if (styleAttributePatched.has(element)) return;
  styleAttributePatched.add(element);

  const originalSetAttribute = element.setAttribute.bind(element);
  Object.defineProperty(element, "setAttribute", {
    configurable: true,
    value: (qualifiedName: string, value: string) => {
      if (qualifiedName.toLowerCase() === "style" && applyXtermStyleAttribute(element, value)) {
        return;
      }
      originalSetAttribute(qualifiedName, value);
    },
  });
}

function applyXtermStyleAttribute(element: HTMLSpanElement, value: string): boolean {
  const parsedStyle = document.createElement("span").style;
  parsedStyle.cssText = value;
  const allowedProperties = new Set([
    "background-color",
    "color",
    "text-decoration",
    "text-decoration-color",
  ]);
  const properties = Array.from({ length: parsedStyle.length }, (_, index) =>
    parsedStyle.item(index),
  );
  if (properties.length === 0 || properties.some((property) => !allowedProperties.has(property))) {
    return false;
  }

  for (const property of properties) {
    element.style.setProperty(
      property,
      parsedStyle.getPropertyValue(property),
      parsedStyle.getPropertyPriority(property),
    );
  }
  return true;
}
