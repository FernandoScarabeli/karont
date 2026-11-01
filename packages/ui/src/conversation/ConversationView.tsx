import type { Conversation, ConversationMessage } from "@karont/contract";
import { BridgeError } from "@karont/contract";
import { Folder, MessageSquareText, TriangleAlert } from "lucide-react";
import {
  type DragEventHandler,
  type ReactNode,
  type RefObject,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { AgentIcon } from "../agents/AgentIcon.tsx";
import { getBridge } from "../bridge/index.ts";
import { Composer } from "../components/Composer/Composer.tsx";
import { t } from "../i18n/pt-BR.ts";
import {
  type AgentModels,
  agentDisplayName,
  ComposerPreferences,
  effortsForModel,
} from "./ComposerPreferences.tsx";
import { MessageRow, type ResponseInput, TodosPart } from "./ConversationParts.tsx";
import styles from "./ConversationView.module.css";
import { useConversation } from "./useConversation.ts";
import { upsertConversation } from "./useConversationIndex.ts";

export function ConversationView({
  id,
  titleRef,
  headerActions,
  dragHandleProps,
}: {
  id: string;
  titleRef?: RefObject<HTMLHeadingElement | null>;
  headerActions?: ReactNode;
  dragHandleProps?: {
    draggable: boolean;
    onDragEnd: DragEventHandler<HTMLHeadingElement>;
    onDragStart: DragEventHandler<HTMLHeadingElement>;
    tabIndex: number;
  };
}) {
  const bridge = getBridge();
  const { conversation, messages, loading, error, liveText, addMessage, updateConversation } =
    useConversation(id);
  const [draft, setDraft] = useState("");
  const [models, setModels] = useState<AgentModels | null>(null);
  const [interactionError, setInteractionError] = useState("");
  const [announcement, setAnnouncement] = useState("");
  const [visibleMessageCount, setVisibleMessageCount] = useState(100);
  const [isSavingOptions, setIsSavingOptions] = useState(false);
  const [isResponding, setIsResponding] = useState(false);
  const [isStopping, setIsStopping] = useState(false);
  const [isSending, setIsSending] = useState(false);
  const messageListRef = useRef<HTMLDivElement>(null);
  const composerSectionRef = useRef<HTMLElement>(null);
  const wasNearBottom = useRef(true);
  const previousScrollHeight = useRef(0);
  const restoreAfterOlder = useRef(false);
  const previousScrollVersion = useRef("");
  const agent = conversation?.agent;

  useEffect(() => {
    if (!agent || !bridge) return;
    let mounted = true;
    void bridge
      .request("agent.models", { agent })
      .then((result) => {
        if (mounted) setModels(result);
      })
      .catch(() => {
        if (mounted) setModels({ agent, models: [], efforts: [] });
      });
    return () => {
      mounted = false;
    };
  }, [agent, bridge]);

  const orderedMessages = messages;
  const visibleMessages = orderedMessages.slice(-visibleMessageCount);
  const latestMessage = visibleMessages.at(-1);
  const latestPart = latestMessage?.parts.at(-1);
  const latestPartContent =
    latestPart?.type === "text"
      ? latestPart.markdown.length
      : latestPart?.type === "thinking"
        ? latestPart.text.length
        : latestPart?.type === "action"
          ? `${latestPart.state}:${latestPart.durationMs ?? ""}`
          : (latestPart?.id ?? "");
  const scrollVersion = `${latestMessage?.id ?? "empty"}:${latestPart?.id ?? ""}:${latestPartContent}:${visibleMessages.length}`;
  const isWorking = conversation?.state === "working";
  const isWaiting = conversation?.state === "waiting";
  const isError = conversation?.state === "error";
  const stateLabel = isWorking
    ? t.chat.working
    : isWaiting
      ? t.chat.waiting
      : isError
        ? t.chat.conversationError
        : t.chat.idle;
  const lastTodos = useMemo(
    () => findLatestTodos(messages.filter((message) => message.status === "streaming")),
    [messages],
  );

  useEffect(() => {
    const list = messageListRef.current;
    if (!list) return;
    const contentChanged = previousScrollVersion.current !== scrollVersion;
    previousScrollVersion.current = scrollVersion;
    if (restoreAfterOlder.current) {
      const heightDifference = list.scrollHeight - previousScrollHeight.current;
      list.scrollTop += heightDifference;
      restoreAfterOlder.current = false;
    } else if (wasNearBottom.current && contentChanged) {
      list.scrollTop = list.scrollHeight;
    }
    previousScrollHeight.current = list.scrollHeight;
  }, [scrollVersion]);

  function trackScroll() {
    const list = messageListRef.current;
    if (!list) return;
    wasNearBottom.current = list.scrollHeight - list.scrollTop - list.clientHeight < 120;
    previousScrollHeight.current = list.scrollHeight;
  }

  const announce = useCallback((text: string) => setAnnouncement(text), []);

  const copyText = useCallback(
    async (text: string) => {
      try {
        await navigator.clipboard.writeText(text);
        announce(t.chat.copied);
      } catch {
        setInteractionError(t.chat.copyFailed);
      }
    },
    [announce],
  );

  const editMessage = useCallback((text: string) => {
    setDraft(text);
    requestAnimationFrame(() => {
      composerSectionRef.current?.querySelector("textarea")?.focus();
    });
  }, []);

  const sendMessage = useCallback(
    async (textValue: string) => {
      const text = textValue.trim();
      if (!bridge || !conversation || !text || isWorking || isWaiting || isSending) return;
      setInteractionError("");
      setIsSending(true);
      setDraft("");
      try {
        const result = await bridge.request("conversation.send", { id, text });
        addMessage(result.userMessage);
        addMessage(result.agentMessage);
      } catch (sendError) {
        setDraft(textValue);
        setInteractionError(
          sendError instanceof BridgeError && sendError.message
            ? sendError.message
            : t.chat.sendFailed,
        );
      } finally {
        setIsSending(false);
      }
    },
    [addMessage, bridge, conversation, id, isSending, isWaiting, isWorking],
  );

  const stopAgent = useCallback(async () => {
    if (!bridge || !conversation || isStopping) return;
    setIsStopping(true);
    setInteractionError("");
    try {
      await bridge.request("conversation.stop", { id });
    } catch (stopError) {
      setInteractionError(
        stopError instanceof BridgeError && stopError.message
          ? stopError.message
          : t.chat.stopFailed,
      );
    } finally {
      setIsStopping(false);
    }
  }, [bridge, conversation, id, isStopping]);

  const resendMessage = useCallback((text: string) => void sendMessage(text), [sendMessage]);

  const respond = useCallback(
    async (response: ResponseInput) => {
      if (!bridge || !conversation || isResponding) return;
      setIsResponding(true);
      setInteractionError("");
      try {
        await bridge.request("conversation.respond", { id, ...response });
      } catch (responseError) {
        setInteractionError(
          responseError instanceof BridgeError && responseError.message
            ? responseError.message
            : t.chat.responseFailed,
        );
      } finally {
        setIsResponding(false);
      }
    },
    [bridge, conversation, id, isResponding],
  );

  const retry = useCallback(
    async (messageId: string) => {
      if (!bridge || !conversation) return;
      setInteractionError("");
      try {
        const result = await bridge.request("conversation.retry", { id, messageId });
        addMessage(result.agentMessage);
      } catch (retryError) {
        setInteractionError(
          retryError instanceof BridgeError && retryError.message
            ? retryError.message
            : t.chat.sendFailed,
        );
      }
    },
    [addMessage, bridge, conversation, id],
  );

  const saveOptions = useCallback(
    async (options: {
      mode?: Conversation["mode"];
      model?: string | null;
      effort?: NonNullable<Conversation["effort"]> | null;
    }) => {
      if (!bridge || !conversation) return;
      setIsSavingOptions(true);
      setInteractionError("");
      try {
        const result = await bridge.request("conversation.setOptions", { id, options });
        updateConversation(result.conversation);
        upsertConversation(result.conversation);
      } catch (optionsError) {
        setInteractionError(
          optionsError instanceof BridgeError && optionsError.message
            ? optionsError.message
            : t.chat.optionsFailed,
        );
      } finally {
        setIsSavingOptions(false);
      }
    },
    [bridge, conversation, id, updateConversation],
  );

  async function copyFolderPath() {
    if (!conversation) return;
    await copyText(conversation.cwd);
    setAnnouncement(t.chat.folderCopied);
  }

  const title = conversation?.title ?? t.chat.loading;
  const homeTodos = isWorking ? lastTodos : null;

  return (
    <section aria-label={title} className={styles.page}>
      <header className={styles.header}>
        <h1 className={styles.title} ref={titleRef} tabIndex={-1} {...dragHandleProps}>
          {title}
        </h1>
        {conversation ? (
          <span
            className={`${styles.state} ${isWaiting ? styles.waiting : isWorking ? styles.working : isError ? styles.failed : ""}`}
          >
            <span aria-hidden="true" className={styles.stateMark} />
            {stateLabel}
          </span>
        ) : null}
        {headerActions}
      </header>

      <section
        aria-label={t.chat.messageList}
        className={styles.messageList}
        onScroll={trackScroll}
        ref={messageListRef}
      >
        {loading ? <p className={styles.loading}>{t.chat.loading}</p> : null}
        {error ? (
          <p className={styles.error} role="alert">
            <TriangleAlert aria-hidden="true" size={16} />
            {error}
          </p>
        ) : null}
        {!loading && !error && messages.length === 0 ? (
          <div className={styles.empty}>
            <MessageSquareText aria-hidden="true" size={22} />
            <p>{t.chat.emptyTitle(conversation ? agentDisplayName(conversation.agent) : "")}</p>
            <span>{t.conversation.promptPlaceholder}</span>
          </div>
        ) : null}
        {orderedMessages.length > visibleMessages.length ? (
          <button
            className={styles.olderMessages}
            onClick={() => {
              previousScrollHeight.current = messageListRef.current?.scrollHeight ?? 0;
              restoreAfterOlder.current = true;
              setVisibleMessageCount((count) => count + 100);
            }}
            type="button"
          >
            {t.chat.showOlderMessages}
          </button>
        ) : null}
        {visibleMessages.map((message) => (
          <MessageRow
            key={message.id}
            message={message}
            onAnnounce={announce}
            onCopy={copyText}
            onEdit={editMessage}
            onResend={resendMessage}
            onRespond={respond}
            onRetry={retry}
          />
        ))}
      </section>

      <section
        aria-label={t.chat.messageComposer}
        className={styles.composerSection}
        ref={composerSectionRef}
      >
        {homeTodos ? (
          <div className={styles.pinnedTodos}>
            <TodosPart part={homeTodos} />
          </div>
        ) : null}
        {isWorking ? (
          <p className={styles.progress} role="status">
            <span aria-hidden="true" className={styles.progressMark} />
            {stateLabel}
            {isStopping ? ` · ${t.chat.stopping}` : ""}
          </p>
        ) : null}
        {interactionError ? (
          <p className={styles.error} role="alert">
            <TriangleAlert aria-hidden="true" size={16} />
            {interactionError}
          </p>
        ) : null}
        <Composer
          ariaDescription={t.conversation.composerKeyboardDescription}
          below={
            conversation ? (
              <div className={styles.folderStrip}>
                <button
                  aria-label={t.chat.folderCopy(conversation.cwd)}
                  className={styles.folderButton}
                  onClick={() => void copyFolderPath()}
                  title={t.chat.folderCopy(conversation.cwd)}
                  type="button"
                >
                  <Folder aria-hidden="true" size={15} />
                  <span>{conversation.cwd}</span>
                </button>
              </div>
            ) : null
          }
          busy={isWorking}
          disabled={
            !conversation || loading || isWaiting || isSavingOptions || isResponding || isSending
          }
          leading={
            conversation ? (
              <div className={styles.composerControls}>
                <span className={styles.agentTag}>
                  <AgentIcon agentId={conversation.agent} />
                  {agentDisplayName(conversation.agent)}
                </span>
                <ComposerPreferences
                  disabled={
                    isWorking || isWaiting || isSavingOptions || isResponding || loading || !bridge
                  }
                  effort={conversation.effort ?? ""}
                  mode={conversation.mode}
                  model={conversation.model ?? ""}
                  models={models}
                  onEffortChange={(value) => void saveOptions({ effort: value || null })}
                  onModeChange={(value) => void saveOptions({ mode: value })}
                  onModelChange={(value) => {
                    const supportedEfforts = effortsForModel(models, value);
                    const clearEffort =
                      conversation.effort && !supportedEfforts.includes(conversation.effort);
                    void saveOptions({
                      model: value || null,
                      ...(clearEffort ? { effort: null } : {}),
                    });
                  }}
                />
              </div>
            ) : null
          }
          onChange={setDraft}
          onStop={() => void stopAgent()}
          onSubmit={() => void sendMessage(draft)}
          placeholder={t.chat.messageInput}
          submitDisabled={!bridge || loading || !draft.trim() || isWaiting || isSending}
          submitLabel={isWorking ? t.chat.stop : t.chat.send}
          value={draft}
        />
      </section>
      <div aria-live="polite" className={styles.srOnly} role="status">
        {liveText ? t.chat.contentAnnounced(liveText) : announcement}
      </div>
    </section>
  );
}

function findLatestTodos(messages: ConversationMessage[]) {
  for (let messageIndex = messages.length - 1; messageIndex >= 0; messageIndex -= 1) {
    const message = messages[messageIndex];
    if (message?.author !== "agent") continue;
    for (let partIndex = message.parts.length - 1; partIndex >= 0; partIndex -= 1) {
      const part = message.parts[partIndex];
      if (part?.type === "todos") return part;
    }
  }
  return null;
}
