import type {
  AgentCapabilities,
  ComposerSkill,
  Conversation,
  ConversationAttachment,
  ConversationMessage,
  ResultOf,
} from "@karont/contract";
import { BridgeError } from "@karont/contract";
import { Check, Folder, TriangleAlert, X } from "lucide-react";
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
import { Composer, type ComposerAutocompleteOption } from "../components/Composer/Composer.tsx";
import { IconButton } from "../components/IconButton/IconButton.tsx";
import { Tooltip } from "../components/Tooltip/Tooltip.tsx";
import { t } from "../i18n/pt-BR.ts";
import { useNavigation } from "../navigation/NavigationContext.tsx";
import { MOTION_MS } from "../styles/motion.ts";
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
  fastSettingKey,
  modelSettingKey,
} from "./ComposerPreferences.tsx";
import { ConversationContextUsageControl } from "./ConversationContextUsage.tsx";
import { ConversationHistory } from "./ConversationHistory.tsx";
import {
  ConversationBranchPlaceholder,
  ConversationLoadingControls,
  ConversationLoadingStrip,
} from "./ConversationLoadingFrame.tsx";
import { ConversationMessageList } from "./ConversationMessageList.tsx";
import { type ResponseInput, TodosPart } from "./ConversationParts.tsx";
import styles from "./ConversationView.module.css";
import {
  type ComposerShortcutTrigger,
  consumePendingComposerCaret,
  detectComposerShortcut,
  findMentionedSkills,
  fuzzyFilter,
  hasSkillMention,
  insertComposerShortcut,
  removeComposerCommand,
  requestSkillCatalogOnce,
  type SkillCatalogRequestState,
} from "./composerShortcuts.ts";
import { cacheAgentModels, getCachedAgentModels } from "./conversationCache.ts";
import { getConversationHistory } from "./conversationHistory.ts";
import { formatFolderPath } from "./displayText.ts";
import { FollowBottomContext } from "./followBottom.ts";
import { FollowScroller } from "./followScroll.ts";
import { type FollowEvent, type FollowState, nextFollowState } from "./followState.ts";
import { GitBranchLabel, useGitInfo } from "./GitBranch.tsx";
import {
  INITIAL_MESSAGE_WINDOW_SIZE,
  isWithinOlderMessageLoadMargin,
  MESSAGE_WINDOW_INCREMENT,
  messageWindowSizeForTarget,
  nextMessageWindowSize,
  OLDER_MESSAGE_LOAD_ROOT_MARGIN_PX,
  olderMessageCursor,
} from "./messageWindow.ts";
import { queueLabel } from "./queueLabel.ts";
import { RestoreChangesPanel } from "./RestoreChangesPanel.tsx";
import { closeRestorePanel, setRestoreBusy, useRestorePanelMessage } from "./restorePanelStore.ts";
import { useConversation } from "./useConversation.ts";
import { upsertConversation } from "./useConversationIndex.ts";
import { useQueueStatus } from "./useQueueStatus.ts";
import { WorktreeStrip } from "./WorktreeStrip.tsx";
import { getFinalRunningActions } from "./workingLabel.ts";

type ComposerFile = ResultOf<"composer.files">["files"][number];

type ConversationOptionsPatch = {
  mode?: Conversation["mode"];
  model?: Conversation["model"] | null;
  effort?: Conversation["effort"] | null;
  fast?: Conversation["fast"];
  plan?: Conversation["plan"];
};

