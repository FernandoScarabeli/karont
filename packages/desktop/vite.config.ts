import path from "node:path";
import { fileURLToPath } from "node:url";
import { defineConfig } from "vite";

const desktopDirectory = path.dirname(fileURLToPath(import.meta.url));

export default defineConfig(({ mode }) => {
  const target = mode === "preload" ? "preload" : mode === "service" ? "service" : "main";
  const entry =
    target === "preload"
      ? path.join(desktopDirectory, "src/preload/preload.ts")
      : target === "service"
        ? path.resolve(desktopDirectory, "../service/src/main.ts")
        : path.join(desktopDirectory, "src/main.ts");
  const format = target === "preload" ? "cjs" : "es";

  return {
    build: {
      outDir: path.join(desktopDirectory, "dist"),
      emptyOutDir: target === "main",
      lib: {
        entry,
        name: "KarontDesktop",
        formats: [format],
        fileName: target,
      },
      rollupOptions: {
        external: (id: string) =>
          id === "electron" ||
          id.startsWith("node:") ||
          (target === "service" && id === "node-pty"),
      },
    },
  };
});
