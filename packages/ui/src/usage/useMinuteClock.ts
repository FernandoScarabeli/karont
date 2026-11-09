import { useEffect, useState } from "react";

const CLOCK_MS = 60_000;

/** Relógio de 1 minuto, só com a janela visível. Fica com quem mostra tempo, longe do contexto. */
export function useMinuteClock(): number {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const tick = () => {
      if (document.visibilityState === "visible") setNow(Date.now());
    };
    const timer = setInterval(tick, CLOCK_MS);
    document.addEventListener("visibilitychange", tick);
    return () => {
      clearInterval(timer);
      document.removeEventListener("visibilitychange", tick);
    };
  }, []);
  return now;
}
