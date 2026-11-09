import {
  type ReactNode,
  type RefObject,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
} from "react";
import {
  DEFAULT_COLOR,
  normalizeHex,
  pickEyeColor,
  pickOutlineColor,
} from "../components/ColorPicker/color.ts";
import { t } from "../i18n/pt-BR.ts";
import styles from "./EyeTracker.module.css";
import { EYE, type EyeGeom, newEye, newLid, placeEye, placeLid } from "./face.ts";
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
   in the box it lives in, and leans after it. Eleven moods.

   ── THE EYES ARE ON THE BODY, NOT IN FRONT OF IT ───────────
   The easy version slides two shapes toward the pointer, and it
   reads as stickers on a disc. Here each eye is a point on a
   sphere under the body's surface: looking left turns it, so an
   eye travels along the curve, and the one heading for the rim
   moves less and narrows as it turns away from you while the
   other swings wide. That foreshortening is the whole trick —
   it is what makes a flat shape read as something soft and round.
   (The maths is in face.ts; tests check eye placement and
   lid geometry across the range of the look.)

   One turn (yaw and pitch) is the state, sprung toward where
   the pointer is; both eyes are read off it, so they can never
   disagree. It relaxes back to facing you when the pointer
   leaves the box, and it blinks on its own now and then.

   ── THE LID CHANGES THE EYE WITHOUT CHANGING THE ELEMENT ───
   A happy, sad, angry eye is the same rounded rectangle with a
   lid over it: a rounded rectangle in the body's colour, whose
   position and tilt ride the same spring as everything else.
   Covering from below leaves a half moon; from above, a slope.

   ── THE BODY FOLLOWS, THE HEM LAGS ─────────────────────────
   The same turn that moves the eyes leans and nudges the whole
   body, less than the eyes: it reads as a head that turns, and
   the body comes after. The hem of the veil is cloth. A second,
   slower and looser spring chases the body and is pushed the
   other way by its speed, so it trails behind a move and keeps
   swinging a little after the pointer stops.

   ── WHAT RUNS WHERE (this is the performance) ──────────────
   Almost nothing runs. The loop draws on every refresh while
   something moves — never throttled, so there is no stepping —
   and stops the moment everything has settled: a Dot at rest
   costs no frames. A blink, a glance, a pointer in the box, a
   change of mood wake it for as long as they last.

   - The body's lean is one `transform` on its own layer
     (will-change), so moving it never repaints the drawing.
   - Floating, hopping, shaking, breathing: CSS, on layers of
     their own, with nothing for the script to do.
   - Every sign (the "!", the z's, the spark, notes, "?", hearts,
     smoke, the tear) is an element of its own, outside the
     body's SVG. Animating something inside it repaints it all.
   - The SVG holds one path (fill and outline together) and the
     eyes. The loop writes an attribute only when the value,
     to a tenth, is not the one already there; `d` only when
     the cloth really moved.
   - The pointer only records where it is. The frame reads it,
     against measurements kept from the last resize or scroll:
     no layout is ever asked for on a pointer move. */

export type DotMood =
  | "idle"
  | "working"
  | "needs-you"
  | "sleeping"
  | "happy"
  | "sad"
  | "dancing"
  | "surprised"
  | "angry"
  | "confused"
  | "love";

/* ── one spring, for everything that settles ───────────────
   Velocity accumulates toward a target, is damped, and snaps
   when both the delta and the velocity fall under 0.02. The look
   (x, y), the eyes' size and height, the lids, the body's drop
   and tilt, the squash of a press and the opening of the hem all
   ride the same spring, so a change of mood is never a hard cut.

   Frames, not milliseconds: `dt` is the real time since the last
   frame in sixtieths of a second, so a dropped frame (or a 120 Hz
   screen) moves the spring exactly as far as the time that
   passed. */
const EPSILON = 0.02;
const EPSILON_CLOTH = 0.1;
const SPRING = 0.06;

/* Read once. A preference, not a live input. */
const stillness = () =>
  typeof window !== "undefined" &&
  !!window.matchMedia?.("(prefers-reduced-motion: reduce)").matches;

/* ── the room around the body ───────────────────────────────
   The drawing is 100 units wide, but the signs hang outside
   the body: the "!" at the right of the head, the z's rising
   from it, the notes beside it. The box reserves that room
   (22 each side, 24 above, 6 below) so nothing is cut, and
   the CSS box is the same ratio: 1.44 wide, 1.3 tall. */
const VIEW = { x: -22, y: -24, w: 144, h: 130 };

const clamp = (v: number, a: number, b: number) => Math.min(b, Math.max(a, v));

/* ── the pose of each mood ──────────────────────────────────
   `ew` and `eh` scale the eyes' width and height, `ey` moves the
   pair down (units), `by` the body down, `ea` makes the right eye
   bigger than the left, `lc` and `lr` are the lid (how much it
   covers, from below if positive, and its tilt, degrees), `sq` is
   the body's squash, `br` its tilt (degrees), `fl` how open the
   hem is (units a side) and `da` how much it dances. */
