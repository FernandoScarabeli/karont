import type { NativeBridge, NativeResult, PickFolderResult } from "@karont/contract";
import { contextBridge, ipcRenderer } from "electron";

const bridge: NativeBridge = {
  request(method, params): Promise<NativeResult> {
    return ipcRenderer.invoke("karont:request", { method, params }) as Promise<NativeResult>;
  },
  pickFolder(options): Promise<PickFolderResult> {
    return ipcRenderer.invoke("karont:pickFolder", options) as Promise<PickFolderResult>;
  },
  onEvent(listener): () => void {
    const handler = (_event: Electron.IpcRendererEvent, event: unknown): void => listener(event);
    ipcRenderer.on("karont:event", handler);
    return () => ipcRenderer.removeListener("karont:event", handler);
  },
};

contextBridge.exposeInMainWorld("karontNative", bridge);
