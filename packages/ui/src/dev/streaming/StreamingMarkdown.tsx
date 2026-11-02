import type { ReactNode } from "react";
import {
  Children,
  cloneElement,
  Fragment,
  isValidElement,
  memo,
  useEffect,
  useMemo,
  useState,
} from "react";
import Markdown from "react-markdown";
import remarkGfm from "remark-gfm";
import conversationStyles from "../../conversation/ConversationParts.module.css";
import { splitMarkdownBlocks } from "../../conversation/markdownBlocks.ts";
import styles from "./StreamingDemo.module.css";
import { splitIntoWords } from "./streamingText.mjs";

type HighlightPlugin = typeof import("rehype-highlight").default;
type Motion = "none" | "fade" | "blur";
export type CaretPhase = "off" | "streaming" | "idle" | "done";

type HastNode = {
  type: string;
  value?: string;
  tagName?: string;
  properties?: Record<string, unknown>;
  children?: HastNode[];
};

export type RenderMetrics = { latestBlockRenders: number };

let highlightPluginPromise: Promise<HighlightPlugin | null> | null = null;

function loadHighlightPlugin(): Promise<HighlightPlugin | null> {
  highlightPluginPromise ??= import("rehype-highlight")
    .then(({ default: rehypeHighlight }) => rehypeHighlight)
    .catch(() => null);
  return highlightPluginPromise;
}

export const StreamingMarkdown = memo(function StreamingMarkdown({
  caretPhase = "off",
  markdown,
  done,
  motion,
  metrics,
}: {
  caretPhase?: CaretPhase;
  markdown: string;
  done: boolean;
  motion: Motion;
  metrics: RenderMetrics;
}) {
  const [highlightPlugin, setHighlightPlugin] = useState<HighlightPlugin | null>(null);
  const blocks = useMemo(() => splitMarkdownBlocks(markdown), [markdown]);
  const hasHighlightableCode = blocks.some(
    (block) => block.hasFencedCode && (block.closed || done),
  );

  useEffect(() => {
    if (!hasHighlightableCode) return;
    let mounted = true;
    void loadHighlightPlugin().then((plugin) => {
      if (mounted && plugin) setHighlightPlugin(() => plugin);
    });
    return () => {
      mounted = false;
    };
  }, [hasHighlightableCode]);

  return (
    <div
      className={`${conversationStyles.markdown} ${styles.markdownSurface}`}
      data-caret={caretPhase}
    >
      {blocks.map((block, index) => {
        const latest = index === blocks.length - 1;
        const useHighlight =
          highlightPlugin !== null && block.hasFencedCode && (block.closed || done);
        return (
          <MarkdownBlock
            block={block.markdown}
            caret={latest && caretPhase !== "off"}
            key={block.start}
            latest={latest}
            metrics={metrics}
            motion={motion}
            start={block.start}
            highlightPlugin={highlightPlugin}
            useHighlight={useHighlight}
          />
        );
      })}
    </div>
  );
});