type Pose = {
  ew: number;
  eh: number;
  ey: number;
  by: number;
  ea: number;
  lc: number;
  lr: number;
  sq: number;
  br: number;
  fl: number;
  da: number;
};

const NEUTRAL: Pose = {
  ew: 1,
  eh: 1,
  ey: 0,
  by: 0,
  ea: 0,
  lc: 0,
  lr: 0,
  sq: 0,
  br: 0,
  fl: 0,
  da: 0,
};

/* `energy` is the hem's ripple against the calm one and `speed` its phase in
   radians a second (the ripple only runs while something moves, or in the moods
   that never stop); `live` is a mood whose body never rests (the spark, the
   dance), so the loop keeps going; `blink` lets it blink. Only an idle soul
   watches the pointer. */
type Spec = { pose: Pose; energy: number; speed: number; live: boolean; blink: boolean };

const spec = (pose: Partial<Pose>, rest: Omit<Spec, "pose">): Spec => ({
  pose: { ...NEUTRAL, ...pose },
  ...rest,
});

const MOODS: Record<DotMood, Spec> = {
  idle: spec({}, { energy: 1, speed: 1.9, live: false, blink: true }),
  /* a little narrowed, like someone following something */
  working: spec({ ew: 1.1, eh: 0.8, ey: 1 }, { energy: 1.8, speed: 5.6, live: true, blink: true }),
  /* big and round, straight at you */
  "needs-you": spec(
    { ew: 1.35, eh: 1.5, ey: -1 },
    { energy: 1.4, speed: 4.2, live: false, blink: true },
  ),
  /* a thin line, and the veil settles lower on its hem */
  sleeping: spec(
    { ew: 1.3, eh: 0.12, ey: 3, by: 6 },
    { energy: 0.2, speed: 0.8, live: false, blink: false },
  ),
  /* a half moon, the lid coming up from below; the hem opens */
  happy: spec(
    { ew: 1.15, eh: 1.1, ey: -1, lc: 0.6, fl: 4 },
    { energy: 1.2, speed: 3.4, live: false, blink: false },
  ),
  /* the lid slopes down and out, the whole body gives and sinks, the hem hangs */
  sad: spec(
    { ew: 1, eh: 1.05, ey: 2, by: 3, lc: -0.42, lr: -20, sq: 0.9, fl: -2 },
    { energy: 0.35, speed: 1.2, live: false, blink: false },
  ),
  dancing: spec(
    { ew: 1.15, eh: 1.1, ey: -1, lc: 0.6, fl: 3, da: 1 },
    { energy: 2, speed: 5, live: true, blink: false },
  ),
  /* round, big, and it stays that way */
  surprised: spec(
    { ew: 1.6, eh: 1.35, ey: -1, fl: 1 },
    { energy: 1.2, speed: 3, live: false, blink: false },
  ),
  /* the lid slopes in, toward the nose */
  angry: spec(
    { ew: 1.15, eh: 0.95, ey: 1, lc: -0.5, lr: 22 },
    { energy: 1.5, speed: 4.5, live: false, blink: false },
  ),
  /* one eye bigger, the head tilted */
  confused: spec({ ea: 0.45, br: 8 }, { energy: 1, speed: 2.4, live: false, blink: true }),
  /* the eyes become hearts (signs of their own); the real ones shrink away */
  love: spec({ ew: 0.01, eh: 0.01 }, { energy: 1.1, speed: 2.4, live: false, blink: false }),
};

type Key = keyof Pose | "x" | "y";
const KEYS: readonly Key[] = [
  "x",
  "y",
  "ew",
  "eh",
  "ey",
  "by",
  "ea",
  "lc",
  "lr",
  "sq",
  "br",
  "fl",
  "da",
];

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
/* how quickly the ripple's energy changes toward the mood's, per frame */
const ENERGY_EASE = 0.08;
const REST_PHASE = 0.4;

/* ── working: a spark that circles the veil ─────────────────
   An ellipse around the body, seen from a little above: the
   lower half of the loop is the near side, in front, and the
   upper half goes behind. The spark shrinks and dims behind. */
const ORBIT = { cx: 50, cy: 50, rx: 54, ry: 14 };
const ORBIT_SPEED = 2.2;
/* where it waits at the side of the body when it is not allowed to move */
const ORBIT_REST = 0.35;
const ORB_BEHIND_SCALE = 0.6;
/* how far the eyes turn after the spark, as a share of the full look */
const ORB_LOOK_X = 0.75;
const ORB_LOOK_Y = 0.4;

/* ── dancing: the loop never stops, and the hem shows ───────
   A beat of 560 ms (about 107 a minute). The body leans from
   side to side over two beats, landing at each end on a beat,
   with a hop in between; the hem is dragged harder than usual
   and opened a little on every landing, so it is the mood where
   the cloth shows most. Done here and not in CSS because the
   cloth has to be pushed by the body's own speed. */
