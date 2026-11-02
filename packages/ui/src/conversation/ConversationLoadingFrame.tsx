import type { Conversation } from "@karont/contract";
import { Folder, GitBranch } from "lucide-react";
import { type ReactNode, useEffect, useState } from "react";
import { Composer } from "../components/Composer/Composer.tsx";
import { t } from "../i18n/pt-BR.ts";
import styles from "./ConversationView.module.css";
import { getCachedAgentModels } from "./conversationCache.ts";
import { formatFolderPath } from "./displayText.ts";

const slowLoadingDelayMs = 300;

export function ConversationLoadingFallback({
  conversation,
  headerActions,
  openedAt,
}: {
  conversation?: Conversation | null;
  headerActions?: ReactNode;
  openedAt: number;
}) {
  const [showLoading, setShowLoading] = useState(() => Date.now() - openedAt >= slowLoadingDelayMs);

  useEffect(() => {
    const remaining = slowLoadingDelayMs - (Date.now() - openedAt);
    if (remaining <= 0) {
      setShowLoading(true);
      return;
    }
    const timer = window.setTimeout(() => setShowLoading(true), remaining);
    return () => window.clearTimeout(timer);
  }, [openedAt]);

  return (
    <ConversationLoadingFrame
      conversation={conversation}
      headerActions={headerActions}
      showLoading={showLoading}
    />
  );
}

export function ConversationLoadingFrame({
  conversation,
  headerActions,
  showLoading = false,
}: {
  conversation?: Conversation | null;
  headerActions?: ReactNode;
  showLoading?: boolean;
}) {
  const title = conversation?.title ?? t.conversation.title;
  return (
    <section aria-label={title} className={styles.page}>
      <header className={styles.header}>
        <h1 className={styles.title}>{title}</h1>
        {headerActions}
      </header>
      <section aria-label={t.chat.messageList} className={styles.messageList} data-loading-frame="">
        {showLoading ? <p className={styles.loading}>{t.chat.loading}</p> : null}
      </section>
      <section aria-label={t.chat.messageComposer} className={styles.composerSection}>
        <Composer
          ariaDescription={t.conversation.composerKeyboardDescription}
          below={
            conversation ? (
              <ConversationSummaryStrip cwd={conversation.cwd} />
            ) : (
              <ConversationLoadingStrip />
            )
          }
          disabled
          leading={
            conversation ? (
              <ConversationLoadingControls conversation={conversation} />
            ) : (
              <ConversationLoadingControls />
            )
          }
          onChange={ignoreChange}
          onSubmit={ignoreSubmit}
          placeholder={t.chat.messageInput}
          submitDisabled
          submitLabel={t.chat.send}
          submitTooltipLabel={t.chat.sendTooltip}
          value=""
        />
      </section>
    </section>
  );
}

export function ConversationLoadingControls({ conversation }: { conversation?: Conversation }) {
  if (conversation) return <ConversationSummaryControls conversation={conversation} />;

  return (
    <div aria-hidden="true" className={styles.composerControls}>
      <span className={`${styles.loadingPlaceholder} ${styles.loadingAttachment}`} />
      <span className={`${styles.loadingPlaceholder} ${styles.loadingAgent}`} />
      <span className={styles.loadingPreferences}>
        <span className={`${styles.loadingPlaceholder} ${styles.loadingModel}`} />
        <span className={`${styles.loadingPlaceholder} ${styles.loadingIcon}`} />
        <span className={`${styles.loadingPlaceholder} ${styles.loadingIcon}`} />
      </span>
    </div>
  );
}

function ConversationSummaryControls({ conversation }: { conversation: Conversation }) {
  const models = getCachedAgentModels(conversation.agent);
  const model = models?.models.find(
    (option) =>
      option.id === conversation.model || option.aliases?.includes(conversation.model ?? ""),
  );
  const modelName = model?.name ?? conversation.model ?? t.chat.model;
  const agentName = conversation.agent === "claude" ? t.chat.agents.claude : t.chat.agents.codex;

  return (
    <div className={styles.composerControls}>
      <span
        aria-hidden="true"
        className={`${styles.loadingPlaceholder} ${styles.loadingAttachment}`}
      />
      <span className={styles.agentTag}>
        <span className={styles.agentName}>{agentName}</span>
      </span>
      <span className={styles.loadingPreferences}>
        <span className={styles.agentTag}>{modelName}</span>
        <span className={styles.agentTag}>
          {t.chat.effort}: {conversation.effort ? t.chat.efforts[conversation.effort] : "—"}
        </span>
        <span className={styles.agentTag}>
          {conversation.fast ? t.chat.fastModeOnTooltip : t.chat.fastModeOffTooltip}
        </span>
        <span className={styles.agentTag}>{t.chat.modes[conversation.mode ?? "edit"]}</span>
        <span className={styles.agentTag}>
          {t.chat.planMode}: {conversation.plan ? "ligado" : "desligado"}
        </span>
      </span>
    </div>
  );
}

function ConversationSummaryStrip({ cwd }: { cwd: string }) {
  const folder = formatFolderPath(cwd);
  return (
    <div className={styles.folderStrip}>
      <span className={styles.folderButton}>
        <Folder aria-hidden="true" size={15} />
        <span title={folder.title}>{folder.text}</span>
      </span>
      <span className={styles.branchSlot}>
        <ConversationBranchPlaceholder />
      </span>
    </div>
  );
}

export function ConversationLoadingStrip() {
  return (
    <div aria-hidden="true" className={styles.folderStrip}>
      <span className={`${styles.folderButton} ${styles.loadingFolder}`}>
        <Folder aria-hidden="true" size={15} />
        <span className={`${styles.loadingPlaceholder} ${styles.loadingFolderText}`} />
      </span>
      <span className={styles.branchSlot}>
        <ConversationBranchPlaceholder />
      </span>
    </div>
  );
}

export function ConversationBranchPlaceholder() {
  return (
    <span aria-hidden="true" className={`${styles.loadingPlaceholder} ${styles.loadingBranch}`}>
      <GitBranch aria-hidden="true" size={14} />
      <span className={styles.loadingBranchText} />
    </span>
  );
}

function ignoreChange() {}
function ignoreSubmit() {}
