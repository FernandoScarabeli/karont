import type { ConversationMessage, MessagePart } from "@karont/contract";
import { History } from "lucide-react";
import {
  type KeyboardEvent,
  memo,
  useCallback,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
} from "react";
import { Composer } from "../../components/Composer/Composer.tsx";
import {
  FluidHoverHighlight,
  FluidHoverProvider,
  useFluidHover,
  useRegisterFluidHoverItem,
} from "../../components/FluidHover/FluidHover.tsx";
import { IconButton } from "../../components/IconButton/IconButton.tsx";
import scrollAreaStyles from "../../components/ScrollArea/ScrollArea.module.css";
import { Tooltip } from "../../components/Tooltip/Tooltip.tsx";
import { MessageRow } from "../../conversation/ConversationParts.tsx";
import { t } from "../../i18n/pt-BR.ts";
import styles from "./HistoryPrototype.module.css";

type HistoryVariant = "A" | "B";

const HIGHLIGHT_DURATION_MS = 960;
const SAMPLE_CONVERSATION_ID = "historico-prototipo";
const firstSampleTime = Date.parse("2026-11-02T17:14:00-03:00");
const noOperation = () => {};
const noOperationAsync = async () => {};

const sampleMessages = t.historyPrototype.samplePairs.flatMap((pair, index) => {
  const createdAt = new Date(firstSampleTime + index * 2 * 60_000).toISOString();
  const agentCreatedAt = new Date(firstSampleTime + index * 2 * 60_000 + 45_000).toISOString();
  const userId = `mensagem-usuario-${index + 1}`;
  const agentId = `mensagem-agente-${index + 1}`;
  const userPart: MessagePart = {
    id: `${userId}-texto`,
    type: "text",
    markdown: pair.user,
  };
  const agentPart: MessagePart = {
    id: `${agentId}-texto`,
    type: "text",
    markdown: pair.agent,
  };

  return [
    {
      id: userId,
      conversationId: SAMPLE_CONVERSATION_ID,
      author: "user" as const,
      status: "done" as const,
      parts: [userPart],
      createdAt,
      updatedAt: createdAt,
    },
    {
      id: agentId,
      conversationId: SAMPLE_CONVERSATION_ID,
      author: "agent" as const,
      status: "done" as const,
      parts: [agentPart],
      createdAt: agentCreatedAt,
      updatedAt: agentCreatedAt,
    },
  ] satisfies ConversationMessage[];
});

const userMessages = sampleMessages.filter((message) => message.author === "user");

function messageText(message: ConversationMessage): string {
  return message.parts
    .filter((part): part is Extract<MessagePart, { type: "text" }> => part.type === "text")
    .map((part) => part.markdown)
    .join("\n")
    .trim();
}

function messageTime(message: ConversationMessage): string {
  return new Date(message.createdAt).toLocaleTimeString("pt-BR", {
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
    timeZone: "America/Sao_Paulo",
  });
}