const BEAT_MS = 560;
const DANCE_DX = 8;
const DANCE_ROLL = 9;
const DANCE_HOP = 7;
const DANCE_LAND = 0.9;
const DANCE_DRAG = 2.4;
const DANCE_KICK = 0.6;
/* where a still or calm dancer is caught: leaning, a little off the ground */
const DANCE_REST_BEAT = 0.8;

/* ── what the CSS does that the cloth should feel ───────────
   The hops, the shake, the startle and the vibration are CSS
   animations on the body's own layer. On the same clock, a timer
   gives the hem the push they would give it. `at` is in ms from
   the start of the cycle, `period` the cycle (0 for once). Keep
   these in step with the keyframes in the CSS. */
type Hit = { at: number; fl?: number; cl?: number };
const KICKS: Partial<Record<DotMood, { period: number; hits: readonly Hit[] }>> = {
  "needs-you": {
    period: 2600,
    hits: [
      { at: 0, fl: 0.5 },
      { at: 350, fl: 0.5 },
      { at: 1900, cl: 1.6 },
    ],
  },
  happy: {
    period: 1400,
    hits: [
      { at: 0, fl: 0.8 },
      { at: 420, fl: 0.6 },
    ],
  },
  surprised: { period: 0, hits: [{ at: 0, fl: 1.6, cl: 2 }] },
  angry: { period: 2800, hits: [{ at: 2200, cl: 1.8 }] },
};

/* ── it talks back when you poke it ─────────────────────────
   A press on the toy opens a little chat bubble over it, types
   one short line into it a letter at a time, holds it to be
   read, and folds it away. Never the same line twice running. */
const LINES = t.dot.lines;
const KEY_MS = 38;
const HOLD_MS = 1500;
const BLINK_MS = 160;

/* ── the signs, in the same units ───────────────────────────
   They are drawn at the size a big Dot wants. A small one needs
   more: under SIGN_BOOST_BELOW px they grow, up to double at
   the smallest, so the "!", the z and the spark still read. */
const SIGN_BOOST_BELOW = 48;
const SIGN_BOOST_RANGE = 28;
/* the "!" is a tapered bar over a round dot, centred on its own middle */
const BANG_BAR =
  "M-4.6 -22 Q-4.6 -26 0 -26 Q4.6 -26 4.6 -22 L2.7 5 Q2.5 7.5 0 7.5 Q-2.5 7.5 -2.7 5 Z";
const BANG_DOT = { cy: 15.5, r: 4.4 };
const Z_GLYPH = "M-6 -5.5 H6 L-6 5.5 H6";
const Z_STEPS = [1, 2, 3] as const;
/* an eighth note: a stem with a flag, and a tilted head */
const NOTE_STEM = "M2.5 4 V-9 C2.5 -5 8.5 -4 8 1.5";
const NOTE_HEAD = { cx: -0.5, cy: 4.5, rx: 3.6, ry: 2.7, rot: -20 };
const QUESTION = "M-4.5 -8 C-4.5 -14.5 5.5 -14.5 5.5 -8 C5.5 -3.5 0 -3.5 0 1.5";
const QUESTION_DOT = { cy: 7.2, r: 1.7 };
const HEART =
  "M0 7 C-11 -0.5 -9 -9 -4.2 -9 C-2 -9 -0.6 -7.8 0 -6.4 C0.6 -7.8 2 -9 4.2 -9 C9 -9 11 -0.5 0 7 Z";
const TEAR = "M0 -6 C3.2 -1.4 4.2 1.6 4.2 3.2 A4.2 4.2 0 0 1 -4.2 3.2 C-4.2 1.6 -3.2 -1.4 0 -6 Z";
const PUFF_R = 3.4;
/* the hearts are drawn big and shrunk to size: in an eye, and rising */
const HEART_EYE = 0.5;
const HEART_RISE = 0.6;

type EyeTrackerProps = {
  /* how far the face turns toward the pointer, 0..100 */
  follow?: number;
  /* how much the turn overshoots and settles, 0..100 */
  bounce?: number;
  size?: number;
  mood?: DotMood;
  /* the colour of the body, as hex; the eyes pick their own for
     contrast (never under 4.5:1) and the outline is worked out
     from it (never under 1.5:1) */
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
type TimerKey = "blink" | "glance" | "rest" | "kick";

/* the last values written, in tenths, so only a change is written */
type Written = {
  px: number;
  py: number;
  tilt: number;
  w: number;
  h: number;
  lw: number;
  lh: number;
  ly: number;
  lrot: number;
};
const unwritten = (): Written => ({
  px: NaN,
  py: NaN,
  tilt: NaN,
  w: NaN,
  h: NaN,
  lw: NaN,
  lh: NaN,
  ly: NaN,
  lrot: NaN,
});
const tenths = (v: number) => Math.round(v * 10);

/* ── the body's colour, the eyes' and the outline's ─────────
   All are written as custom properties on the frame. The eyes
   are one of the app's own two inks (the light one or the dark
   one, whichever the theme calls them), whichever contrasts
   more with the body, and pure black or white if neither
   clears 4.5:1. The outline is worked out from the body's own
   colour: always there, the same hue, lighter on a dark body and
   darker on a light one. */
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
  el.style.setProperty("--k-dot-body", body);
  el.style.setProperty("--k-dot-eye", eyes.color);
  el.style.setProperty("--k-dot-outline", pickOutlineColor(body));
}

