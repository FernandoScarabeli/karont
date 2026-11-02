import { useEffect, useRef, useState } from "react";
import { getSafeRevealLength } from "./streamingText.mjs";

type SmoothTextOptions = { done: boolean };

type SmoothTextSnapshot = {
  text: string;
  frameId: number;
  frameStartedAt: number;
};

export function useSmoothText(text: string, { done }: SmoothTextOptions): SmoothTextSnapshot {
  const latestRef = useRef({ text, done });
  const revealedLengthRef = useRef(0);
  const previousFrameTimeRef = useRef<number | null>(null);
  const fractionalCharactersRef = useRef(0);
  const animationFrameRef = useRef<number | null>(null);
  const [snapshot, setSnapshot] = useState<SmoothTextSnapshot>({
    text: "",
    frameId: 0,
    frameStartedAt: 0,
  });

  latestRef.current = { text, done };

  useEffect(() => {
    let active = true;

    const scheduleFrame = () => {
      if (!active || animationFrameRef.current !== null) return;
      animationFrameRef.current = window.requestAnimationFrame(revealFrame);
    };

    const revealFrame = (frameTime: number) => {
      animationFrameRef.current = null;
      const frameStartedAt = performance.now();
      const latest = latestRef.current;
      const currentLength = revealedLengthRef.current;
      const backlog = latest.text.length - currentLength;
      if (backlog <= 0) return;

      const previousFrameTime = previousFrameTimeRef.current;
      const elapsed =
        previousFrameTime === null
          ? 16
          : Math.max(0, Math.min(latest.done ? 1000 : 100, frameTime - previousFrameTime));
      previousFrameTimeRef.current = frameTime;

      let charactersPerSecond = Math.min(2800, 72 + backlog * 2);
      if (latest.done) {
        charactersPerSecond = Math.max(charactersPerSecond, backlog / 0.25);
      }

      fractionalCharactersRef.current += (charactersPerSecond * elapsed) / 1000;
      const budget = Math.floor(fractionalCharactersRef.current);
      fractionalCharactersRef.current -= budget;
      const requestedLength = Math.min(latest.text.length, currentLength + budget);
      const nextLength = getSafeRevealLength(
        latest.text,
        currentLength,
        requestedLength,
        latest.done,
      );

      if (nextLength > currentLength) {
        revealedLengthRef.current = nextLength;
        setSnapshot((previous) => ({
          text: latest.text.slice(0, nextLength),
          frameId: previous.frameId + 1,
          frameStartedAt,
        }));
      }

      if (
        nextLength < latest.text.length &&
        (requestedLength < latest.text.length || latest.done)
      ) {
        scheduleFrame();
      }
    };

    if (text.length > revealedLengthRef.current) {
      if (done) fractionalCharactersRef.current = 0;
      scheduleFrame();
    }

    return () => {
      active = false;
      if (animationFrameRef.current !== null) {
        window.cancelAnimationFrame(animationFrameRef.current);
        animationFrameRef.current = null;
      }
    };
  }, [text, done]);

  return snapshot;
}
