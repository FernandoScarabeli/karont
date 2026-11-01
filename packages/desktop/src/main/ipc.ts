import { BridgeError } from "@karont/contract";
import type { ServiceClient } from "@karont/service";
import { type BrowserWindow, dialog, type IpcMainInvokeEvent, ipcMain, shell } from "electron";
import { validateExternalUrl } from "./external-url.ts";
import { validateIpcPayload } from "./ipc-validate.ts";
import { validatePickFolderOptions } from "./pick-folder.ts";
import { isAllowedSender } from "./sender.ts";

export type IpcHandlerOptions = {
  getClient(): ServiceClient | null;
  getWindow(): BrowserWindow | null;
};

export function registerIpcHandlers(options: IpcHandlerOptions): void {
  ipcMain.handle("karont:pickFolder", async (event, payload?: unknown) => {
    const mainWindow = options.getWindow();
    if (validateSender(event, mainWindow) || !mainWindow) return null;

    const validation = validatePickFolderOptions(payload);
    if (!validation.ok) return null;

    try {
      const result = await dialog.showOpenDialog(mainWindow, {
        title: "Escolher pasta",
        properties: ["openDirectory", "createDirectory", "dontAddToRecent"],
        defaultPath: validation.options.defaultPath,
      });
      const selectedPath = result.filePaths[0];
      return result.canceled || !selectedPath ? null : { path: selectedPath };
    } catch {
      return null;
    }
  });

  ipcMain.handle("karont:openExternal", async (event, payload: unknown) => {
    if (validateSender(event, options.getWindow())) return false;
    const url = validateExternalUrl(payload);
    if (!url) return false;
    try {
      await shell.openExternal(url);
      return true;
    } catch {
      return false;
    }
  });

  ipcMain.handle("karont:request", async (event, payload) => {
    const senderError = validateSender(event, options.getWindow());
    if (senderError) return { ok: false, error: senderError };

    const validation = validateIpcPayload(payload);
    if (!validation.ok) return validation;

    const client = options.getClient();
    if (!client) {
      return {
        ok: false,
        error: { code: "unavailable", message: "O serviço não está conectado." },
      };
    }

    try {
      const result = await client.request(
        validation.request.method,
        validation.request.params as never,
      );
      return { ok: true, result };
    } catch (error) {
      if (error instanceof BridgeError) {
        return { ok: false, error: { code: error.code, message: error.message } };
      }
      return {
        ok: false,
        error: { code: "internal", message: "O serviço encontrou um erro interno." },
      };
    }
  });
}

function validateSender(
  event: IpcMainInvokeEvent,
  mainWindow: BrowserWindow | null,
): { code: "unauthorized"; message: string } | null {
  const frame = event.senderFrame;
  if (!frame || !mainWindow || mainWindow.isDestroyed() || mainWindow.webContents.isDestroyed()) {
    return { code: "unauthorized", message: "Remetente não autorizado." };
  }
  const allowed = isAllowedSender({
    url: frame.url,
    isMainFrame: frame === mainWindow.webContents.mainFrame,
    belongsToOurWindow: event.sender === mainWindow.webContents,
  });
  return allowed ? null : { code: "unauthorized", message: "Remetente não autorizado." };
}
