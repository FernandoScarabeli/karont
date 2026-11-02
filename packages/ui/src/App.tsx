import { useEffect, useState } from "react";
import { HistoryPrototype } from "./dev/historico/HistoryPrototype.tsx";
import { Showcase } from "./dev/Showcase.tsx";
import { AppShell } from "./shell/AppShell.tsx";

export function App() {
  const [devRoute, setDevRoute] = useState(() =>
    import.meta.env.DEV && ["#vitrine", "#historico"].includes(window.location.hash)
      ? window.location.hash
      : "",
  );

  useEffect(() => {
    if (!import.meta.env.DEV) return;

    const syncDevRoute = () => {
      const hash = window.location.hash;
      setDevRoute(import.meta.env.DEV && ["#vitrine", "#historico"].includes(hash) ? hash : "");
    };

    window.addEventListener("hashchange", syncDevRoute);
    return () => window.removeEventListener("hashchange", syncDevRoute);
  }, []);

  if (devRoute === "#vitrine") return <Showcase />;
  if (devRoute === "#historico") return <HistoryPrototype />;
  return <AppShell />;
}