export function HistoryPrototype() {
  const [variant, setVariant] = useState<HistoryVariant>("A");
  const [historyOpen, setHistoryOpen] = useState(false);
  const [activeIndex, setActiveIndex] = useState(userMessages.length - 1);
  const [draft, setDraft] = useState("");
  const [highlightedMessageId, setHighlightedMessageId] = useState<string | null>(null);
  const messageListRef = useRef<HTMLDivElement>(null);
  const historyButtonRef = useRef<HTMLButtonElement>(null);
  const historyListRef = useRef<HTMLDivElement>(null);
  const highlightTimerRef = useRef<number | null>(null);
  const fluidHover = useFluidHover(historyListRef);
  const setHistoryListRef = useCallback(
    (element: HTMLDivElement | null) => {
      historyListRef.current = element;
      fluidHover.containerRef(element);
    },
    [fluidHover.containerRef],
  );

  const visibleMessages = sampleMessages;

  useLayoutEffect(() => {
    const messageList = messageListRef.current;
    if (messageList) messageList.scrollTop = messageList.scrollHeight;
  }, []);

  useLayoutEffect(() => {
    if (!historyOpen) return;
    const list = historyListRef.current;
    const activeOption = list?.querySelectorAll<HTMLElement>('[role="option"]')[activeIndex];
    if (!list || !activeOption) return;
    list.scrollTop = list.scrollHeight;
    fluidHover.remeasure();
    activeOption.focus({ preventScroll: true });
    activeOption.scrollIntoView({ block: "nearest" });
  }, [activeIndex, fluidHover.remeasure, historyOpen]);

  useEffect(() => {
    if (!historyOpen) return;

    const closeOnOutsidePointer = (event: PointerEvent) => {
      const target = event.target;
      if (!(target instanceof Node)) return;
      if (historyListRef.current?.contains(target) || historyButtonRef.current?.contains(target)) {
        return;
      }
      setHistoryOpen(false);
    };

    const closeOnEscape = (event: globalThis.KeyboardEvent) => {
      if (event.key !== "Escape") return;
      event.preventDefault();
      setHistoryOpen(false);
      historyButtonRef.current?.focus({ preventScroll: true });
    };

    document.addEventListener("pointerdown", closeOnOutsidePointer, true);
    document.addEventListener("keydown", closeOnEscape);
    return () => {
      document.removeEventListener("pointerdown", closeOnOutsidePointer, true);
      document.removeEventListener("keydown", closeOnEscape);
    };
  }, [historyOpen]);

  useEffect(
    () => () => {
      if (highlightTimerRef.current !== null) window.clearTimeout(highlightTimerRef.current);
    },
    [],
  );

  const toggleHistory = useCallback(() => {
    if (historyOpen) {
      setHistoryOpen(false);
      return;
    }
    setActiveIndex(userMessages.length - 1);
    setHistoryOpen(true);
  }, [historyOpen]);

  const navigateToMessage = useCallback((message: ConversationMessage) => {
    setHistoryOpen(false);
    setHighlightedMessageId(message.id);
    historyButtonRef.current?.focus({ preventScroll: true });

    if (highlightTimerRef.current !== null) window.clearTimeout(highlightTimerRef.current);
    highlightTimerRef.current = window.setTimeout(() => {
      setHighlightedMessageId(null);
      highlightTimerRef.current = null;
    }, HIGHLIGHT_DURATION_MS);

    window.requestAnimationFrame(() => {
      const target = Array.from(
        messageListRef.current?.querySelectorAll<HTMLElement>("[data-message-id]") ?? [],
      ).find((element) => element.dataset.messageId === message.id);
      if (!target) return;
      const reducedMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
      target.scrollIntoView({ behavior: reducedMotion ? "auto" : "smooth", block: "start" });
    });
  }, []);

  const handleOptionFocus = useCallback((index: number) => setActiveIndex(index), []);

  const handleHistoryKeyDown = useCallback(
    (event: KeyboardEvent<HTMLDivElement>) => {
      if (event.key === "ArrowUp" || event.key === "ArrowDown") {
        event.preventDefault();
        const direction = event.key === "ArrowUp" ? -1 : 1;
        const nextIndex = Math.max(0, Math.min(userMessages.length - 1, activeIndex + direction));
        setActiveIndex(nextIndex);
        window.requestAnimationFrame(() => {
          const nextOption =
            historyListRef.current?.querySelectorAll<HTMLElement>('[role="option"]')[nextIndex];
          nextOption?.focus({ preventScroll: true });
          nextOption?.scrollIntoView({ block: "nearest" });
        });
      } else if (event.key === "Enter") {
        event.preventDefault();
        const message = userMessages[activeIndex];
        if (message) navigateToMessage(message);
      }
    },
    [activeIndex, navigateToMessage],
  );

  return (
    <main aria-label={t.historyPrototype.conversationTitle} className={styles.page}>
      <header className={styles.pageHeader}>
        <div className={styles.headingBlock}>
          <div className={styles.contextLine}>
            <span className={styles.brand}>{t.brand.name}</span>
            <span aria-hidden="true" className={styles.contextDivider}>
              /
            </span>
            <span className={styles.scope}>{t.historyPrototype.conversationScope}</span>
            <span className={styles.notice}>{t.historyPrototype.notice}</span>
          </div>
          <h1 className={styles.title}>{t.historyPrototype.conversationTitle}</h1>
        </div>
        <label className={styles.variantControl}>
          <span className={styles.visuallyHidden}>{t.historyPrototype.variantLabel}</span>
          <select
            aria-label={t.historyPrototype.variantLabel}
            onChange={(event) => setVariant(event.currentTarget.value as HistoryVariant)}
            value={variant}
          >
            <option value="A">{t.historyPrototype.variantA}</option>
            <option value="B">{t.historyPrototype.variantB}</option>
          </select>
        </label>
      </header>

      <section
        aria-label={t.chat.messageList}
        className={styles.conversationArea}
        data-history-open={historyOpen}
        data-history-variant={variant}
      >
        <div
          className={`${styles.messageList} ${scrollAreaStyles.scrollArea}`}
          ref={messageListRef}
        >
          {visibleMessages.map((message) => (
            <div
              className={`${styles.messageFrame} ${highlightedMessageId === message.id ? styles.highlightedMessage : ""}`}
              key={message.id}
            >
              <MessageRow
                canBranch={false}
                canRetry={false}
                cwd="/projeto-exemplo"
                message={message}
                onAnnounce={noOperation}
                onBranch={noOperation}
                onCopy={noOperation}
                onCopyCode={noOperation}
                onEdit={noOperation}
                onRespond={noOperationAsync}
                onRetry={noOperation}
              />
            </div>
          ))}
        </div>
        <div className={styles.composerDock}>
          <Composer
            leading={<span className={styles.agentTag}>{t.historyPrototype.agentLabel}</span>}
            onChange={setDraft}
            onSubmit={() => {}}
            placeholder={t.historyPrototype.composerPlaceholder}
            submitDisabled
            submitLabel={t.chat.send}
            submitTooltipLabel={t.chat.sendTooltip}
            trailing={
              userMessages.length >= 2 ? (
                <Tooltip align="end" label={t.historyPrototype.historyButton}>
                  <IconButton
                    aria-controls="historico-mensagens-lista"
                    aria-expanded={historyOpen}
                    className={styles.historyButton}
                    icon={<History aria-hidden="true" size={16} strokeWidth={1.8} />}
                    label={t.historyPrototype.historyButton}
                    onClick={toggleHistory}
                    ref={historyButtonRef}
                  />
                </Tooltip>
              ) : null
            }
            value={draft}
          />

          <FluidHoverProvider controller={fluidHover}>
            <div
              aria-label={t.historyPrototype.listAccessibleName}
              aria-multiselectable="false"
              className={`${styles.historyPanel} ${variant === "A" ? styles.historyPanelA : styles.historyPanelB}`}
              hidden={!historyOpen}
              id="historico-mensagens-lista"
              onKeyDown={handleHistoryKeyDown}
              ref={setHistoryListRef}
              role="listbox"
            >
              <FluidHoverHighlight className={styles.fluidHighlight} controller={fluidHover} />
              {userMessages.map((message, index) => (
                <HistoryOption
                  index={index}
                  isActive={index === activeIndex}
                  key={message.id}
                  message={message}
                  onOptionFocus={handleOptionFocus}
                  onSelect={navigateToMessage}
                  variant={variant}
                />
              ))}
            </div>
          </FluidHoverProvider>
        </div>
      </section>
    </main>
  );
}

