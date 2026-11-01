import { useEffect, useState } from "react";
import { Showcase } from "./dev/Showcase.tsx";
import { AppShell } from "./shell/AppShell.tsx";

export function App() {
  const [devRoute, setDevRoute] = useState(() =>
    import.meta.env.DEV && window.location.hash === "#vitrine" ? window.location.hash : "",
  );

  useEffect(() => {
    if (!import.meta.env.DEV) return;

    const syncDevRoute = () => {
      const hash = window.location.hash;
      setDevRoute(hash === "#vitrine" ? hash : "");
    };

    window.addEventListener("hashchange", syncDevRoute);
    return () => window.removeEventListener("hashchange", syncDevRoute);
  }, []);

  if (devRoute === "#vitrine") return <Showcase />;
  return <AppShell />;
}
