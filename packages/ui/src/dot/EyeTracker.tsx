import { type RefObject, useEffect, useId, useLayoutEffect, useRef, useState } from "react";
import {
  DEFAULT_COLOR,
  needsOutline,
  normalizeHex,
  pickEyeColor,
} from "../components/ColorPicker/color.ts";
import { t } from "../i18n/pt-BR.ts";
import styles from "./EyeTracker.module.css";
import { VEIL_FACE_Y, veilPath } from "./veil.ts";

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
   A veil with two eyes that watches your cursor, wherever it is
   in the box it lives in, and leans after it.

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

   ── THE BODY FOLLOWS, THE HEM LAGS ─────────────────────────
   The same turn that moves the eyes leans and nudges the whole
   body, less than the eyes: it reads as a head that turns, and
   the body comes after. The hem of the veil is cloth. A second,
   slower and looser spring chases the body and is pushed the
   other way by its speed, so it trails behind a move and keeps
   swinging a little after the pointer stops.

   Written straight to the DOM every frame, never through state:
   a pointer move is not a render. */

export type DotMood = "idle" | "working" | "needs-you" | "sleeping" | "done";

/* ── one spring, for everything that settles ───────────────
   Velocity accumulates toward a target, is damped, and snaps
   when both the delta and the velocity fall under 0.02. The look
   (x, y), the eyes' size and height, the body's rise, the squash
   of a press and the opening of the hem all ride the same
   spring, so a change of mood is never a hard cut.

   Frames, not milliseconds. `dt` is expressed in sixtieths of
   a second, so a dropped frame moves the spring as far as the
   two frames it replaced.

   The loop parks itself the moment everything has settled, and
   wakes on a pointer move inside the box or on a timer (the next
   blink, the next glance). While only the hem is rippling it
   drops to 30 frames a second (20 asleep), and it never runs
   with the tab hidden or the body off screen. */
const EPSILON = 0.02;
const EPSILON_CLOTH = 0.1;
/* the tail of a move, under this, is slow enough for the ambient rate */
const EPSILON_TAIL = 0.08;
/* a hem swinging under this many units no longer needs every refresh */
const CLOTH_SLOW = 1.2;
const SPRING = 0.06;

/* Read once. A preference, not a live input. */
const stillness = () =>
  typeof window !== "undefined" &&
  !!window.matchMedia?.("(prefers-reduced-motion: reduce)").matches;

/* ── the room around the body ───────────────────────────────
   The drawing is 100 units wide, but the signs hang outside
   the body: the "!" at the right of the head, the z's rising
   from it, the spark circling it. The viewBox reserves that
   room (22 each side, 24 above, 6 below) so nothing is cut,
   and the CSS box is the same ratio: 1.44 wide, 1.3 tall. */
const VIEW = { x: -22, y: -24, w: 144, h: 130 };

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
   `ew` and `eh` scale the eyes' width and height, `ey` moves the
   pair down (units), `by` moves the body down (units). */
type Pose = { ew: number; eh: number; ey: number; by: number };

const POSES: Record<DotMood, Pose> = {
  idle: { ew: 1, eh: 1, ey: 0, by: 0 },
  /* a little narrowed, like someone following something */
  working: { ew: 1.1, eh: 0.8, ey: 1, by: 0 },
  /* big and round, straight at you */
  "needs-you": { ew: 1.35, eh: 1.5, ey: -1, by: 0 },
  /* a thin line, and the veil settles lower on its hem */
  sleeping: { ew: 1.3, eh: 0.12, ey: 3, by: 6 },
  /* flat and lifted, the closest a rectangle gets to a happy ^ ^ */
  done: { ew: 1.2, eh: 0.4, ey: -4, by: 0 },
};

/* ── the body follows the look ──────────────────────────────
   The look runs to ±0.85, so 8° and 6 units at full lean are
   about 7° and 5 units in practice. The pivot is under the head,
   where the shoulders end, so the head swings more than the hem
   (the hem has its own spring). The eyes travel REACH_X on the
   same turn, which is why they outrun the body. */
const BODY_ROT = 8;
const BODY_DX = 6;
const BODY_DY = 3;
const PIVOT = { x: 50, y: 72 };
/* where the squash of a press is anchored: the middle of the hem */
const FOOT = { x: 50, y: 92 };
const SQUASH_X = 0.08;
const SQUASH_Y = 0.1;

