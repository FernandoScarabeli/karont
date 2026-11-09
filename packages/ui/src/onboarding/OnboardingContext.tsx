import { ONBOARDING_COMPLETED_SETTING } from "@karont/contract";
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
import { useServiceStatus } from "../bridge/useServiceStatus.ts";

const CACHE_KEY = "karont.onboardingDone";
/** Tempo máximo do fundo opaco à espera do serviço. */
const COVER_LIMIT_MS = 5_000;

export type OnboardingMode = "first" | "reopen";

type OnboardingValue = {
  /** A primeira abertura está na tela. */
  active: boolean;
  /** Primeira vez de verdade ou reaberta pelas configurações. */
  mode: OnboardingMode;
  /** Esperando a resposta do serviço sem cache local: a tela mostra só o fundo do app. */
  pending: boolean;
  /** Sobe a cada conclusão; telas que leem preferências só ao montar usam para ler de novo. */
  completions: number;
  reopen: () => void;
  /** Conclui: grava o cache local e fecha. */
  finish: () => void;
  /** Fecha sem mudar nada (só quando reaberta). */
  close: () => void;
};

const noop = () => {};
const OnboardingContext = createContext<OnboardingValue>({
  active: false,
  mode: "first",
  pending: false,
  completions: 0,
  reopen: noop,
  finish: noop,
  close: noop,
});

function readCache(): boolean {
  try {
    return window.localStorage.getItem(CACHE_KEY) !== null;
  } catch {
    return false;
  }
}

export function writeOnboardingCache() {
  try {
    window.localStorage.setItem(CACHE_KEY, "1");
  } catch {
    // Sem armazenamento local: o serviço continua decidindo.
  }
}

export function OnboardingProvider({ children }: { children: ReactNode }) {
  const { state } = useServiceStatus();
  const [cached] = useState(readCache);
  const [active, setActive] = useState(false);
  const [mode, setMode] = useState<OnboardingMode>("first");
  const [resolved, setResolved] = useState(false);
  const [timedOut, setTimedOut] = useState(false);
  const [completions, setCompletions] = useState(0);
  const queriedRef = useRef(false);

  useEffect(() => {
    if (cached) return;
    const timer = window.setTimeout(() => setTimedOut(true), COVER_LIMIT_MS);
    return () => window.clearTimeout(timer);
  }, [cached]);

  useEffect(() => {
    if (state === "disconnected" || state === "no-bridge") {
      setResolved(true);
      return;
    }
    if (state !== "connected" || queriedRef.current) return;
    const bridge = getBridge();
    if (!bridge) {
      setResolved(true);
      return;
    }
    queriedRef.current = true;
    void bridge.request("settings.get", { key: ONBOARDING_COMPLETED_SETTING }).then(
      ({ value }) => {
        if (value === null || value === undefined) {
          setMode("first");
          setActive(true);
        } else {
          writeOnboardingCache();
        }
        setResolved(true);
      },
      // Falha: o app nunca fica preso nesta tela.
      () => setResolved(true),
    );
  }, [state]);

  const reopen = useCallback(() => {
    setMode("reopen");
    setActive(true);
  }, []);
  const finish = useCallback(() => {
    writeOnboardingCache();
    setActive(false);
    setCompletions((count) => count + 1);
  }, []);
  const close = useCallback(() => setActive(false), []);

  const pending = !cached && !resolved && !timedOut && !active;

  const value = useMemo<OnboardingValue>(
    () => ({ active, mode, pending, completions, reopen, finish, close }),
    [active, mode, pending, completions, reopen, finish, close],
  );

  return <OnboardingContext.Provider value={value}>{children}</OnboardingContext.Provider>;
}

export function useOnboarding(): OnboardingValue {
  return useContext(OnboardingContext);
}
