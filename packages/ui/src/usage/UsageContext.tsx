import type { AgentUsage, UsageWindow } from "@karont/contract";
import {
  createContext,
  type ReactNode,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
} from "react";
import { getBridge } from "../bridge/index.ts";
import { useUsage } from "./useUsage.ts";

const WINDOW_ORDER: UsageWindow["id"][] = ["five_hour", "weekly"];
export const USAGE_COMPACT_SETTING = "usage.compact";

export type UsageRow = AgentUsage & { name: string };

type UsageDataValue = {
  /** Agentes com pelo menos uma janela, janelas na ordem 5 horas e semana. */
  rows: UsageRow[];
  refreshing: boolean;
  forceRefresh: () => void;
};

type UsageLayoutValue = {
  /** A leitura da escolha terminou (ou falhou): só então o bloco pode aparecer. */
  ready: boolean;
  compact: boolean;
  setCompact: (compact: boolean) => void;
};

const UsageDataContext = createContext<UsageDataValue>({
  rows: [],
  refreshing: false,
  forceRefresh: () => {},
});

const UsageLayoutContext = createContext<UsageLayoutValue>({
  ready: true,
  compact: false,
  setCompact: () => {},
});

function UsageLayoutProvider({ children }: { children: ReactNode }) {
  const [ready, setReady] = useState(() => !getBridge());
  const [compact, setCompactState] = useState(false);

  useEffect(() => {
    const bridge = getBridge();
    if (!bridge) return;
    let mounted = true;
    bridge.request("settings.get", { key: USAGE_COMPACT_SETTING }).then(
      (result) => {
        if (!mounted) return;
        setCompactState((current) => (result.value === true ? true : current));
        setReady(true);
      },
      () => {
        if (mounted) setReady(true);
      },
    );
    return () => {
      mounted = false;
    };
  }, []);

  const setCompact = useCallback((next: boolean) => {
    setCompactState(next);
    const bridge = getBridge();
    if (!bridge) return;
    // Se salvar falhar, a tela continua como a pessoa deixou.
    void bridge
      .request("settings.set", { key: USAGE_COMPACT_SETTING, value: next })
      .catch(() => {});
  }, []);

  const value = useMemo(() => ({ ready, compact, setCompact }), [ready, compact, setCompact]);
  return <UsageLayoutContext.Provider value={value}>{children}</UsageLayoutContext.Provider>;
}

/** Uma única leitura e uma única assinatura de uso, compartilhadas pela sidebar e pela faixa. */
export function UsageProvider({ children }: { children: ReactNode }) {
  const { usage, names, refreshing, forceRefresh } = useUsage();

  const rows = useMemo(
    () =>
      usage
        .map((item) => ({
          ...item,
          name: names.get(item.agent) ?? item.agent,
          windows: WINDOW_ORDER.flatMap((id) => item.windows.filter((window) => window.id === id)),
        }))
        .filter((item) => item.windows.length > 0),
    [usage, names],
  );

  const value = useMemo(
    () => ({ rows, refreshing, forceRefresh }),
    [rows, refreshing, forceRefresh],
  );
  return (
    <UsageDataContext.Provider value={value}>
      <UsageLayoutProvider>{children}</UsageLayoutProvider>
    </UsageDataContext.Provider>
  );
}

export function useUsageData(): UsageDataValue {
  return useContext(UsageDataContext);
}

export function useUsageLayout(): UsageLayoutValue {
  return useContext(UsageLayoutContext);
}
