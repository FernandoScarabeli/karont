import { useEffect, useRef, useState } from "react";
import { flushSync } from "react-dom";
import { alignRevealEnd, DRAIN_MS, getRevealCeiling, planCharRelease } from "./typewriter.ts";

const FIRST_FRAME_MS = 16;
const MAX_FRAME_MS = 100;

type Pacer = {
  revealed: number;
  carry: number;
  drainMsLeft: number;
  lastFrameTime: number | null;
  frame: number | null;
};

// Revela `text` caractere a caractere. Um único loop de rAF cuida do ritmo; ele
// dorme quando está em dia e acorda com texto novo. O estado só muda no máximo
// uma vez por quadro, e só o componente que usa o hook re-renderiza.
export function useTypewriterText(text: string, done: boolean): string {
  const [revealed, setRevealed] = useState("");
  const latestRef = useRef({ text, done });
  const wakeRef = useRef<() => void>(() => {});

  useEffect(() => {
    const pacer: Pacer = {
      revealed: 0,
      carry: 0,
      drainMsLeft: DRAIN_MS,
      lastFrameTime: null,
      frame: null,
    };
    let disposed = false;

    const schedule = () => {
      if (pacer.frame === null) pacer.frame = window.requestAnimationFrame(revealFrame);
    };

    const revealFrame = (frameTime: number) => {
      pacer.frame = null;
      if (disposed) return;

      const { text: latestText, done: latestDone } = latestRef.current;
      const ceiling = getRevealCeiling(latestText, latestDone);
      if (pacer.revealed > ceiling) {
        pacer.revealed = ceiling;
        pacer.carry = 0;
        const clampedText = latestText.slice(0, ceiling);
        flushSync(() => setRevealed(clampedText));
      }

      const backlog = ceiling - pacer.revealed;
      if (backlog <= 0) {
        pacer.lastFrameTime = null;
        pacer.carry = 0;
        pacer.drainMsLeft = DRAIN_MS;
        return;
      }

      const elapsedMs =
        pacer.lastFrameTime === null
          ? FIRST_FRAME_MS
          : Math.min(MAX_FRAME_MS, Math.max(0, frameTime - pacer.lastFrameTime));
      pacer.lastFrameTime = frameTime;

      const plan = planCharRelease({
        backlogChars: backlog,
        elapsedMs,
        done: latestDone,
        carryChars: pacer.carry,
        drainMsLeft: pacer.drainMsLeft,
      });
      pacer.carry = plan.carryChars;
      pacer.drainMsLeft = plan.drainMsLeft;

      if (plan.count > 0) {
        pacer.revealed = alignRevealEnd(latestText, pacer.revealed + plan.count);
        const nextText = latestText.slice(0, pacer.revealed);
        // flushSync: o DOM novo e o ajuste de rolagem (useLayoutEffect) rodam neste
        // mesmo quadro, antes da pintura, em vez de um quadro depois.
        flushSync(() => setRevealed(nextText));
      }

      if (plan.count < backlog) {
        schedule();
      } else {
        pacer.lastFrameTime = null;
      }
    };

    wakeRef.current = schedule;

    return () => {
      disposed = true;
      if (pacer.frame !== null) window.cancelAnimationFrame(pacer.frame);
      pacer.frame = null;
      wakeRef.current = () => {};
    };
  }, []);

  useEffect(() => {
    latestRef.current = { text, done };
    wakeRef.current();
  }, [text, done]);

  return revealed;
}
