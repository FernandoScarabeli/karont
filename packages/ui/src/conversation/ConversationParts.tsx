import {
  AlertTriangle,
  Brain,
  Check,
  CheckCircle2,
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
import { formatAttachmentSize } from "./attachmentUtils.ts";
import styles from "./ConversationParts.module.css";
import { cleanMarkdownPreview, formatConversationText } from "./displayText.ts";
import { getAllowedExternalUrl } from "./externalLinks.ts";
import type { ConversationMessage, MessagePart } from "./useConversation.ts";

type HighlightPlugin = typeof import("rehype-highlight").default;
let highlightPluginPromise: Promise<HighlightPlugin | null> | null = null;

function loadHighlightPlugin(): Promise<HighlightPlugin | null> {
  highlightPluginPromise ??= import("rehype-highlight")
    .then(({ default: rehypeHighlight }) => rehypeHighlight)
    .catch(() => null);
  return highlightPluginPromise;
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
  onEdit,
  onResend,
  onRespond,
  onRetry,
  onAnnounce,
  cwd,
}: {
  message: ConversationMessage;
  onCopy: (text: string) => void;
  onEdit: (text: string) => void;
  onResend: (text: string) => void;
  onRespond: OnRespond;
  onRetry: (messageId: string) => void;
  onAnnounce: (text: string) => void;
  cwd: string;
}) {
  const [showTimeline, setShowTimeline] = useState(false);
  const [visiblePartCount, setVisiblePartCount] = useState(120);
  const timelineId = useId();
  const timelineToggleRef = useRef<HTMLButtonElement>(null);
  const messageRef = useRef<HTMLElement>(null);
  const text =
    message.author === "user"
      ? message.parts
          .filter((part): part is Extract<MessagePart, { type: "text" }> => part.type === "text")
          .map((part) => part.markdown)
          .join("\n")
      : "";
  const visibleParts = message.parts.slice(-visiblePartCount);
  const hasTimeline = message.author === "agent" && message.parts.length > 0;
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

  const closeTimeline = useCallback(() => {
    setShowTimeline(false);
    timelineToggleRef.current?.focus();
  }, []);

  return (
    <article
      aria-label={message.author === "user" ? t.chat.userMessage : t.chat.agentMessage}
      className={`${styles.message} ${message.author === "user" ? styles.userMessage : styles.agentMessage}`}
      data-author={message.author}
      ref={messageRef}
    >
      {message.author === "user" ? (
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
          {text.trim() ? (
            <div className={styles.messageActions}>
              <button className={styles.textAction} onClick={() => onCopy(text)} type="button">
                <Copy aria-hidden="true" size={14} />
                {t.chat.copy}
              </button>
              <button className={styles.textAction} onClick={() => onEdit(text)} type="button">
                <Pencil aria-hidden="true" size={14} />
                {t.chat.edit}
              </button>
              {!message.attachments?.length ? (
                <button
                  className={styles.textAction}
                  disabled={message.status === "streaming"}
                  onClick={() => onResend(text)}
                  type="button"
                >
                  <Play aria-hidden="true" size={14} />
                  {t.chat.resend}
                </button>
              ) : null}
            </div>
          ) : null}
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
              onRetry,
              onAnnounce,
              cwd,
            )}
          </div>
          {hasTimeline ? (
            <>
              <button
                aria-expanded={showTimeline}
                aria-controls={timelineId}
                className={styles.timelineToggle}
                onClick={() => setShowTimeline((value) => !value)}
                ref={timelineToggleRef}
                type="button"
              >
                <Clock3 aria-hidden="true" size={14} />
                {t.chat.timeline}
              </button>
              {showTimeline ? (
                <TimelineView
                  id={timelineId}
                  message={message}
                  cwd={cwd}
                  onClose={closeTimeline}
                  onNavigate={navigateToPart}
                />
              ) : null}
            </>
          ) : null}
        </>
      )}
    </article>
  );
});

function renderParts(
  parts: MessagePart[],
  messageId: string,
  isStreaming: boolean,
  onRespond: OnRespond,
  onRetry: (messageId: string) => void,
  onAnnounce: (text: string) => void,
  cwd: string,
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
        elements.push(
          <ActionGroup
            actions={visibleActions}
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
        onRespond={onRespond}
        onRetry={onRetry}
        part={part}
        cwd={cwd}
      />,
    );
    index += 1;
  }
  return elements;
}

