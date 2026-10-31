import { app, dialog, Menu } from "electron";
import {
  applyDialogResult,
  decideOnClose,
  readStoredCloseBehavior,
} from "./main/close-behavior.ts";
import { registerIpcHandlers } from "./main/ipc.ts";
import { createServiceManager } from "./main/service.ts";
import { createTrayController } from "./main/tray.ts";
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
  let windowLifecycleReady = false;
  let quitting = false;
  let closeDecisionPending = false;
  const service = createServiceManager((event) => {
    if (mainWindow && !mainWindow.isDestroyed() && !mainWindow.webContents.isDestroyed()) {
      mainWindow.webContents.send("karont:event", event);
    }
  });
  const tray = createTrayController({
    openWindow: showMainWindow,
    quit: () => void closeEverything(),
  });

  app.on("second-instance", () => {
    showMainWindow();
  });
  app.on("activate", showMainWindow);

  app.on("web-contents-created", (_event, contents) => {
    contents.on("will-attach-webview", (event) => event.preventDefault());
  });

  app.on("window-all-closed", () => app.quit());
  app.on("before-quit", () => {
    quitting = true;
    tray.destroy();
    // Ao sair por outro caminho, o serviço destacado continua rodando como antes.
    service.close();
  });

  app
    .whenReady()
    .then(async () => {
      Menu.setApplicationMenu(null);
      registerAppProtocol();
      await service.start();
      registerIpcHandlers({ getClient: service.getClient, getWindow: () => mainWindow });
      windowLifecycleReady = true;
      createWindow();
    })
    .catch(handleStartupError);

  function createWindow(): void {
    const window = createMainWindow();
    mainWindow = window;
    window.on("close", (event) => {
      if (quitting) return;
      event.preventDefault();
      if (closeDecisionPending) return;
      closeDecisionPending = true;
      void handleWindowClose(window)
        .catch((error: unknown) => {
          process.stderr.write(`Falha ao decidir o fechamento do Karont: ${errorMessage(error)}\n`);
        })
        .finally(() => {
          if (!quitting) closeDecisionPending = false;
        });
    });
    watchWindowLoad(window, service.publishCurrentStatus);
    void loadMainWindow(window).catch(handleStartupError);
  }

  function showMainWindow(): void {
    if (quitting) return;
    if (!app.isReady()) {
      void app.whenReady().then(showMainWindow);
      return;
    }
    if (!windowLifecycleReady) return;
    if (!mainWindow || mainWindow.isDestroyed()) createWindow();
    if (!mainWindow || mainWindow.isDestroyed()) return;
    if (mainWindow.isMinimized()) mainWindow.restore();
    mainWindow.show();
    mainWindow.focus();
  }

  async function handleWindowClose(
    window: Awaited<ReturnType<typeof createMainWindow>>,
  ): Promise<void> {
    const stored = await readStoredCloseBehavior(async () => {
      const client = service.getClient();
      if (!client) throw new Error("Serviço desconectado");
      return (await client.request("settings.get", { key: "app.closeBehavior" })).value;
    });
    if (quitting || window.isDestroyed()) return;

    const decision = decideOnClose({ stored, quitting });
    if (decision === "background") {
      moveWindowToBackground(window);
      return;
    }
    if (decision === "quit") {
      await closeEverything();
      return;
    }
    if (decision !== "ask") return;

    const result = await dialog.showMessageBox(window, {
      type: "question",
      title: "Fechar o Karont",
      message: "O que fazer com o Karont?",
      detail:
        "Em segundo plano, os agentes e terminais continuam rodando e o Karont fica na bandeja. Fechar tudo encerra todos eles.",
      buttons: ["Deixar rodando em segundo plano", "Fechar tudo", "Cancelar"],
      defaultId: 0,
      cancelId: 2,
      noLink: true,
      checkboxLabel: "Lembrar minha escolha",
      checkboxChecked: false,
    });
    if (quitting || window.isDestroyed()) return;

    const choice = applyDialogResult({
      response: result.response,
      checkboxChecked: result.checkboxChecked,
    });
    if (choice.preference) await saveCloseBehavior(choice.preference);
    if (choice.action === "background") moveWindowToBackground(window);
    if (choice.action === "quit") await closeEverything();
  }

  async function saveCloseBehavior(value: "background" | "quit"): Promise<void> {
    const client = service.getClient();
    if (!client) {
      process.stderr.write("Não foi possível salvar a preferência de fechamento do Karont.\n");
      return;
    }
    const saved = await readStoredCloseBehavior(async () => {
      await client.request("settings.set", { key: "app.closeBehavior", value });
      return true;
    });
    if (saved !== true) {
      process.stderr.write("Não foi possível salvar a preferência de fechamento do Karont.\n");
    }
  }

  function moveWindowToBackground(window: Awaited<ReturnType<typeof createMainWindow>>): void {
    if (window.isDestroyed()) return;
    if (!tray.ensure()) {
      window.minimize();
      return;
    }
    window.hide();
  }

  async function closeEverything(): Promise<void> {
    if (quitting) return;
    quitting = true;
    await service.shutdown(3_000);
    service.close();
    tray.destroy();
    app.quit();
  }
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