/* ── the cloth: a slower, looser spring ─────────────────────
   Stiffness 0.018 puts its swing at about 0.8 s; damping 0.05 is
   a fifth of critical, so it overshoots and takes a second or so
   to settle. `CLOTH_DRAG` converts the body's speed into a push
   the other way: a 6-unit move drags the hem about 8 units. */
const CLOTH_K = 0.018;
const CLOTH_D = 0.05;
const CLOTH_DRAG = 0.2;
const CLOTH_MAX = 12;
/* the hem opens up to this many units a side */
const FLARE_MAX = 9;
const FLARE_MIN = -2;
/* a release gives the hem this push (units per frame) */
const FLARE_KICK = 0.9;

/* ── what ripples the hem, per mood ─────────────────────────
   `speed` is the phase in radians a second, `energy` the
   amplitude against the calm one. Sleeping barely stirs, work
   is busy. `fps` is the frame rate while nothing else moves; the
   one that is following a spark never has nothing else, so it
   keeps every refresh (60 means no throttle). */
const AMBIENT: Record<DotMood, { speed: number; energy: number; fps: number }> = {
  idle: { speed: 1.9, energy: 1, fps: 30 },
  working: { speed: 5.6, energy: 1.8, fps: 60 },
  "needs-you": { speed: 4.2, energy: 1.4, fps: 30 },
  sleeping: { speed: 0.8, energy: 0.2, fps: 20 },
  done: { speed: 3.4, energy: 1.2, fps: 30 },
};
/* how quickly the energy changes toward the mood's, per frame */
const ENERGY_EASE = 0.08;
const REST_PHASE = 0.4;
/* the browser grants a frame up to one refresh late: wait that much less */
const AMBIENT_SLACK_MS = 8;

/* ── working: a spark that circles the veil ─────────────────
   An ellipse around the body, seen from a little above: the
   lower half of the loop is the near side, in front, and the
   upper half goes behind. The spark shrinks and dims behind. */
const ORBIT = { cx: 50, cy: 50, rx: 54, ry: 14 };
const ORBIT_SPEED = 2.2;
/* where it waits at the side of the body when it is not allowed to move */
const ORBIT_REST = 0.35;
const ORB_CORE = 6;
const ORB_HALO = 12.5;
const ORB_BEHIND_SCALE = 0.6;
/* how far the eyes turn after the spark, as a share of the full look */
const ORB_LOOK_X = 0.75;
const ORB_LOOK_Y = 0.4;

/* ── needs-you: two short hops, a pause, a shake ────────────
   A cycle of 2.6 s: a hop at 0 and one at 0.35 s, then still,
   then from 1.9 s a quick shake from side to side that dies
   out by 2.3 s. The hops are pushes on the body's rise; the
   shake is a few units of sideways travel and a hint of roll. */
const CYCLE_MS = 2600;
const HOP2_AT = 350;
const SHAKE_FROM = 1900;
const SHAKE_MS = 400;
const SHAKE_X = 3;
const SHAKE_ROLL = 2.5;
const SHAKE_WAGS = 4;
const SMALL_HOP = -0.6;

/* ── it talks back when you poke it ─────────────────────────
   A press on the toy opens a little chat bubble over it, types
   one short line into it a letter at a time, holds it to be
   read, and folds it away. Never the same line twice running. */
const LINES = t.dot.lines;
const KEY_MS = 38;
const HOLD_MS = 1500;
/* a hop, as a push of velocity on the body's rise */
const HOP = -1;
/* the big jump of "done" */
const BIG_HOP = -2.2;
const DONE_FLARE = 1.4;
/* how long "done" shows its face before going back to idle */
const DONE_MS = 1700;
const BLINK_MS = 160;

/* ── the signs, in the same units ───────────────────────────
   They are drawn at the size a big Dot wants. A small one needs
   more: under SIGN_BOOST_BELOW px they grow, up to double at
   the smallest, so the "!", the z and the spark still read. */
