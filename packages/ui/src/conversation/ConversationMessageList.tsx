import type { Conversation, ConversationMessage } from "@karont/contract";
import { Clock, MessageSquareText, TriangleAlert } from "lucide-react";
import { memo, type RefObject } from "react";
import scrollAreaStyles from "../components/ScrollArea/ScrollArea.module.css";
import { chatMood } from "../dot/chatMood.ts";
import { t } from "../i18n/pt-BR.ts";
import { agentDisplayName } from "./ComposerPreferences.tsx";
import { MessageRow, type ResponseInput } from "./ConversationParts.tsx";
import styles from "./ConversationView.module.css";
import type { FollowState } from "./followState.ts";
import { areMessageListPropsEqual } from "./messageListMemo.ts";
import { WorkingIndicator } from "./WorkingIndicator.tsx";

type WorkingIndicatorProps = {
  active: boolean;
  actions: readonly Extract<ConversationMessage["parts"][number], { type: "action" }>[];
  lastPart?: ConversationMessage["parts"][number];
  stopping: boolean;
};

export type ConversationMessageListProps = {
  conversation: Conversation | null;
  messages: ConversationMessage[];
  totalMessageCount: number;
  canLoadOlderMessages: boolean;
  loading: boolean;
  error: string;
  showSlowLoading: boolean;
  revealLoadedData: boolean;
  highlightedMessageId: string | null;
  latestAgentMessageId?: string;
  latestMessage?: ConversationMessage;
  shouldShowWorkingIndicator: boolean;
  workingIndicatorProps: WorkingIndicatorProps;
  /** Texto do aviso de fila; `null` quando a conversa não está na fila. */
  queuedLabel: string | null;
  onAdjustQueueLimit: () => void;
  messageListRef: RefObject<HTMLDivElement | null>;
  followState: FollowState;
  olderMessagesSentinelRef: RefObject<HTMLDivElement | null>;
  bottomSentinelRef: RefObject<HTMLDivElement | null>;
  onLoadOlderMessages: () => void;
  onAnnounce: (text: string) => void;
  onCopy: (text: string) => Promise<boolean>;
  onEdit: (text: string) => void;
  onRespond: (response: ResponseInput) => Promise<void>;
  onRetry: (messageId: string) => void;
  onBranch: (messageId: string) => void;
  onWorkingIndicatorExit: () => void;
  canRetry: boolean;
  canBranch: boolean;
};

export const ConversationMessageList = memo(function ConversationMessageList({
  conversation,
  messages,
  totalMessageCount,
  canLoadOlderMessages,
  loading,
  error,
  showSlowLoading,
  revealLoadedData,
  highlightedMessageId,
  latestAgentMessageId,
  latestMessage,
  shouldShowWorkingIndicator,
  workingIndicatorProps,
  queuedLabel,
  onAdjustQueueLimit,
  messageListRef,
  followState,
  olderMessagesSentinelRef,
  bottomSentinelRef,
  onLoadOlderMessages,
  onAnnounce,
  onCopy,
  onEdit,
  onRespond,
  onRetry,
  onBranch,
  onWorkingIndicatorExit,
  canRetry,
  canBranch,
}: ConversationMessageListProps) {
  const latestMessageId = latestMessage?.id;

  return (
    <section
      aria-label={t.chat.messageList}
      className={`${styles.messageList} ${scrollAreaStyles.scrollArea}`}
      data-k-chat-scroll
      data-follow={followState}
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
      {conversation?.branchContext ? (
        <p className={styles.branchContextNotice} role="note">
          {t.chat.branchContextNotice}
        </p>
      ) : null}
      {!loading && !error && totalMessageCount === 0 ? (
        <div className={styles.empty}>
          <MessageSquareText aria-hidden="true" size={22} />
          <p>{t.chat.emptyTitle(conversation ? agentDisplayName(conversation.agent) : "")}</p>
          <span>{t.conversation.promptPlaceholder(false)}</span>
        </div>
      ) : null}
      {canLoadOlderMessages ? (
        <>
          <div
            aria-hidden="true"
            className={styles.olderMessagesSentinel}
            ref={olderMessagesSentinelRef}
          />
          <button className={styles.olderMessages} onClick={onLoadOlderMessages} type="button">
            {t.chat.showOlderMessages}
          </button>
        </>
      ) : null}
      {messages.map((message) => {
        const isLatestMessage = message.id === latestMessageId;
        // Na fila a resposta ainda não existe: o bloco vazio só afastaria o aviso da mensagem.
        if (
          queuedLabel !== null &&
          isLatestMessage &&
          message.author === "agent" &&
          message.parts.length === 0
        )
          return null;
        const hasWorkingIndicator =
          message.author === "agent" && isLatestMessage && shouldShowWorkingIndicator;
        return (
          <MessageRow
            key={message.id}
            message={message}
            historyHighlighted={highlightedMessageId === message.id}
            agent={conversation?.agent}
            dotMood={chatMood({
              isLatest: isLatestMessage,
              conversationState: conversation?.state,
              messageStatus: message.status,
            })}
            cwd={conversation?.cwd ?? ""}
            onAnnounce={onAnnounce}
            onCopy={onCopy}
            onEdit={onEdit}
            onRespond={onRespond}
            onRetry={onRetry}
            onBranch={onBranch}
            canRetry={canRetry && message.author === "agent" && message.id === latestAgentMessageId}
            canBranch={canBranch}
            onWorkingIndicatorExit={hasWorkingIndicator ? onWorkingIndicatorExit : undefined}
            workingIndicator={hasWorkingIndicator ? workingIndicatorProps : undefined}
          />
        );
      })}
      {latestMessage?.author !== "agent" && shouldShowWorkingIndicator ? (
        <div className={styles.workingFallback}>
          <WorkingIndicator {...workingIndicatorProps} onExitComplete={onWorkingIndicatorExit} />
        </div>
      ) : null}
      {queuedLabel !== null ? (
        <div className={styles.queuedNotice}>
          <Clock aria-hidden="true" className={styles.queuedIcon} size={14} strokeWidth={1.8} />
          <span role="status">{queuedLabel}</span>
          <button className={styles.queuedAction} onClick={onAdjustQueueLimit} type="button">
            {t.chat.queueAdjustLimit}
          </button>
        </div>
      ) : null}
      <div aria-hidden="true" className={styles.bottomSentinel} ref={bottomSentinelRef} />
    </section>
  );
}, areMessageListPropsEqual);
