import { app, Menu } from "electron";
import { registerIpcHandlers } from "./main/ipc.ts";
import { createServiceManager } from "./main/service.ts";
import {
  createMainWindow,
  loadMainWindow,
  registerAppProtocol,
  registerAppScheme,
} from "./main/window.ts";

registerAppScheme();
const hasInstanceLock = app.requestSingleInstanceLock();
if (!hasInstanceLock) {
  app.quit();
} else {
  let mainWindow: Awaited<ReturnType<typeof createMainWindow>> | null = null;
  const service = createServiceManager((event) => {
    if (mainWindow && !mainWindow.isDestroyed() && !mainWindow.webContents.isDestroyed()) {
      mainWindow.webContents.send("karont:event", event);
    }
  });

  app.on("second-instance", () => {
    if (!mainWindow || mainWindow.isDestroyed()) return;
    if (mainWindow.isMinimized()) mainWindow.restore();
    mainWindow.focus();
  });

  app.on("web-contents-created", (_event, contents) => {
    contents.on("will-attach-webview", (event) => event.preventDefault());
  });

  app.on("window-all-closed", () => app.quit());
  app.on("before-quit", () => service.close());

  app
    .whenReady()
    .then(async () => {
      Menu.setApplicationMenu(null);
      registerAppProtocol();
      await service.start();
      mainWindow = createMainWindow();
      registerIpcHandlers({ getClient: service.getClient, getWindow: () => mainWindow });
      watchWindowLoad(mainWindow, service.publishCurrentStatus);
      void loadMainWindow(mainWindow).catch(handleStartupError);

      app.on("activate", () => {
        if (mainWindow && !mainWindow.isDestroyed()) return;
        mainWindow = createMainWindow();
        watchWindowLoad(mainWindow, service.publishCurrentStatus);
        void loadMainWindow(mainWindow).catch(handleStartupError);
      });
    })
    .catch(handleStartupError);
}

function watchWindowLoad(
  window: Awaited<ReturnType<typeof createMainWindow>>,
  publishStatus: () => void,
): void {
  window.webContents.once("did-finish-load", publishStatus);
}

function handleStartupError(error: unknown): void {
  process.stderr.write(`Falha ao iniciar a janela do Karont: ${errorMessage(error)}\n`);
  app.quit();
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
