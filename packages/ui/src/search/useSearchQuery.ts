import type { SearchResult } from "@karont/contract";
import { useEffect, useRef, useState } from "react";
import { getBridge } from "../bridge/index.ts";
import { createLatestGate } from "../projects/searchPanelState.ts";

const DEBOUNCE_MS = 150;

type Applied = { query: string; result: SearchResult };

/**
 * Busca com atraso de digitação, um pedido por vez e resposta antiga descartada. Enquanto carrega,
 * o último resultado continua valendo. Sem texto ou fechada, não faz pedido nenhum.
 */
export function useSearchQuery(active: boolean, rawQuery: string) {
  const query = active ? rawQuery.trim() : "";
  const [applied, setApplied] = useState<Applied | null>(null);
  const [failed, setFailed] = useState(false);
  const gateRef = useRef<ReturnType<typeof createLatestGate> | null>(null);
  const runningRef = useRef(false);
  const latestRef = useRef<{ query: string; token: number } | null>(null);
  if (gateRef.current === null) gateRef.current = createLatestGate();
  const gate = gateRef.current;

  useEffect(() => {
    const run = () => {
      const latest = latestRef.current;
      if (!latest || runningRef.current) return;
      runningRef.current = true;
      void (async () => {
        try {
          const bridge = getBridge();
          if (!bridge) throw new Error("bridge");
          const result = await bridge.request("search.query", { query: latest.query });
          if (gate.isCurrent(latest.token)) {
            setApplied({ query: latest.query, result });
            setFailed(false);
          }
        } catch {
          if (gate.isCurrent(latest.token)) setFailed(true);
        } finally {
          runningRef.current = false;
          const next = latestRef.current;
          if (next && next.token !== latest.token && gate.isCurrent(next.token)) run();
        }
      })();
    };

    // Qualquer mudança invalida o que estava pendente.
    gate.cancel();
    latestRef.current = null;
    if (query === "") {
      setApplied(null);
      setFailed(false);
      return;
    }
    const timer = window.setTimeout(() => {
      latestRef.current = { query, token: gate.begin() };
      run();
    }, DEBOUNCE_MS);
    return () => {
      window.clearTimeout(timer);
      gate.cancel();
      latestRef.current = null;
    };
  }, [query, gate]);

  return {
    query,
    result: query === "" ? null : (applied?.result ?? null),
    /** A resposta que está na tela é para o texto atual. */
    settled: applied !== null && applied.query === query,
    failed: query !== "" && failed,
  };
}
