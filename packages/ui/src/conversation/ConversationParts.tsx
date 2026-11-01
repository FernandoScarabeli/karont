import {
  AlertTriangle,
  Check,
  CheckCircle2,
  Circle,
  Clock3,
  Copy,
  FileCode2,
  Globe2,
  HelpCircle,
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
import { type FormEvent, memo, useEffect, useId, useState } from "react";
import Markdown from "react-markdown";
import rehypeHighlight from "rehype-highlight";
import remarkGfm from "remark-gfm";
import { Button } from "../components/Button/Button.tsx";
import { t } from "../i18n/pt-BR.ts";
import styles from "./ConversationParts.module.css";
import type { ConversationMessage, MessagePart } from "./useConversation.ts";

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
}: {
  message: ConversationMessage;
  onCopy: (text: string) => void;
  onEdit: (text: string) => void;
  onResend: (text: string) => void;
  onRespond: OnRespond;
  onRetry: (messageId: string) => void;
  onAnnounce: (text: string) => void;
}) {
  const [showTimeline, setShowTimeline] = useState(false);
  const [visiblePartCount, setVisiblePartCount] = useState(120);
  const text =
    message.author === "user"
      ? message.parts
          .filter((part): part is Extract<MessagePart, { type: "text" }> => part.type === "text")
          .map((part) => part.markdown)
          .join("\n")
      : "";
  const visibleParts = message.parts.slice(-visiblePartCount);
  const hasTimeline = message.author === "agent" && message.parts.some(isTimelinePart);

  return (
    <article
      aria-label={message.author === "user" ? t.chat.userMessage : t.chat.agentMessage}
      className={`${styles.message} ${message.author === "user" ? styles.userMessage : styles.agentMessage}`}
      data-author={message.author}
    >
      {message.author === "user" ? (
        <>
          <div className={styles.userBubble}>{text}</div>
          <div className={styles.messageActions}>
            <button className={styles.textAction} onClick={() => onCopy(text)} type="button">
              <Copy aria-hidden="true" size={14} />
              {t.chat.copy}
            </button>
            <button className={styles.textAction} onClick={() => onEdit(text)} type="button">
              <Pencil aria-hidden="true" size={14} />
              {t.chat.edit}
            </button>
            <button
              className={styles.textAction}
              disabled={message.status === "streaming"}
              onClick={() => onResend(text)}
              type="button"
            >
              <Play aria-hidden="true" size={14} />
              {t.chat.resend}
            </button>
          </div>
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
            )}
          </div>
          {hasTimeline ? (
            <>
              <button
                aria-expanded={showTimeline}
                className={styles.timelineToggle}
                onClick={() => setShowTimeline((value) => !value)}
                type="button"
              >
                <Clock3 aria-hidden="true" size={14} />
                {t.chat.timeline}
              </button>
              {showTimeline ? <TimelineView message={message} /> : null}
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
) {
  const elements: ReactNode[] = [];
  let index = 0;
  while (index < parts.length) {
    const part = parts[index];
    if (!part) {
      index += 1;
      continue;
    }
    if (part.type === "action") {
      const actions: Extract<MessagePart, { type: "action" }>[] = [];
      while (parts[index]?.type === "action") {
        const action = parts[index];
        if (action?.type === "action") actions.push(action);
        index += 1;
      }
      elements.push(<ActionGroup actions={actions} key={actions[0]?.id ?? index} />);
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
  }: {
    part: MessagePart;
    messageId: string;
    isStreaming: boolean;
    onRespond: OnRespond;
    onRetry: (messageId: string) => void;
    onAnnounce: (text: string) => void;
  }) {
    switch (part.type) {
      case "text":
        return <MarkdownBody markdown={part.markdown} onAnnounce={onAnnounce} />;
      case "thinking":
        return <ThinkingPart isStreaming={isStreaming} part={part} />;
      case "permission":
        return <PermissionPart onRespond={onRespond} part={part} />;
      case "question":
        return <QuestionPart onRespond={onRespond} part={part} />;
      case "plan":
        return <PlanPart onRespond={onRespond} part={part} />;
      case "todos":
        return <TodosPart part={part} />;
      case "error":
        return <ErrorPart messageId={messageId} onRetry={onRetry} part={part} />;
      case "action":
        return null;
    }
  },
  (previous, next) =>
    previous.part === next.part &&
    previous.messageId === next.messageId &&
    previous.isStreaming === next.isStreaming &&
    previous.onRespond === next.onRespond &&
    previous.onRetry === next.onRetry &&
    previous.onAnnounce === next.onAnnounce,
);

const MarkdownBody = memo(function MarkdownBody({
  markdown,
  onAnnounce,
}: {
  markdown: string;
  onAnnounce: (text: string) => void;
}) {
  return (
    <div className={styles.markdown}>
      <Markdown
        components={{
          a: ({ children }) => (
            <span className={styles.inertLink} title={t.chat.linkUnavailable}>
              {children}
            </span>
          ),
          pre: ({ children }) => <CodeBlock onAnnounce={onAnnounce}>{children}</CodeBlock>,
        }}
        rehypePlugins={[rehypeHighlight]}
        remarkPlugins={[remarkGfm]}
      >
        {markdown}
      </Markdown>
    </div>
  );
});

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
  function ActionGroup({ actions }: { actions: Extract<MessagePart, { type: "action" }>[] }) {
    const onlyAction = actions[0];
    if (actions.length === 1 && onlyAction) return <ActionItem action={onlyAction} />;
    return (
      <details className={styles.actionGroup}>
        <summary>
          <Wrench aria-hidden="true" size={15} />
          {t.chat.actionGroup(actions.length)}
        </summary>
        <div className={styles.actionGroupBody}>
          {actions.map((action) => (
            <ActionItem action={action} key={action.id} />
          ))}
        </div>
      </details>
    );
  },
  (previous, next) =>
    previous.actions.length === next.actions.length &&
    previous.actions.every((action, index) => action === next.actions[index]),
);

const ActionItem = memo(function ActionItem({
  action,
}: {
  action: Extract<MessagePart, { type: "action" }>;
}) {
  const Icon = actionIcon(action.actionType);
  const duration =
    action.durationMs === null || action.durationMs === undefined || action.durationMs === 0
      ? ""
      : formatDuration(action.durationMs);
  const waitingForUser = (action as { state: string }).state === "waiting";
  const title = action.title || `${t.chat.actionTypes[action.actionType]} ${action.input}`;
  return (
    <details className={styles.action}>
      <summary>
        <Icon aria-hidden="true" className={styles.actionIcon} size={15} />
        <span className={styles.actionTitle}>{title}</span>
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
}: {
  part: Extract<MessagePart, { type: "permission" }>;
  onRespond: OnRespond;
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
  const command = permission.command?.trim();
  const description = permission.description ?? permission.summary;
  const heading = permissionHeading(part.tool);

  return (
    <section aria-labelledby={headingId} className={styles.permissionCard}>
      <h3 id={headingId}>
        <AlertTriangle aria-hidden="true" size={16} />
        {heading}
      </h3>
      {command ? <code className={styles.permissionCommand}>{command}</code> : null}
      {description ? <p className={styles.permissionDescription}>{description}</p> : null}
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
      <p className={styles.responseLine}>
        <Check aria-hidden="true" size={15} />
        {part.state === "approved" ? t.chat.planResults.approved : t.chat.planResults.rejected}
        {part.comment ? ` · ${part.comment}` : ""}
      </p>
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
        <Button
          disabled={submitting}
          onClick={() => {
            setSubmitting(true);
            void onRespond({ partId: part.id, responseType: "plan", decision: "approve" }).finally(
              () => setSubmitting(false),
            );
          }}
          variant="primary"
        >
          {t.chat.approve}
        </Button>
        {!adjusting ? (
          <Button onClick={() => setAdjusting(true)} variant="secondary">
            {t.chat.adjust}
          </Button>
        ) : (
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
            variant="secondary"
          >
            {t.chat.sendAdjustment}
          </Button>
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
  function TimelineView({ message }: { message: ConversationMessage }) {
    const steps = message.parts.filter(isTimelinePart);
    const maxDuration = Math.max(
      1,
      ...steps.map((part) => (part.type === "action" ? (part.durationMs ?? 0) : 0)),
    );
    return (
      <section aria-label={t.chat.timelineTitle} className={styles.timeline}>
        <p>{t.chat.timelineCaption}</p>
        <ol>
          {steps.map((part) => {
            const duration = part.type === "action" ? (part.durationMs ?? null) : null;
            const hasDuration = duration !== null && duration > 0;
            const title = part.type === "action" ? part.title : t.chat.thinkingDone;
            const width = hasDuration ? `${Math.max(4, (duration / maxDuration) * 100)}%` : "0%";
            return (
              <li key={part.id}>
                <span className={styles.timelineTitle}>{title}</span>
                <div
                  aria-label={
                    hasDuration ? formatDuration(duration) : t.chat.timelineDurationMissing
                  }
                  className={styles.timelineTrack}
                  role="img"
                >
                  {!hasDuration ? (
                    <span className={styles.timelineUnknown}>—</span>
                  ) : (
                    <span className={styles.timelineBar} style={{ width }} />
                  )}
                </div>
                <span className={styles.timelineDuration}>
                  {hasDuration ? formatDuration(duration) : t.chat.timelineDurationMissing}
                </span>
              </li>
            );
          })}
        </ol>
      </section>
    );
  },
  (previous, next) => {
    const previousSteps = previous.message.parts.filter(isTimelinePart);
    const nextSteps = next.message.parts.filter(isTimelinePart);
    return (
      previousSteps.length === nextSteps.length &&
      previousSteps.every((part, index) => part === nextSteps[index])
    );
  },
);

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

function isTimelinePart(
  part: MessagePart,
): part is Extract<MessagePart, { type: "action" | "thinking" }> {
  return part.type === "action" || part.type === "thinking";
}

function formatDuration(milliseconds: number): string {
  if (milliseconds < 1_000) return `${milliseconds} ms`;
  if (milliseconds < 60_000) return `${(milliseconds / 1_000).toFixed(1)} s`;
  const minutes = Math.floor(milliseconds / 60_000);
  const seconds = Math.round((milliseconds % 60_000) / 1_000);
  return `${minutes} min ${seconds} s`;
}
