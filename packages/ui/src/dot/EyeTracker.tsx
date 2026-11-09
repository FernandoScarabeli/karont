import { type RefObject, useEffect, useId, useLayoutEffect, useRef, useState } from "react";
import { t } from "../i18n/pt-BR.ts";
import styles from "./EyeTracker.module.css";

/* Adaptado do Eye tracker do Bencho (bencho.dev), oferecido sob licença MIT.

   MIT License

   Copyright (c) 2026 Lorenzo Cabra

   Permission is hereby granted, free of charge, to any person obtaining a copy
   of this software and associated documentation files (the “Software”), to deal
   in the Software without restriction, including without limitation the rights
   to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
   copies of the Software, and to permit persons to whom the Software is
   furnished to do so, subject to the following conditions:

   The above copyright notice and this permission notice shall be included in all
   copies or substantial portions of the Software.

   THE SOFTWARE IS PROVIDED “AS IS”, WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
   IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
   FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
   AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
   LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
   OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
   SOFTWARE. */

/* ══ Eye tracker ═══════════════════════════════════════════
   A soul with two eyes that watches your cursor, wherever it is
   in the box it lives in.

   ── THE EYES ARE ON THE BODY, NOT IN FRONT OF IT ───────────
   The easy version slides two shapes toward the pointer, and it
   reads as stickers on a disc. Here each eye is a point on a
   sphere under the body's surface: looking left turns it, so an
   eye travels along the curve, and the one heading for the rim
   moves less and narrows as it turns away from you while the
   other swings wide. That foreshortening is the whole trick —
   it is what makes a flat shape read as something soft and round.

   One turn (yaw and pitch) is the state, sprung toward where
   the pointer is; both eyes are read off it, so they can never
   disagree. It relaxes back to facing you when the pointer
   leaves the box, and it blinks on its own now and then.

   Written straight to the DOM every frame, never through state:
   a pointer move is not a render. */

export type DotMood = "idle" | "working" | "needs-you" | "sleeping" | "done";
export type DotShape = "flame" | "veil" | "wisp";

/* ── one spring, for everything that settles ───────────────
   Velocity accumulates toward a target, is damped, and snaps
   when both the delta and the velocity fall under 0.02. The look
   (x, y), the eyes' size and height, and the body's rise all ride
   the same spring, so a change of mood is never a hard cut.

   Frames, not milliseconds. `dt` is expressed in sixtieths of
   a second, so a dropped frame moves the spring as far as the
   two frames it replaced.

   The loop parks itself the moment everything has settled, and
   wakes on a pointer move inside the box or on a timer (the next
   blink, the next glance). Nothing runs for ever. */
const EPSILON = 0.02;
const SPRING = 0.06;

/* Read once. A preference, not a live input. */
const stillness = () =>
  typeof window !== "undefined" &&
  !!window.matchMedia?.("(prefers-reduced-motion: reduce)").matches;

/* ── the eyes: one style, and where they rest ───────────────
   Two rounded rectangles, the same size as each other, so they
   ride the same sphere and blink the same way. Any difference in
   SIZE between the two is depth, worked out from the turn, never
   drawn in. A soul wants them small and oval.

   The face goes where you are: straight on, centred and level
   when you are on top of it, and it comes back to centre when
   the pointer leaves the box. */
const EYE = { w: 8, h: 14, r: 4 };
/* half the gap between the eyes, in the 100-unit viewBox */
const HALF_GAP = 9;
/* how far the face can travel from its resting spot, in the same
   units: a soul's face sits in a small part of its body, so the
   eyes stay inside the outline even looking far to a side */
const REACH_X = 16;
const REACH_Y = 10;
/* the sphere the eyes are worked out on, as a fraction of the
   half gap (what the depth of one eye against the other uses) */
const GAP = 0.19;
/* how far a look to a corner tilts the pair, in degrees at the
   rim — a glance up and right leans them back */
const TILT = 24;

const clamp = (v: number, a: number, b: number) => Math.min(b, Math.max(a, v));

/* ── the pose of each mood, in terms of the eyes and the body ─
   Eyes only, and the body's rise: nothing is drawn on top.
   `ew` and `eh` scale the eyes' width and height, `ey` moves the
   pair down (units), `by` moves the body down (units). */
type Pose = { ew: number; eh: number; ey: number; by: number };

