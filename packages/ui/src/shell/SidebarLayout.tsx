import { type ReactNode, useCallback, useEffect, useRef } from "react";
import { Group, Panel, Separator, usePanelRef } from "react-resizable-panels";
import { getBridge } from "../bridge/index.ts";
import { t } from "../i18n/pt-BR.ts";
import styles from "./SidebarLayout.module.css";
import { useSidebarShell } from "./SidebarShell.tsx";
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
  const { animateNextChange, registerControls, toggle } = shell;
  const panelRef = usePanelRef();
  const groupRef = useRef<HTMLDivElement>(null);
  const widthRef = useRef(initial.width);
  const savedRef = useRef(initial);

  /** Largura exata em pixels a partir da porcentagem do layout (o DOM fica atrás durante a animação). */
  const exactPixels = useCallback((percentage: number) => {
    const total = groupRef.current?.offsetWidth ?? 0;
    return (percentage / 100) * total;
  }, []);

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
        defaultSize={initial.collapsed ? tokens.rail : initial.width}
        groupResizeBehavior="preserve-pixel-size"
        id="sidebar"
        maxSize={tokens.max}
        minSize={tokens.min}
        onResize={(size) => {
          const pixels = exactPixels(size.asPercentage);
          setCurrentWidth(pixels);
          const isCollapsed = pixels <= tokens.rail + 1;
          setCollapsed(isCollapsed);
        }}
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
      <Panel className={styles.panelBody} id="main">
        {children}
      </Panel>
    </Group>
  );
}