const PartItem = memo(
  function PartItem({
    part,
    messageId,
    isStreaming,
    onRespond,
    onRetry,
    onAnnounce,
    cwd,
  }: {
    part: MessagePart;
    messageId: string;
    isStreaming: boolean;
    onRespond: OnRespond;
    onRetry: (messageId: string) => void;
    onAnnounce: (text: string) => void;
    cwd: string;
  }) {
    let content: ReactNode;
    switch (part.type) {
      case "text":
        content = <MarkdownBody markdown={part.markdown} onAnnounce={onAnnounce} />;
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
        content = <PlanPart onRespond={onRespond} part={part} />;
        break;
      case "todos":
        content = <TodosPart part={part} />;
        break;
      case "error":
        content = <ErrorPart messageId={messageId} onRetry={onRetry} part={part} />;
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
    previous.onRetry === next.onRetry &&
    previous.onAnnounce === next.onAnnounce &&
    previous.cwd === next.cwd,
);

const MarkdownBody = memo(function MarkdownBody({
  markdown,
  onAnnounce,
}: {
  markdown: string;
  onAnnounce: (text: string) => void;
}) {
  const [highlightPlugin, setHighlightPlugin] = useState<HighlightPlugin | null>(null);
  const hasCodeBlock = /(?:^|\n)\s*(?:`{3,}|~{3,})/u.test(markdown);

  useEffect(() => {
    if (!hasCodeBlock) return;
    let mounted = true;
    void loadHighlightPlugin().then((plugin) => {
      if (mounted && plugin) setHighlightPlugin(() => plugin);
    });
    return () => {
      mounted = false;
    };
  }, [hasCodeBlock]);

  return (
    <div className={styles.markdown}>
      <Markdown
        components={{
          a: ({ children, href }) => {
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
          pre: ({ children }) => <CodeBlock onAnnounce={onAnnounce}>{children}</CodeBlock>,
        }}
        rehypePlugins={highlightPlugin ? [highlightPlugin] : []}
        remarkPlugins={[remarkGfm]}
      >
        {markdown}
      </Markdown>
    </div>
  );
});

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
}: {
  children: ReactNode;
  onAnnounce: (text: string) => void;
}) {
  const [copyState, setCopyState] = useState("");
  const code = getText(children);
  return (
    <div className={styles.codeBlock}>
      <button
        aria-label={t.chat.actionCopyCode}
        className={styles.codeCopy}
        onClick={() => {
          void copyCode();
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
        {isStreaming ? t.chat.thinking : t.chat.thinkingDone}
      </summary>
      <div className={styles.thinkingText}>{part.text}</div>
    </details>
  );
});

const ActionGroup = memo(
  function ActionGroup({
    actions,
    messageId,
    cwd,
  }: {
    actions: Array<{
      action: Extract<MessagePart, { type: "action" }>;
      permitted: boolean;
    }>;
    messageId: string;
    cwd: string;
  }) {
    const onlyAction = actions[0];
    if (actions.length === 1 && onlyAction) {
      return (
        <ActionItem
          action={onlyAction.action}
          cwd={cwd}
          messageId={messageId}
          permitted={onlyAction.permitted}
        />
      );
    }
    return (
      <details className={styles.actionGroup}>
        <summary>
          <Wrench aria-hidden="true" size={15} />
          {t.chat.actionGroup(actions.length)}
        </summary>
        <div className={styles.actionGroupBody}>
          {actions.map(({ action, permitted }) => (
            <ActionItem
              action={action}
              cwd={cwd}
              key={action.id}
              messageId={messageId}
              permitted={permitted}
            />
          ))}
        </div>
      </details>
    );
  },
  (previous, next) =>
    previous.actions.length === next.actions.length &&
    previous.messageId === next.messageId &&
    previous.cwd === next.cwd &&
    previous.actions.every(
      ({ action, permitted }, index) =>
        action === next.actions[index]?.action && permitted === next.actions[index]?.permitted,
    ),
);

const ActionItem = memo(function ActionItem({
  action,
  messageId,
  permitted,
  cwd,
}: {
  action: Extract<MessagePart, { type: "action" }>;
  messageId: string;
  permitted: boolean;
  cwd: string;
}) {
  const Icon = actionIcon(action.actionType);
  const duration =
    action.durationMs === null || action.durationMs === undefined || action.durationMs < 1_000
      ? ""
      : formatDuration(action.durationMs);
  const waitingForUser = (action as { state: string }).state === "waiting";
  const title = action.title || `${t.chat.actionTypes[action.actionType]} ${action.input}`;
  const displayTitle = formatConversationText(title, cwd, 92);
  return (
    <details className={styles.action} data-message-id={messageId} data-part-id={action.id}>
      <summary aria-description={permitted ? t.chat.permissionGrantedDescription : undefined}>
        <Icon aria-hidden="true" className={styles.actionIcon} size={15} />
        <span className={styles.actionTitle} title={displayTitle.title}>
          {displayTitle.text}
        </span>
        {permitted ? (
          <LockKeyhole aria-hidden="true" className={styles.permittedIcon} size={13} />
        ) : null}
        <span className={styles.actionState}>
          {waitingForUser ? (
            <Clock3 aria-hidden="true" size={14} />
          ) : action.state === "running" ? (
            <LoaderCircle aria-hidden="true" className={styles.thinkingIcon} size={14} />
          ) : action.state === "ok" ? (
            <CheckCircle2 aria-hidden="true" size={14} />
          ) : (
            <XCircle aria-hidden="true" size={14} />
          )}
          <span>
            {waitingForUser ? t.chat.actionStates.waiting : t.chat.actionStates[action.state]}
          </span>
        </span>
        {duration ? <span className={styles.duration}>{duration}</span> : null}
      </summary>
      <div className={styles.actionDetails}>
        {action.input ? (
          <div>
            <span className={styles.detailLabel}>{t.chat.input}</span>
            <pre>{action.input}</pre>
          </div>
        ) : null}
        {action.output ? (
          <div>
            <span className={styles.detailLabel}>{t.chat.output}</span>
            <pre>
              {action.output}
              {action.truncated ? "\n…" : ""}
            </pre>
          </div>
        ) : null}
      </div>
    </details>
  );
});

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
    return (
      <p className={styles.responseLine}>
        <LockKeyhole aria-hidden="true" size={15} />
        {part.state === "allowed"
          ? t.chat.permissionResults.allowed
          : t.chat.permissionResults.denied}
      </p>
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
    return <p className={styles.responseLine}>{t.chat.questionAnswered}</p>;
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
}: {
  part: Extract<MessagePart, { type: "plan" }>;
  onRespond: OnRespond;
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
          <MarkdownBody markdown={part.markdown} onAnnounce={() => undefined} />
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
      <MarkdownBody markdown={part.markdown} onAnnounce={() => undefined} />
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
  messageId,
  onRetry,
}: {
  part: Extract<MessagePart, { type: "error" }>;
  messageId: string;
  onRetry: (messageId: string) => void;
}) {
  return (
    <section aria-label={t.chat.errorTitle} className={styles.errorCard}>
      <p>
        <AlertTriangle aria-hidden="true" size={16} />
        {part.text}
      </p>
      {part.retryable ? (
        <Button onClick={() => onRetry(messageId)} variant="secondary">
          {t.chat.retry}
        </Button>
      ) : null}
    </section>
  );
});

const TimelineView = memo(
  function TimelineView({
    id,
    message,
    cwd,
    onClose,
    onNavigate,
  }: {
    id: string;
    message: ConversationMessage;
    cwd: string;
    onClose: () => void;
    onNavigate: (partId: string) => void;
  }) {
    const regionRef = useRef<HTMLElement>(null);
    const rowRefs = useRef<Array<HTMLButtonElement | null>>([]);
    const [activeIndex, setActiveIndex] = useState(0);
    const timeline = useMemo(
      () => buildTimeline(message.parts, message.startedAt),
      [message.parts, message.startedAt],
    );
    const tickIntervalMs = timelineTickInterval(timeline.totalDurationMs);
    const axisEndMs = Math.ceil(timeline.totalDurationMs / tickIntervalMs) * tickIntervalMs;
    const ticks: number[] = [];
    for (let tick = 0; tick <= axisEndMs; tick += tickIntervalMs) ticks.push(tick);

    useEffect(() => {
      regionRef.current?.focus();
    }, []);

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

function buildTimeline(parts: MessagePart[], messageStartedAt?: number) {
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
        kindLabel = t.chat.actionTypes[part.actionType];
        title = `${part.title || t.chat.timelineAction} · ${t.chat.actionStates[part.state]}`;
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
