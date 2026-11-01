import { type AgentErrorAgent, describeAgentError } from "@karont/contract";
import {
  AlertTriangle,
  Bot,
  Brain,
  Check,
  CheckCircle2,
  ChevronRight,
  Circle,
  Clock3,
  Copy,
  FileCode2,
  FileText,
  Globe2,
  HelpCircle,
  Image as ImageIcon,
  ListTodo,
  LoaderCircle,
  LockKeyhole,
  Pencil,
  Play,
  Plug,
  Search,
  SquareTerminal,
  Wrench,
  XCircle,
} from "lucide-react";
import type { ReactNode } from "react";
import {
  type FormEvent,
  type KeyboardEvent,
  memo,
  useCallback,
  useEffect,
  useId,
  useMemo,
  useRef,
  useState,
} from "react";
import Markdown from "react-markdown";
import remarkGfm from "remark-gfm";
import { Button } from "../components/Button/Button.tsx";
import { t } from "../i18n/pt-BR.ts";
import {
  countDiffLines,
  formatDiffStats,
  getDiffDisplayLines,
  parseFileChanges,
} from "./actionDiff.ts";
import {
  type ConversationAction,
  categoryForAction,
  groupActionsByParentId,
  groupConsecutiveActions,
  summarizeAction,
  summarizeActionDiff,
  summarizeActionGroup,
} from "./actionSummary.ts";
import { formatAttachmentSize } from "./attachmentUtils.ts";
import styles from "./ConversationParts.module.css";
import { formatWorkDuration, splitFinalAnswer } from "./conversationDisplay.ts";
import { cleanMarkdownPreview, formatConversationText } from "./displayText.ts";
import { getAllowedExternalUrl } from "./externalLinks.ts";
import { splitMarkdownBlocks } from "./markdownBlocks.ts";
import type { ConversationMessage, MessagePart } from "./useConversation.ts";
import { WorkingIndicator } from "./WorkingIndicator.tsx";

type HighlightPlugin = typeof import("rehype-highlight").default;
let highlightPluginPromise: Promise<HighlightPlugin | null> | null = null;

function loadHighlightPlugin(): Promise<HighlightPlugin | null> {
  highlightPluginPromise ??= import("rehype-highlight")
    .then(({ default: rehypeHighlight }) => rehypeHighlight)
    .catch(() => null);
  return highlightPluginPromise;
}

const messageDateFormatter = new Intl.DateTimeFormat("pt-BR", {
  day: "numeric",
  month: "short",
});
const messageDateFormatterWithYear = new Intl.DateTimeFormat("pt-BR", {
  day: "numeric",
  month: "short",
  year: "numeric",
});
const messageTimeFormatter = new Intl.DateTimeFormat("pt-BR", {
  hour: "2-digit",
  minute: "2-digit",
  hourCycle: "h23",
});

function formatMessageDateTime(createdAt: string): string {
  const date = new Date(createdAt);
  const formatter =
    date.getFullYear() === new Date().getFullYear()
      ? messageDateFormatter
      : messageDateFormatterWithYear;
  return `${messageTimeFormatter.format(date)} · ${formatter.format(date)}`;
}

export type ResponseInput =
  | { partId: string; responseType: "permission"; decision: "allow" | "always" | "deny" }
  | { partId: string; responseType: "question"; answers: Record<string, string[]> }
  | {
      partId: string;
      responseType: "plan";
      decision: "approve" | "reject";
      comment?: string;
    };
type OnRespond = (response: ResponseInput) => Promise<void>;

export const MessageRow = memo(function MessageRow({
  message,
  onCopy,
  onCopyCode,
  onEdit,
  onRespond,
  onRetry,
  onAnnounce,
  cwd,
  agent,
  workingIndicator,
  onWorkingIndicatorExit,
}: {
  message: ConversationMessage;
  agent?: AgentErrorAgent;
  onCopy: (text: string) => void;
  onCopyCode?: (code: string) => void;
  onEdit: (text: string) => void;
  onRespond: OnRespond;
  onRetry: (messageId: string) => void;
  onAnnounce: (text: string) => void;
  cwd: string;
  workingIndicator?: {
    active: boolean;
    actions: readonly Extract<MessagePart, { type: "action" }>[];
    lastPart?: MessagePart;
    stopping: boolean;
  };
  onWorkingIndicatorExit?: () => void;
}) {
  const [showTimeline, setShowTimeline] = useState(false);
  const [visiblePartCount, setVisiblePartCount] = useState(120);
  const timelineId = useId();
  const messageRef = useRef<HTMLElement>(null);
  const isUserMessage = message.author === "user";
  const text = isUserMessage
    ? message.parts
        .filter((part): part is Extract<MessagePart, { type: "text" }> => part.type === "text")
        .map((part) => part.markdown)
        .join("\n")
    : "";
  const visibleParts = message.parts.slice(-visiblePartCount);
  const hasTimeline = message.author === "agent" && message.parts.length > 0;
  const hasRetryableError =
    message.author === "agent" &&
    message.parts.some((part) => part.type === "error" && part.retryable);
  const attachmentOccurrences = new Map<string, number>();

  const navigateToPart = useCallback(
    (partId: string) => {
      setVisiblePartCount(message.parts.length);
      requestAnimationFrame(() => {
        const target = Array.from(
          messageRef.current?.querySelectorAll<HTMLElement>("[data-part-id]") ?? [],
        ).find((element) => element.dataset.partId === partId);
        if (!target) return;

        for (let parent = target.parentElement; parent; parent = parent.parentElement) {
          if (parent instanceof HTMLDetailsElement) parent.open = true;
        }
        const scrollTarget =
          target instanceof HTMLDetailsElement
            ? (target.querySelector("summary") ?? target)
            : target;
        scrollTarget.scrollIntoView({ behavior: "smooth", block: "center" });
        const highlightClass = styles.partHighlight;
        if (!highlightClass) return;
        target.classList.remove(highlightClass);
        target.addEventListener(
          "animationend",
          (event) => {
            if (event.target === target) target.classList.remove(highlightClass);
          },
          { once: true },
        );
        void target.offsetWidth;
        target.classList.add(highlightClass);
      });
    },
    [message.parts.length],
  );

  const closeTimeline = useCallback(() => setShowTimeline(false), []);

  return (
    <article
      aria-label={message.author === "user" ? t.chat.userMessage : t.chat.agentMessage}
      className={`${styles.message} ${message.author === "user" ? styles.userMessage : styles.agentMessage}`}
      data-author={message.author}
      data-message-id={message.id}
      ref={messageRef}
    >
      <div className={styles.messageDateOptions}>
        <div className={styles.messageDateOptionsInner}>
          <time className={styles.messageTimestamp} dateTime={message.createdAt}>
            {formatMessageDateTime(message.createdAt)}
          </time>
        </div>
      </div>
      {isUserMessage ? (
        <>
          {message.attachments?.length ? (
            <section aria-label={t.chat.sentAttachments} className={styles.sentAttachments}>
              {message.attachments.map((attachment) => {
                const baseKey = JSON.stringify([
                  attachment.name,
                  attachment.mimeType,
                  attachment.kind,
                  attachment.sizeBytes,
                ]);
                const occurrence = attachmentOccurrences.get(baseKey) ?? 0;
                attachmentOccurrences.set(baseKey, occurrence + 1);
                return (
                  <span
                    className={styles.sentAttachment}
                    key={`${baseKey}:${occurrence}`}
                    title={`${attachment.name} · ${formatAttachmentSize(attachment.sizeBytes)}`}
                  >
                    {attachment.kind === "image" ? (
                      <ImageIcon aria-hidden="true" size={14} />
                    ) : (
                      <FileText aria-hidden="true" size={14} />
                    )}
                    <span className={styles.sentAttachmentName}>{attachment.name}</span>
                    <span className={styles.sentAttachmentSize}>
                      {formatAttachmentSize(attachment.sizeBytes)}
                    </span>
                  </span>
                );
              })}
            </section>
          ) : null}
          {text.trim() ? <div className={styles.userBubble}>{text}</div> : null}
        </>
      ) : (
        <>
          {message.status === "done" ? (
            <>
              {message.parts.length > visibleParts.length ? (
                <button
                  className={styles.olderParts}
                  onClick={() => setVisiblePartCount((count) => count + 120)}
                  type="button"
                >
                  {t.chat.showOlderParts}
                </button>
              ) : null}
              {renderCompletedMessage(
                message,
                {
                  onRespond,
                  onAnnounce,
                  onCopyCode,
                  onRetry,
                  cwd,
                  agent,
                },
                visiblePartCount,
              )}
            </>
          ) : (
            <>
              {message.parts.length > visibleParts.length ? (
                <button
                  className={styles.olderParts}
                  onClick={() => setVisiblePartCount((count) => count + 120)}
                  type="button"
                >
                  {t.chat.showOlderParts}
                </button>
              ) : null}
              <div className={styles.parts}>
                {renderParts(
                  visibleParts,
                  message.id,
                  message.status === "streaming",
                  onRespond,
                  onAnnounce,
                  onCopyCode,
                  cwd,
                  onRetry,
                  agent,
                )}
              </div>
            </>
          )}
          {workingIndicator ? (
            <WorkingIndicator {...workingIndicator} onExitComplete={onWorkingIndicatorExit} />
          ) : null}
        </>
      )}
      <div className={styles.messageOptions}>
        <div className={styles.messageOptionsInner}>
          <div className={styles.messageOptionsMeta}>
            <div className={styles.messageActions}>
              {message.author === "user" && text.trim() ? (
                <>
                  <button className={styles.textAction} onClick={() => onCopy(text)} type="button">
                    <Copy aria-hidden="true" size={14} />
                    {t.chat.copy}
                  </button>
                  <button className={styles.textAction} onClick={() => onEdit(text)} type="button">
                    <Pencil aria-hidden="true" size={14} />
                    {t.chat.edit}
                  </button>
                </>
              ) : null}
              {hasRetryableError ? (
                <button
                  className={styles.textAction}
                  disabled={message.status === "streaming"}
                  onClick={() => onRetry(message.id)}
                  type="button"
                >
                  <Play aria-hidden="true" size={14} />
                  {t.chat.retry}
                </button>
              ) : null}
              {hasTimeline ? (
                <button
                  aria-controls={timelineId}
                  aria-expanded={showTimeline}
                  className={styles.timelineToggle}
                  onClick={() => setShowTimeline((value) => !value)}
                  type="button"
                >
                  <Clock3 aria-hidden="true" size={14} />
                  {t.chat.timeline}
                </button>
              ) : null}
            </div>
          </div>
          {hasTimeline && showTimeline ? (
            <TimelineView
              id={timelineId}
              message={message}
              cwd={cwd}
              onClose={closeTimeline}
              onNavigate={navigateToPart}
            />
          ) : null}
        </div>
      </div>
    </article>
  );
});

