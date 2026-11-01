import { Folder, GitBranch } from "lucide-react";
import { type ReactNode, useEffect, useState } from "react";
import { Composer } from "../components/Composer/Composer.tsx";
import { t } from "../i18n/pt-BR.ts";
import styles from "./ConversationView.module.css";

const slowLoadingDelayMs = 300;

export function ConversationLoadingFallback({
  headerActions,
  openedAt,
}: {
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

  return <ConversationLoadingFrame headerActions={headerActions} showLoading={showLoading} />;
}

export function ConversationLoadingFrame({
  headerActions,
  showLoading = false,
}: {
  headerActions?: ReactNode;
  showLoading?: boolean;
}) {
  return (
    <section aria-label={t.conversation.title} className={styles.page}>
      <header className={styles.header}>
        <h1 className={styles.title}>{t.conversation.title}</h1>
        {headerActions}
      </header>
      <section aria-label={t.chat.messageList} className={styles.messageList} data-loading-frame="">
        {showLoading ? <p className={styles.loading}>{t.chat.loading}</p> : null}
      </section>
      <section aria-label={t.chat.messageComposer} className={styles.composerSection}>
        <Composer
          ariaDescription={t.conversation.composerKeyboardDescription}
          below={<ConversationLoadingStrip />}
          disabled
          leading={<ConversationLoadingControls />}
          onChange={ignoreChange}
          onSubmit={ignoreSubmit}
          placeholder={t.chat.messageInput}
          submitDisabled
          submitLabel={t.chat.send}
          value=""
        />
      </section>
    </section>
  );
}

export function ConversationLoadingControls() {
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
