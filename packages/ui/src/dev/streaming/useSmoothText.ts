import { useEffect, useRef, useState } from "react";
import { planWordRelease, splitIntoTokens } from "./streamingText.mjs";

type SmoothTextOptions = { done: boolean };

type SmoothTextSnapshot = {
  text: string;
  frameId: number;
  frameStartedAt: number;
};

type PacerState = {
  revealedLength: number;
  carryWords: number;
  drainMsLeft: number;
  lastFrameTime: number | null;
  animationFrame: number | null;
  stalledSince: number | null;
  valveOpen: boolean;
};

type BoundaryCache = { text: string; done: boolean; valve: boolean; ends: number[] };

const DRAIN_MS = 350;
// An open markdown marker can hold the text back; after this long the holds are lifted.
const STALL_VALVE_MS = 1500;
const MAX_FRAME_MS = 100;
const FIRST_FRAME_MS = 16;

export function useSmoothText(text: string, { done }: SmoothTextOptions): SmoothTextSnapshot {
  const latestRef = useRef({ text, done });
  const pacerRef = useRef<PacerState>({
    revealedLength: 0,
    carryWords: 0,
    drainMsLeft: DRAIN_MS,
    lastFrameTime: null,
    animationFrame: null,
    stalledSince: null,
    valveOpen: false,
  });
  const wakeRef = useRef<() => void>(() => {});
  const [snapshot, setSnapshot] = useState<SmoothTextSnapshot>({
    text: "",
    frameId: 0,
    frameStartedAt: 0,
  });

  // One loop for the whole component lifetime. It runs while there is backlog
  // and goes to sleep when caught up; new text wakes it. Nothing is cancelled
  // or rescheduled per chunk.
  useEffect(() => {
    const pacer = pacerRef.current;
    let disposed = false;
    let boundaryCache: BoundaryCache | null = null;

    const getBoundaryEnds = (
      currentText: string,
      currentDone: boolean,
      valve: boolean,
    ): number[] => {
      if (
        boundaryCache !== null &&
        boundaryCache.text === currentText &&
        boundaryCache.done === currentDone &&
        boundaryCache.valve === valve
      ) {
        return boundaryCache.ends;
      }
      const ends = splitIntoTokens(currentText, currentDone, { valve }).map((token) => token.end);
      boundaryCache = { text: currentText, done: currentDone, valve, ends };
      return ends;
    };

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
      const ends = getBoundaryEnds(latest.text, latest.done, pacer.valveOpen);
      const firstPending = ends.findIndex((end) => end > pacer.revealedLength);
      const startIndex = firstPending === -1 ? ends.length : firstPending;
      const backlogWords = ends.length - startIndex;

      if (backlogWords <= 0) {
        pacer.lastFrameTime = null;
        // Text held only by an open marker: keep polling until the valve opens.
        const heldByMarker =
          !pacer.valveOpen &&
          splitIntoTokens(latest.text, latest.done, { valve: true }).some(
            (token) => token.end > pacer.revealedLength,
          );
        if (!heldByMarker) {
          pacer.stalledSince = null;
          pacer.valveOpen = false;
          return;
        }
        pacer.stalledSince ??= frameTime;
        if (frameTime - pacer.stalledSince >= STALL_VALVE_MS) {
          pacer.valveOpen = true;
          pacer.stalledSince = null;
        }
        schedule();
        return;
      }

      pacer.stalledSince = null;

      const elapsedMs =
        pacer.lastFrameTime === null
          ? FIRST_FRAME_MS
          : Math.min(MAX_FRAME_MS, Math.max(0, frameTime - pacer.lastFrameTime));
      pacer.lastFrameTime = frameTime;

      const plan = planWordRelease({
        backlogWords,
        elapsedMs,
        done: latest.done,
        carryWords: pacer.carryWords,
        drainMsLeft: pacer.drainMsLeft,
      });
      pacer.carryWords = plan.carryWords;
      pacer.drainMsLeft = plan.drainMsLeft;

      if (plan.count > 0) {
        const nextLength = ends[startIndex + plan.count - 1] ?? pacer.revealedLength;
        pacer.revealedLength = nextLength;
        const nextText = latest.text.slice(0, nextLength);
        setSnapshot((previous) => ({
          text: nextText,
          frameId: previous.frameId + 1,
          frameStartedAt,
        }));
      }

      if (plan.count < backlogWords) {
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
