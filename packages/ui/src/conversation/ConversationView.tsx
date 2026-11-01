import type { Conversation, ConversationAttachment, ConversationMessage } from "@karont/contract";
import { BridgeError } from "@karont/contract";
import {
  FileText,
  Folder,
  GitBranch,
  Image as ImageIcon,
  MessageSquareText,
  Paperclip,
  TriangleAlert,
  X,
} from "lucide-react";
import {
  type ClipboardEvent,
  type DragEventHandler,
  type ReactNode,
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
  classifyAttachmentFile,
  formatAttachmentSize,
  MAX_CONVERSATION_ATTACHMENTS,
  MAX_IMAGE_ATTACHMENT_BYTES,
  MAX_TEXT_ATTACHMENT_BYTES,
} from "./attachmentUtils.ts";
import {
  type AgentModels,
  agentDisplayName,
  ComposerPreferences,
  effortsForModel,
} from "./ComposerPreferences.tsx";
import { MessageRow, type ResponseInput, TodosPart } from "./ConversationParts.tsx";
import styles from "./ConversationView.module.css";
import { formatFolderPath } from "./displayText.ts";
import { isConversationPlanModeActive, setConversationPlanModeActive } from "./planMode.ts";
import { useConversation } from "./useConversation.ts";
import { upsertConversation } from "./useConversationIndex.ts";

type PendingAttachment = ConversationAttachment & {
  id: string;
  sizeBytes: number;
  previewUrl?: string;
};

type AttachmentFailure = "unsupported" | "image-too-large" | "text-too-large" | "invalid-name";

class AttachmentInputError extends Error {
  readonly code: AttachmentFailure;

  constructor(code: AttachmentFailure) {
    super(code);
    this.code = code;
  }
}