export function ConversationView({
  id,
  conversationSummary = null,
  isActivePane,
  headerActions,
  dragHandleProps,
  openedAt,
}: {
  id: string;
  conversationSummary?: Conversation | null;
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
  const { navigate, openConversationBeside } = useNavigation();
  const {
    conversation: retainedConversation,
    contextUsage,
    messages,
    hasOlderMessages,
    loading,
    error,
    liveText,
    responseFinishedId,
    addMessage,
    updateConversation,
    fetchOlderMessages,
    fetchAllOlderMessages,
  } = useConversation(id);
  const currentConversation = retainedConversation?.id === id ? retainedConversation : null;
  const conversation = currentConversation ?? conversationSummary;
  const showingPreviousConversation = Boolean(
    retainedConversation && retainedConversation.id !== id,
  );
  const activeConversationIdRef = useRef(id);
  activeConversationIdRef.current = id;
  const markSeenInFlight = useRef(false);
  const [draftState, setDraftState] = useState({ conversationId: id, value: "" });
  const draft = draftState.conversationId === id ? draftState.value : "";
  const setDraft = useCallback(
    (value: string | ((currentDraft: string) => string)) => {
      setDraftState((current) => {
        if (activeConversationIdRef.current !== id) return current;
        const currentDraft = current.conversationId === id ? current.value : "";
        return {
          conversationId: id,
          value: typeof value === "function" ? value(currentDraft) : value,
        };
      });
    },
    [id],
  );
  const [models, setModels] = useState<AgentModels | null>(null);
  const [activePopoverState, setActivePopoverState] = useState<{
    conversationId: string;
    value: ComposerPopoverName;
  }>({ conversationId: id, value: null });
  const activePopover = activePopoverState.conversationId === id ? activePopoverState.value : null;
  const setActivePopover = useCallback(
    (value: ComposerPopoverName) => {
      if (activeConversationIdRef.current === id) {
        setActivePopoverState({ conversationId: id, value });
      }
    },
    [id],
  );
  const [caretRequest, setCaretRequest] = useState(0);
  const [capabilities, setCapabilities] = useState<AgentCapabilities | null>(null);
  const [capabilitiesLoading, setCapabilitiesLoading] = useState(false);
  const [shortcutTrigger, setShortcutTrigger] = useState<ComposerShortcutTrigger | null>(null);
  const [activeShortcutIndex, setActiveShortcutIndex] = useState(0);
  const [fileSuggestions, setFileSuggestions] = useState<ComposerFile[]>([]);
  const [filesLoading, setFilesLoading] = useState(false);
  const [skillCatalog, setSkillCatalog] = useState<ComposerSkill[]>([]);
  const [skillsLoading, setSkillsLoading] = useState(false);
  const skillCatalogRequestRef = useRef<SkillCatalogRequestState<ComposerSkill> | null>(null);
  const requestSkillCatalog = useCallback(
    () =>
      requestSkillCatalogOnce(skillCatalogRequestRef, id, () =>
        bridge
          ? bridge
              .request("composer.skills", { conversationId: id })
              .then((result) => result.skills)
          : Promise.resolve([]),
      ),
    [bridge, id],
  );
  const [optimisticOptions, setOptimisticOptions] = useState<ConversationOptionsPatch>({});
  const [interactionErrorState, setInteractionErrorState] = useState({
    conversationId: id,
    value: "",
  });
  const interactionError =
    interactionErrorState.conversationId === id ? interactionErrorState.value : "";
  const setInteractionError = useCallback(
    (value: string) => {
      if (activeConversationIdRef.current === id) {
        setInteractionErrorState({ conversationId: id, value });
      }
    },
    [id],
  );
  const [announcement, setAnnouncement] = useState("");
  const [pendingHistoryMessageId, setPendingHistoryMessageId] = useState<string | null>(null);
  const [highlightedMessageId, setHighlightedMessageId] = useState<string | null>(null);
  const [visibleMessageCount, setVisibleMessageCount] = useState(INITIAL_MESSAGE_WINDOW_SIZE);
  const [olderPageVersion, setOlderPageVersion] = useState(0);
  const visibleMessageCountRef = useRef(visibleMessageCount);
  visibleMessageCountRef.current = visibleMessageCount;
  const [isResponding, setIsResponding] = useConversationScopedFlag(id);
  const [isStopping, setIsStopping] = useConversationScopedFlag(id);
  const [isSending, setIsSending] = useConversationScopedFlag(id);
  const [renamingConversationId, setRenamingConversationId] = useState<string | null>(null);
  const isRenamingTitle = renamingConversationId === id;
  const [isCompacting, setIsCompacting] = useConversationScopedFlag(id);
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
      loading ||
      !currentConversation?.unreadAt ||
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
  }, [bridge, currentConversation?.unreadAt, id, loading, updateConversation]);

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
  const [isSavingTitle, setIsSavingTitle] = useConversationScopedFlag(id);
  const previousConversationIdRef = useRef(id);
  const initiallyHadConversationRef = useRef(Boolean(currentConversation ?? conversationSummary));
  const messageRegionRef = useRef<HTMLDivElement>(null);
  const messageListRef = useRef<HTMLDivElement>(null);
  const olderMessagesSentinelRef = useRef<HTMLDivElement>(null);
  const olderMessagesObserverRef = useRef<IntersectionObserver | null>(null);
  const bottomSentinelRef = useRef<HTMLDivElement>(null);
  const composerSectionRef = useRef<HTMLElement>(null);
  const pendingComposerCaretRef = useRef<number | null>(null);
  const titleHeadingRef = useRef<HTMLHeadingElement>(null);
  const titleInputRef = useRef<HTMLInputElement>(null);
  const historyHighlightTimerRef = useRef<number | null>(null);
  const followScrollerRef = useRef<FollowScroller | null>(null);
  const followRef = useRef<FollowState>("following");
  const [followState, setFollowState] = useState<FollowState>("following");
  const olderMessageLoadInFlight = useRef(false);
  const previousScrollVersion = useRef("");
  const previousOlderPageVersion = useRef(olderPageVersion);
  const reobservedOlderPageVersion = useRef(olderPageVersion);
  const optimisticOptionsRef = useRef<ConversationOptionsPatch>({});
  const saveQueueRef = useRef<Promise<void>>(Promise.resolve());
  const saveRevisionRef = useRef(0);
  const sendRevisionRef = useRef(0);
  const sendPendingRef = useRef(false);
  const optimisticConversationIdRef = useRef(id);
  const updateFollowState = useCallback((state: FollowState) => {
    if (followRef.current === state) return;
    followRef.current = state;
    setFollowState(state);
  }, []);
  const agent = conversation?.agent;
  const currentModels =
    models?.agent === agent ? models : agent ? (getCachedAgentModels(agent) ?? null) : null;
  const visibleOptions = optimisticConversationIdRef.current === id ? optimisticOptions : {};
  const visibleConversation = conversation ? { ...conversation, ...visibleOptions } : null;
  const planMode = visibleConversation?.plan ?? false;

  useEffect(() => {
    if (!agent || !bridge) {
      setCapabilities(null);
      setCapabilitiesLoading(false);
      setSkillCatalog([]);
      return;
    }
    let mounted = true;
    setCapabilities(null);
    setCapabilitiesLoading(true);
    setSkillCatalog([]);
    void bridge
      .request("agent.capabilities", { agent })
      .then((result) => {
        if (mounted) {
          setCapabilities(result.capabilities);
          setCapabilitiesLoading(false);
        }
      })
      .catch(() => {
        if (mounted) {
          setCapabilities(null);
          setCapabilitiesLoading(false);
        }
      });
    return () => {
      mounted = false;
    };
  }, [agent, bridge]);

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
    const timer = window.setTimeout(() => setRevealLoadedData(false), MOTION_MS.fast);
    return () => window.clearTimeout(timer);
  }, [conversation]);

  const orderedMessages = messages;
  const orderedMessagesRef = useRef(orderedMessages);
  orderedMessagesRef.current = orderedMessages;
  const visibleMessages = useMemo(
    () => orderedMessages.slice(-visibleMessageCount),
    [orderedMessages, visibleMessageCount],
  );
  const userMessageCount = useMemo(
    () => orderedMessages.reduce((count, message) => count + Number(message.author === "user"), 0),
    [orderedMessages],
  );
  const hasLoadedOlderMessages = visibleMessages.length < orderedMessages.length;
  const canLoadOlderMessages = !loading && (hasLoadedOlderMessages || hasOlderMessages);
  const canLoadOlderMessagesRef = useRef(canLoadOlderMessages);
  canLoadOlderMessagesRef.current = canLoadOlderMessages;
  const hasOlderMessagesRef = useRef(hasOlderMessages);
  hasOlderMessagesRef.current = hasOlderMessages;
  const historyOpen = activePopover === "history";
  const historyEntries = useMemo(
    () => (historyOpen ? getConversationHistory(orderedMessages) : []),
    [historyOpen, orderedMessages],
  );
  const fileQuery = shortcutTrigger?.type === "file" ? shortcutTrigger.query : null;
  const skillsShortcutOpen = shortcutTrigger?.type === "skill";
  const shortcutLabels = t.chat.shortcutSuggestions;
  const shortcutCommands = useMemo(
    () =>
      (
        [
          ["compact", shortcutLabels.commandsByName.compact],
          ["plan", shortcutLabels.commandsByName.plan],
          ["model", shortcutLabels.commandsByName.model],
          ["effort", shortcutLabels.commandsByName.effort],
          ["access", shortcutLabels.commandsByName.access],
          ["new", shortcutLabels.commandsByName.new],
          ["rename", shortcutLabels.commandsByName.rename],
        ] as const
      )
        .filter(([command]) => command !== "compact" || capabilities?.compact === true)
        .map(([command, value]) => ({
          command,
          id: `command:${command}`,
          type: "command" as const,
          primary: value,
          secondary: shortcutLabels.commandDescriptions[command],
        })),
    [capabilities?.compact, shortcutLabels],
  );
  const shortcutOptions = useMemo<ComposerAutocompleteOption[]>(() => {
    if (!shortcutTrigger) return [];
    if (shortcutTrigger.type === "file") {
      return fileSuggestions.map((file) => {
        const directory = file.path.slice(0, Math.max(0, file.path.length - file.name.length));
        return {
          id: `file:${file.path}`,
          type: "file",
          primary: file.name,
          secondary: directory,
          detail: file.path,
        };
      });
    }
    if (shortcutTrigger.type === "skill") {
      return fuzzyFilter(
        skillCatalog,
        shortcutTrigger.query,
        (skill) => `${skill.name} ${skill.description}`,
      ).map((skill) => ({
        id: `skill:${skill.name}`,
        type: "skill",
        primary: `$${skill.name}`,
        secondary: skill.description,
      }));
    }
    return fuzzyFilter(
      shortcutCommands,
      shortcutTrigger.query,
      (command) => `${command.primary} ${command.secondary}`,
    );
  }, [fileSuggestions, shortcutCommands, shortcutTrigger, skillCatalog]);
  const shortcutLoading =
    shortcutTrigger?.type === "file"
      ? filesLoading
      : shortcutTrigger?.type === "skill"
        ? skillsLoading || (capabilitiesLoading && capabilities === null)
        : false;

  useEffect(() => {
    if (
      !capabilitiesLoading &&
      capabilities?.skills !== true &&
      shortcutTrigger?.type === "skill"
    ) {
      setShortcutTrigger(null);
    }
  }, [capabilities?.skills, capabilitiesLoading, shortcutTrigger?.type]);

  useEffect(() => {
    if (fileQuery === null || !bridge || conversation?.id !== id) {
      setFileSuggestions([]);
      setFilesLoading(false);
      return;
    }
    let active = true;
    setFilesLoading(true);
    const timer = window.setTimeout(() => {
      void bridge
        .request("composer.files", { conversationId: id, query: fileQuery })
        .then((result) => {
          if (active) setFileSuggestions(result.files.slice(0, 50));
        })
        .catch(() => {
          if (active) setFileSuggestions([]);
        })
        .finally(() => {
          if (active) setFilesLoading(false);
        });
    }, 80);
    return () => {
      active = false;
      window.clearTimeout(timer);
    };
  }, [bridge, conversation?.id, fileQuery, id]);

  useEffect(() => {
    if (
      !skillsShortcutOpen ||
      capabilities?.skills !== true ||
      !bridge ||
      conversation?.id !== id
    ) {
      if (!skillsShortcutOpen) setSkillsLoading(false);
      return;
    }
    let active = true;
    setSkillsLoading(true);
    void requestSkillCatalog()
      .then((skills) => {
        if (!active) return;
        setSkillCatalog([...skills]);
        setSkillsLoading(false);
      })
      .catch(() => {
        if (!active) return;
        setSkillCatalog([]);
        setSkillsLoading(false);
      });
    return () => {
      active = false;
    };
  }, [bridge, capabilities?.skills, conversation?.id, id, requestSkillCatalog, skillsShortcutOpen]);

  const latestMessage = visibleMessages.at(-1);
  const latestAgentMessageId = useMemo(
    () => orderedMessages.findLast((message) => message.author === "agent")?.id,
    [orderedMessages],
  );
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
  const setHistoryOpen = useCallback(
    (open: boolean) => {
      setActivePopover(open ? "history" : null);
    },
    [setActivePopover],
  );

  useEffect(() => {
    if (!historyOpen || !hasOlderMessages) return;
    void fetchAllOlderMessages().then((loadedCount) => {
      if (loadedCount === null) setInteractionError(t.chat.loadFailed);
    });
  }, [fetchAllOlderMessages, hasOlderMessages, historyOpen, setInteractionError]);

  const navigateToHistoryMessage = useCallback(
    (messageId: string) => {
      const currentMessages = orderedMessagesRef.current;
      const messageIndex = currentMessages.findIndex((message) => message.id === messageId);
      if (messageIndex < 0) return;

      updateFollowState("free");
      followScrollerRef.current?.stop();
      setPendingHistoryMessageId(messageId);
      setVisibleMessageCount((count) =>
        messageWindowSizeForTarget(currentMessages, count, messageId),
      );
    },
    [updateFollowState],
  );
  useLayoutEffect(() => {
    if (!pendingHistoryMessageId) return;
    const list = messageListRef.current;
    if (!list) return;
    const target = Array.from(
      list.querySelectorAll<HTMLElement>(":scope > article[data-message-id]"),
    ).find((element) => element.dataset.messageId === pendingHistoryMessageId);
    if (!target) return;

    setPendingHistoryMessageId(null);
    setHighlightedMessageId(pendingHistoryMessageId);
    if (historyHighlightTimerRef.current !== null) {
      window.clearTimeout(historyHighlightTimerRef.current);
    }
    historyHighlightTimerRef.current = window.setTimeout(() => {
      setHighlightedMessageId(null);
      historyHighlightTimerRef.current = null;
    }, 1200);

    const listRect = list.getBoundingClientRect();
    const targetRect = target.getBoundingClientRect();
    const paddingTop = Number.parseFloat(window.getComputedStyle(list).paddingTop) || 0;
    const previousNavigationSpace =
      Number.parseFloat(list.style.getPropertyValue("--history-navigation-space")) || 0;
    const targetScrollTop = Math.max(
      0,
      list.scrollTop + targetRect.top - listRect.top - paddingTop,
    );
    const contentEnd = list.scrollHeight - list.clientHeight - previousNavigationSpace;
    const navigationSpace = Math.max(0, targetScrollTop - contentEnd);
    list.style.setProperty("--history-navigation-space", `${navigationSpace}px`);
    const reducedMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    list.scrollTo({ behavior: reducedMotion ? "auto" : "smooth", top: targetScrollTop });
  }, [pendingHistoryMessageId]);

  useEffect(
    () => () => {
      if (historyHighlightTimerRef.current !== null) {
        window.clearTimeout(historyHighlightTimerRef.current);
      }
    },
    [],
  );

  const loadOlderMessages = useCallback(async () => {
    const list = messageListRef.current;
    if (!list || olderMessageLoadInFlight.current) return;
    olderMessageLoadInFlight.current = true;
    if (visibleMessageCountRef.current < orderedMessagesRef.current.length) {
      setVisibleMessageCount((count) =>
        nextMessageWindowSize(count, orderedMessagesRef.current.length, MESSAGE_WINDOW_INCREMENT),
      );
      setOlderPageVersion((version) => version + 1);
      return;
    }
    const before = olderMessageCursor(orderedMessagesRef.current, hasOlderMessagesRef.current);
    if (!before) {
      olderMessageLoadInFlight.current = false;
      return;
    }
    const loadedCount = await fetchOlderMessages(before);
    if (loadedCount === null) {
      olderMessageLoadInFlight.current = false;
      setInteractionError(t.chat.loadFailed);
      return;
    }
    if (loadedCount > 0) {
      setVisibleMessageCount((count) => count + loadedCount);
      setOlderPageVersion((version) => version + 1);
      return;
    }
    olderMessageLoadInFlight.current = false;
  }, [fetchOlderMessages, setInteractionError]);

  useEffect(() => {
    const list = messageListRef.current;
    const sentinel = olderMessagesSentinelRef.current;
    if (
      !list ||
      !sentinel ||
      !canLoadOlderMessages ||
      typeof IntersectionObserver === "undefined"
    ) {
      return;
    }
    const observer = new IntersectionObserver(
      (entries) => {
        if (followRef.current === "free" && entries.some((entry) => entry.isIntersecting)) {
          loadOlderMessages();
        }
      },
      { root: list, rootMargin: `${OLDER_MESSAGE_LOAD_ROOT_MARGIN_PX}px 0px 0px 0px` },
    );
    olderMessagesObserverRef.current = observer;
    observer.observe(sentinel);
    return () => {
      observer.disconnect();
      if (olderMessagesObserverRef.current === observer) {
        olderMessagesObserverRef.current = null;
      }
    };
  }, [canLoadOlderMessages, loadOlderMessages]);

  useEffect(() => {
    if (reobservedOlderPageVersion.current === olderPageVersion) return;
    reobservedOlderPageVersion.current = olderPageVersion;
    const observer = olderMessagesObserverRef.current;
    const sentinel = olderMessagesSentinelRef.current;
    if (observer && sentinel) {
      observer.unobserve(sentinel);
      observer.observe(sentinel);
    }
    const frame = window.requestAnimationFrame(() => {
      const list = messageListRef.current;
      const currentSentinel = olderMessagesSentinelRef.current;
      if (
        !list ||
        !currentSentinel ||
        !canLoadOlderMessages ||
        followRef.current !== "free" ||
        !isWithinOlderMessageLoadMargin(
          currentSentinel.getBoundingClientRect(),
          list.getBoundingClientRect(),
        )
      ) {
        return;
      }
      loadOlderMessages();
    });
    return () => window.cancelAnimationFrame(frame);
  }, [canLoadOlderMessages, loadOlderMessages, olderPageVersion]);
  const isWorking = conversation?.state === "working";
  // Na fila o agente ainda não começou: não é "trabalhando", mas bloqueia o mesmo que ele.
  const isQueued = conversation?.state === "queued";
  const isWaiting = conversation?.state === "waiting";
  const queueStatus = useQueueStatus().status;
  const queuedLabel = isQueued ? queueLabel(queueStatus, id) : null;
  const adjustQueueLimit = useCallback(() => {
    navigate({ name: "settings", section: "general" });
  }, [navigate]);
  const restorePanelMessageId = useRestorePanelMessage(id);
  const restoreBusy = isWorking || isQueued || isWaiting;
  useEffect(() => {
    setRestoreBusy(id, restoreBusy);
    return () => setRestoreBusy(id, false);
  }, [id, restoreBusy]);
  const closeRestoreChanges = useCallback(() => {
    const messageId = restorePanelMessageId;
    closeRestorePanel(id);
    if (!messageId) return;
    // O botão "Ver mudanças" que abriu o painel recebe o foco de volta.
    window.requestAnimationFrame(() => {
      messageRegionRef.current
        ?.querySelector<HTMLElement>(`[data-restore-changes-for="${CSS.escape(messageId)}"]`)
        ?.focus({ preventScroll: true });
    });
  }, [id, restorePanelMessageId]);
  const workingActive = isWorking || (isStopping && !isQueued);
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
    Boolean(currentConversation && bridge && !loading && !isWaiting && !isResponding && !isSending),
    id,
  );
  const { info: gitInfo, loading: gitInfoLoading } = useGitInfo(conversation?.cwd, id);
  useEffect(() => {
    if (previousConversationIdRef.current === id) return;
    const previousConversationId = previousConversationIdRef.current;
    previousConversationIdRef.current = id;
    updateFollowState("following");
    optimisticConversationIdRef.current = id;
    optimisticOptionsRef.current = {};
    setOptimisticOptions({});
    saveRevisionRef.current += 1;
    sendRevisionRef.current += 1;
    sendPendingRef.current = false;
    setIsSending(false, previousConversationId);
    setDraft("");
    setShortcutTrigger(null);
    setFileSuggestions([]);
    setSkillCatalog([]);
    if (skillCatalogRequestRef.current?.conversationId === previousConversationId) {
      skillCatalogRequestRef.current = null;
    }
    setInteractionError("");
    setRenamingConversationId(null);
    setPendingHistoryMessageId(null);
    setHighlightedMessageId(null);
    setVisibleMessageCount(INITIAL_MESSAGE_WINDOW_SIZE);
    olderMessageLoadInFlight.current = false;
    if (historyHighlightTimerRef.current !== null) {
      window.clearTimeout(historyHighlightTimerRef.current);
      historyHighlightTimerRef.current = null;
    }
    messageListRef.current?.style.removeProperty("--history-navigation-space");
    setActivePopover(null);
  }, [id, setDraft, updateFollowState, setActivePopover, setInteractionError, setIsSending]);

  useEffect(() => {
    if (conversation && !isRenamingTitle) setTitleDraft(conversation.title);
  }, [conversation, isRenamingTitle]);
  const lastTodos = useMemo(
    () => findLatestTodos(latestMessage?.status === "streaming" ? latestMessage : null),
    [latestMessage],
  );

  // O texto digitado cresce entre um delta e outro. Enquanto o usuário está no fim,
  // acompanha a altura da última mensagem; se ele subiu, não mexe na rolagem.
  // Chamado a cada quadro do texto digitado (antes da pintura). Enquanto o
  // acompanhamento está ligado, sempre fixa no fim; não consulta o IntersectionObserver.
  const pinToBottom = useCallback(() => {
    followScrollerRef.current?.kick();
  }, []);

  // Só a intenção explícita do usuário desliga o acompanhamento; a volta é decidida
  // pela rolagem até perto do fim (ver followState.ts).
  useEffect(() => {
    const list = messageListRef.current;
    if (!list) return;
    const scroller = new FollowScroller(list, () => followRef.current === "following");
    followScrollerRef.current = scroller;
    const follow = (event: FollowEvent) => {
      const before = followRef.current;
      updateFollowState(nextFollowState(before, event));
      // Rolar para cima para a mola na hora.
      if (before === "following" && followRef.current === "free") scroller.stop();
    };
    let lastScrollTop = list.scrollTop;
    let lastDistance = list.scrollHeight - lastScrollTop - list.clientHeight;
    let lastTouchY: number | null = null;
    let grabbingScrollbar = false;
    let scrollFrame: number | null = null;
    let scrollbarDragScrollPending = false;
    const processScroll = () => {
      scrollFrame = null;
      const scrollTop = list.scrollTop;
      // Arrastar a barra de rolagem para cima é intenção do usuário.
      if (scrollbarDragScrollPending && scrollTop < lastScrollTop) {
        follow({ type: "userScrollUp" });
      }
      scrollbarDragScrollPending = false;
      lastScrollTop = scrollTop;
      const distance = list.scrollHeight - scrollTop - list.clientHeight;
      follow({
        type: "scroll",
        distanceFromBottom: distance,
        previousDistanceFromBottom: lastDistance,
      });
      lastDistance = distance;
    };
    const onScroll = () => {
      if (grabbingScrollbar) scrollbarDragScrollPending = true;
      if (scrollFrame !== null) return;
      scrollFrame = window.requestAnimationFrame(processScroll);
    };
    const onWheel = (event: WheelEvent) => {
      if (event.deltaY < 0) {
        follow({ type: "userScrollUp" });
        if (list.scrollTop <= 0 && canLoadOlderMessagesRef.current) {
          loadOlderMessages();
        }
      }
    };
    const onTouchStart = (event: TouchEvent) => {
      lastTouchY = event.touches[0]?.clientY ?? null;
    };
    const onTouchMove = (event: TouchEvent) => {
      const y = event.touches[0]?.clientY;
      if (y === undefined) return;
      // Dedo descendo = conteúdo subindo.
      if (lastTouchY !== null && y > lastTouchY) {
        follow({ type: "userScrollUp" });
      }
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
      if (scrollFrame !== null) window.cancelAnimationFrame(scrollFrame);
      scroller.dispose();
      followScrollerRef.current = null;
    };
  }, [loadOlderMessages, updateFollowState]);

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

  useLayoutEffect(() => {
    const list = messageListRef.current;
    if (!list) return;
    const contentChanged = previousScrollVersion.current !== scrollVersion;
    previousScrollVersion.current = scrollVersion;
    const olderPageCommitted = previousOlderPageVersion.current !== olderPageVersion;
    previousOlderPageVersion.current = olderPageVersion;
    if (olderPageCommitted) {
      olderMessageLoadInFlight.current = false;
    }
    if (followRef.current === "following" && contentChanged) {
      followScrollerRef.current?.kick();
    }
  }, [olderPageVersion, scrollVersion]);

  useLayoutEffect(() => {
    if (caretRequest === 0) return;
    const textarea = composerSectionRef.current?.querySelector("textarea");
    if (!textarea) return;
    const caret = consumePendingComposerCaret(pendingComposerCaretRef);
    if (caret === null) return;
    textarea.focus();
    textarea.setSelectionRange(caret, caret);
  }, [caretRequest]);

  const announce = useCallback((text: string) => setAnnouncement(text), []);

  const copyText = useCallback(
    async (text: string) => {
      try {
        await navigator.clipboard.writeText(text);
        announce(t.chat.copied);
        return true;
      } catch {
        setInteractionError(t.chat.copyFailed);
        return false;
      }
    },
    [announce, setInteractionError],
  );

  const editMessage = useCallback(
    (text: string) => {
      setDraft(text);
      requestAnimationFrame(() => {
        composerSectionRef.current?.querySelector("textarea")?.focus();
      });
    },
    [setDraft],
  );

  const updateShortcutAtCaret = useCallback(
    (value: string, caret: number) => {
      const supportsSkills = capabilitiesLoading || capabilities?.skills === true;
      const next = detectComposerShortcut(value, caret, supportsSkills);
      const isSame =
        shortcutTrigger?.type === next?.type &&
        shortcutTrigger?.start === next?.start &&
        shortcutTrigger?.caret === next?.caret &&
        shortcutTrigger?.tokenEnd === next?.tokenEnd &&
        shortcutTrigger?.query === next?.query;
      if (!isSame) {
        setActiveShortcutIndex(0);
        setShortcutTrigger(next);
      }
    },
    [capabilities?.skills, capabilitiesLoading, shortcutTrigger],
  );

  const closeShortcutSuggestions = useCallback(() => setShortcutTrigger(null), []);

  const compactConversation = useCallback(() => {
    if (!bridge || isCompacting) return;
    setIsCompacting(true);
    void bridge
      .request("conversation.compact", { id })
      .catch((compactError) => {
        setInteractionError(
          compactError instanceof BridgeError && compactError.message
            ? compactError.message
            : t.chat.compactFailed,
        );
      })
      .finally(() => setIsCompacting(false));
  }, [bridge, id, isCompacting, setInteractionError, setIsCompacting]);

  function applyShortcutText(value: string, caret: number) {
    pendingComposerCaretRef.current = caret;
    setCaretRequest((current) => current + 1);
    setDraft(value);
    setShortcutTrigger(null);
  }

  function selectComposerSuggestion(option: ComposerAutocompleteOption) {
    if (!shortcutTrigger) return;
    if (shortcutTrigger.type === "file" && option.type === "file" && option.detail) {
      const result = insertComposerShortcut(draft, shortcutTrigger, `@${option.detail} `);
      applyShortcutText(result.value, result.caret);
      return;
    }
    if (shortcutTrigger.type === "skill" && option.type === "skill") {
      const skill = skillCatalog.find((entry) => option.id === `skill:${entry.name}`);
      if (!skill) return;
      const result = insertComposerShortcut(draft, shortcutTrigger, `$${skill.name} `);
      applyShortcutText(result.value, result.caret);
      return;
    }
    if (shortcutTrigger.type !== "command" || option.type !== "command") return;
    const command = shortcutCommands.find((entry) => entry.id === option.id)?.command;
    if (!command) return;
    const result = removeComposerCommand(draft, shortcutTrigger);
    applyShortcutText(result.value, result.caret);

    if (command === "compact") {
      compactConversation();
    } else if (command === "plan") {
      void saveOptions({ plan: !(visibleConversation?.plan ?? false) });
    } else if (command === "model") {
      setActivePopover("model");
    } else if (command === "effort") {
      setActivePopover("effort");
    } else if (command === "access") {
      setActivePopover("config");
    } else if (command === "new") {
      navigate({ name: "new-conversation" });
    } else if (command === "rename") {
      beginTitleRename();
    }
  }

  const sendMessage = useCallback(
    async (
      textValue: string,
      files: ConversationAttachment[] = [],
      attachmentIds: string[] = [],
    ) => {
      const text = textValue.trim();
      if (
        !bridge ||
        !currentConversation ||
        loading ||
        (!text && files.length === 0) ||
        isWorking ||
        isQueued ||
        isWaiting ||
        isSending ||
        sendPendingRef.current
      )
        return;
      const conversationId = id;
      messageListRef.current?.style.removeProperty("--history-navigation-space");
      updateFollowState(nextFollowState(followRef.current, { type: "newMessage" }));
      const sendRevision = ++sendRevisionRef.current;
      sendPendingRef.current = true;
      const skillCatalogPromise =
        hasSkillMention(text) && capabilities?.skills === true
          ? requestSkillCatalog().catch(() => [])
          : null;
      setInteractionError("");
      setDraft("");
      try {
        let observedQueue: Promise<void>;
        do {
          observedQueue = saveQueueRef.current;
          await observedQueue;
        } while (observedQueue !== saveQueueRef.current);

        if (activeConversationIdRef.current !== conversationId) return;
        const selectedSkills = skillCatalogPromise
          ? findMentionedSkills(
              text,
              await skillCatalogPromise,
              capabilities?.maxSkillsPerMessage ?? 8,
            )
          : [];
        setIsSending(true);
        const result = await bridge.request("conversation.send", {
          id: conversationId,
          text: text || " ",
          ...(files.length ? { attachments: files } : {}),
          ...(selectedSkills.length ? { skills: selectedSkills } : {}),
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
      currentConversation,
      id,
      isSending,
      isQueued,
      isWaiting,
      isWorking,
      capabilities?.skills,
      capabilities?.maxSkillsPerMessage,
      requestSkillCatalog,
      loading,
      setDraft,
      updateFollowState,
      setInteractionError,
      setIsSending,
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
  }, [bridge, conversation, id, isStopping, setInteractionError, setIsStopping]);

  const respond = useCallback(
    async (response: ResponseInput) => {
      if (!bridge || !currentConversation || loading || isResponding) return;
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
    [bridge, currentConversation, id, isResponding, loading, setInteractionError, setIsResponding],
  );

  const retry = useCallback(
    async (messageId: string) => {
      if (!bridge || !currentConversation || loading) return;
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
    [addMessage, bridge, currentConversation, id, loading, setInteractionError],
  );

  const branchMessage = useCallback(
    async (messageId: string) => {
      if (
        !bridge ||
        !currentConversation ||
        loading ||
        isWorking ||
        isQueued ||
        isWaiting ||
        isSending
      )
        return;
      setInteractionError("");
      try {
        const result = await bridge.request("conversation.branch", { id, messageId });
        upsertConversation(result.conversation);
        if (!openConversationBeside(result.conversation.id))
          setInteractionError(t.chat.branchOpenFailed);
      } catch (branchError) {
        setInteractionError(
          branchError instanceof BridgeError && branchError.message
            ? branchError.message
            : t.chat.branchFailed,
        );
      }
    },
    [
      bridge,
      currentConversation,
      id,
      isSending,
      isQueued,
      isWaiting,
      isWorking,
      loading,
      openConversationBeside,
      setInteractionError,
    ],
  );

  const saveOptions = useCallback(
    (
      options: ConversationOptionsPatch,
      rememberedSetting?:
        | { key: string; value: string | boolean }
        | { key: string; value: string | boolean }[],
    ): Promise<void> => {
      if (!bridge || !currentConversation || loading) return Promise.resolve();

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

          const rememberedSettings = Array.isArray(rememberedSetting)
            ? rememberedSetting
            : rememberedSetting
              ? [rememberedSetting]
              : [];
          if (rememberedSettings.length > 0) {
            failureMessage = t.chat.settingsSaveFailed;
            for (const setting of rememberedSettings) await bridge.request("settings.set", setting);
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
    [bridge, currentConversation, id, updateConversation, loading, setInteractionError],
  );

  const copyFolderPath = useCallback(async () => {
    if (!conversation) return;
    await copyText(conversation.cwd);
    setAnnouncement(t.chat.folderCopied);
  }, [conversation, copyText]);

  function beginTitleRename() {
    if (!conversation || loading || isSavingTitle || isRenamingTitle) return;
    setTitleDraft(conversation.title);
    setRenamingConversationId(id);
    requestAnimationFrame(() => {
      titleInputRef.current?.focus();
      titleInputRef.current?.select();
    });
  }

  function cancelTitleRename() {
    setTitleDraft(conversation?.title ?? "");
    setRenamingConversationId(null);
    requestAnimationFrame(() => titleHeadingRef.current?.focus());
  }

  async function saveTitleRename() {
    const titleValue = titleDraft.trim();
    if (!bridge || !conversation || loading || isSavingTitle) return;
    if (!titleValue) {
      setInteractionError(t.chat.titleRequired);
      titleInputRef.current?.focus();
      return;
    }
    setInteractionError("");
    setIsSavingTitle(true);
    try {
      const result = await bridge.request("conversation.rename", { id, title: titleValue });
      const stillActive = activeConversationIdRef.current === id;
      if (stillActive) updateConversation(result.conversation);
      upsertConversation(result.conversation);
      if (stillActive) {
        setRenamingConversationId(null);
        requestAnimationFrame(() => titleHeadingRef.current?.focus());
      }
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
    currentConversation && !loading && bridge && !isWaiting && !isResponding && !isSending,
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
      const supportsFast =
        currentModels?.models.find((option) => option.id === value)?.supportsFast === true;
      const currentEffort = visibleConversation?.effort;
      const clearEffort = currentEffort && !supportedEfforts.includes(currentEffort);
      void saveOptions(
        {
          model: value || null,
          ...(clearEffort ? { effort: null } : {}),
          ...(!supportsFast ? { fast: false } : {}),
        },
        conversation
          ? [
              { key: modelSettingKey(conversation.agent), value },
              ...(!supportsFast ? [{ key: fastSettingKey(conversation.agent), value: false }] : []),
            ]
          : undefined,
      );
    },
    [conversation, currentModels, saveOptions, visibleConversation?.effort],
  );
  const changeFastMode = useCallback(
    (value: boolean) =>
      void saveOptions(
        { fast: value },
        conversation ? { key: fastSettingKey(conversation.agent), value } : undefined,
      ),
    [conversation, saveOptions],
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
          <Tooltip
            className={styles.agentTooltip}
            label={t.chat.agentTooltip(agentDisplayName(conversation.agent))}
          >
            <span className={styles.agentTag}>
              <AgentIcon agentId={conversation.agent} />
              <span className={styles.agentName}>{agentDisplayName(conversation.agent)}</span>
            </span>
          </Tooltip>
          <ComposerPreferences
            activePopover={activePopover}
            disabled={
              loading || isWorking || isQueued || isWaiting || isResponding || isSending || !bridge
            }
            effort={visibleConversation?.effort ?? ""}
            fastMode={visibleConversation?.fast ?? false}
            mode={visibleConversation?.mode ?? "edit"}
            model={visibleConversation?.model ?? null}
            models={currentModels}
            planMode={planMode}
            onActivePopoverChange={setActivePopover}
            onEffortChange={changeEffort}
            onFastModeChange={changeFastMode}
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
      changeFastMode,
      changeMode,
      changeModel,
      changePlanMode,
      composerAttachments.addFiles,
      conversation,
      isResponding,
      isSending,
      isQueued,
      isWaiting,
      isWorking,
      currentModels,
      planMode,
      visibleConversation?.effort,
      visibleConversation?.fast,
      visibleConversation?.mode,
      visibleConversation?.model,
      revealLoadedData,
      setActivePopover,
      loading,
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
  const composerBelow = useMemo(() => {
    return conversation ? (
      <div className={styles.composerBelow}>
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
        <WorktreeStrip
          busy={isWorking || isQueued || isWaiting}
          projectId={conversation.projectId}
          worktreeId={conversation.worktreeId}
        />
      </div>
    ) : (
      <ConversationLoadingStrip />
    );
  }, [
    conversation,
    copyFolderPath,
    folderPath,
    gitInfo,
    gitInfoLoading,
    isQueued,
    isWaiting,
    isWorking,
    revealLoadedData,
  ]);
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
  const composerAutocomplete = shortcutTrigger
    ? {
        open: true,
        label:
          shortcutTrigger.type === "file"
            ? shortcutLabels.files
            : shortcutTrigger.type === "skill"
              ? shortcutLabels.skills
              : shortcutLabels.commands,
        options: shortcutOptions,
        activeIndex: activeShortcutIndex,
        loading: shortcutLoading,
        loadingLabel:
          shortcutTrigger.type === "file"
            ? shortcutLabels.loadingFiles
            : shortcutTrigger.type === "skill"
              ? shortcutLabels.loadingSkills
              : shortcutLabels.loadingCommands,
        emptyLabel: shortcutLabels.nothingFound,
        onActiveIndexChange: setActiveShortcutIndex,
        onSelect: selectComposerSuggestion,
        onClose: closeShortcutSuggestions,
      }
    : undefined;

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

      <div
        className={styles.messageRegion}
        data-history-open={historyOpen}
        data-transitioning={showingPreviousConversation ? "true" : undefined}
        inert={showingPreviousConversation || undefined}
        ref={messageRegionRef}
      >
        <FollowBottomContext value={pinToBottom}>
          <ConversationMessageList
            canBranch={!loading && !isWorking && !isQueued && !isWaiting && !isSending}
            canRetry={!loading && !isWorking && !isQueued && !isWaiting && !isSending}
            conversation={retainedConversation}
            error={error}
            highlightedMessageId={highlightedMessageId}
            latestAgentMessageId={latestAgentMessageId}
            latestMessage={latestMessage}
            loading={loading}
            messageListRef={messageListRef}
            followState={followState}
            messages={visibleMessages}
            canLoadOlderMessages={canLoadOlderMessages}
            olderMessagesSentinelRef={olderMessagesSentinelRef}
            bottomSentinelRef={bottomSentinelRef}
            onAnnounce={announce}
            onBranch={branchMessage}
            onCopy={copyText}
            onEdit={editMessage}
            onLoadOlderMessages={loadOlderMessages}
            onRespond={respond}
            onRetry={retry}
            onWorkingIndicatorExit={completeWorkingIndicatorExit}
            revealLoadedData={revealLoadedData}
            shouldShowWorkingIndicator={shouldShowWorkingIndicator}
            showSlowLoading={showSlowLoading}
            totalMessageCount={orderedMessages.length}
            workingIndicatorProps={workingIndicatorProps}
            queuedLabel={queuedLabel}
            onAdjustQueueLimit={adjustQueueLimit}
          />
        </FollowBottomContext>
        {historyOpen ? <div aria-hidden="true" className={styles.historyBackdrop} /> : null}
        {restorePanelMessageId ? (
          <RestoreChangesPanel
            conversationId={id}
            key={restorePanelMessageId}
            messageId={restorePanelMessageId}
            onClose={closeRestoreChanges}
          />
        ) : null}
      </div>

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
          busy={isWorking || isQueued}
          disabled={isWaiting || isResponding || isSending || isCompacting}
          leading={composerLeading}
          trailing={
            currentConversation &&
            !loading &&
            (capabilities?.contextUsage === true || userMessageCount >= 2) ? (
              <>
                {capabilities?.contextUsage === true ? (
                  <span className={styles.composerRing}>
                    <ConversationContextUsageControl
                      compactAvailable={capabilities.compact}
                      compacting={isCompacting}
                      initialUsage={contextUsage}
                      key={id}
                      onCompact={compactConversation}
                    />
                  </span>
                ) : null}
                {userMessageCount >= 2 ? (
                  <span className={styles.composerHistory}>
                    <ConversationHistory
                      entries={historyEntries}
                      onOpenChange={setHistoryOpen}
                      onSelectMessage={navigateToHistoryMessage}
                      open={historyOpen}
                      popupContainerRef={messageRegionRef}
                    />
                  </span>
                ) : null}
              </>
            ) : undefined
          }
          attachments={composerAttachmentsNode}
          onChange={setDraft}
          onDragEnter={composerAttachments.onDragEnter}
          onDragLeave={composerAttachments.onDragLeave}
          onDragOver={composerAttachments.onDragOver}
          onDrop={composerAttachments.onDrop}
          onPaste={composerAttachments.onPaste}
          onCaretChange={updateShortcutAtCaret}
          onStop={composerStop}
          onSubmit={composerSubmit}
          placeholder={t.chat.composerPlaceholder(capabilities?.skills === true)}
          shortPlaceholder={t.chat.composerPlaceholderShort}
          autocomplete={composerAutocomplete}
          submitDisabled={
            !bridge ||
            !conversation ||
            loading ||
            composerAttachments.isPreparing ||
            (!draft.trim() && composerAttachments.attachments.length === 0) ||
            isWaiting ||
            isSending ||
            isCompacting
          }
          submitLabel={isWorking || isQueued ? t.chat.stop : t.chat.send}
          submitTooltipLabel={
            isQueued ? t.chat.queueStopTooltip : isWorking ? t.chat.stop : t.chat.sendTooltip
          }
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

function useConversationScopedFlag(conversationId: string) {
  const [state, setState] = useState({ conversationId, value: false });
  const value = state.conversationId === conversationId && state.value;
  const setValue = useCallback(
    (nextValue: boolean, ownerConversationId = conversationId) => {
      setState((current) => {
        if (!nextValue && current.conversationId !== ownerConversationId) return current;
        return { conversationId: ownerConversationId, value: nextValue };
      });
    },
    [conversationId],
  );
  return [value, setValue] as const;
}
