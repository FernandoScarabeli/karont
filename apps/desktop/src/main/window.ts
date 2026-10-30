import { BrowserWindow } from 'electron';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { started } from './bootstrap';
import { attachedRuns, client, state } from './state';

export const index = path.join(__dirname, '../renderer/index.html');
export const trustedURL = pathToFileURL(index).href;

let opening: Promise<void> | undefined;
export async function openWindow() {
  if (state.win) {
    state.win.show();
    state.win.focus();
    return;
  }
  if (opening) return opening;
  opening = createWindow().finally(() => {
    opening = undefined;
  });
  return opening;
}

export async function createWindow() {
  const current = new BrowserWindow({
    width: 1440,
    height: 980,
    minWidth: 840,
    minHeight: 620,
    show: false,
    backgroundColor: '#141414',
    title: 'Karont',
    webPreferences: {
      preload: path.join(__dirname, 'preload.cjs'),
      contextIsolation: true,
      sandbox: true,
      nodeIntegration: false,
      webSecurity: true,
    },
  });
  state.win = current;
  current.webContents.on('render-process-gone', () => {
    state.lastFailure = 'Renderer encerrou inesperadamente';
  });
  current.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
  current.webContents.on('will-navigate', (event) => event.preventDefault());
  current.webContents.on('will-attach-webview', (event) => event.preventDefault());
  current.on('closed', () => {
    if (state.win === current) state.win = null;
    attachedRuns.clear();
    void client.request({ method: 'terminal.detachAll' }).catch(() => {});
  });
  current.once('ready-to-show', () => {
    current.show();
    console.log(JSON.stringify({ event: 'window-ready', elapsedMs: performance.now() - started }));
  });
  await current.loadFile(index);
}

export function authorize(event: Electron.IpcMainInvokeEvent) {
  if (
    !state.win ||
    state.win.isDestroyed() ||
    event.sender !== state.win.webContents ||
    event.senderFrame !== state.win.webContents.mainFrame ||
    event.senderFrame.url !== trustedURL
  )
    throw Error('Origem IPC recusada');
}