function renderParts(
  parts: MessagePart[],
  messageId: string,
  isStreaming: boolean,
  onRespond: OnRespond,
  onAnnounce: (text: string) => void,
  onCopyCode: ((code: string) => void) | undefined,
  cwd: string,
  onRetry: (messageId: string) => void,
  agent?: AgentErrorAgent,
) {
  const elements: ReactNode[] = [];
  const permissionActionIds = attachGrantedPermissions(parts);
  const permittedActionIds = new Set(permissionActionIds.values());
  const pendingPermissionCommands = parts.flatMap((part) => {
    if (part.type !== "permission" || part.state !== "pending") return [];
    const permission = part as typeof part & { command?: string };
    const command = permission.command?.trim() || part.summary.trim();
    return command.split(/\r?\n/).map(normalizeCommand).filter(Boolean);
  });
  const hasQuestionCard = parts.some((part) => part.type === "question");
  const hasPlanCard = parts.some((part) => part.type === "plan");
  const allActionEntries = parts.flatMap((part) => {
    if (part.type !== "action") return [];
    return [{ action: part, permitted: permittedActionIds.has(part.id) }];
  });
  const eligibleActionEntries = allActionEntries.filter(
    ({ action }) =>
      !duplicatesPendingPermission(action, pendingPermissionCommands) &&
      !duplicatesPendingCard(action, hasQuestionCard, hasPlanCard),
  );
  const parentGroups = groupActionsByParentId(eligibleActionEntries.map(({ action }) => action));
  const rootActionIds = new Set(parentGroups.map(({ action }) => action.id));
  const entriesByActionId = new Map(
    eligibleActionEntries.map((entry) => [entry.action.id, entry] as const),
  );
  const childrenByParentId = new Map(
    parentGroups.map(
      ({ action, children }) =>
        [
          action.id,
          children.flatMap((child) => {
            const entry = entriesByActionId.get(child.id);
            return entry ? [entry] : [];
          }),
        ] as const,
    ),
  );
  let index = 0;
  while (index < parts.length) {
    const part = parts[index];
    if (!part) {
      index += 1;
      continue;
    }
    if (part.type === "permission" && permissionActionIds.has(part.id)) {
      index += 1;
      continue;
    }
    if (part.type === "action") {
      const actions: Array<{
        action: Extract<MessagePart, { type: "action" }>;
        permitted: boolean;
      }> = [];
      while (index < parts.length) {
        const action = parts[index];
        if (action?.type === "action") {
          actions.push({
            action,
            permitted: permittedActionIds.has(action.id),
          });
          index += 1;
          continue;
        }
        if (action?.type === "permission" && permissionActionIds.has(action.id)) {
          index += 1;
          continue;
        }
        break;
      }
      const visibleActions = actions.filter(
        ({ action }) =>
          !duplicatesPendingPermission(action, pendingPermissionCommands) &&
          !duplicatesPendingCard(action, hasQuestionCard, hasPlanCard),
      );
      if (visibleActions.length > 0) {
        const rootActions = visibleActions.filter(({ action }) => rootActionIds.has(action.id));
        if (rootActions.length === 0) continue;
        elements.push(
          <ActionGroup
            actions={rootActions}
            childrenByParentId={childrenByParentId}
            cwd={cwd}
            key={actions[0]?.action.id ?? index}
            messageId={messageId}
          />,
        );
      }
      continue;
    }
    elements.push(
      <PartItem
        key={part.id}
        isStreaming={isStreaming}
        messageId={messageId}
        onAnnounce={onAnnounce}
        onCopyCode={onCopyCode}
        onRetry={onRetry}
        onRespond={onRespond}
        part={part}
        cwd={cwd}
        agent={agent}
      />,
    );
    index += 1;
  }
  return elements;
}

function isAlwaysVisiblePart(part: MessagePart): boolean {
  return (
    part.type === "error" ||
    (part.type === "permission" && part.state === "pending") ||
    (part.type === "question" && part.state === "pending") ||
    (part.type === "plan" && part.state === "pending")
  );
}

function renderCompletedMessage(
  message: ConversationMessage,
  options: {
    onRespond: OnRespond;
    onAnnounce: (text: string) => void;
    onCopyCode?: (code: string) => void;
    onRetry: (messageId: string) => void;
    cwd: string;
    agent?: AgentErrorAgent;
  },
  visiblePartCount: number,
) {
  const pendingParts = message.parts.filter(isAlwaysVisiblePart);
  const pendingPermissionCommands = pendingParts.flatMap((part) => {
    if (part.type !== "permission") return [];
    const permission = part as typeof part & { command?: string };
    const command = permission.command?.trim() || part.summary.trim();
    return command.split(/\r?\n/u).map(normalizeCommand).filter(Boolean);
  });
  const hasQuestionCard = pendingParts.some((part) => part.type === "question");
  const hasPlanCard = pendingParts.some((part) => part.type === "plan");
  const responseParts = message.parts.filter(
    (part) =>
      !isAlwaysVisiblePart(part) &&
      !(
        part.type === "action" &&
        (duplicatesPendingPermission(part, pendingPermissionCommands) ||
          duplicatesPendingCard(part, hasQuestionCard, hasPlanCard))
      ),
  );
  const { history, finalAnswer } = splitFinalAnswer(responseParts);
  const visiblePartIds = new Set(message.parts.slice(-visiblePartCount).map((part) => part.id));
  const historyParts = history.filter((part) => visiblePartIds.has(part.id));
  const durationMs =
    message.startedAt !== undefined && message.endedAt !== undefined
      ? message.endedAt - message.startedAt
      : undefined;

  return (
    <div className={styles.parts}>
      {historyParts.length > 0 ? (
        <details className={styles.workHistory}>
          <summary className={styles.workHistoryToggle}>
            <span>{formatWorkDuration(durationMs)}</span>
            <ChevronRight aria-hidden="true" className={styles.actionDisclosure} size={14} />
          </summary>
          <div className={styles.workHistoryBody}>
            {renderParts(
              historyParts,
              message.id,
              false,
              options.onRespond,
              options.onAnnounce,
              options.onCopyCode,
              options.cwd,
              options.onRetry,
              options.agent,
            )}
          </div>
        </details>
      ) : null}
      {pendingParts.map((part) => (
        <PartItem
          key={part.id}
          isStreaming={false}
          messageId={message.id}
          onAnnounce={options.onAnnounce}
          onCopyCode={options.onCopyCode}
          onRetry={options.onRetry}
          onRespond={options.onRespond}
          part={part}
          cwd={options.cwd}
          agent={options.agent}
        />
      ))}
      {finalAnswer.map((part) => (
        <PartItem
          key={part.id}
          isStreaming={false}
          messageId={message.id}
          onAnnounce={options.onAnnounce}
          onCopyCode={options.onCopyCode}
          onRetry={options.onRetry}
          onRespond={options.onRespond}
          part={part}
          cwd={options.cwd}
          agent={options.agent}
        />
      ))}
    </div>
  );
}

