import { app, Menu, Tray } from 'electron';
import { trayIcon } from './tray-icon';
import { runStates, state } from './state';
import { openWindow } from './window';

export function updateTray() {
  const { tray } = state;
  if (!state.trayAvailable || !tray) return;
  const active = [...runStates].filter(([, state]) => ['running', 'queued'].includes(state));
  tray.setToolTip(`Karont · ${active.length} execuções ativas`);
  tray.setContextMenu(
    Menu.buildFromTemplate([
      { label: `Abrir Karont · ${active.length} ativas`, click: () => void openWindow() },
      ...active.slice(0, 10).map(([id]) => ({
        label: `Execução ${id.slice(0, 8)}`,
        click: () => {
          state.targetRun = id;
          void openWindow().then(() => state.win?.webContents.send('karont:focus-run', id));
        },
      })),
      { label: 'Encerrar aplicativo (daemon e CLIs continuam)', click: () => app.quit() },
    ]),
  );
}

export function createTray() {
  try {
    state.tray = new Tray(trayIcon());
    state.trayAvailable = true;
    updateTray();
    state.tray.on('click', () => void openWindow());
  } catch {
    state.lastFailure = 'Tray indisponível';
  }
}
