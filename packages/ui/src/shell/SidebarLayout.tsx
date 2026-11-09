import { type ReactNode, useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Group, Panel, Separator, usePanelRef } from "react-resizable-panels";
import { getBridge } from "../bridge/index.ts";
import { t } from "../i18n/pt-BR.ts";
import styles from "./SidebarLayout.module.css";
import {
  parseSidebarSetting,
  readPixelToken,
  SIDEBAR_SETTING,
  type SidebarLimits,
  type SidebarSetting,
  sameSidebarSetting,
} from "./sidebarState.ts";

export type SidebarControls = {
  collapsed: boolean;
  collapse: () => void;
  expand: () => void;
};

type SidebarLayoutProps = {
  /** Recebe o estado e os controles; o conteúdo continua montado mesmo recolhido. */
  sidebar: (controls: SidebarControls) => ReactNode;
  children: ReactNode;
};

type Tokens = SidebarLimits & { rail: number; target: number };

function readTokens(): Tokens {
  return {
    min: readPixelToken("--k-sidebar-min-width", 200),
    max: readPixelToken("--k-sidebar-max-width", 400),
    defaultWidth: readPixelToken("--k-sidebar-width", 232),
    rail: readPixelToken("--k-sidebar-rail-width", 48),
    target: readPixelToken("--k-splitter-target", 8),
  };
}

export function SidebarLayout({ sidebar, children }: SidebarLayoutProps) {
  const tokens = useMemo(readTokens, []);
  const bridge = getBridge();
  const [initial, setInitial] = useState<SidebarSetting | null>(() =>
    bridge ? null : parseSidebarSetting(null, tokens),
  );

  // Só mostra a sidebar depois de ler o valor salvo: ela nunca abre com a largura errada.
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

  if (!initial) return <div className={styles.content} />;
  return (
    <LoadedSidebarLayout initial={initial} sidebar={sidebar} tokens={tokens}>
      {children}
    </LoadedSidebarLayout>
  );
}

function LoadedSidebarLayout({
  initial,
  tokens,
  sidebar,
  children,
}: SidebarLayoutProps & { initial: SidebarSetting; tokens: Tokens }) {
  const bridge = getBridge();
  const panelRef = usePanelRef();
  const groupRef = useRef<HTMLDivElement>(null);
  const [collapsed, setCollapsed] = useState(initial.collapsed);
  const widthRef = useRef(initial.width);
  const savedRef = useRef(initial);
  const animationTimeout = useRef<number | undefined>(undefined);

  useEffect(
    () => () => {
      if (animationTimeout.current !== undefined) window.clearTimeout(animationTimeout.current);
    },
    [],
  );

  /** Largura em pixels a partir da porcentagem do layout (não do DOM, que fica atrás durante a animação). */
  const pixelsFrom = useCallback((percentage: number) => {
    const total = groupRef.current?.offsetWidth ?? 0;
    return Math.round((percentage / 100) * total);
  }, []);

  /** Salva só quando a alça é solta (ou a barra abre e fecha), e só se algo mudou. */
  const persist = useCallback(
    (layout: Record<string, number>) => {
      const percentage = layout.sidebar;
      if (percentage === undefined || !bridge) return;
      const pixels = pixelsFrom(percentage);
      const isCollapsed = pixels <= tokens.rail + 1;
      if (!isCollapsed) widthRef.current = pixels;
      const next = { width: widthRef.current, collapsed: isCollapsed };
      if (sameSidebarSetting(next, savedRef.current)) return;
      savedRef.current = next;
      void bridge.request("settings.set", { key: SIDEBAR_SETTING, value: next }).catch(() => {});
    },
    [bridge, pixelsFrom, tokens.rail],
  );

  /** Anima só as trocas feitas por botão ou duplo clique; arrastar acompanha o ponteiro sem atraso. */
  const animateNextChange = useCallback(() => {
    const group = groupRef.current;
    if (!group) return;
    group.dataset.animating = "true";
    if (animationTimeout.current !== undefined) window.clearTimeout(animationTimeout.current);
    animationTimeout.current = window.setTimeout(() => {
      delete group.dataset.animating;
    }, 400);
  }, []);

  const collapse = useCallback(() => {
    animateNextChange();
    panelRef.current?.collapse();
  }, [animateNextChange, panelRef]);

  const expand = useCallback(() => {
    animateNextChange();
    panelRef.current?.resize(widthRef.current);
  }, [animateNextChange, panelRef]);

  const controls: SidebarControls = { collapsed, collapse, expand };

  return (
    <Group
      className={styles.content}
      elementRef={groupRef}
      onLayoutChanged={persist}
      orientation="horizontal"
      resizeTargetMinimumSize={{ coarse: tokens.target, fine: tokens.target }}
    >
      <Panel
        className={styles.panelBody}
        collapsedSize={tokens.rail}
        collapsible
        defaultSize={initial.collapsed ? tokens.rail : initial.width}
        groupResizeBehavior="preserve-pixel-size"
        id="sidebar"
        maxSize={tokens.max}
        minSize={tokens.min}
        onResize={(size) => {
          const isCollapsed = pixelsFrom(size.asPercentage) <= tokens.rail + 1;
          setCollapsed((current) => (current === isCollapsed ? current : isCollapsed));
        }}
        panelRef={panelRef}
        style={{ overflow: "visible" }}
      >
        {sidebar(controls)}
      </Panel>
      <Separator
        aria-label={t.shell.sidebarResize}
        className={styles.separator}
        disableDoubleClick
        id="sidebar-separator"
        onDoubleClick={() => (collapsed ? expand() : collapse())}
      />
      <Panel className={styles.panelBody} id="main">
        {children}
      </Panel>
    </Group>
  );
}
