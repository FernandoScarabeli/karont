import { MAX_CONCURRENT_AGENTS_LIMIT, MAX_CONCURRENT_AGENTS_SETTING } from "@karont/contract";
import { CircleAlert, Minus, Plus } from "lucide-react";
import { type RefObject, useCallback, useEffect, useMemo, useRef, useState } from "react";
import { getBridge } from "../bridge/index.ts";
import { Button } from "../components/Button/Button.tsx";
import { Dialog } from "../components/Dialog/Dialog.tsx";
import { FluidHoverHighlight, useFluidHover } from "../components/FluidHover/FluidHover.tsx";
import { IconButton } from "../components/IconButton/IconButton.tsx";
import { clearAllConversationsFromIndex } from "../conversation/useConversationIndex.ts";
import { useQueueStatus } from "../conversation/useQueueStatus.ts";
import { t } from "../i18n/pt-BR.ts";
import { useNavigation } from "../navigation/NavigationContext.tsx";
import styles from "./GeneralSection.module.css";

const CLOSE_BEHAVIOR_SETTING = "app.closeBehavior";

type CloseBehavior = "ask" | "background" | "quit";
type LoadPhase = "loading" | "ready" | "error" | "noBridge";

const choices: Array<{
  value: CloseBehavior;
  label: string;
  description: string;
}> = [
  {
    value: "ask",
    label: t.settings.closeBehaviorAsk,
    description: t.settings.closeBehaviorAskDescription,
  },
  {
    value: "background",
    label: t.settings.closeBehaviorBackground,
    description: t.settings.closeBehaviorBackgroundDescription,
  },
  {
    value: "quit",
    label: t.settings.closeBehaviorQuit,
    description: t.settings.closeBehaviorQuitDescription,
  },
];

function isCloseBehavior(value: unknown): value is CloseBehavior {
  return value === "ask" || value === "background" || value === "quit";
}

function errorMessage(error: unknown, fallback: string): string {
  return error instanceof Error && error.message ? error.message : fallback;
}

export function GeneralSection() {
  const bridge = useMemo(() => getBridge(), []);
  const [phase, setPhase] = useState<LoadPhase>(() => (bridge ? "loading" : "noBridge"));
  const [behavior, setBehavior] = useState<CloseBehavior>("ask");
  const [loadError, setLoadError] = useState("");
  const [saveError, setSaveError] = useState("");
  const [announcement, setAnnouncement] = useState("");
  const [isSaving, setIsSaving] = useState(false);
  const choicesRef = useRef<HTMLDivElement>(null);
  const fluidHover = useFluidHover(choicesRef, { axis: "y" });
  const mountedRef = useRef(false);

  const loadPreference = useCallback(async () => {
    if (!bridge) {
      setPhase("noBridge");
      return;
    }

    setPhase("loading");
    setLoadError("");
    try {
      const { value } = await bridge.request("settings.get", { key: CLOSE_BEHAVIOR_SETTING });
      if (!mountedRef.current) return;
      setBehavior(isCloseBehavior(value) ? value : "ask");
      setPhase("ready");
    } catch (error) {
      if (!mountedRef.current) return;
      setLoadError(errorMessage(error, t.settings.closeBehaviorLoadFailed));
      setPhase("error");
    }
  }, [bridge]);

  useEffect(() => {
    mountedRef.current = true;
    void loadPreference();
    return () => {
      mountedRef.current = false;
    };
  }, [loadPreference]);

  useEffect(() => {
    if (!announcement) return;
    const timeout = window.setTimeout(() => setAnnouncement(""), 4_000);
    return () => window.clearTimeout(timeout);
  }, [announcement]);

  async function saveBehavior(nextBehavior: CloseBehavior) {
    if (!bridge || phase !== "ready" || isSaving || nextBehavior === behavior) return;

    const previousBehavior = behavior;
    setBehavior(nextBehavior);
    setSaveError("");
    setAnnouncement("");
    setIsSaving(true);
    try {
      await bridge.request("settings.set", {
        key: CLOSE_BEHAVIOR_SETTING,
        value: nextBehavior,
      });
      setAnnouncement(t.settings.preferenceSaved);
    } catch (error) {
      setBehavior(previousBehavior);
      setSaveError(errorMessage(error, t.settings.closeBehaviorSaveFailed));
    } finally {
      setIsSaving(false);
    }
  }

  return (
    <section
      aria-labelledby="settings-general-title"
      className={styles.section}
      id="settings-general"
    >
      <fieldset
        aria-labelledby="settings-general-title"
        className={styles.group}
        disabled={phase !== "ready" || isSaving}
      >
        <legend className={styles.legend}>
          <span id="settings-general-title">{t.settings.closeBehaviorTitle}</span>
          <span className={styles.announcement} role="status">
            {announcement}
          </span>
        </legend>
        <div className={styles.choices} ref={fluidHover.containerRef}>
          <FluidHoverHighlight controller={fluidHover} />
          {choices.map((choice) => (
            <label
              className={styles.choice}
              key={choice.value}
              ref={(element) => fluidHover.registerItem(choice.value, element)}
            >
              <input
                checked={behavior === choice.value}
                className={styles.radio}
                name="close-behavior"
                onChange={() => void saveBehavior(choice.value)}
                type="radio"
                value={choice.value}
              />
              <span className={styles.choiceText}>
                <span className={styles.choiceLabel}>{choice.label}</span>
                <span className={styles.choiceDescription}>{choice.description}</span>
              </span>
            </label>
          ))}
        </div>
      </fieldset>

      <AgentLimitGroup />

      {phase === "noBridge" ? (
        <p className={styles.connectionMessage} role="status">
          {t.settings.noBridge}
        </p>
      ) : null}

      {phase === "loading" ? (
        <p className={styles.statusMessage} role="status">
          {t.settings.loadingPreference}
        </p>
      ) : null}

      {phase === "error" ? (
        <div className={styles.errorState}>
          <p className={styles.errorMessage} role="alert">
            <CircleAlert aria-hidden="true" size={16} strokeWidth={1.8} />
            <span>{loadError || t.settings.closeBehaviorLoadFailed}</span>
          </p>
          <Button onClick={() => void loadPreference()} size="sm" variant="secondary">
            {t.settings.retry}
          </Button>
        </div>
      ) : null}

      {saveError ? (
        <p className={styles.errorMessage} role="alert">
          <CircleAlert aria-hidden="true" size={16} strokeWidth={1.8} />
          <span>{saveError}</span>
        </p>
      ) : null}
      <DataSection />
    </section>
  );
}

