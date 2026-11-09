import type { Dot } from "@karont/contract";
import { createContext, type ReactNode, useContext, useEffect, useState } from "react";
import { getBridge } from "../bridge/index.ts";

const DotContext = createContext<Dot | null>(null);

/** Lê o Dot uma vez só e o mantém atualizado, para a lista de mensagens não pedir um por mensagem. */
export function DotProvider({ children }: { children: ReactNode }) {
  const [dot, setDot] = useState<Dot | null>(null);

  useEffect(() => {
    const bridge = getBridge();
    if (!bridge) return;
    let active = true;
    let received = false;
    // Inscrever antes da leitura evita perder uma mudança que chegue no meio.
    const unsubscribe = bridge.onEvent((event) => {
      if (event.event !== "dot.updated") return;
      received = true;
      setDot(event.payload);
    });
    void (async () => {
      try {
        const loaded = await bridge.request("dot.get", {});
        if (active && !received) setDot(loaded);
      } catch {
        // Sem Dot carregado, o chat fica como sem Dot.
      }
    })();
    return () => {
      active = false;
      unsubscribe();
    };
  }, []);

  return <DotContext value={dot}>{children}</DotContext>;
}

export function useDot(): Dot | null {
  return useContext(DotContext);
}
