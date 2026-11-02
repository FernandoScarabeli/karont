import { useEffect, useRef, useState } from "react";
import { getRevealCeiling, planCharRelease } from "./streamingText.mjs";

type TypewriterOptions = { done: boolean };

export type TypewriterSnapshot = {
  text: string;
  frameId: number;
  frameStartedAt: number;
};

type PacerState = {
  revealedLength: number;
  carryChars: number;
  drainMsLeft: number;
  lastFrameTime: number | null;
  animationFrame: number | null;
};

const DRAIN_MS = 350;
const MAX_FRAME_MS = 100;
const FIRST_FRAME_MS = 16;

// Character-by-character reveal driven by one persistent rAF loop. It sleeps
// when caught up and is woken by new text, and it updates state at most once
// per frame.
export function useTypewriterText(text: string, { done }: TypewriterOptions): TypewriterSnapshot {
  const latestRef = useRef({ text, done });
  const pacerRef = useRef<PacerState>({
    revealedLength: 0,
    carryChars: 0,
    drainMsLeft: DRAIN_MS,
    lastFrameTime: null,
    animationFrame: null,
  });
  const wakeRef = useRef<() => void>(() => {});
  const [snapshot, setSnapshot] = useState<TypewriterSnapshot>({
    text: "",
    frameId: 0,
    frameStartedAt: 0,
  });

  useEffect(() => {
    const pacer = pacerRef.current;
    let disposed = false;

    const schedule = () => {
      if (pacer.animationFrame === null) {
        pacer.animationFrame = window.requestAnimationFrame(revealFrame);
      }
    };

    const revealFrame = (frameTime: number) => {
      pacer.animationFrame = null;
      if (disposed) return;

      const frameStartedAt = performance.now();
      const latest = latestRef.current;
      const ceiling = getRevealCeiling(latest.text, latest.done);
      const backlogChars = Math.max(0, ceiling - pacer.revealedLength);

      if (backlogChars <= 0) {
        pacer.lastFrameTime = null;
        pacer.drainMsLeft = DRAIN_MS;
        return;
      }

      const elapsedMs =
        pacer.lastFrameTime === null
          ? FIRST_FRAME_MS
          : Math.min(MAX_FRAME_MS, Math.max(0, frameTime - pacer.lastFrameTime));
      pacer.lastFrameTime = frameTime;

      const plan = planCharRelease({
        backlogChars,
        elapsedMs,
        done: latest.done,
        carryChars: pacer.carryChars,
        drainMsLeft: pacer.drainMsLeft,
      });
      pacer.carryChars = plan.carryChars;
      pacer.drainMsLeft = plan.drainMsLeft;

      if (plan.count > 0) {
        let nextLength = Math.min(latest.text.length, pacer.revealedLength + plan.count);
        // Never split a surrogate pair.
        const lastUnit = latest.text.charCodeAt(nextLength - 1);
        if (lastUnit >= 0xd800 && lastUnit <= 0xdbff && nextLength < latest.text.length) {
          nextLength += 1;
        }
        pacer.revealedLength = nextLength;
        const nextText = latest.text.slice(0, nextLength);
        setSnapshot((previous) => ({
          text: nextText,
          frameId: previous.frameId + 1,
          frameStartedAt,
        }));
      }

      if (plan.count < backlogChars) {
        schedule();
      } else {
        pacer.lastFrameTime = null;
      }
    };

    wakeRef.current = schedule;

    return () => {
      disposed = true;
      if (pacer.animationFrame !== null) window.cancelAnimationFrame(pacer.animationFrame);
      pacer.animationFrame = null;
      pacer.lastFrameTime = null;
      wakeRef.current = () => {};
    };
  }, []);

  useEffect(() => {
    latestRef.current = { text, done };
    wakeRef.current();
  }, [text, done]);

  return snapshot;
}
