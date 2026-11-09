import {
  type KeyboardEvent,
  type PointerEvent,
  useCallback,
  useEffect,
  useId,
  useLayoutEffect,
  useRef,
  useState,
} from "react";
import { t } from "../../i18n/pt-BR.ts";
import { ComposerPopover } from "../ComposerPopover/ComposerPopover.tsx";
import styles from "./ColorPicker.module.css";
import { DEFAULT_COLOR, type Hsv, hexToHsv, hsvToHex, normalizeHex, SWATCHES } from "./color.ts";

const clamp = (v: number, a: number, b: number) => Math.min(b, Math.max(a, v));

/* O passo das setas: 1 ponto de saturação, brilho ou grau; com Shift, 10. */
const STEP = 1;
const STEP_BIG = 10;

/* Um seletor de cor: campo de saturação e brilho, trilho de matiz, campo hex
   e amostras prontas. Feito aqui, sem dependência.

   Arrastar não passa por estado: o ponteiro, preso ao campo (pointer capture),
   escreve a posição direto em variáveis CSS do seletor, e quem o usa recebe a
   cor no máximo uma vez por quadro. O estado do React só é atualizado quando
   o gesto termina (soltar, tecla, amostra, hex). */
export function ColorPicker({
  value,
  onChange,
}: {
  /* a cor atual, em hex */
  value: string;
  /* chamada com "#rrggbb", no máximo uma vez por quadro durante um arrasto */
  onChange: (hex: string) => void;
}) {
  const root = useRef<HTMLDivElement>(null);
  const field = useRef<HTMLDivElement>(null);
  const track = useRef<HTMLDivElement>(null);
  const input = useRef<HTMLInputElement>(null);
  const onChangeRef = useRef(onChange);
  onChangeRef.current = onChange;
  const hsv = useRef<Hsv>(hexToHsv(value) ?? { h: 0, s: 0, v: 0 });
  const frame = useRef(0);
  const [committed, setCommitted] = useState(hsv.current);
  const ids = useId();

  /* escreve a cor atual no que está na tela, sem renderizar */
  const paint = useCallback(() => {
    const { h, s, v } = hsv.current;
    const hex = hsvToHex(hsv.current);
    const el = root.current;
    if (el) {
      el.style.setProperty("--k-cp-hue", String(h));
      el.style.setProperty("--k-cp-sat", String(s));
      el.style.setProperty("--k-cp-val", String(v));
      el.style.setProperty("--k-cp-color", hex);
    }
    const sat = Math.round(s * 100);
    const val = Math.round(v * 100);
    field.current?.setAttribute("aria-valuenow", String(sat));
    field.current?.setAttribute("aria-valuetext", t.colorPicker.fieldValue(sat, val));
    track.current?.setAttribute("aria-valuenow", String(Math.round(h)));
    track.current?.setAttribute("aria-valuetext", t.colorPicker.hueValue(Math.round(h)));
    if (input.current && document.activeElement !== input.current) input.current.value = hex;
  }, []);

  /* quem usa recebe a cor no máximo uma vez por quadro */
  const emit = useCallback(() => {
    if (frame.current) return;
    frame.current = requestAnimationFrame(() => {
      frame.current = 0;
      onChangeRef.current(hsvToHex(hsv.current));
    });
  }, []);
  useEffect(() => () => cancelAnimationFrame(frame.current), []);

  const set = useCallback(
    (next: Hsv) => {
      hsv.current = next;
      paint();
      emit();
    },
    [emit, paint],
  );
  const commit = useCallback(() => setCommitted({ ...hsv.current }), []);

  /* uma cor que veio de fora (outra amostra, outro seletor). Se for a mesma que
     o seletor já tem, nada muda: assim o matiz não pula ao passar por um cinza. */
  useLayoutEffect(() => {
    const next = normalizeHex(value);
    if (next && next !== hsvToHex(hsv.current)) {
      const parsed = hexToHsv(next);
      if (parsed) {
        hsv.current = {
          h: parsed.s === 0 || parsed.v === 0 ? hsv.current.h : parsed.h,
          s: parsed.s,
          v: parsed.v,
        };
        setCommitted({ ...hsv.current });
      }
    }
    paint();
  }, [value, paint]);

  /* ── o campo: saturação para a direita, brilho para cima ── */
  const fromField = (e: PointerEvent<HTMLDivElement>) => {
    const r = e.currentTarget.getBoundingClientRect();
    set({
      h: hsv.current.h,
      s: clamp((e.clientX - r.left) / r.width, 0, 1),
      v: 1 - clamp((e.clientY - r.top) / r.height, 0, 1),
    });
  };
  const onFieldDown = (e: PointerEvent<HTMLDivElement>) => {
    e.currentTarget.setPointerCapture(e.pointerId);
    e.currentTarget.focus();
    fromField(e);
  };
  const onFieldMove = (e: PointerEvent<HTMLDivElement>) => {
    if (e.currentTarget.hasPointerCapture(e.pointerId)) fromField(e);
  };
  const onFieldKey = (e: KeyboardEvent<HTMLDivElement>) => {
    const step = (e.shiftKey ? STEP_BIG : STEP) / 100;
    const { h, s, v } = hsv.current;
    const next =
      e.key === "ArrowRight"
        ? { h, s: clamp(s + step, 0, 1), v }
        : e.key === "ArrowLeft"
          ? { h, s: clamp(s - step, 0, 1), v }
          : e.key === "ArrowUp"
            ? { h, s, v: clamp(v + step, 0, 1) }
            : e.key === "ArrowDown"
              ? { h, s, v: clamp(v - step, 0, 1) }
              : null;
    if (!next) return;
    e.preventDefault();
    set(next);
    commit();
  };

  /* ── o trilho do matiz ── */
  const fromTrack = (e: PointerEvent<HTMLDivElement>) => {
    const r = e.currentTarget.getBoundingClientRect();
    set({ ...hsv.current, h: clamp((e.clientX - r.left) / r.width, 0, 1) * 360 });
  };
  const onTrackDown = (e: PointerEvent<HTMLDivElement>) => {
    e.currentTarget.setPointerCapture(e.pointerId);
    e.currentTarget.focus();
    fromTrack(e);
  };
  const onTrackMove = (e: PointerEvent<HTMLDivElement>) => {
    if (e.currentTarget.hasPointerCapture(e.pointerId)) fromTrack(e);
  };
  const onTrackKey = (e: KeyboardEvent<HTMLDivElement>) => {
    const step = e.shiftKey ? STEP_BIG : STEP;
    const h = hsv.current.h;
    const next =
      e.key === "ArrowRight" || e.key === "ArrowUp"
        ? clamp(h + step, 0, 360)
        : e.key === "ArrowLeft" || e.key === "ArrowDown"
          ? clamp(h - step, 0, 360)
          : e.key === "Home"
            ? 0
            : e.key === "End"
              ? 360
              : null;
    if (next === null) return;
    e.preventDefault();
    set({ ...hsv.current, h: next });
    commit();
  };

  /* ── o campo hex: #rgb ou #rrggbb; Enter ou sair confirmam, o inválido volta ── */
  const confirmHex = () => {
    const el = input.current;
    if (!el) return;
    const next = normalizeHex(el.value);
    const parsed = next ? hexToHsv(next) : null;
    if (parsed) {
      set({
        h: parsed.s === 0 || parsed.v === 0 ? hsv.current.h : parsed.h,
        s: parsed.s,
        v: parsed.v,
      });
      commit();
    }
    el.value = hsvToHex(hsv.current);
  };

  const current = hsvToHex(committed);
  return (
    // biome-ignore lint/a11y/useSemanticElements: o conjunto leva um nome, mas não tem borda de fieldset.
    <div aria-label={t.colorPicker.group} className={styles.picker} ref={root} role="group">
      <div
        aria-label={t.colorPicker.field}
        aria-valuemax={100}
        aria-valuemin={0}
        aria-valuenow={Math.round(committed.s * 100)}
        aria-valuetext={t.colorPicker.fieldValue(
          Math.round(committed.s * 100),
          Math.round(committed.v * 100),
        )}
        className={styles.field}
        onKeyDown={onFieldKey}
        onLostPointerCapture={commit}
        onPointerCancel={commit}
        onPointerDown={onFieldDown}
        onPointerMove={onFieldMove}
        ref={field}
        role="slider"
        tabIndex={0}
      >
        <span aria-hidden="true" className={styles.fieldThumb} />
      </div>

      <div
        aria-label={t.colorPicker.hue}
        aria-valuemax={360}
        aria-valuemin={0}
        aria-valuenow={Math.round(committed.h)}
        aria-valuetext={t.colorPicker.hueValue(Math.round(committed.h))}
        className={styles.hue}
        onKeyDown={onTrackKey}
        onLostPointerCapture={commit}
        onPointerCancel={commit}
        onPointerDown={onTrackDown}
        onPointerMove={onTrackMove}
        ref={track}
        role="slider"
        tabIndex={0}
      >
        <span aria-hidden="true" className={styles.hueThumb} />
      </div>

      <input
        aria-label={t.colorPicker.hex}
        autoComplete="off"
        className={styles.hex}
        defaultValue={current}
        id={`${ids}-hex`}
        maxLength={7}
        onBlur={confirmHex}
        onKeyDown={(e) => {
          if (e.key === "Enter") {
            e.preventDefault();
            confirmHex();
          }
        }}
        ref={input}
        spellCheck={false}
        type="text"
      />

      {/* biome-ignore lint/a11y/useSemanticElements: um grupo de botões de amostra, sem borda de fieldset. */}
      <div aria-label={t.colorPicker.swatches} className={styles.swatches} role="group">
        {SWATCHES.map((swatch) => (
          <button
            aria-label={t.colorPicker.swatch[swatch.id]}
            aria-pressed={swatch.hex === current}
            className={styles.swatch}
            key={swatch.id}
            onClick={() => {
              const parsed = hexToHsv(swatch.hex);
              if (!parsed) return;
              set({
                h: parsed.s === 0 || parsed.v === 0 ? hsv.current.h : parsed.h,
                s: parsed.s,
                v: parsed.v,
              });
              commit();
            }}
            ref={(n) => n?.style.setProperty("--k-cp-swatch", swatch.hex)}
            type="button"
          />
        ))}
      </div>
    </div>
  );
}

/* O botão redondo com a cor atual; abre o seletor num popover, como o do
   campo de mensagem: Esc e clique fora fecham, e o foco volta ao botão. */
export function ColorWell({ value, onChange }: { value: string; onChange: (hex: string) => void }) {
  const [open, setOpen] = useState(false);
  const button = useRef<HTMLButtonElement>(null);
  const hex = normalizeHex(value) ?? DEFAULT_COLOR;
  const close = useCallback(() => setOpen(false), []);
  return (
    <>
      <button
        aria-expanded={open}
        aria-haspopup="dialog"
        aria-label={t.colorPicker.well(hex)}
        className={styles.well}
        onClick={() => setOpen((o) => !o)}
        ref={(n) => {
          button.current = n;
          n?.style.setProperty("--k-cp-color", hex);
        }}
        type="button"
      />
      <ComposerPopover
        anchorRef={button}
        className={styles.popover}
        label={t.colorPicker.popover}
        onClose={close}
        open={open}
        placement="auto"
        role="dialog"
      >
        <ColorPicker onChange={onChange} value={hex} />
      </ComposerPopover>
    </>
  );
}
