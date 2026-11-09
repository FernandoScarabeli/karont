import { useEffect, useState } from "react";
import { DotPrototype } from "./dev/DotPrototype.tsx";
import { Showcase } from "./dev/Showcase.tsx";
import { AppShell } from "./shell/AppShell.tsx";

function readDevRoute(hash: string) {
  return import.meta.env.DEV && (hash === "#vitrine" || hash === "#dot") ? hash : "";
}

export function App() {
  const [devRoute, setDevRoute] = useState(() => readDevRoute(window.location.hash));

  useEffect(() => {
    if (!import.meta.env.DEV) return;

    const syncDevRoute = () => {
      setDevRoute(readDevRoute(window.location.hash));
    };

    window.addEventListener("hashchange", syncDevRoute);
    return () => window.removeEventListener("hashchange", syncDevRoute);
  }, []);

  if (devRoute === "#vitrine") return <Showcase />;
  if (devRoute === "#dot") return <DotPrototype />;
  return <AppShell />;
}