function AgentLimitGroup() {
  const bridge = useMemo(() => getBridge(), []);
  const { status } = useQueueStatus();
  const serviceLimit = status?.limit ?? null;
  // Valor mostrado logo no clique; some quando o serviço informa o limite ou a gravação falha.
  const [pendingLimit, setPendingLimit] = useState<number | null>(null);
  const [saveError, setSaveError] = useState("");
  const saveRevisionRef = useRef(0);
  const limit = pendingLimit ?? serviceLimit;

  // Só limpa quando o serviço confirma o último clique; com cliques seguidos, o número não volta.
  useEffect(() => {
    setPendingLimit((current) => (current === serviceLimit ? null : current));
  }, [serviceLimit]);

  async function changeLimit(delta: number) {
    if (!bridge || limit === null) return;
    const next = Math.min(MAX_CONCURRENT_AGENTS_LIMIT, Math.max(1, limit + delta));
    if (next === limit) return;
    const revision = ++saveRevisionRef.current;
    setPendingLimit(next);
    setSaveError("");
    try {
      await bridge.request("settings.set", { key: MAX_CONCURRENT_AGENTS_SETTING, value: next });
    } catch (error) {
      if (revision !== saveRevisionRef.current) return;
      setPendingLimit(null);
      setSaveError(errorMessage(error, t.settings.agentLimitSaveFailed));
    }
  }

  return (
    <section aria-labelledby="settings-agent-limit-title" className={styles.limitGroup}>
      <h2 className={styles.limitHeading} id="settings-agent-limit-title">
        {t.settings.agentLimitTitle}
      </h2>
      <div className={styles.limitControl}>
        <IconButton
          disabled={!bridge || limit === null || limit <= 1}
          icon={<Minus aria-hidden="true" size={15} />}
          label={t.settings.agentLimitDecrease}
          onClick={() => void changeLimit(-1)}
          variant="secondary"
        />
        <span className={styles.limitValue} role="status">
          {limit === null ? "" : t.settings.agentLimitValue(limit)}
        </span>
        <IconButton
          disabled={!bridge || limit === null || limit >= MAX_CONCURRENT_AGENTS_LIMIT}
          icon={<Plus aria-hidden="true" size={15} />}
          label={t.settings.agentLimitIncrease}
          onClick={() => void changeLimit(1)}
          variant="secondary"
        />
      </div>
      <p className={styles.limitDescription}>{t.settings.agentLimitDescription}</p>
      {saveError ? (
        <p className={styles.errorMessage} role="alert">
          <CircleAlert aria-hidden="true" size={16} strokeWidth={1.8} />
          <span>{saveError}</span>
        </p>
      ) : null}
    </section>
  );
}

