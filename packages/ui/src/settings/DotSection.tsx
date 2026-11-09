import { type Dot, type DotFields, dotFieldsSchema } from "@karont/contract";
import { useEffect, useMemo, useRef, useState } from "react";
import { getBridge } from "../bridge/index.ts";
import { Button } from "../components/Button/Button.tsx";
import { ColorWell } from "../components/ColorPicker/ColorPicker.tsx";
import { Dialog } from "../components/Dialog/Dialog.tsx";
import { TextField } from "../components/TextField/TextField.tsx";
import { EyeTracker } from "../dot/EyeTracker.tsx";
import { t } from "../i18n/pt-BR.ts";
import { useNavigation } from "../navigation/NavigationContext.tsx";
import styles from "./DotSection.module.css";
import { dotFields as copy, dotPatch, mergeDotDraft } from "./dotDraft.ts";

const same = (a: DotFields, b: DotFields) => JSON.stringify(a) === JSON.stringify(b);

export function DotSection() {
  const bridge = useMemo(getBridge, []);
  const { setLeaveGuard } = useNavigation();
  const [saved, setSaved] = useState<Dot | null>(null);
  const [draft, setDraft] = useState<DotFields | null>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const [message, setMessage] = useState("");
  const [pending, setPending] = useState<(() => void) | null>(null);
  const current = useRef({ saved, draft });
  current.current = { saved, draft };
  const mounted = useRef(false);
  const dirty = !!saved && !!draft && !same(copy(saved), draft);

  async function load() {
    setLoading(true);
    setError("");
    try {
      if (!bridge) throw new Error();
      const dot = await bridge.request("dot.get", {});
      if (!mounted.current) return;
      setSaved(dot);
      setDraft(copy(dot));
    } catch {
      if (mounted.current) setError(t.dotSettings.unavailable);
    } finally {
      if (mounted.current) setLoading(false);
    }
  }

  useEffect(() => {
    mounted.current = true;
    // Inscrever antes da leitura evita perder mudanças de outra janela.
    let received = false;
    const unsubscribe = bridge?.onEvent((event) => {
      if (event.event !== "dot.updated") return;
      received = true;
      const { saved: old, draft: edit } = current.current;
      if (!old || !edit || same(copy(old), edit)) setDraft(copy(event.payload));
      else {
        const merged = mergeDotDraft(old, edit, event.payload);
        current.current = { saved: event.payload, draft: merged };
        setDraft(merged);
        setMessage(t.dotSettings.conflict);
      }
      setSaved(event.payload);
    });
    setLoading(true);
    void (async () => {
      try {
        if (!bridge) throw new Error();
        const dot = await bridge.request("dot.get", {});
        if (mounted.current && !received) {
          setSaved(dot);
          setDraft(copy(dot));
        }
      } catch {
        if (mounted.current) setError(t.dotSettings.unavailable);
      } finally {
        if (mounted.current) setLoading(false);
      }
    })();
    return () => {
      mounted.current = false;
      unsubscribe?.();
    };
  }, [bridge]);

  useEffect(() => {
    if (!dirty && !saving) return;
    setLeaveGuard((proceed) => {
      setPending(() => proceed);
      return true;
    });
    const beforeUnload = (event: BeforeUnloadEvent) => {
      event.preventDefault();
    };
    window.addEventListener("beforeunload", beforeUnload);
    return () => {
      setLeaveGuard(null);
      window.removeEventListener("beforeunload", beforeUnload);
    };
  }, [dirty, saving, setLeaveGuard]);

  async function save() {
    if (!draft || !saved || !bridge || saving) return;
    const parsed = dotFieldsSchema.safeParse(draft);
    if (!parsed.success) {
      setError(t.dotSettings.invalidName);
      return;
    }
    setSaving(true);
    setError("");
    setMessage("");
    // Só os campos alterados sobrescrevem dados de outras janelas.
    const baseline = copy(saved);
    const patch = dotPatch(baseline, parsed.data);
    try {
      const dot = await bridge.request("dot.update", patch);
      if (mounted.current) {
        setSaved(dot);
        setDraft(copy(dot));
        setMessage(t.dotSettings.saved);
      }
    } catch {
      if (mounted.current) setError(t.dotSettings.saveFailed);
    } finally {
      if (mounted.current) setSaving(false);
    }
  }

  return (
    <section className={styles.section} aria-labelledby="dot-settings-title">
      <h2 className={styles.heading} id="dot-settings-title">
        {t.dotSettings.title}
      </h2>
      <p className={styles.note}>{t.dotSettings.upcoming}</p>
      {loading ? <p role="status">{t.dotSettings.loading}</p> : null}
      {!loading && !draft ? (
        <Button onClick={() => void load()}>{t.dotSettings.retry}</Button>
      ) : null}
      {draft ? (
        <>
          <div className={styles.preview}>
            <EyeTracker color={draft.color} size={96} />
          </div>
          <fieldset className={styles.fields} disabled={loading || saving}>
            <TextField
              label={t.dotSettings.name}
              maxLength={80}
              value={draft.name}
              onChange={(event) => {
                setDraft({ ...draft, name: event.currentTarget.value });
                setMessage("");
              }}
            />
            <div className={styles.row}>
              <span>{t.dotSettings.color}</span>
              <ColorWell
                value={draft.color}
                onChange={(color) => {
                  setDraft({ ...draft, color });
                  setMessage("");
                }}
              />
            </div>
            <fieldset className={styles.fields}>
              <legend>{t.dotSettings.personality}</legend>
              {(["explanation", "playfulness", "boldness"] as const).map((axis) => (
                <label className={styles.axis} key={axis}>
                  <span>
                    {t.dotSettings[axis]} <output>{draft.personality[axis]}</output>
                  </span>
                  <input
                    type="range"
                    min={0}
                    max={100}
                    step={1}
                    value={draft.personality[axis]}
                    onChange={(event) => {
                      setDraft({
                        ...draft,
                        personality: {
                          ...draft.personality,
                          [axis]: Number(event.currentTarget.value),
                        },
                      });
                      setMessage("");
                    }}
                  />
                </label>
              ))}
            </fieldset>
            <label className={styles.row}>
              <input
                type="checkbox"
                checked={draft.enabled}
                onChange={(event) => {
                  setDraft({ ...draft, enabled: event.currentTarget.checked });
                  setMessage("");
                }}
              />
              {t.dotSettings.enabled}
            </label>
            <div className={styles.actions}>
              <Button disabled={!dirty} onClick={() => void save()}>
                {saving ? t.dotSettings.saving : t.dotSettings.save}
              </Button>
              <Button
                variant="ghost"
                disabled={!dirty}
                onClick={() => {
                  if (saved) setDraft(copy(saved));
                  setError("");
                  setMessage("");
                }}
              >
                {t.dotSettings.cancel}
              </Button>
            </div>
          </fieldset>
        </>
      ) : null}
      {error ? (
        <p className={styles.error} role="alert">
          {error}
        </p>
      ) : null}
      <span className={styles.note} role="status">
        {message}
      </span>
      <Dialog
        open={!!pending}
        onClose={() => setPending(null)}
        title={t.dotSettings.discardTitle}
        description={t.dotSettings.discardDescription}
        footer={
          <>
            <Button variant="ghost" onClick={() => setPending(null)}>
              {t.dotSettings.stay}
            </Button>
            <Button
              disabled={saving}
              onClick={() => {
                const proceed = pending;
                setLeaveGuard(null);
                setPending(null);
                proceed?.();
              }}
            >
              {t.dotSettings.discard}
            </Button>
          </>
        }
      />
    </section>
  );
}