const POSES: Record<DotMood, Pose> = {
  idle: { ew: 1, eh: 1, ey: 0, by: 0 },
  /* lower and narrow, like someone reading */
  working: { ew: 1.15, eh: 0.5, ey: 4, by: 0 },
  /* bigger, wide awake */
  "needs-you": { ew: 1.25, eh: 1.35, ey: -1, by: 0 },
  /* a thin line, and the soul settles a little lower */
  sleeping: { ew: 1.3, eh: 0.12, ey: 3, by: 4 },
  /* flat and lifted, the closest a rectangle gets to a happy ^ ^ */
  done: { ew: 1.2, eh: 0.4, ey: -4, by: 0 },
};

/* ── it talks back when you poke it ─────────────────────────
   A press on the toy opens a little chat bubble over it, types
   one short line into it a letter at a time, holds it to be
   read, and folds it away. Never the same line twice running. */
const LINES = t.dot.lines;
const KEY_MS = 38;
const HOLD_MS = 1500;
/* a hop, as a push of velocity on the body's rise */
const HOP = -1;
const HOP_EVERY_MS = 4200;
/* how long "done" shows its face before going back to idle */
const DONE_MS = 1700;
const BLINK_MS = 160;

/* ── the body, in three shapes ──────────────────────────────
   The eyes are worked out on a sphere whatever the body is, so
   the turn reads the same on all three; the body is only the
   outline they are clipped to. Each keeps the face's resting
   spot (`faceY`) in its upper third, inside the outline.
   The flame is round below and thins to a curved tip; the veil
   has a round top, straight sides and three soft waves along the
   hem; the fringe is a soft square with a short thread working
   loose from a bottom corner. */
const SHAPES: Record<DotShape, { path: string; faceY: number }> = {
  flame: {
    path: "M58 8 C61 8 62 11 61 14 C60 30 84 40 84 64 C84 83 69 94 50 94 C31 94 16 83 16 64 C16 44 36 36 45 24 C49 18 53 11 58 8 Z",
    faceY: 56,
  },
  veil: {
    path: "M14 46 C14 24 29 8 50 8 C71 8 86 24 86 46 L86 80 C86 88 82 92 77 91 C71 90 70 85 63 85 C57 85 56 91 50 91 C44 91 43 85 37 85 C30 85 29 90 23 91 C18 92 14 88 14 80 Z",
    faceY: 44,
  },
  wisp: {
    path: "M36 10 H64 C79 10 90 21 90 36 V62 C90 77 79 88 64 88 H46 C34 88 28 92 22 96 C16 99 8 97 8 91 C8 86 14 86 16 89 C18 91 19 88 16 84 C12 79 10 72 10 62 V36 C10 21 21 10 36 10 Z",
    faceY: 44,
  },
};

type EyeTrackerProps = {
  /* how far the face turns toward the pointer, 0..100 */
  follow?: number;
  /* how much the turn overshoots and settles, 0..100 */
  bounce?: number;
  size?: number;
  shape?: DotShape;
  mood?: DotMood;
  /* a dark body with light eyes, or the other way round */
  tone?: "dark" | "light";
  /* where the eyes rest, in the 100-unit viewBox; left unset, the
     shape's own */
  faceY?: number;
  /* a small mark rather than a toy: no listeners, no frame loop,
     no timers. Drawn once with the mood's face. */
  still?: boolean;
  /* the box it watches the pointer inside; left unset it is its
     own frame */
  within?: RefObject<HTMLElement | null>;
};

/* what the effect hands back to the mood effect */
type Engine = { setMood: (mood: DotMood, first?: boolean) => void; redraw: () => void };
type TimerKey = "blink" | "glance" | "rest" | "scan" | "hop" | "back";
type Key = keyof Pose | "x" | "y";
const KEYS: readonly Key[] = ["x", "y", "ew", "eh", "ey", "by"];

