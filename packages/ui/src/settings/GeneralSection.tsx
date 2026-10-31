import { CircleAlert } from "lucide-react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { getBridge } from "../bridge/index.ts";
import { Button } from "../components/Button/Button.tsx";
import { t } from "../i18n/pt-BR.ts";
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
        <div className={styles.choices}>
          {choices.map((choice) => (
            <label className={styles.choice} key={choice.value}>
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
    </section>
  );
}
