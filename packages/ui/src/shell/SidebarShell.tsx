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
  parseSidebarSetting,
  readPixelToken,
  SIDEBAR_SETTING,
  type SidebarLimits,
  type SidebarSetting,
} from "./sidebarState.ts";

export type SidebarTokens = SidebarLimits & { rail: number; target: number; border: number };

export type SidebarPanelControls = { collapse: () => void; expand: () => void };

type SidebarShellValue = {
  initial: SidebarSetting;
  tokens: SidebarTokens;
  collapsed: boolean;
  setCollapsed: (collapsed: boolean) => void;
  /** Largura atual da sidebar, escrita direto no elemento (sem re-render) para o topo acompanhar. */
  setCurrentWidth: (pixels: number) => void;
  /** Liga a animação curta de abrir e fechar (só botão e duplo clique). */
  animateNextChange: () => void;
  registerControls: (controls: SidebarPanelControls | null) => void;
  /** O elemento do shell (dono da largura atual), para animações feitas fora do React. */
  getShellElement: () => HTMLElement | null;
  /** Há uma troca por botão em curso (ela anima por CSS). */
  isButtonAnimating: () => boolean;
  toggle: () => void;
};

const SidebarShellContext = createContext<SidebarShellValue | null>(null);

export function useSidebarShell(): SidebarShellValue {
  const value = useContext(SidebarShellContext);
  if (!value) throw new Error("useSidebarShell fora do SidebarShellProvider");
  return value;
}

function readTokens(): SidebarTokens {
  return {
    min: readPixelToken("--k-sidebar-min-width", 200),
    max: readPixelToken("--k-sidebar-max-width", 400),
    defaultWidth: readPixelToken("--k-sidebar-width", 232),
    rail: readPixelToken("--k-sidebar-rail-width", 48),
    target: readPixelToken("--k-splitter-target", 8),
    border: readPixelToken("--k-border-width", 1),
  };
}

const CURRENT_WIDTH_VARIABLE = "--k-sidebar-current-width";

/**
 * Dono do estado da barra lateral, compartilhado entre o topo e a área de painéis.
 * Só mostra o conteúdo depois de ler a largura salva: nada abre com a largura errada.
 */
export function SidebarShellProvider({
  className,
  children,
}: {
  className: string | undefined;
  children: ReactNode;
}) {
  const tokens = useMemo(readTokens, []);
  const bridge = getBridge();
  const [initial, setInitial] = useState<SidebarSetting | null>(() =>
    bridge ? null : parseSidebarSetting(null, tokens),
  );

  // biome-ignore lint/correctness/useExhaustiveDependencies: carrega uma vez.
  useEffect(() => {
    if (!bridge) return;
    let mounted = true;
    bridge
      .request("settings.get", { key: SIDEBAR_SETTING })
      .then((result) => result.value)
      .catch(() => null)
      .then((value) => {
        if (mounted) setInitial(parseSidebarSetting(value, tokens));
      });
    return () => {
      mounted = false;
    };
  }, []);

  if (!initial) return <div className={className} />;
  return (
    <LoadedProvider className={className} initial={initial} tokens={tokens}>
      {children}
    </LoadedProvider>
  );
}

function LoadedProvider({
  className,
  initial,
  tokens,
  children,
}: {
  className: string | undefined;
  initial: SidebarSetting;
  tokens: SidebarTokens;
  children: ReactNode;
}) {
  const shellRef = useRef<HTMLDivElement>(null);
  const controlsRef = useRef<SidebarPanelControls | null>(null);
  const animationTimeout = useRef<number | undefined>(undefined);
  const [collapsed, setCollapsed] = useState(initial.collapsed);
  const collapsedRef = useRef(collapsed);
  collapsedRef.current = collapsed;

  useEffect(
    () => () => {
      if (animationTimeout.current !== undefined) window.clearTimeout(animationTimeout.current);
    },
    [],
  );

  const setCurrentWidth = useCallback((pixels: number) => {
    shellRef.current?.style.setProperty(CURRENT_WIDTH_VARIABLE, `${pixels}px`);
  }, []);

  const animateNextChange = useCallback(() => {
    const shell = shellRef.current;
    if (!shell) return;
    shell.dataset.animating = "true";
    if (animationTimeout.current !== undefined) window.clearTimeout(animationTimeout.current);
    animationTimeout.current = window.setTimeout(() => {
      delete shell.dataset.animating;
    }, 400);
  }, []);

  const registerControls = useCallback((controls: SidebarPanelControls | null) => {
    controlsRef.current = controls;
  }, []);

  const getShellElement = useCallback(() => shellRef.current, []);
  const isButtonAnimating = useCallback(() => shellRef.current?.dataset.animating === "true", []);

  const toggle = useCallback(() => {
    const controls = controlsRef.current;
    if (!controls) return;
    if (collapsedRef.current) controls.expand();
    else controls.collapse();
  }, []);

  const value = useMemo<SidebarShellValue>(
    () => ({
      initial,
      tokens,
      collapsed,
      setCollapsed,
      setCurrentWidth,
      animateNextChange,
      registerControls,
      getShellElement,
      isButtonAnimating,
      toggle,
    }),
    [
      initial,
      tokens,
      collapsed,
      setCurrentWidth,
      animateNextChange,
      registerControls,
      getShellElement,
      isButtonAnimating,
      toggle,
    ],
  );

  const startWidth = initial.collapsed ? tokens.rail : initial.width;
  return (
    <SidebarShellContext.Provider value={value}>
      <div
        className={className}
        ref={shellRef}
        style={{ [CURRENT_WIDTH_VARIABLE]: `${startWidth}px` } as React.CSSProperties}
      >
        {children}
      </div>
    </SidebarShellContext.Provider>
  );
}
