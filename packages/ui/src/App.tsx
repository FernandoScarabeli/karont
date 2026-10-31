import { useEffect, useState } from "react";
import { Showcase } from "./dev/Showcase.tsx";
import { AppShell } from "./shell/AppShell.tsx";

export function App() {
  const [showcaseVisible, setShowcaseVisible] = useState(
    () => import.meta.env.DEV && window.location.hash === "#vitrine",
  );

  useEffect(() => {
    if (!import.meta.env.DEV) return;

    const syncShowcaseVisibility = () => {
      setShowcaseVisible(window.location.hash === "#vitrine");
    };

    window.addEventListener("hashchange", syncShowcaseVisibility);
    return () => window.removeEventListener("hashchange", syncShowcaseVisibility);
  }, []);

  return showcaseVisible ? <Showcase /> : <AppShell />;
}
