import type { ReactNode } from "react";
import {
  Children,
  cloneElement,
  Fragment,
  isValidElement,
  memo,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
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

export type RenderMetrics = { latestBlockRenders: number };

let highlightPluginPromise: Promise<HighlightPlugin | null> | null = null;

function loadHighlightPlugin(): Promise<HighlightPlugin | null> {
  highlightPluginPromise ??= import("rehype-highlight")
    .then(({ default: rehypeHighlight }) => rehypeHighlight)
    .catch(() => null);
  return highlightPluginPromise;
}

export const StreamingMarkdown = memo(function StreamingMarkdown({
  markdown,
  done,
  motion,
  metrics,
}: {
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
    <div className={`${conversationStyles.markdown} ${styles.markdownSurface}`}>
      {blocks.map((block, index) => {
        const latest = index === blocks.length - 1;
        const useHighlight =
          highlightPlugin !== null && block.hasFencedCode && (block.closed || done);
        return (
          <MarkdownBlock
            block={block.markdown}
            done={done}
            key={block.start}
            latest={latest}
            metrics={metrics}
            motion={latest ? motion : "none"}
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
    done,
    latest,
    metrics,
    motion,
    start,
    highlightPlugin,
    useHighlight,
  }: {
    block: string;
    done: boolean;
    latest: boolean;
    metrics: RenderMetrics;
    motion: Motion;
    start: number;
    highlightPlugin: HighlightPlugin | null;
    useHighlight: boolean;
  }) {
    const previousTextLengthRef = useRef(0);
    const currentTextLengthRef = useRef(0);
    const previousCodeLineCountRef = useRef(0);
    const currentCodeLineCountRef = useRef(0);

    if (latest) metrics.latestBlockRenders += 1;
    const previousTextLength = previousTextLengthRef.current;
    const previousCodeLineCount = previousCodeLineCountRef.current;
    currentTextLengthRef.current = 0;
    currentCodeLineCountRef.current = 0;

    useLayoutEffect(() => {
      previousTextLengthRef.current = currentTextLengthRef.current;
      previousCodeLineCountRef.current = currentCodeLineCountRef.current;
    });

    const animated = latest && motion !== "none" && !done;
    const context: TextContext = {
      blockStart: start,
      animated,
      motion,
      previousLength: previousTextLength,
      cursor: currentTextLengthRef,
    };

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
        const visibleCode = isAnimatedCode
          ? renderCodeLines(code, start, previousCodeLineCount, currentCodeLineCountRef, motion)
          : children;
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
        rehypePlugins={useHighlight && highlightPlugin ? [highlightPlugin] : []}
        remarkPlugins={[remarkGfm]}
      >
        {block}
      </Markdown>
    );
  },
  (previous, next) =>
    previous.block === next.block &&
    (previous.done === next.done || (!previous.latest && !next.latest)) &&
    previous.latest === next.latest &&
    previous.metrics === next.metrics &&
    previous.motion === next.motion &&
    previous.start === next.start &&
    (!next.useHighlight || previous.highlightPlugin === next.highlightPlugin) &&
    previous.useHighlight === next.useHighlight,
);

type TextContext = {
  blockStart: number;
  animated: boolean;
  motion: Motion;
  previousLength: number;
  cursor: { current: number };
};

function wrapInlineChildren(children: ReactNode, context: TextContext): ReactNode {
  return Children.map(children, (child) => {
    if (typeof child === "string") {
      return splitIntoWords(child).map((segment) => {
        const position = context.cursor.current;
        context.cursor.current += segment.value.length;
        const isNewWord = segment.kind === "word" && position >= context.previousLength;
        if (!context.animated || !isNewWord) return segment.value;

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

function renderCodeLines(
  code: string,
  blockStart: number,
  previousLineCount: number,
  currentLineCount: { current: number },
  motion: Motion,
): ReactNode {
  const lines = code.split("\n");
  return (
    <code>
      {lines.map((line, lineIndex) => {
        const stableLineIndex = currentLineCount.current;
        currentLineCount.current += 1;
        const lineKey = blockStart + stableLineIndex;
        return (
          <Fragment key={`line-${lineKey}`}>
            <span
              className={
                stableLineIndex >= previousLineCount
                  ? motion === "blur"
                    ? styles.lineBlur
                    : styles.lineFade
                  : undefined
              }
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