export function EyeTracker({
  follow = 60,
  bounce = 30,
  size = 100,
  shape = "flame",
  mood = "idle",
  tone = "dark",
  faceY,
  still = false,
  within,
}: EyeTrackerProps = {}) {
  const box = useRef<HTMLDivElement>(null);
  const eyes = useRef<(SVGGElement | null)[]>([]);
  const lift = useRef<SVGGElement>(null);
  const engine = useRef<Engine | null>(null);
  const knobs = useRef({ follow, bounce });
  knobs.current = { follow, bounce };
  const moodNow = useRef(mood);
  moodNow.current = mood;
  const face = faceY ?? SHAPES[shape].faceY;
  const faceNow = useRef(face);
  faceNow.current = face;

  const [typed, setTyped] = useState("");
  const [line, setLine] = useState("");
  const [talking, setTalking] = useState(false);
  const turn = useRef(0);
  const lastLine = useRef(-1);
  useEffect(
    () => () => {
      turn.current++;
    },
    [],
  );
  const poke = async () => {
    const mine = ++turn.current;
    const pool = LINES.map((_, i) => i).filter((i) => i !== lastLine.current);
    const i = pool[Math.floor(Math.random() * pool.length)] ?? 0;
    lastLine.current = i;
    const next = LINES[i] ?? "";
    const wait = (ms: number) => new Promise((r) => setTimeout(r, ms));
    setLine(next);
    setTyped("");
    setTalking(true);
    for (let k = 1; k <= next.length; k++) {
      await wait(KEY_MS + Math.random() * 30);
      if (mine !== turn.current) return;
      setTyped(next.slice(0, k));
    }
    await wait(HOLD_MS);
    if (mine !== turn.current) return;
    setTalking(false);
  };

  /* the size goes in as a custom property, never as a style
     attribute */
  const s = clamp(size, 16, 240);
  useLayoutEffect(() => {
    box.current?.style.setProperty("--eyt-size", `${s}px`);
  }, [s]);

  useLayoutEffect(() => {
    const el = box.current;
    if (!el) return;
    const calm = stillness();
    /* where the face is on the body (fractions of the reach),
       its speed, and where it is heading — one spring on each
       value, read as a turn when the eyes are drawn */
    const S: Record<Key, number> = { x: 0, y: 0, ew: 1, eh: 1, ey: 0, by: 0 };
    const V: Record<Key, number> = { x: 0, y: 0, ew: 0, eh: 0, ey: 0, by: 0 };
    const T: Record<Key, number> = { ...S };
    let raf = 0;
    let prev = 0;
    let blinkAt = -1e9;
    let eff: DotMood = moodNow.current;
    let pointerIn = false;
    const timers: Partial<Record<TimerKey, number>> = {};
    const at = (key: TimerKey, ms: number, fn: () => void) => {
      window.clearTimeout(timers[key]);
      timers[key] = window.setTimeout(fn, ms);
    };

    const draw = (now: number) => {
      /* a blink is 160ms down and up, as a squash on each eye */
      let lid = 1;
      const since = now - blinkAt;
      if (since < BLINK_MS) lid = 1 - 0.9 * Math.sin((since / BLINK_MS) * Math.PI);

      /* the turn that brings the front of the body to the face's
         spot: yaw about the vertical, pitch about the horizontal */
      const as = (v: number) => Math.asin(clamp(v, -0.92, 0.92));
      const yaw = as(S.x);
      const pitch = -as(S.y);
      const cy = Math.cos(yaw);
      const sy = Math.sin(yaw);
      const cp = Math.cos(pitch);
      const sp = Math.sin(pitch);
      /* the pair leans with a diagonal look and stands level on
         the axes: up-right and down-left lean one way, the other
         two the other, nothing straight on */
      const tilt = TILT * S.x * S.y;

      lift.current?.setAttribute("transform", `translate(0 ${S.by.toFixed(2)})`);

      [-GAP, GAP].forEach((x0, i) => {
        const g = eyes.current[i];
        if (!g) return;
        /* the eye as a point on the unit sphere, either side of
           the front, turned with the body */
        const z0 = Math.sqrt(1 - x0 * x0);
        const z1 = -x0 * sy + z0 * cy;
        const y2 = -z1 * sp;
        const z2 = z1 * cp;
        /* depth: the eye nearer the rim is further from you, so it
           is smaller all over and narrower still across the turn */
        const near = clamp(z2, 0, 1);
        const k = 0.45 + 0.55 * near;
        const sx = k * (0.7 + 0.3 * near);
        /* ── the size is written as a size, never as a scale ──
           A scale stretches the corner with the shape: an eye
           narrowed for depth or squashed by a blink had elliptical
           corners, rounder on one side than the other. Writing the
           width and height directly keeps every corner the same
           radius, clamped so it never exceeds half a side. */
        const w = EYE.w * S.ew * sx;
        const h = Math.max(0.6, EYE.h * S.eh * k * lid);
        const rect = g.firstElementChild as SVGRectElement | null;
        if (rect) {
          rect.setAttribute("x", (-w / 2).toFixed(2));
          rect.setAttribute("y", (-h / 2).toFixed(2));
          rect.setAttribute("width", w.toFixed(2));
          rect.setAttribute("height", h.toFixed(2));
          rect.setAttribute("rx", Math.min(EYE.r * S.ew, w / 2, h / 2).toFixed(2));
        }
        /* the pair stands HALF_GAP apart at rest; the turn moves
           the face by at most REACH_X and REACH_Y */
        const px = 50 + (x0 / GAP) * HALF_GAP * cy + z0 * sy * REACH_X;
        const py = faceNow.current + S.ey + y2 * REACH_Y;
        g.setAttribute(
          "transform",
          `translate(${px.toFixed(2)} ${py.toFixed(2)}) rotate(${tilt.toFixed(2)})`,
        );
      });
    };

    const settled = () =>
      KEYS.every((k) => Math.abs(T[k] - S[k]) < EPSILON && Math.abs(V[k]) < EPSILON);

    /* ── it only runs while it can be seen ───────────────────
       Off screen or in a background tab the loop stops; it starts
       again the moment the body comes back into view */
    let seen = true;
    const tick = (now: number) => {
      raf = 0;
      if (!seen || document.hidden) {
        prev = 0;
        return;
      }
      const dt = prev ? Math.min(2.5, (now - prev) / 16.67) : 1;
      prev = now;
      if (calm) {
        for (const k of KEYS) S[k] = T[k];
      } else {
        /* one spring for every value; Bounce loosens the damping */
        const d = 0.34 - (clamp(knobs.current.bounce, 0, 100) / 100) * 0.22;
        for (const k of KEYS) {
          V[k] += ((T[k] - S[k]) * SPRING - V[k] * d) * dt;
          S[k] += V[k] * dt;
        }
      }
      draw(now);
      /* parked when it has settled and no blink is under way */
      if (settled() && now - blinkAt > BLINK_MS) {
        for (const k of KEYS) {
          S[k] = T[k];
          V[k] = 0;
        }
        draw(now);
        prev = 0;
        return;
      }
      raf = requestAnimationFrame(tick);
    };
    const wake = () => {
      if (!raf && seen && !document.hidden && !still) raf = requestAnimationFrame(tick);
    };

    const setMood = (m: DotMood, first = false) => {
      eff = m;
      for (const key of ["rest", "scan", "hop", "back"] as const) window.clearTimeout(timers[key]);
      Object.assign(T, POSES[m], { x: 0, y: 0 });
      pointerIn = false;
      if (still || first) {
        for (const k of KEYS) {
          S[k] = T[k];
          V[k] = 0;
        }
      }
      if (still) {
        draw(performance.now());
        return;
      }
      if (m === "working") scan();
      if (m === "needs-you") {
        if (!first) V.by += HOP;
        at("hop", HOP_EVERY_MS, hop);
      }
      if (m === "done") {
        if (!first) V.by += HOP;
        /* then it goes back to idle visually, on the same spring */
        at("back", DONE_MS, () => {
          eff = "idle";
          Object.assign(T, POSES.idle);
          wake();
        });
      }
      if (first) draw(performance.now());
      wake();
    };
    engine.current = { setMood, redraw: () => draw(performance.now()) };

    /* ── working: a slow look from side to side, like reading ── */
    let dir = 1;
    function scan() {
      if (eff !== "working") return;
      dir = -dir;
      T.x = dir * 0.5;
      T.y = 0.2;
      wake();
      at("scan", 1500 + Math.random() * 600, scan);
    }
    /* ── needs-you: a little hop now and then ── */
    function hop() {
      if (eff !== "needs-you") return;
      V.by += HOP;
      wake();
      at("hop", HOP_EVERY_MS, hop);
    }

    if (still) {
      setMood(moodNow.current);
      return () => {
        engine.current = null;
      };
    }

    /* ── the face goes where you are ──────────────────────────
       A spot out along the pointer's direction, further the
       further away you are — so on top of it the face is dead
       centre, and off in a corner it is out by that corner's
       rim, turned, one eye smaller and the pair leaning. */
    /* ── only while you are in its box ──────────────────────
       It watches the pointer while the pointer is inside the
       box it was given, and faces front again the moment you
       leave — a wall of these all turning after a cursor
       crossing the page read as noise. The reach is measured
       against that box, so the eyes arrive at the rim as you
       arrive at its edge. Only an idle soul follows; the others
       keep to their own look. */
    const aim = (e: PointerEvent) => {
      if (eff !== "idle") return;
      const f = (within?.current ?? el).getBoundingClientRect();
      if (e.clientX < f.left || e.clientX > f.right || e.clientY < f.top || e.clientY > f.bottom) {
        if (pointerIn) rest();
        return;
      }
      pointerIn = true;
      const r = el.getBoundingClientRect();
      const dx = e.clientX - (r.left + r.width / 2);
      const dy = e.clientY - (r.top + r.height / 2);
      const d = Math.hypot(dx, dy) || 1;
      const reach = Math.max(60, Math.min(f.width, f.height) * 0.28);
      const far = Math.min(
        0.85,
        Math.tanh(d / reach) * (clamp(knobs.current.follow, 0, 100) / 100) * 1.5,
      );
      T.x = (dx / d) * far;
      T.y = (dy / d) * far;
      wake();
    };
    function rest() {
      pointerIn = false;
      if (eff === "idle") {
        T.x = 0;
        T.y = 0;
      }
      wake();
    }

    /* ── idle: straight ahead, and now and then a glance ──────
       Every 5 seconds it looks off in a random direction,
       holds it for a moment, and comes back to centre — unless
       the pointer is in the box, which it follows instead. */
    const glance = () => {
      if (eff === "idle" && !pointerIn) {
        const a = Math.random() * Math.PI * 2;
        const far = 0.45 + Math.random() * 0.25;
        T.x = Math.cos(a) * far;
        T.y = Math.sin(a) * far;
        wake();
        at("rest", 900, () => {
          if (eff === "idle" && !pointerIn) {
            T.x = 0;
            T.y = 0;
            wake();
          }
        });
      }
      at("glance", 5000, glance);
    };
    /* a blink now and then, never while it sleeps */
    const blink = () => {
      if (eff !== "sleeping") {
        blinkAt = performance.now();
        wake();
      }
      at("blink", 2600 + Math.random() * 3200, blink);
    };

    setMood(moodNow.current, true);
    at("blink", 2200, blink);
    at("glance", 5000, glance);

    const io =
      typeof IntersectionObserver === "undefined"
        ? null
        : new IntersectionObserver(([entry]) => {
            seen = entry?.isIntersecting ?? true;
            wake();
          });
    io?.observe(el);
    document.addEventListener("visibilitychange", wake);
    window.addEventListener("pointermove", aim, { passive: true });
    document.documentElement.addEventListener("pointerleave", rest);
    return () => {
      cancelAnimationFrame(raf);
      io?.disconnect();
      engine.current = null;
      for (const id of Object.values(timers)) window.clearTimeout(id);
      document.removeEventListener("visibilitychange", wake);
      window.removeEventListener("pointermove", aim);
      document.documentElement.removeEventListener("pointerleave", rest);
    };
  }, [still, within]);

  /* a change of mood is a new target for the same spring; a new
     resting height for the face is a redraw */
  const first = useRef(true);
  useLayoutEffect(() => {
    if (first.current) {
      first.current = false;
      return;
    }
    engine.current?.setMood(mood);
  }, [mood]);
  // biome-ignore lint/correctness/useExhaustiveDependencies: a new face height only asks for a redraw
  useLayoutEffect(() => {
    engine.current?.redraw();
  }, [face]);

  const clip = `eyt-clip-${useId().replace(/:/g, "")}`;
  const body = SHAPES[shape].path;
  const label = t.dot.mood[mood];

  const art = (
    <svg aria-hidden="true" className={styles.eytBall} focusable="false" viewBox="0 0 100 100">
      <defs>
        <clipPath id={clip}>
          <path d={body} />
        </clipPath>
      </defs>
      <g ref={lift}>
        <g className={styles.eytBreathe}>
          <path className={styles.eytBody} d={body} />
          <g clipPath={`url(#${clip})`}>
            {[0, 1].map((i) => (
              <g
                key={i}
                ref={(n) => {
                  eyes.current[i] = n;
                }}
              >
                <rect
                  className={styles.eytEye}
                  height={EYE.h}
                  rx={EYE.r}
                  width={EYE.w}
                  x={-EYE.w / 2}
                  y={-EYE.h / 2}
                />
              </g>
            ))}
          </g>
        </g>
      </g>
    </svg>
  );

  /* a still mark is a picture with a name; a live one is a group
     around a real button, so the poke is reachable by keyboard */
  if (still) {
    return (
      <div
        aria-label={label}
        className={styles.eyt}
        data-mood={mood}
        data-still
        data-tone={tone}
        ref={box}
        role="img"
      >
        <div className={styles.eytFloat}>{art}</div>
      </div>
    );
  }
  return (
    // biome-ignore lint/a11y/useSemanticElements: o nome do humor exige role=group num contêiner sem borda de fieldset.
    <div
      aria-label={label}
      className={styles.eyt}
      data-mood={mood}
      data-tone={tone}
      ref={box}
      role="group"
    >
      <div className={styles.eytFloat}>
        <button aria-label={t.dot.poke} className={styles.eytPoke} onClick={poke} type="button">
          {art}
        </button>
      </div>
      <span aria-hidden="true" className={styles.eytSay} data-on={talking || undefined}>
        <span>{typed}</span>
        <span className={styles.eytCaret} />
      </span>
      <span aria-live="polite" className={styles.eytLive}>
        {talking ? line : ""}
      </span>
    </div>
  );
}
