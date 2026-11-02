import { lazy, Suspense, useEffect, useState } from "react";
import { Showcase } from "./dev/Showcase.tsx";
import { AppShell } from "./shell/AppShell.tsx";

const StreamingDemo = import.meta.env.DEV
  ? lazy(() =>
      import("./dev/streaming/StreamingDemo.tsx").then((module) => ({
        default: module.StreamingDemo,
      })),
    )
  : null;

export function App() {
  const [devRoute, setDevRoute] = useState(() =>
    import.meta.env.DEV && ["#vitrine", "#streaming"].includes(window.location.hash)
      ? window.location.hash
      : "",
  );

  useEffect(() => {
    if (!import.meta.env.DEV) return;

    const syncDevRoute = () => {
      const hash = window.location.hash;
      setDevRoute(import.meta.env.DEV && ["#vitrine", "#streaming"].includes(hash) ? hash : "");
    };

    window.addEventListener("hashchange", syncDevRoute);
    return () => window.removeEventListener("hashchange", syncDevRoute);
  }, []);

  if (devRoute === "#vitrine") return <Showcase />;
  if (import.meta.env.DEV && devRoute === "#streaming" && StreamingDemo) {
    return (
      <Suspense fallback={null}>
        <StreamingDemo />
      </Suspense>
    );
  }
  return <AppShell />;
}
