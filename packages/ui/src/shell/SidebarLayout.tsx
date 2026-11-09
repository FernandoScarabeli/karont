import { type ReactNode, useCallback, useEffect, useMemo, useRef } from "react";
import { Group, Panel, Separator, usePanelRef } from "react-resizable-panels";
import { getBridge } from "../bridge/index.ts";
import { t } from "../i18n/pt-BR.ts";
import styles from "./SidebarLayout.module.css";
import { useSidebarShell } from "./SidebarShell.tsx";
import { SidebarCrossing } from "./sidebarCrossing.ts";
import { SIDEBAR_SETTING, sameSidebarSetting } from "./sidebarState.ts";

type SidebarLayoutProps = {
  /** Recebe se está recolhida; o conteúdo continua montado mesmo assim. */
  sidebar: (state: { collapsed: boolean }) => ReactNode;
  children: ReactNode;
};

export function SidebarLayout({ sidebar, children }: SidebarLayoutProps) {
  const bridge = getBridge();
  const shell = useSidebarShell();
  const { initial, tokens, collapsed, setCollapsed, setCurrentWidth } = shell;
  const { animateNextChange, registerControls, toggle, getShellElement, isButtonAnimating } = shell;
  const panelRef = usePanelRef();
  const groupRef = useRef<HTMLDivElement>(null);
  const sidebarElement = useRef<HTMLDivElement | null>(null);
  const mainElement = useRef<HTMLDivElement | null>(null);
  const crossing = useMemo(() => new SidebarCrossing(), []);
  /** Último valor visto, para animar o pulo da biblioteca ao cruzar o limite. */
  const lastValues = useRef<{ sidebarGrow: number; mainGrow: number; width: number } | null>(null);
  const wasCollapsed = useRef(initial.collapsed);
  const widthRef = useRef(initial.width);
  const savedRef = useRef(initial);

  /** Largura exata em pixels a partir da porcentagem do layout (o DOM fica atrás durante a animação). */
  const exactPixels = useCallback(
    (percentage: number) => {
      // As porcentagens (e o flex-grow) valem para o espaço sem a linha da alça.
      const total = (groupRef.current?.offsetWidth ?? 0) - tokens.border;
      return (percentage / 100) * total;
    },
    [tokens.border],
  );

  /** Salva só quando a alça é solta (ou a barra abre e fecha), e só se algo mudou. */
  const persist = useCallback(
    (layout: Record<string, number>) => {
      const percentage = layout.sidebar;
      if (percentage === undefined || !bridge) return;
      const pixels = Math.round(exactPixels(percentage));
      const isCollapsed = pixels <= tokens.rail + 1;
      if (!isCollapsed) widthRef.current = pixels;
      const next = { width: widthRef.current, collapsed: isCollapsed };
      if (sameSidebarSetting(next, savedRef.current)) return;
      savedRef.current = next;
      void bridge.request("settings.set", { key: SIDEBAR_SETTING, value: next }).catch(() => {});
    },
    [bridge, exactPixels, tokens.rail],
  );

  /**
   * Segue o estilo do painel no mesmo instante em que a biblioteca o escreve (MutationObserver roda
   * antes do próximo quadro): atualiza a largura do topo, o estado recolhido e a animação da
   * passagem pelo limite, sem atraso de um quadro e sem re-render por pixel.
   */
  useEffect(() => {
    const sidebarEl = sidebarElement.current;
    const mainEl = mainElement.current;
    const shellEl = getShellElement();
    if (!sidebarEl || !mainEl || !shellEl) return;
    const sync = () => {
      const sidebarGrow = Number.parseFloat(sidebarEl.style.flexGrow);
      const mainGrow = Number.parseFloat(mainEl.style.flexGrow);
      if (!Number.isFinite(sidebarGrow) || !Number.isFinite(mainGrow)) return;
      const pixels = exactPixels(sidebarGrow);
      setCurrentWidth(pixels);
      const isCollapsed = pixels <= tokens.rail + 1;
      setCollapsed(isCollapsed);
      const next = { sidebarGrow, mainGrow, width: pixels };
      const previous = lastValues.current;
      if (isCollapsed !== wasCollapsed.current && previous && !isButtonAnimating()) {
        // Cruzou o limite arrastando: anima só essa passagem.
        crossing.start({ shell: shellEl, sidebar: sidebarEl, main: mainEl }, previous, next);
      } else {
        crossing.retarget(next);
      }
      lastValues.current = next;
      wasCollapsed.current = isCollapsed;
    };
    sync();
    const observer = new MutationObserver(sync);
    observer.observe(sidebarEl, { attributes: true, attributeFilter: ["style"] });
    return () => {
      observer.disconnect();
      crossing.cancel();
    };
  }, [
    crossing,
    exactPixels,
    getShellElement,
    isButtonAnimating,
    setCollapsed,
    setCurrentWidth,
    tokens.rail,
  ]);

  useEffect(() => {
    registerControls({
      collapse: () => {
        animateNextChange();
        panelRef.current?.collapse();
      },
      expand: () => {
        animateNextChange();
        panelRef.current?.resize(widthRef.current);
      },
    });
    return () => registerControls(null);
  }, [animateNextChange, panelRef, registerControls]);

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
        elementRef={sidebarElement}
        defaultSize={initial.collapsed ? tokens.rail : initial.width}
        groupResizeBehavior="preserve-pixel-size"
        id="sidebar"
        maxSize={tokens.max}
        minSize={tokens.min}
        panelRef={panelRef}
        style={{ overflow: "visible" }}
      >
        {sidebar({ collapsed })}
      </Panel>
      <Separator
        aria-label={t.shell.sidebarResize}
        className={styles.separator}
        disableDoubleClick
        id="sidebar-separator"
        onDoubleClick={toggle}
      />
      <Panel className={styles.panelBody} elementRef={mainElement} id="main">
        {children}
      </Panel>
    </Group>
  );
}
