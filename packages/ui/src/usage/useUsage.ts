import type { AgentUsage } from "@karont/contract";
import { useCallback, useEffect, useRef, useState } from "react";
import { getBridge } from "../bridge/index.ts";
import { mergeListed, upsertUsage } from "./merge.ts";

/** Folga depois do `resetsAt`, para o timer não disparar um instante antes da janela vencer. */
const EXPIRY_SLACK_MS = 1000;
/** `setTimeout` estoura acima de ~24,8 dias; uma janela nunca chega perto disso. */
const MAX_TIMER_MS = 2 ** 31 - 1;

export type UsageState = {
  usage: AgentUsage[];
  names: ReadonlyMap<string, string>;
  refreshing: boolean;
  /** Pedido do botão: ignora o limite de tempo do serviço. */
  forceRefresh: () => void;
};

/**
 * Dados do bloco de uso. Sem polling: lê ao montar, ao voltar para a janela, quando uma janela
 * vence e quando a pessoa pede. O limite de 2 minutos entre leituras é do serviço.
 * Toda falha de leitura é silenciosa e o valor anterior continua na tela.
 */
export function useUsage(): UsageState {
  const [usage, setUsage] = useState<AgentUsage[]>([]);
  const [names, setNames] = useState<ReadonlyMap<string, string>>(new Map());
  const [refreshing, setRefreshing] = useState(false);
  const [expiryTick, setExpiryTick] = useState(0);
  const mounted = useRef(false);
  const inFlight = useRef(false);

  const refresh = useCallback(async (force: boolean) => {
    const bridge = getBridge();
    if (!bridge || inFlight.current) return;
    inFlight.current = true;
    setRefreshing(true);
    try {
      const result = await bridge.request("usage.refresh", force ? { force: true } : {});
      if (mounted.current) setUsage((current) => mergeListed(current, result.usage));
    } catch {
      // Silencioso: o valor anterior continua, com o "há X" honesto.
    } finally {
      inFlight.current = false;
      if (mounted.current) setRefreshing(false);
    }
  }, []);

  const forceRefresh = useCallback(() => {
    void refresh(true);
  }, [refresh]);

  useEffect(() => {
    mounted.current = true;
    const bridge = getBridge();
    if (!bridge) {
      return () => {
        mounted.current = false;
      };
    }
    const unsubscribe = bridge.onEvent((event) => {
      if (event.event !== "usage.updated") return;
      setUsage((current) => upsertUsage(current, event.payload));
    });
    void bridge.request("usage.list", {}).then(
      (listed) => {
        if (mounted.current) setUsage((current) => mergeListed(current, listed.usage));
      },
      () => {},
    );
    void bridge.request("agents.list", {}).then(
      (agents) => {
        if (mounted.current) {
          setNames(new Map(agents.agents.map((agent) => [agent.id, agent.name])));
        }
      },
      () => {},
    );
    void refresh(false);

    const onFocus = () => void refresh(false);
    const onVisibility = () => {
      if (document.visibilityState === "visible") void refresh(false);
    };
    window.addEventListener("focus", onFocus);
    document.addEventListener("visibilitychange", onVisibility);
    return () => {
      mounted.current = false;
      unsubscribe();
      window.removeEventListener("focus", onFocus);
      document.removeEventListener("visibilitychange", onVisibility);
    };
  }, [refresh]);

  // Uma leitura (sem force) quando a próxima janela a vencer vence de fato. Só janelas que ainda
  // estão no futuro entram: cada uma dispara uma vez e depois some da conta.
  // biome-ignore lint/correctness/useExhaustiveDependencies: `expiryTick` reagenda depois de um disparo.
  useEffect(() => {
    const now = Date.now();
    let next = Number.POSITIVE_INFINITY;
    for (const item of usage) {
      for (const window of item.windows) {
        if (window.resetsAt === null) continue;
        const at = Date.parse(window.resetsAt);
        if (at > now && at < next) next = at;
      }
    }
    if (!Number.isFinite(next)) return;
    const timer = setTimeout(
      () => {
        void refresh(false);
        setExpiryTick((value) => value + 1);
      },
      Math.min(next - now + EXPIRY_SLACK_MS, MAX_TIMER_MS),
    );
    return () => clearTimeout(timer);
  }, [usage, refresh, expiryTick]);

  return { usage, names, refreshing, forceRefresh };
}
