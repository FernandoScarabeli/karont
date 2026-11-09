import { Check, CircleAlert } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { useAccent } from "../appearance/AccentProvider.tsx";
import { ACCENTS, type AccentId } from "../appearance/accent.ts";
import { t } from "../i18n/pt-BR.ts";
import styles from "./AppearanceSection.module.css";

export function AppearanceSection() {
  const { accent, saveAccent } = useAccent();
  const [error, setError] = useState("");
  const [announcement, setAnnouncement] = useState("");
  const mountedRef = useRef(false);

  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
    };
  }, []);

  useEffect(() => {
    if (!announcement) return;
    const timeout = window.setTimeout(() => setAnnouncement(""), 4_000);
    return () => window.clearTimeout(timeout);
  }, [announcement]);

  async function choose(id: AccentId) {
    setError("");
    setAnnouncement("");
    try {
      await saveAccent(id);
      if (mountedRef.current) setAnnouncement(t.settings.accentSaved);
    } catch (caught) {
      if (mountedRef.current) {
        setError(
          caught instanceof Error && caught.message ? caught.message : t.settings.accentSaveFailed,
        );
      }
    }
  }

  return (
    <section aria-labelledby="settings-appearance-title" className={styles.section}>
      <h2 className={styles.heading} id="settings-appearance-title">
        {t.settings.appearance}
      </h2>

      <fieldset className={styles.group}>
        <legend className={styles.legend}>{t.settings.accentTitle}</legend>
        <div className={styles.options}>
          {ACCENTS.map((option) => (
            <label className={styles.option} key={option.id}>
              <input
                checked={accent === option.id}
                className={styles.input}
                name="accent"
                onChange={() => void choose(option.id)}
                type="radio"
                value={option.id}
              />
              <span aria-hidden="true" className={styles.swatch} data-accent={option.id}>
                {accent === option.id ? (
                  <Check className={styles.check} size={16} strokeWidth={3} />
                ) : null}
              </span>
              <span className={styles.name}>{option.name}</span>
            </label>
          ))}
        </div>
      </fieldset>

      <span className={styles.announcement} role="status">
        {announcement}
      </span>
      {error ? (
        <p className={styles.errorMessage} role="alert">
          <CircleAlert aria-hidden="true" size={16} />
          {error}
        </p>
      ) : null}
    </section>
  );
}
