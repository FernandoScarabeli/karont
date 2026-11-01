import { lazy, Suspense, useEffect, useState } from "react";
import { Showcase } from "./dev/Showcase.tsx";
import { AppShell } from "./shell/AppShell.tsx";

const ChatPreview = import.meta.env.DEV
  ? lazy(() =>
      import("./dev/ChatPreview.tsx").then(({ ChatPreview: preview }) => ({ default: preview })),
    )
  : null;

function isChatPreviewHash(hash: string): boolean {
  return hash === "#chat" || hash.startsWith("#chat-");
}

export function App() {
  const [devRoute, setDevRoute] = useState(() =>
    import.meta.env.DEV &&
    (isChatPreviewHash(window.location.hash) || window.location.hash === "#vitrine")
      ? window.location.hash
      : "",
  );

  useEffect(() => {
    if (!import.meta.env.DEV) return;

    const syncDevRoute = () => {
      const hash = window.location.hash;
      setDevRoute(isChatPreviewHash(hash) || hash === "#vitrine" ? hash : "");
    };

    window.addEventListener("hashchange", syncDevRoute);
    return () => window.removeEventListener("hashchange", syncDevRoute);
  }, []);

  if (import.meta.env.DEV && ChatPreview && isChatPreviewHash(devRoute)) {
    return (
      <Suspense fallback={null}>
        <ChatPreview />
      </Suspense>
    );
  }
  if (devRoute === "#vitrine") return <Showcase />;
  return <AppShell />;
}