const PartItem = memo(
  function PartItem({
    part,
    messageId,
    isStreaming,
    onRespond,
    onAnnounce,
    onCopyCode,
    onRetry,
    cwd,
    agent,
  }: {
    part: MessagePart;
    messageId: string;
    isStreaming: boolean;
    onRespond: OnRespond;
    onAnnounce: (text: string) => void;
    onCopyCode: ((code: string) => void) | undefined;
    onRetry: (messageId: string) => void;
    cwd: string;
    agent?: AgentErrorAgent;
  }) {
    let content: ReactNode;
    switch (part.type) {
      case "text":
        content = (
          <MarkdownBody
            isStreaming={isStreaming}
            markdown={part.markdown}
            onAnnounce={onAnnounce}
            onCopyCode={onCopyCode}
          />
        );
        break;
      case "thinking":
        content = <ThinkingPart isStreaming={isStreaming} part={part} />;
        break;
      case "permission":
        content = <PermissionPart cwd={cwd} onRespond={onRespond} part={part} />;
        break;
      case "question":
        content = <QuestionPart onRespond={onRespond} part={part} />;
        break;
      case "plan":
        content = <PlanPart onCopyCode={onCopyCode} onRespond={onRespond} part={part} />;
        break;
      case "todos":
        content = <TodosDisclosure part={part} />;
        break;
      case "error":
        content = <ErrorPart agent={agent} messageId={messageId} onRetry={onRetry} part={part} />;
        break;
      case "action":
        return null;
    }
    return (
      <div className={styles.partTarget} data-message-id={messageId} data-part-id={part.id}>
        {content}
      </div>
    );
  },
  (previous, next) =>
    previous.part === next.part &&
    previous.messageId === next.messageId &&
    previous.isStreaming === next.isStreaming &&
    previous.onRespond === next.onRespond &&
    previous.onAnnounce === next.onAnnounce &&
    previous.onCopyCode === next.onCopyCode &&
    previous.onRetry === next.onRetry &&
    previous.cwd === next.cwd &&
    previous.agent === next.agent,
);

const MarkdownBody = memo(function MarkdownBody({
  markdown,
  isStreaming = false,
  onAnnounce,
  onCopyCode,
}: {
  markdown: string;
  isStreaming?: boolean;
  onAnnounce: (text: string) => void;
  onCopyCode?: (code: string) => void;
}) {
  const [highlightPlugin, setHighlightPlugin] = useState<HighlightPlugin | null>(null);
  const blocks = useMemo(() => splitMarkdownBlocks(markdown), [markdown]);
  const hasClosedCodeBlock = blocks.some(
    (block) => block.hasFencedCode && (block.closed || !isStreaming),
  );

  useEffect(() => {
    if (!hasClosedCodeBlock) return;
    let mounted = true;
    void loadHighlightPlugin().then((plugin) => {
      if (mounted && plugin) setHighlightPlugin(() => plugin);
    });
    return () => {
      mounted = false;
    };
  }, [hasClosedCodeBlock]);

  return (
    <div className={styles.markdown}>
      {blocks.map((block) => (
        <MarkdownBlock
          block={block.markdown}
          highlightPlugin={highlightPlugin}
          key={block.start}
          onAnnounce={onAnnounce}
          onCopyCode={onCopyCode}
          useHighlight={
            highlightPlugin !== null && block.hasFencedCode && (block.closed || !isStreaming)
          }
        />
      ))}
    </div>
  );
});

