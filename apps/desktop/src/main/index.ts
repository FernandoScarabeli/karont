import { bootstrap } from './bootstrap';
import { app, Menu, session } from 'electron';
import { client, state } from './state';
import { openWindow } from './window';
import { createTray } from './tray';
import { loadNotificationPreference, notify } from './notify';
import { ensureDaemon, startHeartbeat, stopHeartbeat } from './daemon';
import { registerIpc } from './ipc';

// Nenhum módulo importado acima faz algo no carregamento que dependa disto; a ordem fica aqui.
bootstrap();
loadNotificationPreference();

if (!app.requestSingleInstanceLock()) {
  app.quit();
} else {
  app.on('second-instance', () => {
    void openWindow();
  });
  app.on('activate', () => {
    void openWindow();
  });
  app.on('window-all-closed', () => {});
  app.on('before-quit', () => {
    stopHeartbeat();
    client.close();
  });
  void app
    .whenReady()
    .then(async () => {
      session.defaultSession.setPermissionRequestHandler((_w, _p, cb) => cb(false));
      session.defaultSession.setPermissionCheckHandler(() => false);
      registerIpc();
      await ensureDaemon().catch(() => {
        state.connected = false;
        state.lastFailure = 'Daemon indisponível';
        notify('daemon:startup', 'Daemon indisponível');
      });
      await startHeartbeat();
      createTray();
      Menu.setApplicationMenu(null);
      await openWindow();
    })
    .catch((e) => {
      console.error(e);
      app.exit(1);
    });
}