function DataSection() {
  const bridge = useMemo(() => getBridge(), []);
  const { closeAllConversationPanes } = useNavigation();
  const [count, setCount] = useState<number | null>(null);
  const [isLoadingCount, setIsLoadingCount] = useState(true);
  const [countError, setCountError] = useState("");
  const [isDialogOpen, setIsDialogOpen] = useState(false);
  const [isDeleting, setIsDeleting] = useState(false);
  const [deleteError, setDeleteError] = useState("");
  const [announcement, setAnnouncement] = useState("");
  const cancelButtonRef = useRef<HTMLButtonElement>(null);
  const headingRef = useRef<HTMLHeadingElement>(null);
  const countRef = useRef<number | null>(null);
  const mountedRef = useRef(false);

  const updateCount = useCallback((nextCount: number | null) => {
    countRef.current = nextCount;
    setCount(nextCount);
  }, []);

  const loadConversationCount = useCallback(async () => {
    if (!bridge) {
      updateCount(null);
      setIsLoadingCount(false);
      setCountError(t.settings.noBridge);
      return null;
    }
    setIsLoadingCount(true);
    setCountError("");
    try {
      const result = await bridge.request("conversation.count", {});
      if (mountedRef.current) updateCount(result.count);
      return result.count;
    } catch (error) {
      if (mountedRef.current) {
        setCountError(errorMessage(error, t.settings.conversationCountLoadFailed));
      }
      return null;
    } finally {
      if (mountedRef.current) setIsLoadingCount(false);
    }
  }, [bridge, updateCount]);

  useEffect(() => {
    mountedRef.current = true;
    void loadConversationCount();
    if (!bridge)
      return () => {
        mountedRef.current = false;
      };
    const unsubscribe = bridge.onEvent((event) => {
      if (event.event === "conversation.deletedAll") updateCount(0);
      else if (event.event === "conversation.stateChanged" && countRef.current === 0) {
        void loadConversationCount();
      }
    });
    return () => {
      mountedRef.current = false;
      unsubscribe();
    };
  }, [bridge, loadConversationCount, updateCount]);

  useEffect(() => {
    if (!announcement) return;
    const timeout = window.setTimeout(() => setAnnouncement(""), 4_000);
    return () => window.clearTimeout(timeout);
  }, [announcement]);

  async function openConfirmation() {
    if (!bridge || isLoadingCount || isDeleting) return;
    setDeleteError("");
    setAnnouncement("");
    const currentCount = await loadConversationCount();
    if (currentCount && currentCount > 0) setIsDialogOpen(true);
  }

  async function deleteAllConversations() {
    if (!bridge || isDeleting || count === null || count < 1) return;
    setIsDeleting(true);
    setDeleteError("");
    try {
      await bridge.request("conversation.deleteAll", {});
      updateCount(0);
      setIsDialogOpen(false);
      setAnnouncement(t.settings.conversationsDeleted);
      closeAllConversationPanes();
      clearAllConversationsFromIndex();
      window.requestAnimationFrame(() => headingRef.current?.focus());
    } catch (error) {
      setDeleteError(errorMessage(error, t.settings.deleteAllConversationsFailed));
    } finally {
      setIsDeleting(false);
    }
  }

  return (
    <section aria-labelledby="settings-data-title" className={styles.dataSection}>
      <h2 className={styles.dataHeading} id="settings-data-title" ref={headingRef} tabIndex={-1}>
        {t.settings.dataTitle}
      </h2>
      <div className={styles.dataRow}>
        <span className={styles.dataLabel}>{t.settings.deleteAllConversations}</span>
        <Button
          disabled={!bridge || isLoadingCount || isDeleting || count === 0}
          onClick={() => void openConfirmation()}
          variant="danger"
        >
          {count === 0 && !isLoadingCount
            ? t.settings.noConversations
            : t.settings.deleteAllConversationsAction}
        </Button>
      </div>
      <div className={styles.dataFeedback}>
        {isLoadingCount ? (
          <span className={styles.announcement} role="status">
            {t.settings.loadingConversationCount}
          </span>
        ) : null}
        {announcement ? (
          <span className={styles.announcement} role="status">
            {announcement}
          </span>
        ) : null}
        {countError ? (
          <div className={styles.errorState}>
            <p className={styles.errorMessage} role="alert">
              <CircleAlert aria-hidden="true" size={16} strokeWidth={1.8} />
              <span>{countError}</span>
            </p>
            <Button onClick={() => void loadConversationCount()} size="sm" variant="secondary">
              {t.settings.retry}
            </Button>
          </div>
        ) : null}
      </div>
      <Dialog
        description={t.settings.deleteAllConversationsDescription(count ?? 0)}
        initialFocusRef={cancelButtonRef as RefObject<HTMLElement | null>}
        onClose={() => {
          if (isDeleting) return;
          setIsDialogOpen(false);
          setDeleteError("");
        }}
        open={isDialogOpen}
        title={t.settings.deleteAllConversationsTitle}
        footer={
          <>
            <Button
              disabled={isDeleting}
              onClick={() => {
                setIsDialogOpen(false);
                setDeleteError("");
              }}
              ref={cancelButtonRef}
              variant="secondary"
            >
              {t.settings.deleteAllConversationsCancel}
            </Button>
            <Button
              disabled={isDeleting}
              onClick={() => void deleteAllConversations()}
              variant="danger"
            >
              {isDeleting
                ? t.settings.deletingConversations
                : t.settings.deleteAllConversationsConfirm}
            </Button>
          </>
        }
      >
        {deleteError ? (
          <p className={styles.errorMessage} role="alert">
            {deleteError}
          </p>
        ) : null}
      </Dialog>
    </section>
  );
}