const HistoryOption = memo(function HistoryOption({
  index,
  isActive,
  message,
  onOptionFocus,
  onSelect,
  variant,
}: {
  index: number;
  isActive: boolean;
  message: ConversationMessage;
  onOptionFocus: (index: number) => void;
  onSelect: (message: ConversationMessage) => void;
  variant: HistoryVariant;
}) {
  const registerFluidHoverItem = useRegisterFluidHoverItem(message.id);
  const text = messageText(message);
  const time = messageTime(message);

  return (
    <div
      aria-label={t.historyPrototype.messageOptionLabel(time, text)}
      aria-selected={isActive}
      className={`${styles.historyOption} ${variant === "A" ? styles.historyOptionA : styles.historyOptionB}`}
      id={`historico-mensagem-opcao-${index + 1}`}
      onClick={() => onSelect(message)}
      onFocus={() => onOptionFocus(index)}
      onKeyDown={(event: KeyboardEvent<HTMLDivElement>) => {
        if (event.key === "Enter" || event.key === " ") {
          event.preventDefault();
          event.stopPropagation();
          onSelect(message);
        }
      }}
      ref={registerFluidHoverItem}
      role="option"
      tabIndex={isActive ? 0 : -1}
    >
      <span aria-hidden="true" className={styles.messagePreview}>
        {text}
      </span>
      {variant === "B" ? (
        <time aria-hidden="true" className={styles.messageTime} dateTime={message.createdAt}>
          {time}
        </time>
      ) : null}
    </div>
  );
});
