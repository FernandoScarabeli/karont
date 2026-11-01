import { useEffect, useState } from "react";
import { Showcase } from "./dev/Showcase.tsx";
import { WorkingShowcase } from "./dev/working/WorkingShowcase.tsx";
import { AppShell } from "./shell/AppShell.tsx";

export function App() {
  const [devRoute, setDevRoute] = useState(() =>
    import.meta.env.DEV && ["#vitrine", "#trabalhando"].includes(window.location.hash)
      ? window.location.hash
      : "",
  );

  useEffect(() => {
    if (!import.meta.env.DEV) return;

    const syncDevRoute = () => {
      const hash = window.location.hash;
      setDevRoute(hash === "#vitrine" || hash === "#trabalhando" ? hash : "");
    };

    window.addEventListener("hashchange", syncDevRoute);
    return () => window.removeEventListener("hashchange", syncDevRoute);
  }, []);

  if (devRoute === "#vitrine") return <Showcase />;
  if (devRoute === "#trabalhando") return <WorkingShowcase />;
  return <AppShell />;
}
