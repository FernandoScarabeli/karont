import type { Conversation, ConversationAttachment, ConversationMessage } from "@karont/contract";
import { BridgeError } from "@karont/contract";
import { Check, Folder, MessageSquareText, TriangleAlert, X } from "lucide-react";
import {
  type DragEventHandler,
  type ReactNode,
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { AgentIcon } from "../agents/AgentIcon.tsx";
import { getBridge } from "../bridge/index.ts";
import { Composer } from "../components/Composer/Composer.tsx";
import { IconButton } from "../components/IconButton/IconButton.tsx";
import scrollAreaStyles from "../components/ScrollArea/ScrollArea.module.css";
import { t } from "../i18n/pt-BR.ts";
import {
  AttachmentChips,
  AttachmentPicker,
  useComposerAttachments,
} from "./ComposerAttachments.tsx";
import {
  type AgentEffort,
  type AgentModels,
  agentDisplayName,
  type ComposerPopoverName,
  ComposerPreferences,
  effortSettingKey,
  effortsForModel,
  modelSettingKey,
} from "./ComposerPreferences.tsx";
import {
  ConversationBranchPlaceholder,
  ConversationLoadingControls,
  ConversationLoadingStrip,
} from "./ConversationLoadingFrame.tsx";
import { MessageRow, type ResponseInput, TodosPart } from "./ConversationParts.tsx";
import styles from "./ConversationView.module.css";
import { cacheAgentModels, getCachedAgentModels } from "./conversationCache.ts";
import { formatFolderPath } from "./displayText.ts";
import { FollowBottomContext } from "./followBottom.ts";
import { type FollowEvent, type FollowState, nextFollowState } from "./followState.ts";
import { GitBranchLabel, useGitInfo } from "./GitBranch.tsx";
import { useConversation } from "./useConversation.ts";
import { upsertConversation } from "./useConversationIndex.ts";
import { WorkingIndicator } from "./WorkingIndicator.tsx";
import { getFinalRunningActions } from "./workingLabel.ts";

type ConversationOptionsPatch = {
  mode?: Conversation["mode"];
  model?: Conversation["model"] | null;
  effort?: Conversation["effort"] | null;
  plan?: Conversation["plan"];
};

export function ConversationView({
  id,
  isActivePane,
  headerActions,
  dragHandleProps,
  openedAt,
}: {
  id: string;
  isActivePane: boolean;
  headerActions?: ReactNode;
  openedAt: number;
  dragHandleProps?: {
    draggable: boolean;
    onDragEnd: DragEventHandler<HTMLHeadingElement>;
    onDragStart: DragEventHandler<HTMLHeadingElement>;
    tabIndex: number;
  };
}) {
  const bridge = getBridge();
  const {
    conversation,
    messages,
    loading,
    error,
    liveText,
    responseFinishedId,
    addMessage,
    updateConversation,
  } = useConversation(id);
  const markSeenInFlight = useRef(false);
  const [draft, setDraft] = useState("");
  const [models, setModels] = useState<AgentModels | null>(null);
  const [activePopover, setActivePopover] = useState<ComposerPopoverName>(null);
  const [optimisticOptions, setOptimisticOptions] = useState<ConversationOptionsPatch>({});
  const [interactionError, setInteractionError] = useState("");
  const [announcement, setAnnouncement] = useState("");
  const [visibleMessageCount, setVisibleMessageCount] = useState(100);
  const [isResponding, setIsResponding] = useState(false);
  const [isStopping, setIsStopping] = useState(false);
  const [isSending, setIsSending] = useState(false);
  const [isRenamingTitle, setIsRenamingTitle] = useState(false);
  const [workingIndicatorPresence, setWorkingIndicatorPresence] = useState(() => ({
    conversationId: id,
    present: false,
  }));
  const [showSlowLoading, setShowSlowLoading] = useState(
    () => !conversation && loading && Date.now() - openedAt >= 300,
  );
  const [revealLoadedData, setRevealLoadedData] = useState(false);

  const markSeen = useCallback(async () => {
    if (
      !bridge ||
      document.visibilityState !== "visible" ||
      !conversation?.unreadAt ||
      markSeenInFlight.current
    ) {
      return;
    }

    markSeenInFlight.current = true;
    try {
      const result = await bridge.request("conversation.markSeen", { id });
      updateConversation(result.conversation);
      upsertConversation(result.conversation);
    } catch {
      // Um próximo foco ou retorno à aba pode tentar marcar a resposta como vista.
    } finally {
      markSeenInFlight.current = false;
    }
  }, [bridge, conversation?.unreadAt, id, updateConversation]);

  useEffect(() => {
    void markSeen();
    const updateOnVisibility = () => {
      if (document.visibilityState === "visible") void markSeen();
    };
    document.addEventListener("visibilitychange", updateOnVisibility);
    return () => document.removeEventListener("visibilitychange", updateOnVisibility);
  }, [markSeen]);

  useEffect(() => {
    if (isActivePane) void markSeen();
  }, [isActivePane, markSeen]);

  useEffect(() => {
    if (responseFinishedId) void markSeen();
  }, [markSeen, responseFinishedId]);
  const [titleDraft, setTitleDraft] = useState("");
  const [isSavingTitle, setIsSavingTitle] = useState(false);
  const previousConversationIdRef = useRef(id);
  const initiallyHadConversationRef = useRef(Boolean(conversation));
  const messageListRef = useRef<HTMLDivElement>(null);
  const bottomSentinelRef = useRef<HTMLDivElement>(null);
  const composerSectionRef = useRef<HTMLElement>(null);
  const titleHeadingRef = useRef<HTMLHeadingElement>(null);
  const titleInputRef = useRef<HTMLInputElement>(null);
  const scrollFrameRef = useRef<number | null>(null);
  const followRef = useRef<FollowState>("following");
  const previousScrollHeight = useRef(0);
  const restoreAfterOlder = useRef(false);
  const previousScrollVersion = useRef("");
  const optimisticOptionsRef = useRef<ConversationOptionsPatch>({});
  const saveQueueRef = useRef<Promise<void>>(Promise.resolve());
  const saveRevisionRef = useRef(0);
  const sendRevisionRef = useRef(0);
  const sendPendingRef = useRef(false);
  const activeConversationIdRef = useRef(id);
  const optimisticConversationIdRef = useRef(id);
  activeConversationIdRef.current = id;
  const agent = conversation?.agent;
  const currentModels =
    models?.agent === agent ? models : agent ? (getCachedAgentModels(agent) ?? null) : null;
  const visibleOptions = optimisticConversationIdRef.current === id ? optimisticOptions : {};
  const visibleConversation = conversation ? { ...conversation, ...visibleOptions } : null;
  const planMode = visibleConversation?.plan ?? false;

  useEffect(() => {
    if (!agent || !bridge) {
      setModels(null);
      return;
    }
    let mounted = true;
    void bridge
      .request("agent.models", { agent })
      .then((result) => {
        cacheAgentModels(result);
        if (mounted) setModels(result);
      })
      .catch(() => {
        if (mounted) {
          setModels(getCachedAgentModels(agent) ?? { agent, models: [], efforts: [] });
        }
      });
    return () => {
      mounted = false;
    };
  }, [agent, bridge]);

  useEffect(() => {
    if (!loading || conversation) {
      setShowSlowLoading(false);
      return;
    }
    const remaining = 300 - (Date.now() - openedAt);
    if (remaining <= 0) {
      setShowSlowLoading(true);
      return;
    }
    const timer = window.setTimeout(() => setShowSlowLoading(true), remaining);
    return () => window.clearTimeout(timer);
  }, [conversation, loading, openedAt]);

  useLayoutEffect(() => {
    if (!conversation || initiallyHadConversationRef.current) return;
    initiallyHadConversationRef.current = true;
    setRevealLoadedData(true);
    const timer = window.setTimeout(() => setRevealLoadedData(false), 120);
    return () => window.clearTimeout(timer);
  }, [conversation]);

  const orderedMessages = messages;
  const visibleMessages = orderedMessages.slice(-visibleMessageCount);
  const latestMessage = visibleMessages.at(-1);
  const streamingAgentMessage =
    latestMessage?.author === "agent" && latestMessage.status === "streaming"
      ? latestMessage
      : null;
  const workingLastPart = streamingAgentMessage?.parts.at(-1);
  const workingActions = useMemo(
    () => getFinalRunningActions(streamingAgentMessage?.parts ?? []),
    [streamingAgentMessage?.parts],
  );
  const latestPart = latestMessage?.parts.at(-1);
  const latestPartContent =
    latestPart?.type === "text"
      ? latestPart.markdown.length
      : latestPart?.type === "thinking"
        ? latestPart.text.length
        : latestPart?.type === "action"
          ? `${latestPart.state}:${latestPart.durationMs ?? ""}`
          : (latestPart?.id ?? "");
  const scrollVersion = `${latestMessage?.id ?? "empty"}:${latestPart?.id ?? ""}:${latestPartContent}:${visibleMessages.length}:${conversation?.state ?? "idle"}`;
  const isWorking = conversation?.state === "working";
  const isWaiting = conversation?.state === "waiting";
  const workingActive = isWorking || isStopping;
  const shouldShowWorkingIndicator =
    !isWaiting &&
    (workingActive ||
      (workingIndicatorPresence.conversationId === id && workingIndicatorPresence.present));
  const workingIndicatorProps = useMemo(
    () => ({
      active: workingActive,
      actions: workingActions,
      lastPart: workingLastPart,
      stopping: isStopping,
    }),
    [workingActive, workingActions, workingLastPart, isStopping],
  );
  const completeWorkingIndicatorExit = useCallback(() => {
    if (workingActive && !isWaiting) return;
    setWorkingIndicatorPresence((current) =>
      current.conversationId === id && current.present ? { ...current, present: false } : current,
    );
  }, [id, isWaiting, workingActive]);
  useEffect(() => {
    setWorkingIndicatorPresence((current) => {
      if (current.conversationId !== id) {
        return { conversationId: id, present: workingActive && !isWaiting };
      }
      if (isWaiting) return current.present ? { ...current, present: false } : current;
      return workingActive && !current.present ? { ...current, present: true } : current;
    });
  }, [id, isWaiting, workingActive]);
  const composerAttachments = useComposerAttachments(
    Boolean(conversation && bridge && !isWaiting && !isResponding && !isSending),
    id,
  );
  const { info: gitInfo, loading: gitInfoLoading } = useGitInfo(conversation?.cwd, id);
  useEffect(() => {
    if (previousConversationIdRef.current === id) return;
    previousConversationIdRef.current = id;
    followRef.current = "following";
    optimisticConversationIdRef.current = id;
    optimisticOptionsRef.current = {};
    setOptimisticOptions({});
    saveRevisionRef.current += 1;
    sendRevisionRef.current += 1;
    sendPendingRef.current = false;
    setIsSending(false);
    setDraft("");
    setInteractionError("");
    setActivePopover(null);
  }, [id]);

  useEffect(() => {
    if (conversation && !isRenamingTitle) setTitleDraft(conversation.title);
  }, [conversation, isRenamingTitle]);
  const lastTodos = useMemo(
    () => findLatestTodos(latestMessage?.status === "streaming" ? latestMessage : null),
    [latestMessage],
  );

  useEffect(
    () => () => {
      if (scrollFrameRef.current !== null) {
        window.cancelAnimationFrame(scrollFrameRef.current);
        scrollFrameRef.current = null;
      }
    },
    [],
  );

  // O texto digitado cresce entre um delta e outro. Enquanto o usuário está no fim,
  // acompanha a altura da última mensagem; se ele subiu, não mexe na rolagem.
  // Chamado a cada quadro do texto digitado (antes da pintura). Enquanto o
  // acompanhamento está ligado, sempre fixa no fim; não consulta o IntersectionObserver.
  const pinToBottom = useCallback(() => {
    const list = messageListRef.current;
    if (list && followRef.current === "following") list.scrollTop = list.scrollHeight;
  }, []);

  // Só a intenção explícita do usuário desliga o acompanhamento; a volta é decidida
  // pela rolagem até perto do fim (ver followState.ts).
  useEffect(() => {
    const list = messageListRef.current;
    if (!list) return;
    const follow = (event: FollowEvent) => {
      followRef.current = nextFollowState(followRef.current, event);
    };
    let lastScrollTop = list.scrollTop;
    let lastDistance = list.scrollHeight - list.scrollTop - list.clientHeight;
    let lastTouchY: number | null = null;
    let grabbingScrollbar = false;

    const onScroll = () => {
      // Arrastar a barra de rolagem para cima é intenção do usuário.
      if (grabbingScrollbar && list.scrollTop < lastScrollTop) follow({ type: "userScrollUp" });
      lastScrollTop = list.scrollTop;
      const distance = list.scrollHeight - list.scrollTop - list.clientHeight;
      follow({
        type: "scroll",
        distanceFromBottom: distance,
        previousDistanceFromBottom: lastDistance,
      });
      lastDistance = distance;
    };
    const onWheel = (event: WheelEvent) => {
      if (event.deltaY < 0) follow({ type: "userScrollUp" });
    };
    const onTouchStart = (event: TouchEvent) => {
      lastTouchY = event.touches[0]?.clientY ?? null;
    };
    const onTouchMove = (event: TouchEvent) => {
      const y = event.touches[0]?.clientY;
      if (y === undefined) return;
      // Dedo descendo = conteúdo subindo.
      if (lastTouchY !== null && y > lastTouchY) follow({ type: "userScrollUp" });
      lastTouchY = y;
    };
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "PageUp" || event.key === "ArrowUp" || event.key === "Home") {
        follow({ type: "userScrollUp" });
      }
    };
    const onPointerDown = (event: PointerEvent) => {
      const rect = list.getBoundingClientRect();
      grabbingScrollbar =
        event.target === list && event.clientX - rect.left >= list.clientWidth + list.clientLeft;
    };
    const releaseScrollbar = () => {
      grabbingScrollbar = false;
    };

    list.addEventListener("scroll", onScroll, { passive: true });
    list.addEventListener("wheel", onWheel, { passive: true });
    list.addEventListener("touchstart", onTouchStart, { passive: true });
    list.addEventListener("touchmove", onTouchMove, { passive: true });
    list.addEventListener("keydown", onKeyDown);
    list.addEventListener("pointerdown", onPointerDown);
    window.addEventListener("pointerup", releaseScrollbar);
    window.addEventListener("pointercancel", releaseScrollbar);
    return () => {
      list.removeEventListener("scroll", onScroll);
      list.removeEventListener("wheel", onWheel);
      list.removeEventListener("touchstart", onTouchStart);
      list.removeEventListener("touchmove", onTouchMove);
      list.removeEventListener("keydown", onKeyDown);
      list.removeEventListener("pointerdown", onPointerDown);
      window.removeEventListener("pointerup", releaseScrollbar);
      window.removeEventListener("pointercancel", releaseScrollbar);
    };
  }, []);

  // Rede de segurança para outros crescimentos (imagens, realce, blocos fechados).
  useEffect(() => {
    const list = messageListRef.current;
    const latestId = latestMessage?.id;
    if (!list || !latestId) return;
    const latestArticle = list.querySelector<HTMLElement>(
      `:scope > article[data-message-id="${CSS.escape(latestId)}"]`,
    );
    if (!latestArticle) return;
    const observer = new ResizeObserver(pinToBottom);
    observer.observe(latestArticle);
    return () => observer.disconnect();
  }, [latestMessage?.id, pinToBottom]);

  useEffect(() => {
    const list = messageListRef.current;
    if (!list) return;
    const contentChanged = previousScrollVersion.current !== scrollVersion;
    previousScrollVersion.current = scrollVersion;
    if (restoreAfterOlder.current) {
      const heightDifference = list.scrollHeight - previousScrollHeight.current;
      list.scrollTop += heightDifference;
      restoreAfterOlder.current = false;
    } else if (followRef.current === "following" && contentChanged) {
      if (scrollFrameRef.current !== null) {
        window.cancelAnimationFrame(scrollFrameRef.current);
      }
      scrollFrameRef.current = window.requestAnimationFrame(() => {
        scrollFrameRef.current = null;
        bottomSentinelRef.current?.scrollIntoView({ block: "end", inline: "nearest" });
      });
    }
  }, [scrollVersion]);

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
    async (
      textValue: string,
      files: ConversationAttachment[] = [],
      attachmentIds: string[] = [],
    ) => {
      const text = textValue.trim();
      if (
        !bridge ||
        !conversation ||
        (!text && files.length === 0) ||
        isWorking ||
        isWaiting ||
        isSending ||
        sendPendingRef.current
      )
        return;
      const conversationId = id;
      followRef.current = nextFollowState(followRef.current, { type: "newMessage" });
      const sendRevision = ++sendRevisionRef.current;
      sendPendingRef.current = true;
      setInteractionError("");
      setDraft("");
      try {
        let observedQueue: Promise<void>;
        do {
          observedQueue = saveQueueRef.current;
          await observedQueue;
        } while (observedQueue !== saveQueueRef.current);

        if (activeConversationIdRef.current !== conversationId) return;
        setIsSending(true);
        const result = await bridge.request("conversation.send", {
          id: conversationId,
          text: text || " ",
          ...(files.length ? { attachments: files } : {}),
        });
        if (activeConversationIdRef.current === conversationId) {
          addMessage(result.userMessage);
          addMessage(result.agentMessage);
          for (const attachmentId of attachmentIds) composerAttachments.remove(attachmentId);
        }
      } catch (sendError) {
        if (activeConversationIdRef.current === conversationId) {
          if (textValue) {
            setDraft((currentDraft) =>
              currentDraft ? `${textValue}\n\n${currentDraft}` : textValue,
            );
          }
          setInteractionError(
            sendError instanceof BridgeError && sendError.message
              ? sendError.message
              : t.chat.sendFailed,
          );
        }
      } finally {
        if (sendRevisionRef.current === sendRevision) {
          setIsSending(false);
          sendPendingRef.current = false;
        }
      }
    },
    [
      addMessage,
      bridge,
      composerAttachments.remove,
      conversation,
      id,
      isSending,
      isWaiting,
      isWorking,
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
    (
      options: ConversationOptionsPatch,
      rememberedSetting?: { key: string; value: string },
    ): Promise<void> => {
      if (!bridge || !conversation) return Promise.resolve();

      const conversationId = id;
      if (activeConversationIdRef.current !== conversationId) return Promise.resolve();
      const revision = ++saveRevisionRef.current;
      const nextOptimisticOptions = { ...optimisticOptionsRef.current, ...options };
      optimisticConversationIdRef.current = conversationId;
      optimisticOptionsRef.current = nextOptimisticOptions;
      setOptimisticOptions(nextOptimisticOptions);
      setInteractionError("");

      const queuedSave = saveQueueRef.current.then(async () => {
        let failureMessage: string = t.chat.optionsFailed;
        try {
          const result = await bridge.request("conversation.setOptions", {
            id: conversationId,
            options,
          });
          if (activeConversationIdRef.current === conversationId) {
            updateConversation(result.conversation);
          }
          upsertConversation(result.conversation);

          if (rememberedSetting) {
            failureMessage = t.chat.settingsSaveFailed;
            await bridge.request("settings.set", rememberedSetting);
          }

          if (
            activeConversationIdRef.current === conversationId &&
            revision === saveRevisionRef.current
          ) {
            optimisticOptionsRef.current = {};
            setOptimisticOptions({});
            setInteractionError("");
          }
        } catch (optionsError) {
          if (
            activeConversationIdRef.current === conversationId &&
            revision === saveRevisionRef.current
          ) {
            optimisticOptionsRef.current = {};
            setOptimisticOptions({});
          }
          if (activeConversationIdRef.current === conversationId) {
            setInteractionError(
              failureMessage === t.chat.optionsFailed &&
                optionsError instanceof BridgeError &&
                optionsError.message
                ? optionsError.message
                : failureMessage,
            );
          }
        }
      });

      saveQueueRef.current = queuedSave;
      return queuedSave;
    },
    [bridge, conversation, id, updateConversation],
  );

  const copyFolderPath = useCallback(async () => {
    if (!conversation) return;
    await copyText(conversation.cwd);
    setAnnouncement(t.chat.folderCopied);
  }, [conversation, copyText]);

  function beginTitleRename() {
    if (!conversation || isSavingTitle || isRenamingTitle) return;
    setTitleDraft(conversation.title);
    setIsRenamingTitle(true);
    requestAnimationFrame(() => {
      titleInputRef.current?.focus();
      titleInputRef.current?.select();
    });
  }

  function cancelTitleRename() {
    setTitleDraft(conversation?.title ?? "");
    setIsRenamingTitle(false);
    requestAnimationFrame(() => titleHeadingRef.current?.focus());
  }

  async function saveTitleRename() {
    const titleValue = titleDraft.trim();
    if (!bridge || !conversation || isSavingTitle) return;
    if (!titleValue) {
      setInteractionError(t.chat.titleRequired);
      titleInputRef.current?.focus();
      return;
    }
    setInteractionError("");
    setIsSavingTitle(true);
    try {
      const result = await bridge.request("conversation.rename", { id, title: titleValue });
      updateConversation(result.conversation);
      upsertConversation(result.conversation);
      setIsRenamingTitle(false);
      requestAnimationFrame(() => titleHeadingRef.current?.focus());
    } catch (renameError) {
      setInteractionError(
        renameError instanceof BridgeError && renameError.message
          ? renameError.message
          : t.chat.renameTitleFailed,
      );
    } finally {
      setIsSavingTitle(false);
    }
  }

  const title = conversation?.title ?? t.conversation.title;
  const homeTodos = isWorking ? lastTodos : null;
  const folderPath = useMemo(
    () => (conversation ? formatFolderPath(conversation.cwd) : null),
    [conversation],
  );
  const canAttachFiles = Boolean(
    conversation && bridge && !isWaiting && !isResponding && !isSending,
  );
  const changeEffort = useCallback(
    (value: AgentEffort | "") => {
      void saveOptions(
        { effort: value || null },
        value && conversation ? { key: effortSettingKey(conversation.agent), value } : undefined,
      );
    },
    [conversation, saveOptions],
  );
  const changeMode = useCallback(
    (value: NonNullable<Conversation["mode"]>) => void saveOptions({ mode: value }),
    [saveOptions],
  );
  const changeModel = useCallback(
    (value: string) => {
      const supportedEfforts = effortsForModel(currentModels, value);
      const currentEffort = visibleConversation?.effort;
      const clearEffort = currentEffort && !supportedEfforts.includes(currentEffort);
      void saveOptions(
        {
          model: value || null,
          ...(clearEffort ? { effort: null } : {}),
        },
        conversation ? { key: modelSettingKey(conversation.agent), value } : undefined,
      );
    },
    [conversation, currentModels, saveOptions, visibleConversation?.effort],
  );
  const changePlanMode = useCallback(
    (value: boolean) => void saveOptions({ plan: value }),
    [saveOptions],
  );
  const composerLeading = useMemo(
    () =>
      conversation ? (
        <div className={`${styles.composerControls} ${revealLoadedData ? styles.dataReveal : ""}`}>
          <AttachmentPicker disabled={!canAttachFiles} onFiles={composerAttachments.addFiles} />
          <span className={styles.agentTag}>
            <AgentIcon agentId={conversation.agent} />
            <span className={styles.agentName}>{agentDisplayName(conversation.agent)}</span>
          </span>
          <ComposerPreferences
            activePopover={activePopover}
            disabled={isWorking || isWaiting || isResponding || isSending || !bridge}
            effort={visibleConversation?.effort ?? ""}
            mode={visibleConversation?.mode ?? "edit"}
            model={visibleConversation?.model ?? null}
            models={currentModels}
            planMode={planMode}
            onActivePopoverChange={setActivePopover}
            onEffortChange={changeEffort}
            onModeChange={changeMode}
            onModelChange={changeModel}
            onPlanModeChange={changePlanMode}
          />
        </div>
      ) : (
        <ConversationLoadingControls />
      ),
    [
      bridge,
      activePopover,
      canAttachFiles,
      changeEffort,
      changeMode,
      changeModel,
      changePlanMode,
      composerAttachments.addFiles,
      conversation,
      isResponding,
      isSending,
      isWaiting,
      isWorking,
      currentModels,
      planMode,
      visibleConversation?.effort,
      visibleConversation?.mode,
      visibleConversation?.model,
      revealLoadedData,
    ],
  );
  const composerAttachmentsNode = useMemo(
    () => (
      <AttachmentChips
        attachments={composerAttachments.attachments}
        disabled={isSending}
        onRemove={composerAttachments.remove}
      />
    ),
    [composerAttachments.attachments, composerAttachments.remove, isSending],
  );
  const composerBelow = useMemo(
    () =>
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
            <span
              className={revealLoadedData ? styles.dataReveal : undefined}
              title={folderPath?.title}
            >
              {folderPath?.text}
            </span>
          </button>
          <span className={styles.branchSlot}>
            {gitInfo ? (
              <span className={revealLoadedData ? styles.dataReveal : undefined}>
                <GitBranchLabel info={gitInfo} />
              </span>
            ) : gitInfoLoading ? (
              <ConversationBranchPlaceholder />
            ) : null}
          </span>
        </div>
      ) : (
        <ConversationLoadingStrip />
      ),
    [conversation, copyFolderPath, folderPath, gitInfo, gitInfoLoading, revealLoadedData],
  );
  const composerStop = useCallback(() => void stopAgent(), [stopAgent]);
  const composerSubmit = useCallback(
    () =>
      void sendMessage(
        draft,
        composerAttachments.getRequestAttachments(),
        composerAttachments.attachments.map((attachment) => attachment.id),
      ),
    [
      composerAttachments.attachments,
      composerAttachments.getRequestAttachments,
      draft,
      sendMessage,
    ],
  );

  return (
    <section
      aria-label={title}
      className={styles.page}
      data-focus-context="conversation"
      onFocusCapture={() => void markSeen()}
      tabIndex={-1}
    >
      <header className={styles.header}>
        <h1
          {...dragHandleProps}
          aria-description={isRenamingTitle ? undefined : t.chat.renameTitleHint}
          aria-label={title}
          className={styles.title}
          data-pane-title=""
          draggable={Boolean(dragHandleProps?.draggable && !isRenamingTitle)}
          onDoubleClick={beginTitleRename}
          onKeyDown={(event) => {
            if (!isRenamingTitle && (event.key === "F2" || event.key === "Enter")) {
              event.preventDefault();
              beginTitleRename();
            }
          }}
          ref={titleHeadingRef}
          tabIndex={isRenamingTitle ? -1 : 0}
          title={isRenamingTitle ? undefined : t.chat.renameTitleHint}
        >
          {isRenamingTitle ? (
            <input
              aria-label={t.chat.renameTitleInput}
              className={styles.titleInput}
              disabled={isSavingTitle}
              maxLength={240}
              onChange={(event) => setTitleDraft(event.currentTarget.value)}
              onKeyDown={(event) => {
                event.stopPropagation();
                if (event.key === "Enter") {
                  event.preventDefault();
                  void saveTitleRename();
                } else if (event.key === "Escape") {
                  event.preventDefault();
                  cancelTitleRename();
                }
              }}
              ref={titleInputRef}
              value={titleDraft}
            />
          ) : (
            <span className={revealLoadedData ? styles.dataReveal : undefined}>{title}</span>
          )}
        </h1>
        {isRenamingTitle ? (
          <div className={styles.titleActions}>
            <IconButton
              disabled={isSavingTitle}
              icon={<Check aria-hidden="true" size={15} />}
              label={t.chat.saveTitle}
              onClick={() => void saveTitleRename()}
              size="sm"
            />
            <IconButton
              disabled={isSavingTitle}
              icon={<X aria-hidden="true" size={15} />}
              label={t.chat.cancelTitleRename}
              onClick={cancelTitleRename}
              size="sm"
            />
          </div>
        ) : null}
        {headerActions}
      </header>

      <FollowBottomContext value={pinToBottom}>
        <section
          aria-label={t.chat.messageList}
          className={`${styles.messageList} ${scrollAreaStyles.scrollArea}`}
          data-reveal={revealLoadedData ? "true" : undefined}
          ref={messageListRef}
        >
          {loading && !conversation && showSlowLoading ? (
            <p className={styles.loading}>{t.chat.loading}</p>
          ) : null}
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
              agent={conversation?.agent}
              cwd={conversation?.cwd ?? ""}
              onAnnounce={announce}
              onCopy={copyText}
              onEdit={editMessage}
              onRespond={respond}
              onRetry={retry}
              onWorkingIndicatorExit={
                message.author === "agent" &&
                message.id === latestMessage?.id &&
                shouldShowWorkingIndicator
                  ? completeWorkingIndicatorExit
                  : undefined
              }
              workingIndicator={
                message.author === "agent" &&
                message.id === latestMessage?.id &&
                shouldShowWorkingIndicator
                  ? workingIndicatorProps
                  : undefined
              }
            />
          ))}
          {latestMessage?.author !== "agent" && shouldShowWorkingIndicator ? (
            <div className={styles.workingFallback}>
              <WorkingIndicator
                {...workingIndicatorProps}
                onExitComplete={completeWorkingIndicatorExit}
              />
            </div>
          ) : null}
          <div aria-hidden="true" className={styles.bottomSentinel} ref={bottomSentinelRef} />
        </section>
      </FollowBottomContext>

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
        {composerAttachments.isPreparing ? (
          <p className={styles.progress} role="status">
            <span aria-hidden="true" className={styles.progressMark} />
            {t.chat.preparingAttachments}
          </p>
        ) : null}
        {composerAttachments.error ? (
          <p className={styles.error} role="alert">
            <TriangleAlert aria-hidden="true" size={16} />
            {composerAttachments.error}
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
          below={composerBelow}
          busy={isWorking}
          disabled={isWaiting || isResponding || isSending}
          leading={composerLeading}
          attachments={composerAttachmentsNode}
          onChange={setDraft}
          onDragEnter={composerAttachments.onDragEnter}
          onDragLeave={composerAttachments.onDragLeave}
          onDragOver={composerAttachments.onDragOver}
          onDrop={composerAttachments.onDrop}
          onPaste={composerAttachments.onPaste}
          onStop={composerStop}
          onSubmit={composerSubmit}
          placeholder={t.chat.messageInput}
          submitDisabled={
            !bridge ||
            !conversation ||
            loading ||
            composerAttachments.isPreparing ||
            (!draft.trim() && composerAttachments.attachments.length === 0) ||
            isWaiting ||
            isSending
          }
          submitLabel={isWorking ? t.chat.stop : t.chat.send}
          dragActive={composerAttachments.isDragging}
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
