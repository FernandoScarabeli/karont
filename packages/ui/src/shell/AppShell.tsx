import { lazy, Suspense, useCallback, useEffect, useRef, useState } from "react";
import { NavigationProvider } from "../navigation/NavigationContext.tsx";
import { decideSearchShortcut } from "../projects/searchPanelState.ts";
import styles from "./AppShell.module.css";
import { Sheet } from "./Sheet.tsx";
import { Sidebar } from "./Sidebar.tsx";
import { SidebarLayout } from "./SidebarLayout.tsx";
import { TopBar } from "./TopBar.tsx";

const SearchPanel = lazy(async () => {
  const module = await import("../search/SearchPanel.tsx");
  return { default: module.SearchPanel };
});

/** Foco dentro de um terminal (xterm) visível: lá o Ctrl K é do terminal. */
function isInVisibleTerminal(target: EventTarget | null): boolean {
  if (!(target instanceof Element)) return false;
  const terminal = target.closest(".xterm");
  if (!terminal?.isConnected) return false;
  return terminal.checkVisibility ? terminal.checkVisibility() : true;
}

export function AppShell() {
  const [searchOpen, setSearchOpen] = useState(false);
  const [searchLoaded, setSearchLoaded] = useState(false);
  const openRef = useRef(false);
  openRef.current = searchOpen;

  const openSearch = useCallback(() => {
    setSearchLoaded(true);
    setSearchOpen(true);
  }, []);
  const closeSearch = useCallback(() => setSearchOpen(false), []);

  useEffect(() => {
    function onKeyDown(event: KeyboardEvent) {
      const decision = decideSearchShortcut({
        key: event.key,
        ctrlKey: event.ctrlKey,
        metaKey: event.metaKey,
        altKey: event.altKey,
        shiftKey: event.shiftKey,
        repeat: event.repeat,
        isComposing: event.isComposing,
        inTerminal: isInVisibleTerminal(event.target),
        searchOpen: openRef.current,
      });
      if (decision === "ignore") return;
      event.preventDefault();
      event.stopPropagation();
      if (decision === "open") openSearch();
      else closeSearch();
    }
    window.addEventListener("keydown", onKeyDown, true);
    return () => window.removeEventListener("keydown", onKeyDown, true);
  }, [openSearch, closeSearch]);

  return (
    <NavigationProvider>
      <div className={styles.shell}>
        <TopBar onOpenSearch={openSearch} />
        <SidebarLayout
          sidebar={({ collapsed, collapse, expand }) => (
            <Sidebar collapsed={collapsed} onCollapse={collapse} onExpand={expand} />
          )}
        >
          <Sheet />
        </SidebarLayout>
      </div>
      {searchLoaded ? (
        <Suspense fallback={null}>
          <SearchPanel onClose={closeSearch} open={searchOpen} />
        </Suspense>
      ) : null}
    </NavigationProvider>
  );
}
