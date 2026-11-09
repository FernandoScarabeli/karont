import {
  createContext,
  type ReactNode,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { getBridge } from "../bridge/index.ts";
import {
  ACCENT_SETTING,
  type AccentId,
  applyAccent,
  DEFAULT_ACCENT,
  normalizeAccent,
  readAccentCache,
  writeAccentCache,
} from "./accent.ts";

type AccentValue = {
  accent: AccentId;
  /** Aplica na hora e salva; se o serviço recusar, volta à cor anterior e repassa o erro. */
  saveAccent: (id: AccentId) => Promise<void>;
};

const AccentContext = createContext<AccentValue>({
  accent: DEFAULT_ACCENT,
  saveAccent: async () => {},
});

export function AccentProvider({ children }: { children: ReactNode }) {
  const bridge = useMemo(() => getBridge(), []);
  const [accent, setAccent] = useState<AccentId>(() => readAccentCache());
  const accentRef = useRef(accent);
  const touchedRef = useRef(false);

  const commit = useCallback((id: AccentId) => {
    accentRef.current = id;
    setAccent(id);
    applyAccent(id);
    writeAccentCache(id);
  }, []);

  useEffect(() => {
    if (!bridge) return;
    let active = true;
    void bridge
      .request("settings.get", { key: ACCENT_SETTING })
      .then(({ value }) => {
        if (active && !touchedRef.current) commit(normalizeAccent(value));
      })
      .catch(() => {
        // Sem o valor do serviço, fica a cor já aplicada.
      });
    return () => {
      active = false;
    };
  }, [bridge, commit]);

  const saveAccent = useCallback(
    async (id: AccentId) => {
      const previous = accentRef.current;
      touchedRef.current = true;
      commit(id);
      if (!bridge) return;
      try {
        await bridge.request("settings.set", { key: ACCENT_SETTING, value: id });
      } catch (error) {
        commit(previous);
        throw error;
      }
    },
    [bridge, commit],
  );

  const value = useMemo(() => ({ accent, saveAccent }), [accent, saveAccent]);
  return <AccentContext.Provider value={value}>{children}</AccentContext.Provider>;
}

export function useAccent(): AccentValue {
  return useContext(AccentContext);
}
