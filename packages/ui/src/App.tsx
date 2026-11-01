import { lazy, Suspense, useEffect, useState } from "react";
import { Showcase } from "./dev/Showcase.tsx";
import { AppShell } from "./shell/AppShell.tsx";

const DevConversa = import.meta.env.DEV
  ? lazy(() =>
      import("./dev/conversa/Conversa.tsx").then((module) => ({
        default: module.Conversa,
      })),
    )
  : null;

export function App() {
  const [devRoute, setDevRoute] = useState(() =>
    import.meta.env.DEV && ["#vitrine", "#conversa"].includes(window.location.hash)
      ? window.location.hash
      : "",
  );

  useEffect(() => {
    if (!import.meta.env.DEV) return;

    const syncDevRoute = () => {
      const hash = window.location.hash;
      setDevRoute(["#vitrine", "#conversa"].includes(hash) ? hash : "");
    };

    window.addEventListener("hashchange", syncDevRoute);
    return () => window.removeEventListener("hashchange", syncDevRoute);
  }, []);

  if (devRoute === "#vitrine") return <Showcase />;
  if (devRoute === "#conversa" && DevConversa) {
    return (
      <Suspense fallback={null}>
        <DevConversa />
      </Suspense>
    );
  }
  return <AppShell />;
}