const SIGN_BOOST_BELOW = 48;
const SIGN_BOOST_RANGE = 28;
const BANG_AT = { x: 100, y: 33 };
const SLEEP_AT = { x: 86, y: 26 };
/* the "!" is a tapered bar over a round dot, centred on its own middle */
const BANG_BAR =
  "M-4.6 -22 Q-4.6 -26 0 -26 Q4.6 -26 4.6 -22 L2.7 5 Q2.5 7.5 0 7.5 Q-2.5 7.5 -2.7 5 Z";
const BANG_DOT = { cy: 15.5, r: 4.4 };
const Z_GLYPH = "M-6 -5.5 H6 L-6 5.5 H6";
const Z_COUNT = 3;

type EyeTrackerProps = {
  /* how far the face turns toward the pointer, 0..100 */
  follow?: number;
  /* how much the turn overshoots and settles, 0..100 */
  bounce?: number;
  size?: number;
  mood?: DotMood;
  /* the colour of the body, as hex; the eyes pick their own for
     contrast (never under 4.5:1) */
  color?: string;
  /* where the eyes rest, in the 100-unit viewBox; left unset, the
     veil's own */
  faceY?: number;
  /* a small mark rather than a toy: no listeners, no frame loop,
     no timers. Drawn once with the mood's face and its sign. */
  still?: boolean;
  /* the box it watches the pointer inside; left unset it is its
     own frame */
  within?: RefObject<HTMLElement | null>;
};

/* what the effect hands back to the mood effect */
type Engine = {
  setMood: (mood: DotMood, first?: boolean) => void;
  redraw: () => void;
  press: (down: boolean) => void;
};
type TimerKey = "blink" | "glance" | "rest" | "scan" | "back" | "ambient";
type Key = keyof Pose | "x" | "y" | "cl" | "fl" | "sq";
const KEYS: readonly Key[] = ["x", "y", "ew", "eh", "ey", "by", "cl", "fl", "sq"];

/* ── the body's colour and the eyes' ────────────────────────
   Both are written as custom properties on the frame. The eyes
   are one of the app's own two inks (the light one or the dark
   one, whichever the theme calls them), whichever contrasts
   more with the body, and pure black or white if neither
   clears 4.5:1. A body too close to the app's background to
   read as a shape gets a quiet outline. */
function paint(el: HTMLElement, color: string) {
  const body = normalizeHex(color) ?? DEFAULT_COLOR;
  const cs = getComputedStyle(el);
  const token = (name: string, fallback: string) =>
    normalizeHex(cs.getPropertyValue(name)) ?? fallback;
  const eyes = pickEyeColor(
    body,
    token("--k-color-primary", "#f3eee3"),
    token("--k-color-on-primary", "#141415"),
  );
  const ground = token("--k-color-bg-app", "#0f0f10");
  el.style.setProperty("--k-dot-body", body);
  el.style.setProperty("--k-dot-eye", eyes.color);
  el.toggleAttribute("data-rim", needsOutline(body, ground));
}