/* a sign's drawing: a 40-unit square around its own centre, which is the point
   the sign is placed by */
function Glyph({
  className,
  n,
  children,
}: {
  className: string | undefined;
  n?: number;
  children: ReactNode;
}) {
  return (
    <span className={`${styles.eytGlyph} ${className}`} data-n={n}>
      <svg aria-hidden="true" focusable="false" viewBox="-20 -20 40 40">
        {children}
      </svg>
    </span>
  );
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
  const [reducedMotion, setReducedMotion] = useState(stillness);
  useEffect(() => {
    if (still) return;
    const media = window.matchMedia("(prefers-reduced-motion: reduce)");
    const sync = () => setReducedMotion(media.matches);
    sync();
    media.addEventListener("change", sync);
    return () => media.removeEventListener("change", sync);
  }, [still]);
  const box = useRef<HTMLDivElement>(null);
  const lean = useRef<HTMLSpanElement>(null);
  const eyes = useRef<(SVGGElement | null)[]>([]);
  const eyeRects = useRef<(SVGRectElement | null)[]>([]);
  const lidRects = useRef<(SVGRectElement | null)[]>([]);
  const bodyPath = useRef<SVGPathElement>(null);
  const orb = useRef<HTMLSpanElement>(null);
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
     attribute; so do the boost of the signs and the face's height */
  const s = clamp(size, 16, 240);
  const unit = useRef(s / 100);
  unit.current = s / 100;
  const boost = clamp(1 + (SIGN_BOOST_BELOW - s) / SIGN_BOOST_RANGE, 1, 2);
  useLayoutEffect(() => {
    const el = box.current;
    if (!el) return;
    el.style.setProperty("--eyt-size", `${s}px`);
    el.style.setProperty("--eyt-boost", String(boost));
  }, [s, boost]);
  useLayoutEffect(() => {
    box.current?.style.setProperty("--eyt-face", String(face));
  }, [face]);

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
    const calm = reducedMotion;
    /* a still mark and a calm one are drawn, not run */
    const frozen = still || calm;
    /* where the face is on the body (fractions of the reach), its
       speed, and where it is heading — one spring on each value */
    const S = { ...MOODS[moodNow.current].pose, x: 0, y: 0, cl: 0 };
    const V: Record<Key | "cl", number> = {
      x: 0,
      y: 0,
      ew: 0,
      eh: 0,
      ey: 0,
      by: 0,
      ea: 0,
      lc: 0,
      lr: 0,
      sq: 0,
      br: 0,
      fl: 0,
      da: 0,
      cl: 0,
    };
    const T: Record<Key, number> = { ...S };
    let raf = 0;
    let prev = 0;
    let blinkAt = -1e9;
    let eff: DotMood = moodNow.current;
    let pointerIn = false;
    /* the hem's ripple: a phase that runs on only while something moves, an
       energy that eases */
    let phase = REST_PHASE;
    let energy = MOODS[eff].energy;
    let orbit = ORBIT_REST;
    let beat = DANCE_REST_BEAT;
    let beatN = 0;
    let danceAt = 0;
    let kickSign = 1;
    /* the body's lean this frame (units, degrees, squash) */
    let bdx = 0;
    let bdy = 0;
    let broll = 0;
    let bsq = 0;
    let prevDx = 0;
    const timers: Partial<Record<TimerKey, number>> = {};
    const at = (key: TimerKey, ms: number, fn: () => void) => {
      window.clearTimeout(timers[key]);
      timers[key] = window.setTimeout(fn, ms);
    };

    /* what was last written: nothing is written twice */
    const wrote = [unwritten(), unwritten()];
    let wroteLean = "";
    const wroteHem = [NaN, NaN, NaN, NaN];
    let wroteFront = true;
    let wroteOrb = "";
    const geom: EyeGeom = newEye();
    const lid = newLid();

    /* the stage and the pointer are measured when they change, never on a move */
    const R = { left: 0, top: 0, right: 0, bottom: 0, w: 0, h: 0, cx: 0, cy: 0 };
    let stale = true;
    const ro =
      frozen || typeof ResizeObserver === "undefined"
        ? null
        : new ResizeObserver(() => {
            stale = true;
          });
    ro?.observe(el);
    let watched: HTMLElement | null = null;
    const measure = () => {
      stale = false;
      /* the box it watches is the parent's, which has no ref yet when this
         effect first runs: it is found, and watched, the first time it is read */
      const w = within?.current ?? null;
      if (w && w !== watched) {
        if (watched) ro?.unobserve(watched);
        ro?.observe(w);
        watched = w;
      }
      const f = (w ?? el).getBoundingClientRect();
      R.left = f.left;
      R.top = f.top;
      R.right = f.right;
      R.bottom = f.bottom;
      R.w = f.width;
      R.h = f.height;
      const r = el.getBoundingClientRect();
      R.cx = r.left + r.width / 2;
      R.cy = r.top + r.height / 2;
    };
    let ptX = 0;
    let ptY = 0;
    let ptDirty = false;

    /* the body's lean this frame, from the look, the dance and the pose */
    const bodyPose = () => {
      const sway = S.da * Math.cos(Math.PI * beat);
      const hop = S.da * Math.abs(Math.sin(Math.PI * beat));
      bdx = BODY_DX * S.x + sway * DANCE_DX;
      bdy = BODY_DY * S.y + S.by - hop * DANCE_HOP;
      broll = BODY_ROT * S.x + S.br + sway * DANCE_ROLL;
      bsq = S.sq + S.da * DANCE_LAND * (1 - hop / (S.da || 1)) ** 6;
    };

    const draw = () => {
      /* a blink is 160ms down and up, as a squash on each eye */
      let blink = 1;
      const since = performance.now() - blinkAt;
      if (since < BLINK_MS) blink = 1 - 0.9 * Math.sin((since / BLINK_MS) * Math.PI);

      /* the whole body, on its own layer: it travels, rolls about the pivot
         under the head and gives under a press, squashed about its foot. One
         matrix, so the layer is moved and nothing repaints. */
      const u = unit.current;
      const rad = (broll * Math.PI) / 180;
      const c = Math.cos(rad);
      const sn = Math.sin(rad);
      const sqx = 1 + SQUASH_X * bsq;
      const sqy = 1 - SQUASH_Y * bsq;
      const a = c * sqx;
      const b = sn * sqx;
      const cc = -sn * sqy;
      const d = c * sqy;
      const px = (PIVOT.x - VIEW.x) * u;
      const py = (PIVOT.y - VIEW.y) * u;
      const fx = (FOOT.x - VIEW.x) * u;
      const fy = (FOOT.y - VIEW.y) * u;
      const e = -(a * fx + cc * fy) + (c * (fx - px) - sn * (fy - py)) + px + bdx * u;
      const f = -(b * fx + d * fy) + (sn * (fx - px) + c * (fy - py)) + py + bdy * u;
      const tf = `matrix(${a.toFixed(4)},${b.toFixed(4)},${cc.toFixed(4)},${d.toFixed(4)},${e.toFixed(2)},${f.toFixed(2)})`;
      if (tf !== wroteLean) {
        wroteLean = tf;
        if (lean.current) lean.current.style.transform = tf;
      }

      /* the hem: written only when the cloth really moved */
      const cl = clamp(S.cl, -CLOTH_MAX, CLOTH_MAX);
      const fl = clamp(S.fl, FLARE_MIN, FLARE_MAX);
      const q0 = tenths(cl);
      const q1 = tenths(fl);
      const q2 = Math.round(phase * 50);
      const q3 = Math.round(energy * 20);
      if (q0 !== wroteHem[0] || q1 !== wroteHem[1] || q2 !== wroteHem[2] || q3 !== wroteHem[3]) {
        wroteHem[0] = q0;
        wroteHem[1] = q1;
        wroteHem[2] = q2;
        wroteHem[3] = q3;
        bodyPath.current?.setAttribute("d", veilPath(cl, phase, fl, energy));
      }

      for (let i = 0; i < 2; i++) {
        const g = eyes.current[i];
        const rect = eyeRects.current[i];
        const lidRect = lidRects.current[i];
        const w = wrote[i];
        if (!g || !rect || !lidRect || !w) continue;
        const side = i === 0 ? 0 : 1;
        placeEye(geom, side, S.x, S.y, faceNow.current, S.ey, S.ew, S.eh, S.ea, blink);
        const qx = tenths(geom.px);
        const qy = tenths(geom.py);
        const qt = tenths(geom.tilt);
        if (qx !== w.px || qy !== w.py || qt !== w.tilt) {
          w.px = qx;
          w.py = qy;
          w.tilt = qt;
          g.setAttribute(
            "transform",
            `translate(${geom.px.toFixed(1)} ${geom.py.toFixed(1)}) rotate(${geom.tilt.toFixed(1)})`,
          );
        }
        const qw = tenths(geom.w);
        const qh = tenths(geom.h);
        if (qw !== w.w || qh !== w.h) {
          w.w = qw;
          w.h = qh;
          rect.setAttribute("x", (-geom.w / 2).toFixed(1));
          rect.setAttribute("y", (-geom.h / 2).toFixed(1));
          rect.setAttribute("width", geom.w.toFixed(1));
          rect.setAttribute("height", geom.h.toFixed(1));
          rect.setAttribute("rx", geom.rx.toFixed(1));
        }
        placeLid(lid, geom, side, S.lc, S.lr);
        const lw = lid.show ? tenths(lid.w) : 0;
        const lh = lid.show ? tenths(lid.h) : 0;
        const ly = lid.show ? tenths(lid.y) : 0;
        const lrot = lid.show ? tenths(lid.rot) : 0;
        if (lw !== w.lw || lh !== w.lh || ly !== w.ly || lrot !== w.lrot) {
          w.lw = lw;
          w.lh = lh;
          w.ly = ly;
          w.lrot = lrot;
          if (lid.show) {
            lidRect.setAttribute("x", lid.x.toFixed(1));
            lidRect.setAttribute("y", lid.y.toFixed(1));
            lidRect.setAttribute("width", lid.w.toFixed(1));
            lidRect.setAttribute("height", lid.h.toFixed(1));
            lidRect.setAttribute("rx", lid.rx.toFixed(1));
            lidRect.setAttribute("transform", `rotate(${lid.rot.toFixed(1)})`);
          } else {
            lidRect.setAttribute("height", "0");
          }
        }
      }

      /* the spark: on the near half of the loop it is drawn over
         the body, on the far half under it, and smaller. Its own layer,
         moved and never repainted. */
      const o = orb.current;
      if (o && eff === "working") {
        const u2 = unit.current;
        const depth = Math.sin(orbit);
        const ox = (ORBIT.cx + ORBIT.rx * Math.cos(orbit) - VIEW.x) * u2;
        const oy = (ORBIT.cy + ORBIT.ry * depth - VIEW.y) * u2;
        const grow = ORB_BEHIND_SCALE + (1 - ORB_BEHIND_SCALE) * (0.5 + 0.5 * depth);
        const otf = `translate(${ox.toFixed(1)}px,${oy.toFixed(1)}px) scale(${grow.toFixed(2)})`;
        if (otf !== wroteOrb) {
          wroteOrb = otf;
          o.style.transform = otf;
        }
        const front = depth >= 0;
        if (front !== wroteFront) {
          wroteFront = front;
          o.toggleAttribute("data-front", front);
        }
      }
    };

    /* every spring has arrived, and the cloth is judged by what the eye can
       see, a tenth of a unit: its slow spring needs seconds to fall under the
       0.02 of the others, and the loop would run for a change nobody can see */
    const busy = () => {
      for (const k of KEYS) {
        if (Math.abs(T[k] - S[k]) >= EPSILON || Math.abs(V[k]) >= EPSILON) return true;
      }
      return Math.abs(S.cl) >= EPSILON_CLOTH || Math.abs(V.cl) >= EPSILON_CLOTH;
    };

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
      const gap = prev ? now - prev : 1000 / 60;
      prev = now;
      const dt = Math.min(2.5, gap / (1000 / 60));
      /* the ripple and the spark run on the clock, not on the spring's frames */
      const sec = Math.min(0.2, gap / 1000);
      if (stale) measure();
      if (ptDirty) {
        ptDirty = false;
        aim();
      }

      const cur = MOODS[eff];
      if (eff === "working") {
        orbit += ORBIT_SPEED * sec;
        T.x = Math.cos(orbit) * ORB_LOOK_X;
        T.y = Math.sin(orbit) * ORB_LOOK_Y;
      }
      if (eff === "dancing") {
        beat = (now - danceAt) / BEAT_MS;
        const n = Math.floor(beat);
        if (n !== beatN) {
          beatN = n;
          V.fl += DANCE_KICK;
        }
      }

      /* one spring for every value; Bounce loosens the damping */
      const damp = 0.34 - (clamp(knobs.current.bounce, 0, 100) / 100) * 0.22;
      for (const k of KEYS) {
        V[k] += ((T[k] - S[k]) * SPRING - V[k] * damp) * dt;
        S[k] += V[k] * dt;
      }
      bodyPose();
      /* the cloth: its own, slower spring, pushed the other way by how far the
         body just travelled (per frame, so the push does not depend on dt) */
      const drag = eff === "dancing" ? CLOTH_DRAG * DANCE_DRAG : CLOTH_DRAG;
      V.cl += (-S.cl * CLOTH_K - V.cl * CLOTH_D) * dt - (bdx - prevDx) * drag;
      S.cl += V.cl * dt;
      prevDx = bdx;

      /* the ripple only runs while the hem is moving, or in a mood that
         never rests: a hem at rest is not rewritten */
      const moving =
        cur.live ||
        Math.abs(S.cl) > EPSILON_CLOTH ||
        Math.abs(V.cl) > EPSILON_CLOTH ||
        Math.abs(V.fl) > EPSILON ||
        Math.abs(T.fl - S.fl) > EPSILON ||
        Math.abs(cur.energy - energy) > EPSILON;
      if (moving) phase += cur.speed * sec;
      energy += (cur.energy - energy) * Math.min(1, ENERGY_EASE * dt);

      /* everything has settled and no blink is under way: put what is left
         exactly where it was going, draw that last frame, and stop */
      const quiet = !cur.live && !busy() && now - blinkAt > BLINK_MS;
      if (quiet) {
        for (const k of KEYS) {
          S[k] = T[k];
          V[k] = 0;
        }
        S.cl = 0;
        V.cl = 0;
        energy = cur.energy;
        bodyPose();
        prevDx = bdx;
      }
      draw();
      if (quiet) {
        prev = 0;
        return;
      }
      raf = requestAnimationFrame(tick);
    };
    function wake() {
      if (!raf && seen && !document.hidden && !frozen) raf = requestAnimationFrame(tick);
    }

    /* the CSS cycles' pushes to the hem, on their clock */
    const startKicks = (m: DotMood) => {
      const k = KICKS[m];
      const first = k?.hits[0];
      if (!k || !first) return;
      let n = 0;
      const hit = () => {
        const h = k.hits[n];
        if (!h) return;
        if (seen && !document.hidden) {
          if (h.fl) V.fl += h.fl;
          if (h.cl) {
            V.cl += h.cl * kickSign;
            kickSign = -kickSign;
          }
          wake();
        }
        n += 1;
        const next = k.hits[n];
        if (next) at("kick", next.at - h.at, hit);
        else if (k.period > 0) {
          n = 0;
          at("kick", k.period - h.at + first.at, hit);
        }
      };
      at("kick", first.at, hit);
    };

    const setMood = (m: DotMood, first = false) => {
      eff = m;
      for (const key of ["rest", "kick"] as const) window.clearTimeout(timers[key]);
      Object.assign(T, MOODS[m].pose, { x: 0, y: 0 });
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
        energy = frozen ? MOODS[m].energy : energy;
      }
      if (frozen) {
        orbit = ORBIT_REST;
        phase = REST_PHASE;
        beat = DANCE_REST_BEAT;
        bodyPose();
        draw();
        return;
      }
      danceAt = performance.now() - beat * BEAT_MS;
      beatN = Math.floor(beat);
      startKicks(m);
      if (first) {
        bodyPose();
        prevDx = bdx;
        draw();
      }
      wake();
    };
    /* a press squashes the body; letting go springs it back, the hem opening */
    const press = (down: boolean) => {
      if (frozen) return;
      T.sq = down ? 1 : MOODS[eff].pose.sq;
      if (!down) V.fl += FLARE_KICK;
      wake();
    };
    engine.current = {
      setMood,
      redraw: () => {
        draw();
      },
      press,
    };

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
       keep to their own look (the working one follows its spark).
       The listener only writes down where the pointer is; the
       frame does the rest, against measurements kept from the
       last time the box changed. */
    const outside = (x: number, y: number) =>
      x < R.left || x > R.right || y < R.top || y > R.bottom;
    function aim() {
      if (eff !== "idle") return;
      if (outside(ptX, ptY)) {
        if (pointerIn) rest();
        return;
      }
      pointerIn = true;
      const dx = ptX - R.cx;
      const dy = ptY - R.cy;
      const d = Math.hypot(dx, dy) || 1;
      const reach = Math.max(60, Math.min(R.w, R.h) * 0.28);
      const far = Math.min(
        0.85,
        Math.tanh(d / reach) * (clamp(knobs.current.follow, 0, 100) / 100) * 1.5,
      );
      T.x = (dx / d) * far;
      T.y = (dy / d) * far;
    }
    const onMove = (e: PointerEvent) => {
      if (eff !== "idle") return;
      ptX = e.clientX;
      ptY = e.clientY;
      if (!stale && !pointerIn && outside(ptX, ptY)) return;
      ptDirty = true;
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
    const markStale = () => {
      stale = true;
    };

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
    /* a blink now and then, in the moods that blink */
    const blinkNow = () => {
      if (MOODS[eff].blink) {
        blinkAt = performance.now();
        wake();
      }
      at("blink", 2600 + Math.random() * 3200, blinkNow);
    };

    setMood(moodNow.current, true);
    at("blink", 2200, blinkNow);
    at("glance", 5000, glance);

    const io =
      typeof IntersectionObserver === "undefined"
        ? null
        : new IntersectionObserver(([entry]) => {
            seen = entry?.isIntersecting ?? true;
            stale = true;
            wake();
          });
    io?.observe(el);
    document.addEventListener("visibilitychange", wake);
    window.addEventListener("pointermove", onMove, { passive: true });
    window.addEventListener("scroll", markStale, { capture: true, passive: true });
    window.addEventListener("resize", markStale, { passive: true });
    document.documentElement.addEventListener("pointerleave", rest);
    return () => {
      cancelAnimationFrame(raf);
      io?.disconnect();
      ro?.disconnect();
      engine.current = null;
      for (const id of Object.values(timers)) window.clearTimeout(id);
      document.removeEventListener("visibilitychange", wake);
      window.removeEventListener("pointermove", onMove);
      window.removeEventListener("scroll", markStale, { capture: true });
      window.removeEventListener("resize", markStale);
      document.documentElement.removeEventListener("pointerleave", rest);
    };
  }, [still, within, reducedMotion]);

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
  // biome-ignore lint/correctness/useExhaustiveDependencies: tamanho e altura do rosto pedem um novo desenho
  useLayoutEffect(() => {
    engine.current?.redraw();
  }, [face, s]);

  const restPath = veilPath(0, 0, 0, 0);
  const label = t.dot.mood[mood];
  const on = (m: DotMood) => (mood === m ? true : undefined);

  const art = (
    <span className={styles.eytStage}>
      {/* the spark has its own layer, in front of the body or behind it */}
      <span className={styles.eytOrb} data-front data-on={on("working")} ref={orb}>
        <span className={styles.eytOrbBoost}>
          <span className={styles.eytOrbHalo} />
          <span className={styles.eytOrbCore} />
        </span>
      </span>
      <span className={styles.eytAct}>
        <span className={styles.eytLean} ref={lean}>
          <svg
            aria-hidden="true"
            className={styles.eytBall}
            focusable="false"
            viewBox={`${VIEW.x} ${VIEW.y} ${VIEW.w} ${VIEW.h}`}
          >
            <path className={styles.eytBody} d={restPath} ref={bodyPath} />
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
                  ref={(n) => {
                    eyeRects.current[i] = n;
                  }}
                  rx={EYE.r}
                  width={EYE.w}
                  x={-EYE.w / 2}
                  y={-EYE.h / 2}
                />
                <rect
                  className={styles.eytLid}
                  height={0}
                  ref={(n) => {
                    lidRects.current[i] = n;
                  }}
                  width={EYE.w}
                  x={-EYE.w / 2}
                  y={0}
                />
              </g>
            ))}
          </svg>
        </span>
      </span>

      {/* needs you: the "!", big, at the right of the head, in the attention colour */}
      <span className={`${styles.eytSign} ${styles.eytBang}`} data-on={on("needs-you")}>
        <Glyph className={styles.eytBangGlyph}>
          <path className={styles.eytBangShape} d={BANG_BAR} />
          <circle className={styles.eytBangShape} cy={BANG_DOT.cy} r={BANG_DOT.r} />
        </Glyph>
      </span>

      {/* asleep: three z's, one after another */}
      <span className={`${styles.eytSign} ${styles.eytSleep}`} data-on={on("sleeping")}>
        {Z_STEPS.map((n) => (
          <Glyph className={styles.eytZ} key={n} n={n}>
            <path className={styles.eytZGlyph} d={Z_GLYPH} />
          </Glyph>
        ))}
      </span>

      {/* dancing: a note rising each side */}
      {(["a", "b"] as const).map((k) => (
        <span
          className={`${styles.eytSign} ${styles.eytNotes}`}
          data-on={on("dancing")}
          data-side={k}
          key={k}
        >
          <Glyph className={styles.eytNote}>
            <path className={styles.eytNoteStem} d={NOTE_STEM} />
            <ellipse
              className={styles.eytNoteHead}
              cx={NOTE_HEAD.cx}
              cy={NOTE_HEAD.cy}
              rx={NOTE_HEAD.rx}
              ry={NOTE_HEAD.ry}
              transform={`rotate(${NOTE_HEAD.rot} ${NOTE_HEAD.cx} ${NOTE_HEAD.cy})`}
            />
          </Glyph>
        </span>
      ))}

      {/* confused: a question mark beside the head */}
      <span className={`${styles.eytSign} ${styles.eytQuestion}`} data-on={on("confused")}>
        <Glyph className={styles.eytQuestionGlyph}>
          <path className={styles.eytQuestionStem} d={QUESTION} />
          <circle className={styles.eytQuestionDot} cy={QUESTION_DOT.cy} r={QUESTION_DOT.r} />
        </Glyph>
      </span>

      {/* in love: the eyes are hearts, and now and then another rises */}
      {(["l", "r"] as const).map((k) => (
        <span
          className={`${styles.eytSign} ${styles.eytLoveEye}`}
          data-on={on("love")}
          data-side={k}
          key={k}
        >
          <Glyph className={styles.eytLoveEyeGlyph}>
            <path className={styles.eytLoveEyeShape} d={HEART} transform={`scale(${HEART_EYE})`} />
          </Glyph>
        </span>
      ))}
      <span className={`${styles.eytSign} ${styles.eytLove}`} data-on={on("love")}>
        <Glyph className={styles.eytHeart}>
          <path className={styles.eytHeartShape} d={HEART} transform={`scale(${HEART_RISE})`} />
        </Glyph>
      </span>

      {/* angry: smoke from the top of the head */}
      {(["l", "r"] as const).map((k) => (
        <span
          className={`${styles.eytSign} ${styles.eytSmoke}`}
          data-on={on("angry")}
          data-side={k}
          key={k}
        >
          <Glyph className={styles.eytPuff}>
            <circle className={styles.eytPuffShape} r={PUFF_R} />
          </Glyph>
        </span>
      ))}

      {/* sad: a tear that is born in the eye and runs down */}
      <span className={`${styles.eytSign} ${styles.eytTear}`} data-on={on("sad")}>
        <Glyph className={styles.eytTearGlyph}>
          <path className={styles.eytTearShape} d={TEAR} />
        </Glyph>
      </span>
    </span>
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