export function ConversationView({
  id,
  headerActions,
  dragHandleProps,
}: {
  id: string;
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
  const [pendingAttachments, setPendingAttachments] = useState<PendingAttachment[]>([]);
  const [isDraggingFiles, setIsDraggingFiles] = useState(false);
  const [isPreparingAttachments, setIsPreparingAttachments] = useState(false);
  const [gitInfo, setGitInfo] = useState<{ branch: string | null; detached: boolean } | null>(null);
  const [planMode, setPlanMode] = useState(() => isConversationPlanModeActive(id));
  const [models, setModels] = useState<AgentModels | null>(null);
  const [interactionError, setInteractionError] = useState("");
  const [announcement, setAnnouncement] = useState("");
  const [visibleMessageCount, setVisibleMessageCount] = useState(100);
  const [isSavingOptions, setIsSavingOptions] = useState(false);
  const [isResponding, setIsResponding] = useState(false);
  const [isStopping, setIsStopping] = useState(false);
  const [isSending, setIsSending] = useState(false);
  const pendingAttachmentsRef = useRef<PendingAttachment[]>([]);
  const attachmentQueueRef = useRef<Promise<void>>(Promise.resolve());
  const attachmentTaskCountRef = useRef(0);
  const activeConversationIdRef = useRef(id);
  activeConversationIdRef.current = id;
  const isMountedRef = useRef(true);
  const dragDepthRef = useRef(0);
  const previousConversationIdRef = useRef(id);
  const messageListRef = useRef<HTMLDivElement>(null);
  const composerSectionRef = useRef<HTMLElement>(null);
  const attachmentInputRef = useRef<HTMLInputElement>(null);
  const wasNearBottom = useRef(true);
  const previousScrollHeight = useRef(0);
  const restoreAfterOlder = useRef(false);
  const previousScrollVersion = useRef("");
  const agent = conversation?.agent;

  const replacePendingAttachments = useCallback((next: PendingAttachment[]) => {
    pendingAttachmentsRef.current = next;
    setPendingAttachments(next);
  }, []);

  const clearPendingAttachments = useCallback(() => {
    for (const attachment of pendingAttachmentsRef.current) {
      if (attachment.previewUrl) URL.revokeObjectURL(attachment.previewUrl);
    }
    replacePendingAttachments([]);
  }, [replacePendingAttachments]);

  const removePendingAttachment = useCallback(
    (attachmentId: string) => {
      const removed = pendingAttachmentsRef.current.find(
        (attachment) => attachment.id === attachmentId,
      );
      if (removed?.previewUrl) URL.revokeObjectURL(removed.previewUrl);
      replacePendingAttachments(
        pendingAttachmentsRef.current.filter((attachment) => attachment.id !== attachmentId),
      );
    },
    [replacePendingAttachments],
  );

  useEffect(() => {
    isMountedRef.current = true;
    return () => {
      isMountedRef.current = false;
      for (const attachment of pendingAttachmentsRef.current) {
        if (attachment.previewUrl) URL.revokeObjectURL(attachment.previewUrl);
      }
    };
  }, []);

  useEffect(() => {
    if (previousConversationIdRef.current === id) return;
    previousConversationIdRef.current = id;
    setDraft("");
    clearPendingAttachments();
    setInteractionError("");
  }, [clearPendingAttachments, id]);

  useEffect(() => {
    if (!bridge || !conversation?.cwd) {
      setGitInfo(null);
      return;
    }
    let active = true;
    const conversationId = id;
    const refreshGitInfo = () => {
      void bridge
        .request("folders.gitInfo", { path: conversation.cwd })
        .then((result) => {
          if (active && id === conversationId) setGitInfo(result);
        })
        .catch(() => {
          if (active && id === conversationId) setGitInfo(null);
        });
    };

    setGitInfo(null);
    refreshGitInfo();
    window.addEventListener("focus", refreshGitInfo);
    return () => {
      active = false;
      window.removeEventListener("focus", refreshGitInfo);
    };
  }, [bridge, conversation?.cwd, id]);

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
    () => findLatestTodos(latestMessage?.status === "streaming" ? latestMessage : null),
    [latestMessage],
  );

  function queueAttachments(files: File[]) {
    if (files.length === 0 || !conversation || !bridge || loading || isWaiting || isSending) {
      return;
    }
    const queueConversationId = id;
    attachmentTaskCountRef.current += 1;
    setIsPreparingAttachments(true);
    setInteractionError("");
    attachmentQueueRef.current = attachmentQueueRef.current
      .then(async () => {
        if (!isMountedRef.current || activeConversationIdRef.current !== queueConversationId) {
          return;
        }
        const warnings: string[] = [];
        for (const file of files) {
          if (!isMountedRef.current || activeConversationIdRef.current !== queueConversationId) {
            break;
          }
          if (pendingAttachmentsRef.current.length >= MAX_CONVERSATION_ATTACHMENTS) {
            warnings.push(t.chat.attachmentLimit);
            break;
          }
          try {
            const attachment = await prepareAttachment(file);
            if (!isMountedRef.current || activeConversationIdRef.current !== queueConversationId) {
              if (attachment.previewUrl) URL.revokeObjectURL(attachment.previewUrl);
              break;
            }
            replacePendingAttachments([...pendingAttachmentsRef.current, attachment]);
          } catch (fileError) {
            if (activeConversationIdRef.current === queueConversationId) {
              warnings.push(attachmentFailureMessage(fileError, file.name));
            }
          }
        }
        if (
          warnings.length > 0 &&
          isMountedRef.current &&
          activeConversationIdRef.current === queueConversationId
        ) {
          setInteractionError([...new Set(warnings)].slice(0, 3).join(" "));
        }
      })
      .catch(() => {
        if (isMountedRef.current && activeConversationIdRef.current === queueConversationId) {
          setInteractionError(t.chat.attachmentReadFailed("arquivo"));
        }
      })
      .finally(() => {
        attachmentTaskCountRef.current -= 1;
        if (isMountedRef.current && attachmentTaskCountRef.current === 0) {
          setIsPreparingAttachments(false);
        }
      });
  }

  function handlePaste(event: ClipboardEvent<HTMLTextAreaElement>) {
    const files = Array.from(event.clipboardData.items)
      .filter((item) => item.kind === "file" && item.type.startsWith("image/"))
      .map((item) => item.getAsFile())
      .filter((file): file is File => file !== null);
    if (files.length === 0) return;
    event.preventDefault();
    queueAttachments(files);
  }

  const handleDragEnter: DragEventHandler<HTMLFormElement> = (event) => {
    if (!Array.from(event.dataTransfer.types).includes("Files")) return;
    event.preventDefault();
    dragDepthRef.current += 1;
    setIsDraggingFiles(true);
  };

  const handleDragLeave: DragEventHandler<HTMLFormElement> = (event) => {
    if (dragDepthRef.current === 0) return;
    event.preventDefault();
    dragDepthRef.current = Math.max(0, dragDepthRef.current - 1);
    if (dragDepthRef.current === 0) setIsDraggingFiles(false);
  };

  const handleDragOver: DragEventHandler<HTMLFormElement> = (event) => {
    if (!Array.from(event.dataTransfer.types).includes("Files")) return;
    event.preventDefault();
    event.dataTransfer.dropEffect = "copy";
  };

  const handleDrop: DragEventHandler<HTMLFormElement> = (event) => {
    if (event.dataTransfer.files.length === 0) return;
    event.preventDefault();
    dragDepthRef.current = 0;
    setIsDraggingFiles(false);
    queueAttachments(Array.from(event.dataTransfer.files));
  };

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
    async (textValue: string, files: PendingAttachment[] = []) => {
      const text = textValue.trim();
      if (
        !bridge ||
        !conversation ||
        (!text && files.length === 0) ||
        isWorking ||
        isWaiting ||
        isSending
      )
        return;
      setInteractionError("");
      setIsSending(true);
      setDraft("");
      try {
        const attachments: ConversationAttachment[] = files.map(
          ({ name, mimeType, kind, data }) => ({
            name,
            mimeType,
            kind,
            data,
          }),
        );
        const result = await bridge.request("conversation.send", {
          id,
          text: text || " ",
          ...(planMode ? { plan: true } : {}),
          ...(attachments.length ? { attachments } : {}),
        });
        addMessage(result.userMessage);
        addMessage(result.agentMessage);
        clearPendingAttachments();
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
    [
      addMessage,
      bridge,
      clearPendingAttachments,
      conversation,
      id,
      isSending,
      isWaiting,
      isWorking,
      planMode,
    ],
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
        if (response.responseType === "plan" && response.decision === "approve") {
          setPlanMode(false);
          setConversationPlanModeActive(id, false);
        }
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
  const folderPath = conversation ? formatFolderPath(conversation.cwd) : null;
  const canAttachFiles = Boolean(
    conversation &&
      bridge &&
      !loading &&
      !isWaiting &&
      !isSavingOptions &&
      !isResponding &&
      !isSending,
  );

  return (
    <section
      aria-label={title}
      className={styles.page}
      data-focus-context="conversation"
      tabIndex={-1}
    >
      <header className={styles.header}>
        <h1 className={styles.title} {...dragHandleProps}>
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
            cwd={conversation?.cwd ?? ""}
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
        {isPreparingAttachments ? (
          <p className={styles.progress} role="status">
            <span aria-hidden="true" className={styles.progressMark} />
            {t.chat.preparingAttachments}
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
                  <span title={folderPath?.title}>{folderPath?.text}</span>
                </button>
                {gitInfo?.detached || gitInfo?.branch ? (
                  <span
                    className={styles.gitBranch}
                    title={gitInfo.detached ? t.chat.detachedHead : (gitInfo.branch ?? undefined)}
                  >
                    <GitBranch aria-hidden="true" size={14} />
                    <span>{gitInfo.detached ? t.chat.detachedHead : gitInfo.branch}</span>
                  </span>
                ) : null}
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
                <button
                  aria-label={t.chat.attachFile}
                  aria-description={t.chat.attachmentRules}
                  className={styles.attachButton}
                  disabled={!canAttachFiles}
                  onClick={() => attachmentInputRef.current?.click()}
                  title={t.chat.attachmentRules}
                  type="button"
                >
                  <Paperclip aria-hidden="true" size={16} />
                </button>
                <input
                  aria-label={t.chat.chooseAttachments}
                  className={styles.fileInput}
                  multiple
                  onChange={(event) => {
                    queueAttachments(Array.from(event.currentTarget.files ?? []));
                    event.currentTarget.value = "";
                  }}
                  ref={attachmentInputRef}
                  type="file"
                />
                <span className={styles.agentTag}>
                  <AgentIcon agentId={conversation.agent} />
                  {agentDisplayName(conversation.agent)}
                </span>
                <ComposerPreferences
                  disabled={
                    isWorking ||
                    isWaiting ||
                    isSavingOptions ||
                    isResponding ||
                    isSending ||
                    loading ||
                    !bridge
                  }
                  effort={conversation.effort ?? ""}
                  mode={conversation.mode}
                  model={conversation.model ?? ""}
                  models={models}
                  planMode={planMode}
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
                  onPlanModeChange={(value) => {
                    setPlanMode(value);
                    setConversationPlanModeActive(id, value);
                  }}
                />
              </div>
            ) : null
          }
          attachments={
            pendingAttachments.length ? (
              <section aria-label={t.chat.pendingAttachments} className={styles.pendingAttachments}>
                {pendingAttachments.map((attachment) => (
                  <div className={styles.pendingAttachment} key={attachment.id}>
                    {attachment.kind === "image" && attachment.previewUrl ? (
                      <img
                        alt=""
                        className={styles.attachmentThumbnail}
                        src={attachment.previewUrl}
                      />
                    ) : (
                      <span aria-hidden="true" className={styles.attachmentIcon}>
                        {attachment.kind === "image" ? (
                          <ImageIcon size={16} />
                        ) : (
                          <FileText size={16} />
                        )}
                      </span>
                    )}
                    <span className={styles.pendingAttachmentText}>
                      <span className={styles.pendingAttachmentName} title={attachment.name}>
                        {attachment.name}
                      </span>
                      <span className={styles.pendingAttachmentSize}>
                        {formatAttachmentSize(attachment.sizeBytes)}
                      </span>
                    </span>
                    <button
                      aria-label={t.chat.removeAttachment(attachment.name)}
                      className={styles.removeAttachment}
                      disabled={isSending}
                      onClick={() => removePendingAttachment(attachment.id)}
                      title={t.chat.removeAttachment(attachment.name)}
                      type="button"
                    >
                      <X aria-hidden="true" size={14} />
                    </button>
                  </div>
                ))}
              </section>
            ) : null
          }
          onChange={setDraft}
          onDragEnter={handleDragEnter}
          onDragLeave={handleDragLeave}
          onDragOver={handleDragOver}
          onDrop={handleDrop}
          onPaste={handlePaste}
          onStop={() => void stopAgent()}
          onSubmit={() => void sendMessage(draft, pendingAttachments)}
          placeholder={t.chat.messageInput}
          submitDisabled={
            !bridge ||
            loading ||
            isPreparingAttachments ||
            (!draft.trim() && pendingAttachments.length === 0) ||
            isWaiting ||
            isSending
          }
          submitLabel={isWorking ? t.chat.stop : t.chat.send}
          dragActive={isDraggingFiles}
          dropMessage={t.chat.dropAttachments}
          value={draft}
        />
      </section>
      <div aria-live="polite" className={styles.srOnly} role="status">
        {liveText ? t.chat.contentAnnounced(liveText) : announcement}
      </div>
    </section>
  );
}

function findLatestTodos(message: ConversationMessage | null) {
  if (message?.author !== "agent") return null;
  for (let partIndex = message.parts.length - 1; partIndex >= 0; partIndex -= 1) {
    const part = message.parts[partIndex];
    if (part?.type === "todos") return part;
  }
  return null;
}

async function prepareAttachment(file: File): Promise<PendingAttachment> {
  const fileInfo = classifyAttachmentFile(file);
  if (!fileInfo) throw new AttachmentInputError("unsupported");

  const name = file.name || fallbackAttachmentName(fileInfo.kind, fileInfo.mimeType);
  if (name.trim() !== name || name.length > 255 || /\p{Cc}/u.test(name)) {
    throw new AttachmentInputError("invalid-name");
  }

  if (fileInfo.kind === "image") {
    if (file.size > MAX_IMAGE_ATTACHMENT_BYTES) {
      throw new AttachmentInputError("image-too-large");
    }
    const bytes = new Uint8Array(await file.arrayBuffer());
    if (bytes.byteLength > MAX_IMAGE_ATTACHMENT_BYTES) {
      throw new AttachmentInputError("image-too-large");
    }
    return {
      id: crypto.randomUUID(),
      name,
      mimeType: fileInfo.mimeType,
      kind: "image",
      data: encodeBase64(bytes),
      sizeBytes: bytes.byteLength,
      previewUrl: URL.createObjectURL(file),
    };
  }

  if (file.size > MAX_TEXT_ATTACHMENT_BYTES) {
    throw new AttachmentInputError("text-too-large");
  }
  const data = await file.text();
  const sizeBytes = new TextEncoder().encode(data).byteLength;
  if (sizeBytes > MAX_TEXT_ATTACHMENT_BYTES) {
    throw new AttachmentInputError("text-too-large");
  }
  return {
    id: crypto.randomUUID(),
    name,
    mimeType: fileInfo.mimeType,
    kind: "text",
    data,
    sizeBytes,
  };
}

function fallbackAttachmentName(kind: "image" | "text", mimeType: string): string {
  if (kind === "text" && mimeType === "application/json") return "arquivo.json";
  const extension =
    mimeType === "image/jpeg"
      ? "jpg"
      : mimeType.split("/")[1] || (kind === "image" ? "png" : "txt");
  return `${kind === "image" ? "imagem-colada" : "arquivo"}.${extension}`;
}

function encodeBase64(bytes: Uint8Array): string {
  let binary = "";
  const chunkSize = 32_768;
  for (let offset = 0; offset < bytes.length; offset += chunkSize) {
    binary += String.fromCharCode(...bytes.subarray(offset, offset + chunkSize));
  }
  return btoa(binary);
}

function attachmentFailureMessage(error: unknown, name: string): string {
  const safeName = name.trim() || "arquivo";
  if (!(error instanceof AttachmentInputError)) return t.chat.attachmentReadFailed(safeName);
  switch (error.code) {
    case "unsupported":
      return t.chat.attachmentUnsupported(safeName);
    case "image-too-large":
      return t.chat.attachmentImageTooLarge(safeName);
    case "text-too-large":
      return t.chat.attachmentTextTooLarge(safeName);
    case "invalid-name":
      return t.chat.attachmentInvalidName;
  }
}
