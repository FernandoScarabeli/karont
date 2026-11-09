import { useEffect, useState } from "react";
import { DotPrototype } from "./dev/DotPrototype.tsx";
import { Showcase } from "./dev/Showcase.tsx";
import { AppShell } from "./shell/AppShell.tsx";

/* o protótipo do Dot também abre no modo "preview" (build de produção para medir) */
const prototypeRoute = import.meta.env.DEV || import.meta.env.MODE === "preview";

function readDevRoute(hash: string) {
  if (import.meta.env.DEV && hash === "#vitrine") return hash;
  return prototypeRoute && hash === "#dot" ? hash : "";
}

export function App() {
  const [devRoute, setDevRoute] = useState(() => readDevRoute(window.location.hash));

  useEffect(() => {
    if (!prototypeRoute) return;

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