export function EyeTracker({
  follow = 60,
  bounce = 30,
  size = 100,
  mood = "idle",
  color = DEFAULT_COLOR,
  faceY,
  still = false,
  within,
}: EyeTrackerProps = {}) {
  const box = useRef<HTMLDivElement>(null);
  const eyes = useRef<(SVGGElement | null)[]>([]);
  const lift = useRef<SVGGElement>(null);
  const bodyPath = useRef<SVGPathElement>(null);
  const rimPath = useRef<SVGPathElement>(null);
  const clipPathEl = useRef<SVGPathElement>(null);
  const orbs = useRef<(SVGGElement | null)[]>([]);
  const engine = useRef<Engine | null>(null);
  const knobs = useRef({ follow, bounce });
  knobs.current = { follow, bounce };
  const moodNow = useRef(mood);
  moodNow.current = mood;
  const face = faceY ?? VEIL_FACE_Y;
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

  /* the colour goes in the same way; a change of theme or accent
     changes the inks the eyes choose from, so it is read again */
  useLayoutEffect(() => {
    const el = box.current;
    if (!el) return;
    paint(el, color);
    if (typeof MutationObserver === "undefined") return;
    const watcher = new MutationObserver(() => paint(el, color));
    watcher.observe(document.documentElement, { attributes: true });
    return () => watcher.disconnect();
  }, [color]);

  useLayoutEffect(() => {
    const el = box.current;
    if (!el) return;
    const calm = stillness();
    /* a still mark and a calm one are drawn, not run */
    const frozen = still || calm;
    /* where the face is on the body (fractions of the reach),
       its speed, and where it is heading — one spring on each
       value, read as a turn when the eyes are drawn */
    const S: Record<Key, number> = { x: 0, y: 0, ew: 1, eh: 1, ey: 0, by: 0, cl: 0, fl: 0, sq: 0 };
    const V: Record<Key, number> = { x: 0, y: 0, ew: 0, eh: 0, ey: 0, by: 0, cl: 0, fl: 0, sq: 0 };
    const T: Record<Key, number> = { ...S };
    let raf = 0;
    let prev = 0;
    let blinkAt = -1e9;
    let eff: DotMood = moodNow.current;
    let pointerIn = false;
    /* the hem's ripple: a phase that only ever runs on, an energy that eases */
    let phase = REST_PHASE;
    let energy = AMBIENT[eff].energy;
    let orbit = ORBIT_REST;
    let shake = 0;
    let cycleAt = 0;
    let cycleN = 0;
    let hop1 = true;
    let hop2 = false;
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

      /* the whole body: it travels, rolls about the pivot under the
         head and gives under a press, squashed about its foot */
      const roll = BODY_ROT * S.x + shake * SHAKE_ROLL;
      const sqx = 1 + SQUASH_X * S.sq;
      const sqy = 1 - SQUASH_Y * S.sq;
      lift.current?.setAttribute(
        "transform",
        `translate(${(BODY_DX * S.x + shake * SHAKE_X).toFixed(2)} ${(BODY_DY * S.y + S.by).toFixed(2)}) rotate(${roll.toFixed(2)} ${PIVOT.x} ${PIVOT.y}) translate(${FOOT.x} ${FOOT.y}) scale(${sqx.toFixed(3)} ${sqy.toFixed(3)}) translate(${-FOOT.x} ${-FOOT.y})`,
      );

      /* the outline: the same string on the body, its rim and the
         clip the eyes are cut to, so nothing leaves the cloth */
      const outline = veilPath(
        clamp(S.cl, -CLOTH_MAX, CLOTH_MAX),
        phase,
        clamp(S.fl, FLARE_MIN, FLARE_MAX),
        energy,
      );
      bodyPath.current?.setAttribute("d", outline);
      rimPath.current?.setAttribute("d", outline);
      clipPathEl.current?.setAttribute("d", outline);

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

      /* the spark: on the near half of the loop it is drawn over
         the body, on the far half under it, and smaller */
      const depth = Math.sin(orbit);
      const ox = ORBIT.cx + ORBIT.rx * Math.cos(orbit);
      const oy = ORBIT.cy + ORBIT.ry * depth;
      const grow = ORB_BEHIND_SCALE + (1 - ORB_BEHIND_SCALE) * (0.5 + 0.5 * depth);
      const nowFront = depth >= 0;
      orbs.current.forEach((g, i) => {
        if (!g) return;
        const mine = i === 0 ? nowFront : !nowFront;
        if (mine !== (g.getAttribute("display") !== "none")) {
          g.setAttribute("display", mine ? "inline" : "none");
        }
        if (mine) {
          g.setAttribute(
            "transform",
            `translate(${ox.toFixed(2)} ${oy.toFixed(2)}) scale(${grow.toFixed(3)})`,
          );
        }
      });
    };

    /* the cloth is judged by what the eye can see, a tenth of a unit: its
       slow spring needs seconds to fall under the 0.02 of the others, and the
       loop would run at full rate all that time for a change nobody can see */
    const settled = () =>
      KEYS.every((k) => {
        const e = k === "cl" ? EPSILON_CLOTH : EPSILON;
        return Math.abs(T[k] - S[k]) < e && Math.abs(V[k]) < e;
      });

    /* ── it only runs while it can be seen ───────────────────
       Off screen or in a background tab the loop stops; it starts
       again the moment the body comes back into view */
    let seen = true;
    const tick = (now: number) => {
      raf = 0;
      window.clearTimeout(timers.ambient);
      if (!seen || document.hidden) {
        prev = 0;
        return;
      }
      const dt = prev ? Math.min(2.5, (now - prev) / 16.67) : 1;
      /* the ripple and the spark run on the clock, not on the spring's frames */
      const sec = prev ? Math.min(0.2, (now - prev) / 1000) : 1 / 60;
      prev = now;

      /* ── what the mood itself does, frame by frame ── */
      const amb = AMBIENT[eff];
      phase += amb.speed * sec;
      energy += (amb.energy - energy) * Math.min(1, ENERGY_EASE * dt);
      if (eff === "working") {
        orbit += ORBIT_SPEED * sec;
        const ox = Math.cos(orbit);
        const oy = Math.sin(orbit);
        T.x = ox * ORB_LOOK_X;
        T.y = oy * ORB_LOOK_Y;
      }
      shake = 0;
      let shaking = false;
      if (eff === "needs-you") {
        const run = now - cycleAt;
        const n = Math.floor(run / CYCLE_MS);
        const w = run - n * CYCLE_MS;
        if (n !== cycleN) {
          cycleN = n;
          hop1 = false;
          hop2 = false;
        }
        if (!hop1) {
          hop1 = true;
          V.by += SMALL_HOP;
        }
        if (!hop2 && w >= HOP2_AT) {
          hop2 = true;
          V.by += SMALL_HOP;
        }
        if (w >= SHAKE_FROM && w < SHAKE_FROM + SHAKE_MS) {
          const p = (w - SHAKE_FROM) / SHAKE_MS;
          shake = Math.sin(p * Math.PI * 2 * SHAKE_WAGS) * (1 - p);
          shaking = true;
        }
      }

      const before = S.x;
      if (frozen) {
        for (const k of KEYS) S[k] = T[k];
      } else {
        /* one spring for every value; Bounce loosens the damping */
        const d = 0.34 - (clamp(knobs.current.bounce, 0, 100) / 100) * 0.22;
        for (const k of KEYS) {
          if (k === "cl") continue;
          V[k] += ((T[k] - S[k]) * SPRING - V[k] * d) * dt;
          S[k] += V[k] * dt;
        }
        /* the cloth: its own, slower spring, pushed the other way by
           how far the body just travelled */
        V.cl += (-S.cl * CLOTH_K - V.cl * CLOTH_D - (S.x - before) * BODY_DX * CLOTH_DRAG) * dt;
        S.cl += V.cl * dt;
      }
      draw(now);

      /* when everything has settled and no blink or shake is under way,
         only the ripple (and the cycle's next hop) is left: the next
         frame is asked for at the mood's slower rate, not at every
         refresh. Some half a frame is taken off the wait because the
         browser adds the rest when it grants the frame. */
      const quiet = settled() && now - blinkAt > BLINK_MS && !shaking;
      if (quiet) {
        /* what is left under the threshold is put exactly where it was going */
        for (const k of KEYS) {
          S[k] = T[k];
          V[k] = 0;
        }
      }
      /* a hem still swinging by a unit or less is slow enough to follow at the
         ambient rate too: only a real move needs every refresh */
      const hot =
        !quiet &&
        (KEYS.some((k) => k !== "cl" && Math.abs(T[k] - S[k]) + Math.abs(V[k]) >= EPSILON_TAIL) ||
          now - blinkAt <= BLINK_MS ||
          shaking ||
          Math.abs(S.cl) > CLOTH_SLOW ||
          Math.abs(V.cl) > CLOTH_SLOW / 10);
      if (!hot && amb.fps < 60) {
        const wait = 1000 / amb.fps - (performance.now() - now) - AMBIENT_SLACK_MS;
        timers.ambient = window.setTimeout(wake, Math.max(0, wait));
        return;
      }
      raf = requestAnimationFrame(tick);
    };
    function wake() {
      if (!raf && seen && !document.hidden && !frozen) raf = requestAnimationFrame(tick);
    }

    const setMood = (m: DotMood, first = false) => {
      eff = m;
      for (const key of ["rest", "scan", "back"] as const) window.clearTimeout(timers[key]);
      Object.assign(T, POSES[m], { x: 0, y: 0 });
      pointerIn = false;
      if (m === "working") {
        T.x = Math.cos(orbit) * ORB_LOOK_X;
        T.y = Math.sin(orbit) * ORB_LOOK_Y;
      }
      if (frozen || first) {
        for (const k of KEYS) {
          S[k] = T[k];
          V[k] = 0;
        }
        energy = frozen ? AMBIENT[m].energy : energy;
      }
      if (frozen) {
        orbit = ORBIT_REST;
        phase = REST_PHASE;
        shake = 0;
        draw(performance.now());
        return;
      }
      cycleAt = performance.now();
      cycleN = 0;
      hop1 = true;
      hop2 = false;
      if (m === "needs-you" && !first) V.by += HOP;
      if (m === "done") {
        if (!first) {
          V.by += BIG_HOP;
          V.fl += DONE_FLARE;
        }
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
    /* a press squashes the body; letting go springs it back, the hem opening */
    const press = (down: boolean) => {
      if (frozen) return;
      T.sq = down ? 1 : 0;
      if (!down) V.fl += FLARE_KICK;
      wake();
    };
    engine.current = { setMood, redraw: () => draw(performance.now()), press };

    if (frozen) {
      setMood(moodNow.current, true);
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
       keep to their own look (the working one follows its spark). */
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
  const restPath = veilPath(0, 0, 0, 0);
  const label = t.dot.mood[mood];
  const boost = clamp(1 + (SIGN_BOOST_BELOW - s) / SIGN_BOOST_RANGE, 1, 2);

  /* the spark, drawn twice: once under the body and once over it,
     and only the one on the side it is passing is shown */
  const orb = (key: string, hidden: boolean) => (
    <g
      className={styles.eytOrb}
      display={hidden ? "none" : undefined}
      key={key}
      ref={(n) => {
        orbs.current[key === "front" ? 0 : 1] = n;
      }}
    >
      <g transform={`scale(${boost})`}>
        <circle className={styles.eytOrbHalo} r={ORB_HALO} />
        <circle className={styles.eytOrbCore} r={ORB_CORE} />
      </g>
    </g>
  );

  const art = (
    <svg
      aria-hidden="true"
      className={styles.eytBall}
      focusable="false"
      viewBox={`${VIEW.x} ${VIEW.y} ${VIEW.w} ${VIEW.h}`}
    >
      <defs>
        <clipPath id={clip}>
          <path d={restPath} ref={clipPathEl} />
        </clipPath>
      </defs>
      {orb("back", true)}
      <g ref={lift}>
        <g className={styles.eytBreathe}>
          <path className={styles.eytBody} d={restPath} ref={bodyPath} />
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
          <path className={styles.eytRim} d={restPath} ref={rimPath} />
        </g>
      </g>
      {orb("front", false)}
      <g transform={`translate(${BANG_AT.x} ${BANG_AT.y})`}>
        <g className={styles.eytBang}>
          <g transform={`scale(${boost})`}>
            <path className={styles.eytBangShape} d={BANG_BAR} />
            <circle className={styles.eytBangShape} cy={BANG_DOT.cy} r={BANG_DOT.r} />
          </g>
        </g>
      </g>
      <g transform={`translate(${SLEEP_AT.x} ${SLEEP_AT.y})`}>
        <g className={styles.eytSleep}>
          {Array.from({ length: Z_COUNT }, (_, i) => (
            // biome-ignore lint/suspicious/noArrayIndexKey: três z fixos, na ordem
            <g className={styles.eytZ} data-n={i + 1} key={i}>
              <g transform={`scale(${boost})`}>
                <path className={styles.eytZGlyph} d={Z_GLYPH} />
              </g>
            </g>
          ))}
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
        ref={box}
        role="img"
      >
        <div className={styles.eytFloat}>{art}</div>
      </div>
    );
  }
  const press = (down: boolean) => engine.current?.press(down);
  return (
    // biome-ignore lint/a11y/useSemanticElements: o nome do humor exige role=group num contêiner sem borda de fieldset.
    <div aria-label={label} className={styles.eyt} data-mood={mood} ref={box} role="group">
      <div className={styles.eytFloat}>
        <button
          aria-label={t.dot.poke}
          className={styles.eytPoke}
          onBlur={() => press(false)}
          onClick={poke}
          onKeyDown={(e) => {
            if ((e.key === "Enter" || e.key === " ") && !e.repeat) press(true);
          }}
          onKeyUp={() => press(false)}
          onPointerCancel={() => press(false)}
          onPointerDown={() => press(true)}
          onPointerLeave={() => press(false)}
          onPointerUp={() => press(false)}
          type="button"
        >
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