const MarkdownBlock = memo(
  function MarkdownBlock({
    block,
    highlightPlugin,
    onAnnounce,
    onCopyCode,
    useHighlight,
  }: {
    block: string;
    highlightPlugin: HighlightPlugin | null;
    onAnnounce: (text: string) => void;
    onCopyCode?: (code: string) => void;
    useHighlight: boolean;
  }) {
    const components = useMemo(
      () => ({
        a: ({ children, href }: { children?: ReactNode; href?: string }) => {
          const externalUrl = getAllowedExternalUrl(href);
          return externalUrl ? (
            <button
              className={styles.markdownLink}
              onClick={() => void openExternalUrl(externalUrl, onAnnounce)}
              type="button"
            >
              {children}
            </button>
          ) : (
            <span className={styles.inertLink} title={t.chat.linkUnavailable}>
              {children}
            </span>
          );
        },
        pre: ({ children }: { children?: ReactNode }) => (
          <CodeBlock onAnnounce={onAnnounce} onCopyCode={onCopyCode}>
            {children}
          </CodeBlock>
        ),
      }),
      [onAnnounce, onCopyCode],
    );

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
    previous.onAnnounce === next.onAnnounce &&
    previous.onCopyCode === next.onCopyCode &&
    previous.useHighlight === next.useHighlight &&
    (!next.useHighlight || previous.highlightPlugin === next.highlightPlugin),
);

async function openExternalUrl(url: string, onAnnounce: (text: string) => void): Promise<void> {
  try {
    if (window.karontNative) {
      const opened = await window.karontNative.openExternal(url);
      if (!opened) onAnnounce(t.chat.linkOpenFailed);
      return;
    }
    window.open(url, "_blank", "noopener,noreferrer");
  } catch {
    onAnnounce(t.chat.linkOpenFailed);
  }
}

function CodeBlock({
  children,
  onAnnounce,
  onCopyCode,
}: {
  children: ReactNode;
  onAnnounce: (text: string) => void;
  onCopyCode?: (code: string) => void;
}) {
  const [copyState, setCopyState] = useState("");
  const code = getText(children);
  return (
    <div className={styles.codeBlock}>
      <button
        aria-label={t.chat.actionCopyCode}
        className={styles.codeCopy}
        onClick={() => {
          if (onCopyCode) {
            onCopyCode(code);
            setCopyState(t.chat.codeCopied);
            onAnnounce(t.chat.codeCopied);
          } else {
            void copyCode();
          }
        }}
        type="button"
      >
        <Copy aria-hidden="true" size={14} />
      </button>
      <pre>{children}</pre>
      {copyState ? <span className={styles.codeStatus}>{copyState}</span> : null}
    </div>
  );

  async function copyCode() {
    try {
      await navigator.clipboard.writeText(code);
      setCopyState(t.chat.codeCopied);
      onAnnounce(t.chat.codeCopied);
    } catch {
      setCopyState(t.chat.copyFailed);
      onAnnounce(t.chat.copyFailed);
    }
  }
}

function getText(node: ReactNode): string {
  if (typeof node === "string" || typeof node === "number") return String(node);
  if (Array.isArray(node)) return node.map(getText).join("");
  if (node && typeof node === "object" && "props" in node) {
    return getText((node as { props?: { children?: ReactNode } }).props?.children);
  }
  return "";
}

const ThinkingPart = memo(function ThinkingPart({
  part,
  isStreaming,
}: {
  part: Extract<MessagePart, { type: "thinking" }>;
  isStreaming: boolean;
}) {
  const [expanded, setExpanded] = useState(isStreaming);
  const duration =
    part.startedAt !== undefined && part.endedAt !== undefined
      ? Math.max(0, Math.round((part.endedAt - part.startedAt) / 1_000))
      : null;
  useEffect(() => setExpanded(isStreaming), [isStreaming]);

  return (
    <details
      className={styles.thinking}
      onToggle={(event) => setExpanded(event.currentTarget.open)}
      open={expanded}
    >
      <summary>
        {isStreaming ? (
          <LoaderCircle aria-hidden="true" className={styles.thinkingIcon} size={15} />
        ) : (
          <CheckCircle2 aria-hidden="true" className={styles.thinkingDoneIcon} size={15} />
        )}
        {isStreaming
          ? t.chat.thinking
          : duration === null
            ? t.chat.thinkingDone
            : t.chat.thinkingDuration(duration)}
      </summary>
      <div className={styles.thinkingText}>{part.text}</div>
    </details>
  );
});

const ActionGroup = memo(
  function ActionGroup({
    actions,
    childrenByParentId,
    messageId,
    cwd,
  }: {
    actions: Array<{
      action: Extract<MessagePart, { type: "action" }>;
      permitted: boolean;
    }>;
    childrenByParentId: Map<string, Array<{ action: ConversationAction; permitted: boolean }>>;
    messageId: string;
    cwd: string;
  }) {
    return (
      <>
        {groupConsecutiveActions(actions.map(({ action }) => action)).map((group) => {
          const groupActions = group.actions.flatMap((action) => {
            const entry = actions.find((item) => item.action.id === action.id);
            return entry ? [entry] : [];
          });
          const label = summarizeActionGroup(group, cwd);
          if (groupActions.length === 1) {
            const item = groupActions[0];
            return item ? (
              <ActionItem
                action={item.action}
                cwd={cwd}
                key={item.action.id}
                messageId={messageId}
                permitted={item.permitted}
                nestedActions={childrenByParentId.get(item.action.id) ?? []}
                summary={label}
              />
            ) : null;
          }
          return (
            <ActionBatch
              actions={groupActions}
              cwd={cwd}
              key={group.actions[0]?.id ?? label}
              label={label}
              messageId={messageId}
            />
          );
        })}
      </>
    );
  },
  (previous, next) =>
    previous.actions.length === next.actions.length &&
    previous.messageId === next.messageId &&
    previous.cwd === next.cwd &&
    sameNestedActionEntries(previous.childrenByParentId, next.childrenByParentId) &&
    previous.actions.every(
      ({ action, permitted }, index) =>
        action === next.actions[index]?.action && permitted === next.actions[index]?.permitted,
    ),
);

function sameNestedActionEntries(
  previous: Map<string, Array<{ action: ConversationAction; permitted: boolean }>>,
  next: Map<string, Array<{ action: ConversationAction; permitted: boolean }>>,
): boolean {
  if (previous.size !== next.size) return false;
  for (const [parentId, children] of previous) {
    const nextChildren = next.get(parentId);
    if (
      !nextChildren ||
      children.length !== nextChildren.length ||
      children.some(
        ({ action, permitted }, index) =>
          action !== nextChildren[index]?.action || permitted !== nextChildren[index]?.permitted,
      )
    ) {
      return false;
    }
  }
  return true;
}

export const ActionItem = memo(function ActionItem({
  action,
  messageId,
  permitted,
  nestedActions = [],
  cwd,
  summary,
  initialExpanded = false,
}: {
  action: ConversationAction;
  messageId: string;
  permitted: boolean;
  nestedActions?: Array<{ action: ConversationAction; permitted: boolean }>;
  cwd: string;
  summary: string;
  initialExpanded?: boolean;
}) {
  const Icon = actionCategoryIcon(action);
  const [expanded, setExpanded] = useState(initialExpanded);
  const displayTitle = formatConversationText(actionRowLabel(action, cwd, summary), cwd, 160);
  const detailsId = useId();
  return (
    <div className={styles.action} data-message-id={messageId} data-part-id={action.id}>
      <button
        aria-controls={detailsId}
        aria-description={permitted ? t.chat.permissionGrantedDescription : undefined}
        aria-expanded={expanded}
        className={styles.actionToggle}
        onClick={() => setExpanded((value) => !value)}
        type="button"
      >
        <Icon aria-hidden="true" className={styles.actionIcon} size={14} />
        <span className={styles.actionTitle} title={displayTitle.title}>
          {displayTitle.text}
        </span>
        <ChevronRight aria-hidden="true" className={styles.actionDisclosure} size={14} />
      </button>
      <div hidden={!expanded} id={detailsId}>
        <ActionDetails action={action} cwd={cwd} />
        {nestedActions.length > 0 ? (
          <fieldset className={styles.actionChildren}>
            <legend className={styles.srOnly}>{t.chat.subagentActions}</legend>
            {nestedActions.map((child) => (
              <ActionItem
                action={child.action}
                cwd={cwd}
                key={child.action.id}
                messageId={messageId}
                permitted={child.permitted}
                summary={summarizeAction(child.action, cwd)}
              />
            ))}
          </fieldset>
        ) : null}
      </div>
    </div>
  );
});

const ActionBatch = memo(function ActionBatch({
  actions,
  cwd,
  label,
  messageId,
}: {
  actions: Array<{ action: ConversationAction; permitted: boolean }>;
  cwd: string;
  label: string;
  messageId: string;
}) {
  const [expanded, setExpanded] = useState(false);
  const detailsId = useId();
  const Icon = actionCategoryIcon(actions[0]?.action);
  const displayLabel = formatConversationText(actionBatchLabel(actions, label), cwd, 160);
  return (
    <div className={styles.actionGroup} data-expanded={expanded}>
      <button
        aria-controls={detailsId}
        aria-expanded={expanded}
        className={styles.actionGroupToggle}
        onClick={() => setExpanded((value) => !value)}
        type="button"
      >
        <Icon aria-hidden="true" className={styles.actionIcon} size={14} />
        <span className={styles.actionTitle} title={displayLabel.title}>
          {displayLabel.text}
        </span>
        <ChevronRight aria-hidden="true" className={styles.actionDisclosure} size={14} />
      </button>
      <div className={styles.actionGroupBody} hidden={!expanded} id={detailsId}>
        {actions.map(({ action, permitted }) => (
          <div
            className={styles.actionBatchItem}
            data-message-id={messageId}
            data-part-id={action.id}
            key={action.id}
          >
            <div className={styles.actionBatchTitle}>
              <span>{formatConversationText(actionRowLabel(action, cwd), cwd, 160).text}</span>
              {permitted ? (
                <span className={styles.srOnly}>{t.chat.permissionGrantedDescription}</span>
              ) : null}
            </div>
            <ActionDetails action={action} cwd={cwd} />
          </div>
        ))}
      </div>
    </div>
  );
});

function ActionDetails({ action, cwd }: { action: ConversationAction; cwd: string }) {
  const category = categoryForAction(action);
  const paths = actionPaths(action, cwd);
  const changes = parseFileChanges(action.output);

  if (category === "read") {
    return (
      <div className={styles.actionDetails}>
        <span className={styles.detailLabel}>{t.chat.input}</span>
        <ul className={styles.detailPaths}>
          {paths.map((path) => (
            <li key={path}>{path}</li>
          ))}
        </ul>
      </div>
    );
  }

  if (category === "search") {
    return (
      <div className={styles.actionDetails}>
        {actionSearchQuery(action) ? (
          <div>
            <span className={styles.detailLabel}>{t.chat.input}</span>
            <pre>{actionSearchQuery(action)}</pre>
          </div>
        ) : null}
        {action.output ? (
          <div>
            <span className={styles.detailLabel}>{t.chat.output}</span>
            <pre>{withTruncation(action.output, action.truncated)}</pre>
          </div>
        ) : null}
      </div>
    );
  }

  if (category === "edit" || category === "write") {
    const hasDiff = changes.some((change) => change.diff.trim());
    return (
      <div className={styles.actionDetails}>
        {hasDiff ? (
          changes.map((change) => (
            <div className={styles.diffFile} key={change.path}>
              <span className={styles.detailLabel}>{change.path}</span>
              {change.diff ? (
                <pre className={styles.diffOutput}>{renderDiff(change.diff)}</pre>
              ) : null}
            </div>
          ))
        ) : (
          <ul className={styles.detailPaths}>
            {paths.map((path) => (
              <li key={path}>{path}</li>
            ))}
          </ul>
        )}
      </div>
    );
  }

  if (category === "web") {
    return (
      <div className={styles.actionDetails}>
        <span className={styles.detailLabel}>{action.input || action.title}</span>
        {action.output ? <pre>{withTruncation(action.output, action.truncated)}</pre> : null}
      </div>
    );
  }

  if (category === "image") {
    return (
      <div className={styles.actionDetails}>
        {action.output ? (
          <div>
            <span className={styles.detailLabel}>{t.chat.savedPath}</span>
            <pre>{withTruncation(action.output, action.truncated)}</pre>
          </div>
        ) : null}
        {action.input ? (
          <div>
            <span className={styles.detailLabel}>{t.chat.revisedPrompt}</span>
            <pre>{withTruncation(action.input, action.truncated)}</pre>
          </div>
        ) : null}
      </div>
    );
  }

  if (category === "mcp") {
    return (
      <div className={styles.actionDetails}>
        {action.input ? (
          <div>
            <span className={styles.detailLabel}>{t.chat.input}</span>
            <pre>{formatRawValue(action.input)}</pre>
          </div>
        ) : null}
        {action.output ? (
          <div>
            <span className={styles.detailLabel}>{t.chat.output}</span>
            <pre>{withTruncation(formatRawValue(action.output), action.truncated)}</pre>
          </div>
        ) : null}
      </div>
    );
  }

  if (category === "command" || category === "test" || category === "list") {
    const command = actionCommand(action);
    const { output, exitCode } = commandOutput(action.output);
    const resultLabel =
      exitCode !== null
        ? t.chat.commandExitCode(exitCode)
        : action.state === "error"
          ? t.chat.commandFailed
          : action.state === "ok"
            ? t.chat.commandCompleted
            : action.state === "waiting"
              ? t.chat.actionStates.waiting
              : action.state === "running"
                ? t.chat.actionStates.running
                : "";
    return (
      <div className={styles.actionDetails}>
        <div className={styles.commandHeader}>
          <span className={styles.detailLabel}>{command}</span>
          {resultLabel ? <span className={styles.exitCode}>{resultLabel}</span> : null}
        </div>
        {output ? <pre>{withTruncation(output, action.truncated)}</pre> : null}
      </div>
    );
  }

  return (
    <div className={styles.actionDetails}>
      {action.input ? (
        <div>
          <span className={styles.detailLabel}>{t.chat.input}</span>
          <pre>{formatRawValue(action.input)}</pre>
        </div>
      ) : null}
      {action.output ? (
        <div>
          <span className={styles.detailLabel}>{t.chat.output}</span>
          <pre>{withTruncation(formatRawValue(action.output), action.truncated)}</pre>
        </div>
      ) : null}
    </div>
  );
}

function actionRowLabel(action: ConversationAction, cwd: string, fallback?: string): string {
  const diffSummary = summarizeActionDiff(action, cwd);
  if (diffSummary) return diffSummary;
  const category = categoryForAction(action);
  if (category === "edit" || category === "write") {
    const paths = actionPaths(action, cwd);
    const verb = category === "write" ? "Criou" : "Editou";
    if (paths.length === 1) return `${verb} ${paths[0]}`;
    if (paths.length > 1) return `${verb} ${paths.length} arquivos`;
  }
  return fallback ?? summarizeAction(action, cwd);
}

function actionBatchLabel(
  actions: Array<{ action: ConversationAction; permitted: boolean }>,
  fallback: string,
): string {
  const changes = actions
    .flatMap(({ action }) => parseFileChanges(action.output))
    .filter((change) => change.diff.trim());
  if (!changes.length) return fallback;
  const added = changes.reduce((total, change) => total + countDiffLines(change.diff).added, 0);
  const removed = changes.reduce((total, change) => total + countDiffLines(change.diff).removed, 0);
  const stats = formatDiffStats(added, removed);
  return stats ? `${fallback} ${stats}` : fallback;
}

function actionPaths(action: ConversationAction, cwd: string): string[] {
  const paths = parseFileChanges(action.output).map((change) => change.path);
  let parsedInput: unknown;
  try {
    parsedInput = JSON.parse(action.input);
  } catch {
    parsedInput = null;
  }
  if (isRecord(parsedInput)) {
    for (const key of ["file_path", "path", "filename"]) {
      const value = parsedInput[key];
      if (typeof value === "string") paths.push(value);
    }
    for (const key of ["files", "paths"]) {
      const value = parsedInput[key];
      if (Array.isArray(value))
        paths.push(...value.filter((item): item is string => typeof item === "string"));
    }
  } else if (action.actionType !== "command") {
    paths.push(...action.input.split(/\r?\n/u));
  }
  if (action.actionType === "command") {
    const command = actionCommand(action);
    const matches =
      command.match(
        /(?:^|[\s'"])((?:\.{0,2}\/|\/)?[\w@.-][\w./@-]*\.[A-Za-z0-9_-]+)(?=$|[\s'"])/gu,
      ) ?? [];
    paths.push(...matches.map((match) => match.trim().replace(/^[\s'"]+/u, "")));
  }
  const titlePath = action.title.match(/(?:·|:)\s*(.+)$/u)?.[1];
  if (titlePath) paths.push(titlePath);
  return [...new Set(paths.map((path) => displayPath(path, cwd)).filter(isLikelyPath))];
}

function displayPath(path: string, cwd: string): string {
  const clean = path.trim().replace(/^[`"']+|[`"',;:)]+$/gu, "");
  if (!clean) return "";
  return formatConversationText(clean, cwd, 180).text;
}

function isLikelyPath(value: string): boolean {
  return Boolean(value && !/^(?:arquivos|um arquivo|uma ação|files?)$/iu.test(value));
}

function actionCommand(action: ConversationAction): string {
  try {
    const parsed: unknown = JSON.parse(action.input);
    if (isRecord(parsed) && typeof parsed.command === "string") return parsed.command;
  } catch {
    // Entradas que não são JSON já contêm o comando em texto.
  }
  return action.input || action.title;
}

function actionSearchQuery(action: ConversationAction): string {
  try {
    const parsed: unknown = JSON.parse(action.input);
    if (isRecord(parsed)) {
      const query = [parsed.pattern, parsed.query].find(
        (value): value is string => typeof value === "string" && Boolean(value.trim()),
      );
      if (query) return query;
    }
  } catch {
    // A entrada pode ser uma busca em texto simples.
  }
  return action.input || action.title;
}

function commandOutput(value: string): { output: string; exitCode: string | null } {
  const match = value.match(/(?:Código de saída|Exit code):?\s*(-?\d+)/iu);
  return {
    output: match ? value.replace(match[0], "").trimEnd() : value,
    exitCode: match?.[1] ?? null,
  };
}

function renderDiff(diff: string): ReactNode[] {
  const occurrences = new Map<string, number>();
  return getDiffDisplayLines(diff).map(({ text: line, kind }) => {
    const occurrence = occurrences.get(line) ?? 0;
    occurrences.set(line, occurrence + 1);
    const className =
      kind === "added"
        ? styles.diffAdded
        : kind === "removed"
          ? styles.diffRemoved
          : kind === "hunk"
            ? styles.diffHunk
            : "";
    return (
      <span className={className} key={`${line}:${occurrence}`}>
        {line || " "}
      </span>
    );
  });
}

function formatRawValue(value: string): string {
  try {
    return JSON.stringify(JSON.parse(value), null, 2);
  } catch {
    return value;
  }
}

function withTruncation(value: string, truncated: boolean): string {
  return truncated ? `${value}\n…` : value;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

const PermissionPart = memo(function PermissionPart({
  part,
  onRespond,
  cwd,
}: {
  part: Extract<MessagePart, { type: "permission" }>;
  onRespond: OnRespond;
  cwd: string;
}) {
  const headingId = useId();
  if (part.state !== "pending") {
    const stateLabel =
      part.state === "allowed" ? t.chat.permissionResults.allowed : t.chat.permissionResults.denied;
    return (
      <details className={styles.responseDisclosure}>
        <summary>
          <LockKeyhole aria-hidden="true" className={styles.actionIcon} size={14} />
          <span>{`${stateLabel} · ${part.tool}`}</span>
          <ChevronRight aria-hidden="true" className={styles.actionDisclosure} size={14} />
        </summary>
        <div className={styles.actionDetails}>
          <p className={styles.permissionDescription}>{part.summary}</p>
          {part.description ? (
            <p className={styles.permissionDescription}>{part.description}</p>
          ) : null}
        </div>
      </details>
    );
  }
  const permission = part as typeof part & { command?: string; description?: string };
  const command = permission.command?.trim() || part.summary.trim();
  const description = permission.description?.trim();
  const heading = permissionHeading(part.tool);
  const displayCommand = formatConversationText(command, cwd, 112);
  const displayDescription = description ? formatConversationText(description, cwd, 144) : null;

  return (
    <section aria-labelledby={headingId} className={styles.permissionCard}>
      <h3 id={headingId}>
        <AlertTriangle aria-hidden="true" size={16} />
        {heading}
      </h3>
      {command ? (
        <code className={styles.permissionCommand} title={displayCommand.title}>
          {displayCommand.text}
        </code>
      ) : null}
      {displayDescription ? (
        <p className={styles.permissionDescription} title={displayDescription.title}>
          {displayDescription.text}
        </p>
      ) : null}
      <div className={styles.cardActions}>
        {part.options.includes("allow") ? (
          <Button
            onClick={() =>
              void onRespond({ partId: part.id, responseType: "permission", decision: "allow" })
            }
            variant="primary"
          >
            {t.chat.allow}
          </Button>
        ) : null}
        {part.options.includes("always") ? (
          <Button
            onClick={() =>
              void onRespond({ partId: part.id, responseType: "permission", decision: "always" })
            }
            variant="secondary"
          >
            {t.chat.always}
          </Button>
        ) : null}
        {part.options.includes("deny") ? (
          <Button
            onClick={() =>
              void onRespond({ partId: part.id, responseType: "permission", decision: "deny" })
            }
            variant="ghost"
          >
            {t.chat.deny}
          </Button>
        ) : null}
      </div>
    </section>
  );
});

const QuestionPart = memo(function QuestionPart({
  part,
  onRespond,
}: {
  part: Extract<MessagePart, { type: "question" }>;
  onRespond: OnRespond;
}) {
  const [selected, setSelected] = useState<Record<string, string[]>>({});
  const [freeText, setFreeText] = useState<Record<string, string>>({});
  const [submitting, setSubmitting] = useState(false);
  if (part.state === "answered") {
    return (
      <details className={styles.responseDisclosure}>
        <summary>
          <HelpCircle aria-hidden="true" className={styles.actionIcon} size={14} />
          <span>{t.chat.questionAnswered}</span>
          <ChevronRight aria-hidden="true" className={styles.actionDisclosure} size={14} />
        </summary>
        <div className={styles.actionDetails}>
          {part.questions.map((question) => (
            <div
              className={styles.answeredQuestion}
              key={`${part.id}-${question.header ?? question.question}`}
            >
              <span className={styles.detailLabel}>{question.question}</span>
              <ul>
                {question.options.map((option) => (
                  <li key={option.label}>
                    <span>{option.label}</span>
                    {option.description ? <span>{option.description}</span> : null}
                  </li>
                ))}
              </ul>
            </div>
          ))}
        </div>
      </details>
    );
  }
  function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const answers = Object.fromEntries(
      part.questions.map((_question, index) => {
        const key = String(index);
        const typed = freeText[key]?.trim();
        return [key, [...(selected[key] ?? []), ...(typed ? [typed] : [])]];
      }),
    );
    setSubmitting(true);
    void onRespond({ partId: part.id, responseType: "question", answers }).finally(() =>
      setSubmitting(false),
    );
  }
  return (
    <form className={styles.questionCard} onSubmit={submit}>
      <h3>
        <HelpCircle aria-hidden="true" size={16} />
        {t.chat.questionTitle}
      </h3>
      {part.questions.map((question, index) => {
        const key = String(index);
        const questionKey =
          question.header ??
          `${question.question}:${question.options.map((option) => option.label).join("|")}`;
        return (
          <fieldset className={styles.question} key={`${part.id}-${questionKey}`}>
            <legend>{question.question}</legend>
            {question.options.map((option) => {
              const checked = selected[key]?.includes(option.label) ?? false;
              return (
                <label className={styles.questionOption} key={option.label}>
                  <input
                    checked={checked}
                    name={`${part.id}-${index}`}
                    onChange={() =>
                      setSelected((previous) => {
                        const current = previous[key] ?? [];
                        const next = question.multiSelect
                          ? checked
                            ? current.filter((value) => value !== option.label)
                            : [...current, option.label]
                          : [option.label];
                        return { ...previous, [key]: next };
                      })
                    }
                    type={question.multiSelect ? "checkbox" : "radio"}
                    value={option.label}
                  />
                  <span>
                    <strong>{option.label}</strong>
                    {option.description ? <small>{option.description}</small> : null}
                  </span>
                </label>
              );
            })}
            {question.freeText ? (
              <label className={styles.otherAnswer}>
                <span>{t.chat.otherAnswer}</span>
                <input
                  onChange={(event) =>
                    setFreeText((previous) => ({ ...previous, [key]: event.currentTarget.value }))
                  }
                  value={freeText[key] ?? ""}
                />
              </label>
            ) : null}
          </fieldset>
        );
      })}
      <div className={styles.cardActions}>
        <Button disabled={submitting} type="submit" variant="primary">
          {t.chat.questionSend}
        </Button>
      </div>
    </form>
  );
});

const PlanPart = memo(function PlanPart({
  part,
  onRespond,
  onCopyCode,
}: {
  part: Extract<MessagePart, { type: "plan" }>;
  onRespond: OnRespond;
  onCopyCode?: (code: string) => void;
}) {
  const [adjusting, setAdjusting] = useState(false);
  const [comment, setComment] = useState("");
  const [submitting, setSubmitting] = useState(false);
  if (part.state !== "pending") {
    return (
      <details className={styles.planResult}>
        <summary className={styles.planSummary}>
          <Check aria-hidden="true" size={15} />
          {part.state === "approved" ? t.chat.planResults.approved : t.chat.planResults.rejected}
        </summary>
        <div className={styles.planResultBody}>
          <MarkdownBody
            markdown={part.markdown}
            onAnnounce={() => undefined}
            onCopyCode={onCopyCode}
          />
          {part.comment ? <p className={styles.planComment}>{part.comment}</p> : null}
        </div>
      </details>
    );
  }
  return (
    <section aria-label={t.chat.plan} className={styles.planCard}>
      <h3>
        <ListTodo aria-hidden="true" size={16} />
        {t.chat.plan}
      </h3>
      <MarkdownBody markdown={part.markdown} onAnnounce={() => undefined} onCopyCode={onCopyCode} />
      {adjusting ? (
        <label className={styles.adjustment}>
          <span>{t.chat.adjustment}</span>
          <textarea onChange={(event) => setComment(event.currentTarget.value)} value={comment} />
        </label>
      ) : null}
      <div className={styles.cardActions}>
        {!adjusting ? (
          <>
            <Button
              disabled={submitting}
              onClick={() => {
                setSubmitting(true);
                void onRespond({
                  partId: part.id,
                  responseType: "plan",
                  decision: "approve",
                }).finally(() => setSubmitting(false));
              }}
              variant="primary"
            >
              {t.chat.approve}
            </Button>
            <Button onClick={() => setAdjusting(true)} variant="secondary">
              {t.chat.adjust}
            </Button>
          </>
        ) : (
          <>
            <Button
              disabled={submitting || !comment.trim()}
              onClick={() => {
                setSubmitting(true);
                void onRespond({
                  partId: part.id,
                  responseType: "plan",
                  decision: "reject",
                  comment: comment.trim(),
                }).finally(() => setSubmitting(false));
              }}
              variant="primary"
            >
              {t.chat.sendAdjustment}
            </Button>
            <Button
              disabled={submitting}
              onClick={() => {
                setAdjusting(false);
                setComment("");
              }}
              variant="secondary"
            >
              {t.chat.cancelAdjustment}
            </Button>
          </>
        )}
      </div>
    </section>
  );
});

const TodosDisclosure = memo(function TodosDisclosure({
  part,
}: {
  part: Extract<MessagePart, { type: "todos" }>;
}) {
  const completed = part.items.filter((item) => item.state === "done").length;
  return (
    <details className={styles.todosDisclosure}>
      <summary>
        <ListTodo aria-hidden="true" className={styles.actionIcon} size={14} />
        <span>{t.chat.todoSummary(completed, part.items.length)}</span>
        <ChevronRight aria-hidden="true" className={styles.actionDisclosure} size={14} />
      </summary>
      <ul>
        {part.items.map((item) => {
          const Icon =
            item.state === "done" ? CheckCircle2 : item.state === "working" ? Play : Circle;
          return (
            <li className={styles[`todo_${item.state}`]} key={item.id}>
              <Icon aria-hidden="true" size={14} />
              <span>{item.title}</span>
              <span className={styles.todoState}>{t.chat.todoStates[item.state]}</span>
            </li>
          );
        })}
      </ul>
    </details>
  );
});

export const TodosPart = memo(function TodosPart({
  part,
}: {
  part: Extract<MessagePart, { type: "todos" }>;
}) {
  return (
    <section aria-label={t.chat.todos} className={styles.todos}>
      <h3>
        <ListTodo aria-hidden="true" size={15} />
        {t.chat.todos}
      </h3>
      <ul>
        {part.items.map((item) => {
          const Icon =
            item.state === "done" ? CheckCircle2 : item.state === "working" ? Play : Circle;
          return (
            <li className={styles[`todo_${item.state}`]} key={item.id}>
              <Icon aria-hidden="true" size={15} />
              <span>{item.title}</span>
              <span className={styles.todoState}>{t.chat.todoStates[item.state]}</span>
            </li>
          );
        })}
      </ul>
    </section>
  );
});

const ErrorPart = memo(function ErrorPart({
  part,
  agent,
  messageId,
  onRetry,
}: {
  part: Extract<MessagePart, { type: "error" }>;
  agent?: AgentErrorAgent;
  messageId: string;
  onRetry: (messageId: string) => void;
}) {
  const [detailsOpen, setDetailsOpen] = useState(false);
  const detailsId = useId();
  const description = describeAgentError(part.text, agent);
  const details = part.details ?? description.details;
  return (
    <section aria-label={t.chat.errorTitle} className={styles.errorCard}>
      <p>
        <AlertTriangle aria-hidden="true" size={16} />
        {description.message}
      </p>
      <div className={styles.errorActions}>
        {part.retryable ? (
          <button className={styles.errorAction} onClick={() => onRetry(messageId)} type="button">
            <Play aria-hidden="true" size={14} />
            {t.chat.retry}
          </button>
        ) : null}
        {details ? (
          <button
            aria-controls={detailsId}
            aria-expanded={detailsOpen}
            className={styles.errorAction}
            onClick={() => setDetailsOpen((value) => !value)}
            type="button"
          >
            {detailsOpen ? t.chat.hideDetails : t.chat.showDetails}
          </button>
        ) : null}
      </div>
      {details ? (
        <pre className={styles.errorDetailsText} hidden={!detailsOpen} id={detailsId}>
          {details}
        </pre>
      ) : null}
    </section>
  );
});

export const TimelineView = memo(
  function TimelineView({
    id,
    message,
    cwd,
    onClose,
    onNavigate,
    autoFocus = true,
  }: {
    id: string;
    message: ConversationMessage;
    cwd: string;
    onClose: () => void;
    onNavigate: (partId: string) => void;
    autoFocus?: boolean;
  }) {
    const regionRef = useRef<HTMLElement>(null);
    const rowRefs = useRef<Array<HTMLButtonElement | null>>([]);
    const [activeIndex, setActiveIndex] = useState(0);
    const timeline = useMemo(
      () => buildTimeline(message.parts, message.startedAt, cwd),
      [message.parts, message.startedAt, cwd],
    );
    const tickIntervalMs = timelineTickInterval(timeline.totalDurationMs);
    const axisEndMs = Math.ceil(timeline.totalDurationMs / tickIntervalMs) * tickIntervalMs;
    const ticks: number[] = [];
    for (let tick = 0; tick <= axisEndMs; tick += tickIntervalMs) ticks.push(tick);

    useEffect(() => {
      if (autoFocus) regionRef.current?.focus();
    }, [autoFocus]);

    function handleTimelineKeyDown(event: KeyboardEvent<HTMLElement>) {
      if (event.key === "Escape") {
        event.preventDefault();
        onClose();
        return;
      }
      if (event.key === "Enter") {
        event.preventDefault();
        const focusedRow = event.target instanceof HTMLButtonElement ? event.target : undefined;
        const focusedIndex = focusedRow ? rowRefs.current.indexOf(focusedRow) : -1;
        const index = focusedIndex >= 0 ? focusedIndex : activeIndex;
        const row = timeline.rows[index];
        if (row) onNavigate(row.part.id);
        return;
      }
      if (!["ArrowUp", "ArrowDown", "ArrowLeft", "ArrowRight"].includes(event.key)) return;
      event.preventDefault();
      const focusedRow = event.target instanceof HTMLButtonElement ? event.target : undefined;
      const focusedIndex = focusedRow ? rowRefs.current.indexOf(focusedRow) : -1;
      const currentIndex = focusedIndex >= 0 ? focusedIndex : activeIndex;
      const direction = event.key === "ArrowUp" || event.key === "ArrowLeft" ? -1 : 1;
      const nextIndex =
        focusedIndex < 0
          ? direction < 0
            ? timeline.rows.length - 1
            : 0
          : Math.max(0, Math.min(timeline.rows.length - 1, currentIndex + direction));
      setActiveIndex(nextIndex);
      rowRefs.current[nextIndex]?.focus();
    }

    return (
      <section
        aria-label={t.chat.timelineTitle}
        aria-describedby={`${id}-help`}
        className={styles.timeline}
        id={id}
        ref={regionRef}
        tabIndex={-1}
        onKeyDown={handleTimelineKeyDown}
      >
        <div className={styles.timelineHeader}>
          <h3>{t.chat.timelineTitle}</h3>
          <p>
            <span>{t.chat.timelineTotal}</span>
            <strong>
              {timeline.hasKnownDuration
                ? formatDuration(timeline.totalDurationMs)
                : t.chat.timelineDurationMissing}
            </strong>
          </p>
        </div>
        {timeline.isLegacy ? (
          <p className={styles.timelineCaption}>{t.chat.timelineLegacyNote}</p>
        ) : null}
        <p className={styles.srOnly} id={`${id}-help`}>
          {t.chat.timelineNavigateHelp}
        </p>
        <div className={styles.timelineChart}>
          <figure aria-label={t.chat.timelineAxis} className={styles.timelineAxis}>
            <figcaption className={styles.srOnly}>{t.chat.timelineAxis}</figcaption>
            <span className={styles.timelineAxisLabel}>{t.chat.timelineStepHeader}</span>
            <div className={styles.timelineAxisTrack}>
              {ticks.map((tick, index) => {
                const position = axisEndMs > 0 ? (tick / axisEndMs) * 100 : 0;
                const edgeClass =
                  index === 0
                    ? styles.timelineAxisTickFirst
                    : index === ticks.length - 1
                      ? styles.timelineAxisTickLast
                      : "";
                return (
                  <span
                    className={`${styles.timelineAxisTick} ${edgeClass}`}
                    key={tick}
                    style={{ left: `${position}%` }}
                  >
                    {formatAxisTick(tick)}
                  </span>
                );
              })}
            </div>
            <span className={styles.timelineAxisEnd}>{t.chat.timelineDurationHeader}</span>
          </figure>
          <ol className={styles.timelineRows}>
            {timeline.rows.map((row, index) => {
              const icon = timelineIcon(row.part);
              const displayTitle = formatConversationText(row.title, cwd, 34);
              const durationLabel =
                row.durationMs === null
                  ? t.chat.timelineDurationMissing
                  : formatDuration(row.durationMs);
              const left =
                row.startMs !== null && axisEndMs > 0
                  ? `${(row.startMs / axisEndMs) * 100}%`
                  : "0%";
              const width =
                row.durationMs !== null && axisEndMs > 0
                  ? row.durationMs === 0
                    ? "var(--k-border-width)"
                    : `${(row.durationMs / axisEndMs) * 100}%`
                  : "0%";
              return (
                <li className={styles.timelineRow} key={row.part.id}>
                  <button
                    aria-current={activeIndex === index ? "step" : undefined}
                    aria-label={`${row.kindLabel}. ${displayTitle.fullText}. ${durationLabel}`}
                    className={styles.timelineStep}
                    onClick={() => onNavigate(row.part.id)}
                    onFocus={() => setActiveIndex(index)}
                    ref={(element) => {
                      rowRefs.current[index] = element;
                    }}
                    tabIndex={activeIndex === index ? 0 : -1}
                    type="button"
                    data-kind={row.kind}
                  >
                    <span aria-hidden="true" className={styles.timelineIcon}>
                      {icon}
                    </span>
                    <span className={styles.timelineKind}>{row.kindLabel}</span>
                    <span className={styles.timelineTitle} title={displayTitle.title}>
                      {displayTitle.text}
                    </span>
                    <span aria-hidden="true" className={styles.timelineTrack}>
                      {ticks.map((tick) => {
                        const position = axisEndMs > 0 ? (tick / axisEndMs) * 100 : 0;
                        return (
                          <span
                            className={styles.timelineGridTick}
                            key={tick}
                            style={{ left: `${position}%` }}
                          />
                        );
                      })}
                      {row.durationMs !== null && row.startMs !== null ? (
                        <span className={styles.timelineBar} style={{ left, width }} />
                      ) : null}
                    </span>
                    <span className={styles.timelineDuration}>{durationLabel}</span>
                  </button>
                </li>
              );
            })}
          </ol>
        </div>
      </section>
    );
  },
  (previous, next) => {
    return (
      previous.id === next.id &&
      previous.onClose === next.onClose &&
      previous.onNavigate === next.onNavigate &&
      previous.autoFocus === next.autoFocus &&
      previous.cwd === next.cwd &&
      previous.message.parts.length === next.message.parts.length &&
      previous.message.parts.every((part, index) => part === next.message.parts[index])
    );
  },
);

type TimelineKind = "thinking" | "action" | "waiting" | "text" | "todo" | "error";

type TimelineRow = {
  part: MessagePart;
  kind: TimelineKind;
  kindLabel: string;
  title: string;
  durationMs: number | null;
  startMs: number | null;
};

function buildTimeline(parts: MessagePart[], messageStartedAt?: number, cwd = "") {
  const origin = messageStartedAt;
  const isLegacy = messageStartedAt === undefined;
  let totalDurationMs = 0;
  let hasKnownDuration = false;
  let summedDurationMs = 0;
  const rows = parts.map((part): TimelineRow => {
    let kind: TimelineKind;
    let kindLabel: string;
    let title: string;
    let durationMs: number | null = null;
    let startMs: number | null = null;

    switch (part.type) {
      case "thinking":
        kind = "thinking";
        kindLabel = t.chat.timelineThinking;
        title = previewText(part.text) || t.chat.thinkingDone;
        break;
      case "action":
        kind = part.state === "error" ? "error" : part.state === "waiting" ? "waiting" : "action";
        kindLabel = t.chat.timelineAction;
        title = summarizeAction(part, cwd);
        break;
      case "permission":
        kind = "waiting";
        kindLabel = t.chat.timelineWaiting;
        title =
          part.state === "allowed"
            ? t.chat.timelineApproval
            : `${
                part.state === "denied"
                  ? t.chat.permissionResults.denied
                  : t.chat.timelinePermissionRequest
              } · ${previewText(part.summary)}`;
        break;
      case "question": {
        kind = "waiting";
        kindLabel = t.chat.timelineWaiting;
        const question = part.questions[0]?.question ?? t.chat.questionTitle;
        title = `${part.state === "pending" ? t.chat.timelineQuestionPending : t.chat.questionAnswered} · ${previewText(question)}`;
        break;
      }
      case "plan":
        kind = "waiting";
        kindLabel = t.chat.timelineWaiting;
        title = `${
          part.state === "pending"
            ? t.chat.timelinePlanPending
            : part.state === "approved"
              ? t.chat.timelinePlanApproved
              : t.chat.timelinePlanAdjusted
        } · ${previewText(part.markdown)}`;
        break;
      case "text":
        kind = "text";
        kindLabel = t.chat.timelineText;
        title = previewText(part.markdown) || t.chat.timelineText;
        break;
      case "todos":
        kind = "todo";
        kindLabel = t.chat.todos;
        title = t.chat.timelineTaskCount(part.items.length);
        break;
      case "error":
        kind = "error";
        kindLabel = t.chat.timelineFailure;
        title = previewText(part.text);
        break;
    }

    if (isLegacy) {
      if (part.type === "action" && part.durationMs !== null) {
        startMs = summedDurationMs;
        durationMs = part.durationMs;
        summedDurationMs += part.durationMs;
        hasKnownDuration = true;
      }
    } else if (part.startedAt !== undefined || part.endedAt !== undefined) {
      const partStartedAt = part.startedAt ?? part.endedAt ?? 0;
      startMs = Math.max(0, partStartedAt - (origin ?? partStartedAt));
      const endedAt = part.endedAt ?? Date.now();
      durationMs = Math.max(0, endedAt - partStartedAt);
      totalDurationMs = Math.max(totalDurationMs, startMs + durationMs);
      hasKnownDuration = true;
    }

    return { part, kind, kindLabel, title, durationMs, startMs };
  });

  return {
    rows,
    totalDurationMs: isLegacy ? summedDurationMs : totalDurationMs,
    hasKnownDuration,
    isLegacy,
  };
}

function timelineIcon(part: MessagePart): ReactNode {
  switch (part.type) {
    case "thinking":
      return <Brain size={14} />;
    case "action": {
      const Icon = actionIcon(part.actionType);
      return <Icon size={14} />;
    }
    case "permission":
      return part.state === "denied" ? <XCircle size={14} /> : <LockKeyhole size={14} />;
    case "question":
      return part.state === "answered" ? <CheckCircle2 size={14} /> : <HelpCircle size={14} />;
    case "plan":
      return part.state === "pending" ? (
        <Clock3 size={14} />
      ) : part.state === "approved" ? (
        <CheckCircle2 size={14} />
      ) : (
        <Pencil size={14} />
      );
    case "text":
      return <FileText size={14} />;
    case "todos":
      return <ListTodo size={14} />;
    case "error":
      return <AlertTriangle size={14} />;
  }
}

function previewText(value: string): string {
  const normalized = cleanMarkdownPreview(value);
  return normalized.length > 140 ? `${normalized.slice(0, 140)}…` : normalized;
}

function formatAxisTick(milliseconds: number): string {
  return `${milliseconds / 1_000} s`;
}

function timelineTickInterval(totalDurationMs: number): number {
  const target = totalDurationMs / 8;
  if (target <= 2_000) return 2_000;
  const magnitude = 10 ** Math.floor(Math.log10(target));
  const normalized = target / magnitude;
  const step = normalized <= 2 ? 2 : normalized <= 5 ? 5 : 10;
  return Math.max(2_000, step * magnitude);
}

function actionIcon(type: Extract<MessagePart, { type: "action" }>["actionType"]) {
  switch (type) {
    case "read":
      return FileCode2;
    case "edit":
    case "write":
      return Pencil;
    case "command":
      return SquareTerminal;
    case "search":
      return Search;
    case "web":
      return Globe2;
    case "subagent":
      return Bot;
    case "mcp":
      return Plug;
    case "image":
      return ImageIcon;
    case "other":
      return Wrench;
  }
}

function actionCategoryIcon(action: ConversationAction | undefined) {
  if (!action) return Wrench;
  switch (categoryForAction(action)) {
    case "read":
      return FileCode2;
    case "edit":
    case "write":
      return Pencil;
    case "test":
    case "list":
    case "command":
      return SquareTerminal;
    case "search":
      return Search;
    case "web":
      return Globe2;
    case "subagent":
      return Bot;
    case "mcp":
      return Plug;
    case "image":
      return ImageIcon;
    case "other":
      return Wrench;
  }
}

function permissionHeading(tool: string): string {
  const normalizedTool = tool.toLocaleLowerCase();
  if (/(bash|shell|command|exec|terminal)/.test(normalizedTool)) {
    return t.chat.permissionRunCommand;
  }
  if (/(edit|write|file)/.test(normalizedTool)) return t.chat.permissionEditFile;
  return t.chat.permissionAction;
}

function normalizeCommand(value: string): string {
  return value.trim().replace(/\s+/g, " ");
}

function attachGrantedPermissions(parts: MessagePart[]): Map<string, string> {
  const attached = new Map<string, string>();
  parts.forEach((part, index) => {
    if (part.type !== "permission" || part.state !== "allowed") return;
    const previous = parts[index - 1];
    const next = parts[index + 1];
    const neighbors = [previous, next].filter(
      (neighbor): neighbor is Extract<MessagePart, { type: "action" }> =>
        neighbor?.type === "action",
    );
    const summary = normalizeCommand(part.summary);
    const matched = summary
      ? neighbors.find((action) => {
          const candidates = [action.input, action.title].map(normalizeCommand).filter(Boolean);
          return candidates.some(
            (candidate) => summary.includes(candidate) || candidate.includes(summary),
          );
        })
      : undefined;
    const action = matched ?? neighbors[0];
    if (action) attached.set(part.id, action.id);
  });
  return attached;
}

function duplicatesPendingPermission(
  action: Extract<MessagePart, { type: "action" }>,
  commands: string[],
): boolean {
  if (commands.length === 0) return false;
  return [action.input, action.title].some((candidate) => {
    const normalized = normalizeCommand(candidate);
    return normalized.length > 0 && commands.includes(normalized);
  });
}

function duplicatesPendingCard(
  action: Extract<MessagePart, { type: "action" }>,
  hasQuestionCard: boolean,
  hasPlanCard: boolean,
): boolean {
  const tool = action.title.toLowerCase().replace(/[^a-z0-9]/g, "");
  const isQuestionTool = [
    "askuserquestion",
    "requestuserinput",
    "askquestion",
    "userquestion",
    "question",
  ].some((name) => tool.includes(name));
  const isPlanTool = [
    "exitplanmode",
    "updateplan",
    "submitplan",
    "planapproval",
    "requestplanapproval",
  ].some((name) => tool.includes(name));

  return (hasQuestionCard && isQuestionTool) || (hasPlanCard && isPlanTool);
}

function formatDuration(milliseconds: number): string {
  if (milliseconds < 1_000) return `${milliseconds} ms`;
  if (milliseconds < 60_000) return `${(milliseconds / 1_000).toFixed(1)} s`;
  const minutes = Math.floor(milliseconds / 60_000);
  const seconds = Math.round((milliseconds % 60_000) / 1_000);
  return `${minutes} min ${seconds} s`;
}