const MarkdownBlock = memo(
  function MarkdownBlock({
    block,
    caret,
    latest,
    metrics,
    motion,
    start,
    highlightPlugin,
    useHighlight,
  }: {
    block: string;
    caret: boolean;
    latest: boolean;
    metrics: RenderMetrics;
    motion: Motion;
    start: number;
    highlightPlugin: HighlightPlugin | null;
    useHighlight: boolean;
  }) {
    if (latest) metrics.latestBlockRenders += 1;

    // Positions are rebuilt on every render of this block, in document order.
    // Each word keeps the same key while it stays in the text, so React keeps
    // its span mounted and its fade plays only once.
    const context: TextContext = {
      blockStart: start,
      motion,
      cursor: { current: 0 },
      lineCursor: { current: 0 },
    };
    const animated = motion !== "none";

    const components = {
      p: ({ children, node: _node, ...props }: { children?: ReactNode; node?: unknown }) => (
        <p {...props}>{animated ? wrapInlineChildren(children, context) : children}</p>
      ),
      h1: ({ children, node: _node, ...props }: { children?: ReactNode; node?: unknown }) => (
        <h1 {...props}>{animated ? wrapInlineChildren(children, context) : children}</h1>
      ),
      h2: ({ children, node: _node, ...props }: { children?: ReactNode; node?: unknown }) => (
        <h2 {...props}>{animated ? wrapInlineChildren(children, context) : children}</h2>
      ),
      h3: ({ children, node: _node, ...props }: { children?: ReactNode; node?: unknown }) => (
        <h3 {...props}>{animated ? wrapInlineChildren(children, context) : children}</h3>
      ),
      h4: ({ children, node: _node, ...props }: { children?: ReactNode; node?: unknown }) => (
        <h4 {...props}>{animated ? wrapInlineChildren(children, context) : children}</h4>
      ),
      h5: ({ children, node: _node, ...props }: { children?: ReactNode; node?: unknown }) => (
        <h5 {...props}>{animated ? wrapInlineChildren(children, context) : children}</h5>
      ),
      h6: ({ children, node: _node, ...props }: { children?: ReactNode; node?: unknown }) => (
        <h6 {...props}>{animated ? wrapInlineChildren(children, context) : children}</h6>
      ),
      li: ({ children, node: _node, ...props }: { children?: ReactNode; node?: unknown }) => (
        <li {...props}>{animated ? wrapInlineChildren(children, context) : children}</li>
      ),
      pre: ({ children }: { children?: ReactNode }) => {
        const code = getText(children);
        const isAnimatedCode = animated && !useHighlight;
        const visibleCode = isAnimatedCode ? renderCodeLines(code, context) : children;
        return (
          <div className={conversationStyles.codeBlock}>
            <pre>{visibleCode}</pre>
          </div>
        );
      },
    };

    return (
      <Markdown
        components={components}
        rehypePlugins={[
          ...(useHighlight && highlightPlugin ? [highlightPlugin] : []),
          ...(caret ? [rehypeCaret] : []),
        ]}
        remarkPlugins={[remarkGfm]}
      >
        {block}
      </Markdown>
    );
  },
  (previous, next) =>
    previous.block === next.block &&
    previous.latest === next.latest &&
    previous.caret === next.caret &&
    previous.metrics === next.metrics &&
    previous.motion === next.motion &&
    previous.start === next.start &&
    (!next.useHighlight || previous.highlightPlugin === next.highlightPlugin) &&
    previous.useHighlight === next.useHighlight,
);

const CARET_CLASS = styles.caret;

// Appends the block caret inside the deepest element that holds the last
// visible text, so it sits right after the last character on the same line.
function rehypeCaret() {
  return (tree: HastNode) => {
    const host = findLastTextHost(tree);
    if (!host) return;
    host.children ??= [];
    host.children.push({
      type: "element",
      tagName: "span",
      properties: { className: [CARET_CLASS], ariaHidden: true },
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

type TextContext = {
  blockStart: number;
  motion: Motion;
  cursor: { current: number };
  lineCursor: { current: number };
};

function wrapInlineChildren(children: ReactNode, context: TextContext): ReactNode {
  return Children.map(children, (child) => {
    if (typeof child === "string") {
      return splitIntoWords(child).map((segment) => {
        const position = context.cursor.current;
        context.cursor.current += segment.value.length;
        if (segment.kind !== "word") return segment.value;

        return (
          <span
            className={context.motion === "blur" ? styles.wordBlur : styles.wordFade}
            data-stream-word-position={context.blockStart + position}
            key={`word-${context.blockStart + position}`}
          >
            {segment.value}
          </span>
        );
      });
    }

    if (!isValidElement(child)) return child;
    const props = child.props as { children?: ReactNode };
    if (typeof child.type === "string" && blockElements.has(child.type)) return child;
    return cloneElement(child, undefined, wrapInlineChildren(props.children, context));
  });
}

const blockElements = new Set([
  "blockquote",
  "li",
  "ol",
  "p",
  "pre",
  "table",
  "tbody",
  "td",
  "th",
  "thead",
  "tr",
  "ul",
]);

function renderCodeLines(code: string, context: TextContext): ReactNode {
  const lines = code.split("\n");
  return (
    <code>
      {lines.map((line, lineIndex) => {
        const lineKey = context.blockStart + context.lineCursor.current;
        context.lineCursor.current += 1;
        return (
          <Fragment key={`line-${lineKey}`}>
            <span
              className={context.motion === "blur" ? styles.lineBlur : styles.lineFade}
              data-stream-line-position={lineKey}
            >
              {line}
            </span>
            {lineIndex < lines.length - 1 ? "\n" : null}
          </Fragment>
        );
      })}
    </code>
  );
}

function getText(node: ReactNode): string {
  if (typeof node === "string" || typeof node === "number") return String(node);
  if (Array.isArray(node)) return node.map(getText).join("");
  if (isValidElement(node)) {
    const props = node.props as { children?: ReactNode };
    return getText(props.children);
  }
  return "";
}
