import { contextBridge, ipcRenderer } from 'electron';
import { createKarontBridge } from '../shared/createBridge';
import type { KarontBridge } from '../shared/bridge';

const bridge = createKarontBridge({
  runtime: {
    sandboxed: process.sandboxed === true,
    contextIsolated: process.contextIsolated === true,
  },
  invoke: (channel, value) => ipcRenderer.invoke(channel, value),
  on: (channel, listener) => {
    const handler = (_event: Electron.IpcRendererEvent, value: unknown) => listener(value);
    ipcRenderer.on(channel, handler);
    return () => ipcRenderer.removeListener(channel, handler);
  },
}) satisfies KarontBridge;

contextBridge.exposeInMainWorld('karont', bridge);
