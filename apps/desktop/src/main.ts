import {
  app,
  BrowserWindow,
  ipcMain,
  Menu,
  Tray,
  session,
  Notification,
  dialog,
  clipboard,
} from 'electron';
import path from 'node:path';
import fs from 'node:fs';
import { issueReport } from '../../../packages/local/src/report';
import { NotificationCenter } from './notifications';
import { APP_VERSION, type DiagnosticItem, type Dot } from '../../../packages/contracts/src';
import { pathToFileURL } from 'node:url';
import { trayIcon } from './tray-icon';
import { spawn } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { z } from 'zod';
import { Client } from '../../../packages/local/src/client';
import { migrateLegacyDirs } from '../../../packages/local/src/paths';
import {
  layoutSchema,
  requestSchema,
  type Command,
  type TerminalEvent,
} from '../../../packages/contracts/src';
const started = performance.now();
for (const flag of [
  'no-sandbox',
  'disable-seccomp-filter-sandbox',
  'disable-namespace-sandbox',
  'disable-setuid-sandbox',
  'disable-gpu-sandbox',
  'single-process',
]) {
  if (app.commandLine.hasSwitch(flag))
    throw Error(`Karont exige sandbox Chromium ativo; flag recusada: ${flag}`);
}
app.setName('karont');
migrateLegacyDirs();
app.setPath(
  'userData',
  process.env.KARONT_DESKTOP_DATA ||
    process.env.EROS_DESKTOP_DATA ||
    path.join(app.getPath('appData'), 'karont'),
);
const client = new Client();
let win: BrowserWindow | null = null;
let connected = true,
  lastFailure = 'Não verificado',
  trayAvailable = false;
let targetRun: string | undefined;
const attachedRuns = new Set<string>();
const runStates = new Map<string, string>();
const pendingResumes = new Set<string>();
const preferencesPath = path.join(app.getPath('userData'), 'attention.json');
const notifications = new NotificationCenter((title, click, fail) => {
  if (!Notification.isSupported()) return false;
  const notification = new Notification({
    title,
    body: 'Abra o Karont para consultar os detalhes.',
    silent: false,
  });
  notification.on('click', click);
  notification.on('failed', fail);
  notification.show();
  return true;
});
const projectAddUiSchema = z
  .object({
    workspaceId: z.string().uuid(),
    name: z.string().trim().min(1).max(120),
    root: z.string().min(1).max(4096),
    icon: z.enum([
      'folder',
      'code-xml',
      'globe',
      'terminal',
      'layers',
      'briefcase',
      'book-open',
      'rocket',
    ]),
    dotIds: z
      .array(
        z
          .string()
          .min(1)
          .max(80)
          .regex(/^[a-zA-Z0-9._-]+$/),
      )
      .max(8)
      .refine((ids) => new Set(ids).size === ids.length),
  })
  .strict();
try {
  notifications.enabled = JSON.parse(fs.readFileSync(preferencesPath, 'utf8')).enabled !== false;
} catch {
  // Sem preferência salva (ou arquivo inválido): mantém o padrão do NotificationCenter.
}
function notify(key: string, title: string, runId?: string) {
  notifications.notify(key, title, () => {
    targetRun = runId;
    void openWindow().then(() => {
      if (runId) win?.webContents.send('karont:focus-run', runId);
    });
  });
}
function updateTray() {
  if (!trayAvailable) return;
  const active = [...runStates].filter(([, state]) => ['running', 'queued'].includes(state));
  tray.setToolTip(`Karont · ${active.length} execuções ativas`);
  tray.setContextMenu(
    Menu.buildFromTemplate([
      { label: `Abrir Karont · ${active.length} ativas`, click: () => void openWindow() },
      ...active.slice(0, 10).map(([id]) => ({
        label: `Execução ${id.slice(0, 8)}`,
        click: () => {
          targetRun = id;
          void openWindow().then(() => win?.webContents.send('karont:focus-run', id));
        },
      })),
      { label: 'Encerrar aplicativo (daemon e CLIs continuam)', click: () => app.quit() },
    ]),
  );
}
client.onEvent((event: TerminalEvent) => {
  if (event.type === 'continuity.notice') {
    const titles = {
      'quota.confirmed': 'Limite temporário confirmado',
      'auto_resume.scheduled': 'Auto Resume agendado',
      'run.resumed': 'Execução retomada',
      'resume.failed': 'Retomada falhou',
    };
    notify(`continuity:${event.eventId}`, titles[event.kind], event.runId);
  }
  if (event.type === 'run.updated') {
    const run = event.run;
    if (runStates.get(run.id) === 'recovery_needed' && run.state === 'queued')
      pendingResumes.add(run.id);
    if (pendingResumes.has(run.id) && run.state === 'running') {
      notify(`resumed:${run.id}:${run.sessionId}`, 'Execução retomada em nova sessão', run.id);
      pendingResumes.delete(run.id);
    }
    if (run.state === 'recovery_needed') {
      notify(`recovery:${run.id}:${run.sessionId}`, 'Recuperação necessária', run.id);
      if (pendingResumes.delete(run.id))
        notify(`resume-failed:${run.id}:${run.sessionId}`, 'Retomada falhou', run.id);
    }
    runStates.set(run.id, run.state);
    updateTray();
    if (['completed', 'failed'].includes(run.state))
      notify(
        `run:${run.id}:${run.state}`,
        run.state === 'completed' ? 'Execução concluída' : 'Execução com erro',
        run.id,
      );
  }
  if (event.type === 'approval.updated' && ['applied', 'failed'].includes(event.approval.status))
    notify(
      `rollback:${event.approval.id}`,
      event.approval.status === 'applied' ? 'Rollback concluído' : 'Rollback falhou',
      event.approval.runId,
    );
  if (win && !win.isDestroyed()) win.webContents.send('karont:event', event);
});
let tray: Tray;
let opening: Promise<void> | undefined;
let heartbeat: NodeJS.Timeout;
const index = path.join(__dirname, '../renderer/index.html');
const trustedURL = pathToFileURL(index).href;
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
    clearInterval(heartbeat);
    client.close();
  });
  void app
    .whenReady()
    .then(async () => {
      session.defaultSession.setPermissionRequestHandler((_w, _p, cb) => cb(false));
      session.defaultSession.setPermissionCheckHandler(() => false);
      ipcMain.handle('karont:command', async (event, command: unknown) => {
        authorize(event);
        if (!command || typeof command !== 'object') throw Error('Mensagem inválida');
        const c = command as Record<string, unknown>;
        if (c.method === 'snapshot' && Object.keys(c).length === 1)
          return client.request({ method: 'snapshot' });
        if (c.method === 'layout' && Object.keys(c).length === 2)
          return client.request({ method: 'layout', value: layoutSchema.parse(c.value) });
        if (c.method === 'stream' && typeof c.value === 'boolean' && Object.keys(c).length === 2)
          return client.request({ method: 'stream', value: c.value });
        if (c.method === 'close' && Object.keys(c).length === 1) {
          win?.close();
          return;
        }
        throw Error('Comando IPC recusado');
      });
      ipcMain.handle('karont:diagnostics', async (event, value: unknown) => {
        authorize(event);
        noValue(value);
        return diagnostics();
      });
      ipcMain.handle('karont:report', async (event, value: unknown) => {
        authorize(event);
        noValue(value);
        return issueReport(await diagnostics());
      });
      ipcMain.handle('karont:report:save', async (event, value: unknown) => {
        authorize(event);
        noValue(value);
        const report = issueReport(await diagnostics());
        const result = await dialog.showSaveDialog(win!, {
          title: 'Salvar relatório local',
          defaultPath: 'karont-problema.md',
          filters: [{ name: 'Markdown', extensions: ['md'] }],
        });
        if (result.canceled || !result.filePath) return false;
        fs.writeFileSync(result.filePath, report, { mode: 0o600 });
        return true;
      });
      ipcMain.handle('karont:report:copy', async (event, value: unknown) => {
        authorize(event);
        noValue(value);
        clipboard.writeText(issueReport(await diagnostics()));
        return true;
      });
      ipcMain.handle('karont:notifications', (event, value: unknown) => {
        authorize(event);
        if (value !== undefined && typeof value !== 'boolean') throw Error('Preferência inválida');
        if (typeof value === 'boolean') {
          notifications.enabled = value;
          fs.mkdirSync(path.dirname(preferencesPath), { recursive: true, mode: 0o700 });
          fs.writeFileSync(preferencesPath, JSON.stringify({ enabled: value }), { mode: 0o600 });
        }
        return { enabled: notifications.enabled, history: notifications.history };
      });
      ipcMain.handle('karont:focus-target', (event, value: unknown) => {
        authorize(event);
        noValue(value);
        const id = targetRun;
        targetRun = undefined;
        return id;
      });
      ipcMain.handle('karont:projects:choose-folder', async (event) => {
        authorize(event);
        const selected = await dialog.showOpenDialog(win!, {
          title: 'Escolher pasta raiz',
          buttonLabel: 'Selecionar pasta',
          properties: ['openDirectory'],
        });
        authorize(event);
        return selected.canceled ? null : (selected.filePaths[0] ?? null);
      });
      ipcMain.handle('karont:projects:add', async (event, value: unknown) => {
        authorize(event);
        const input = projectAddUiSchema.parse(value);
        if (input.dotIds.length)
          throw Error('Concessões são configuradas separadamente do cadastro de projeto');
        return client.request({
          method: 'projects.add',
          value: { ...input, operationId: randomUUID() },
        });
      });
      const handlers: [string, Command['method'], (value: any) => object][] = [
        ['karont:workspaces:list', 'workspaces.list', (value) => ({ value })],
        ['karont:workspaces:create', 'workspaces.create', (value) => ({ value })],
        ['karont:workspaces:rename', 'workspaces.rename', (value) => ({ value })],
        ['karont:approvals:list', 'approvals.list', noValue],
        ['karont:approvals:decide', 'approvals.decide', (value) => ({ value })],
        ['karont:dots:list', 'dots.list', noValue],
        [
          'karont:projects:list',
          'projects.list',
          (value) => (value === undefined ? {} : { value }),
        ],
        ['karont:projects:update', 'projects.update', (value) => ({ value })],
        ['karont:chats:list', 'chats.list', (value) => ({ value })],
        ['karont:chats:create', 'chats.create', (value) => ({ value })],
        ['karont:chats:get', 'chats.get', (value) => ({ value })],
        ['karont:chats:rename', 'chats.rename', (value) => ({ value })],
        ['karont:chats:open', 'chats.open', (value) => ({ value })],
        ['karont:chats:favorite', 'chats.favorite', (value) => ({ value })],
        ['karont:chats:draft', 'chats.draft', (value) => ({ value })],
        ['karont:chats:move-preview', 'chats.move.preview', (value) => ({ value })],
        ['karont:chats:move', 'chats.move', (value) => ({ value })],
        ['karont:messages:list', 'messages.list', (value) => ({ value })],
        ['karont:messages:save', 'messages.save', (value) => ({ value })],
        ['karont:messages:send', 'messages.send', (value) => ({ value })],
        ['karont:messages:deliveries', 'messages.deliveries', (value) => ({ value })],
        ['karont:chats:runs', 'chats.runs.list', (value) => ({ value })],
        ['karont:tasks:list', 'tasks.list', (value) => ({ value })],
        ['karont:tasks:get', 'tasks.get', (value) => ({ value })],
        ['karont:tasks:create', 'tasks.create', (value) => ({ value })],
        ['karont:tasks:update', 'tasks.update', (value) => ({ value })],
        ['karont:tasks:assignees:set', 'tasks.assignees.set', (value) => ({ value })],
        ['karont:tasks:runs:link', 'tasks.runs.link', (value) => ({ value })],
        ['karont:tasks:runs:unlink', 'tasks.runs.unlink', (value) => ({ value })],
        ['karont:tasks:events:list', 'tasks.events.list', (value) => ({ value })],
        ['karont:navigation:get', 'navigation.get', noValue],
        ['karont:navigation:set', 'navigation.set', (value) => ({ value })],
        ['karont:runs:list', 'runs.list', (value) => ({ value })],
        ['karont:checkpoints:list', 'checkpoints.list', (value) => ({ value })],
        ['karont:checkpoints:create', 'checkpoints.create', (value) => ({ value })],
        ['karont:recovery:inspect', 'recovery.inspect', (value) => ({ value })],
        ['karont:runs:pause', 'runs.pause', (value) => ({ value })],
        ['karont:runs:resume', 'runs.resume', (value) => ({ value })],
        ['karont:runs:autoResume', 'runs.autoResume', (value) => ({ value })],
        ['karont:runs:start', 'runs.start', (value) => ({ value })],
        ['karont:terminal:attach', 'terminal.attach', (value) => ({ value })],
        ['karont:terminal:detach-all', 'terminal.detachAll', noValue],
        ['karont:terminal:write', 'terminal.write', (value) => ({ value })],
        ['karont:terminal:resize', 'terminal.resize', (value) => ({ value })],
        ['karont:runs:cancel', 'runs.cancel', (value) => ({ value })],
        ['karont:worktree:remove', 'worktree.remove', (value) => ({ value })],
        ['karont:runs:diff', 'runs.diff', (value) => ({ value })],
        ['karont:rollback:preview', 'rollback.preview', (value) => ({ value })],
        ['karont:rollback:apply', 'rollback.apply', (value) => ({ value })],
      ];
      for (const [channel, method, payload] of handlers) {
        ipcMain.handle(channel, async (event, value: unknown) => {
          authorize(event);
          const request = requestSchema.parse({ id: 1, method, ...payload(value) });
          if (request.method === 'runs.start' && request.value.permissionMode === 'full') {
            const consent = await dialog.showMessageBox(win!, {
              type: 'warning',
              title: 'Acesso total para esta execução',
              message: 'Permitir acesso ampliado à sua conta?',
              detail:
                'O Codex poderá executar comandos, acessar a rede e alterar arquivos fora da worktree. A worktree não é sandbox. Esta autorização vale somente para a nova execução.',
              buttons: ['Cancelar', 'Habilitar acesso total'],
              defaultId: 0,
              cancelId: 0,
              noLink: true,
            });
            if (consent.response !== 1) throw Error('Acesso total não autorizado');
            authorize(event);
            request.value.elevatedConfirmed = true;
          }
          const { id: _id, ...command } = request;
          const result = await client.request(command as Command);
          if (request.method === 'terminal.attach') attachedRuns.add(request.value.runId);
          if (request.method === 'terminal.detachAll') attachedRuns.clear();
          return result;
        });
      }
      await ensureDaemon().catch(() => {
        connected = false;
        lastFailure = 'Daemon indisponível';
        notify('daemon:startup', 'Daemon indisponível');
      });
      async function refreshHealth() {
        try {
          await client.request({ method: 'ping' });
          const runs = await client.request<
            { id: string; state: string; sessionId: string | null }[]
          >({
            method: 'runs.list',
            value: { limit: 100 },
          });
          for (const run of runs) {
            if (run.state === 'recovery_needed')
              notify(`recovery:${run.id}:${run.sessionId}`, 'Recuperação necessária', run.id);
            if (runStates.get(run.id) === 'recovery_needed' && run.state === 'running')
              notify(
                `resumed:${run.id}:${run.sessionId}`,
                'Execução retomada em nova sessão',
                run.id,
              );
            if (
              ['running', 'queued'].includes(runStates.get(run.id) ?? '') &&
              ['completed', 'failed'].includes(run.state)
            )
              notify(
                `run:${run.id}:${run.state}`,
                run.state === 'completed' ? 'Execução concluída' : 'Execução com erro',
                run.id,
              );
          }
          runStates.clear();
          for (const run of runs) runStates.set(run.id, run.state);
          if (!connected && win && !win.isDestroyed())
            for (const runId of attachedRuns)
              await client.request({ method: 'terminal.attach', value: { runId } });
          connected = true;
          updateTray();
        } catch {
          if (connected) notify(`daemon:${Date.now()}`, 'Conexão com daemon interrompida');
          connected = false;
          lastFailure = 'Conexão com daemon interrompida';
        }
      }
      await refreshHealth();
      let checking = false;
      heartbeat = setInterval(() => {
        if (checking) return;
        checking = true;
        void refreshHealth().finally(() => {
          checking = false;
        });
      }, 2000);
      try {
        tray = new Tray(trayIcon());
        trayAvailable = true;
        updateTray();
        tray.on('click', () => void openWindow());
      } catch {
        lastFailure = 'Tray indisponível';
      }
      Menu.setApplicationMenu(null);
      await openWindow();
    })
    .catch((e) => {
      console.error(e);
      app.exit(1);
    });
}
async function ensureDaemon() {
  try {
    await client.request({ method: 'ping' });
    return;
  } catch {
    // Daemon ainda não está rodando: inicia um abaixo.
  }
  const child = spawn(
    process.env.EROS_NODE_BINARY || 'node',
    [path.join(__dirname, '../daemon/entry.cjs')],
    { detached: true, stdio: 'ignore' },
  );
  child.on('error', (e) => console.error('Daemon:', e.message));
  child.unref();
  for (let n = 0; n < 40; n++) {
    await new Promise((r) => setTimeout(r, 100));
    try {
      await client.request({ method: 'ping' });
      return;
    } catch {
      // Ainda subindo: tenta de novo (até 40 × 100 ms).
    }
  }
  throw Error('Daemon indisponível. Verifique Node >=24 e os diretórios privados.');
}
async function openWindow() {
  if (win) {
    win.show();
    win.focus();
    return;
  }
  if (opening) return opening;
  opening = createWindow().finally(() => {
    opening = undefined;
  });
  return opening;
}
async function createWindow() {
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
  win = current;
  current.webContents.on('render-process-gone', () => {
    lastFailure = 'Renderer encerrou inesperadamente';
  });
  current.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
  current.webContents.on('will-navigate', (event) => event.preventDefault());
  current.webContents.on('will-attach-webview', (event) => event.preventDefault());
  current.on('closed', () => {
    if (win === current) win = null;
    attachedRuns.clear();
    void client.request({ method: 'terminal.detachAll' }).catch(() => {});
  });
  current.once('ready-to-show', () => {
    current.show();
    console.log(JSON.stringify({ event: 'window-ready', elapsedMs: performance.now() - started }));
  });
  await current.loadFile(index);
}
function authorize(event: Electron.IpcMainInvokeEvent) {
  if (
    !win ||
    win.isDestroyed() ||
    event.sender !== win.webContents ||
    event.senderFrame !== win.webContents.mainFrame ||
    event.senderFrame.url !== trustedURL
  )
    throw Error('Origem IPC recusada');
}
function noValue(value: unknown) {
  if (value !== undefined) throw Error('Argumento inesperado');
  return {};
}

async function diagnostics(): Promise<DiagnosticItem[]> {
  let daemon: DiagnosticItem[];
  try {
    daemon = await client.request({ method: 'diagnostics' });
  } catch {
    daemon = [
      {
        category: 'Daemon',
        label: 'Conexão',
        status: 'error',
        value: 'Daemon indisponível; tente reconectar.',
      },
    ];
  }
  const prefs = win && !win.isDestroyed() ? { sandbox: true } : undefined;
  return [
    ...daemon,
    {
      category: 'Aplicativo',
      label: 'Aplicativo',
      status: 'available',
      value: `${APP_VERSION} · Electron ${process.versions.electron} · Node ${process.versions.node}`,
    },
    {
      category: 'Sistema',
      label: 'Sessão gráfica',
      status: process.env.WAYLAND_DISPLAY || process.env.DISPLAY ? 'available' : 'unverified',
      value: process.env.WAYLAND_DISPLAY
        ? 'Wayland (variável presente)'
        : process.env.DISPLAY
          ? 'X11 (variável presente)'
          : 'Não detectada',
    },
    {
      category: 'Recursos',
      label: 'GPU',
      status: 'unverified',
      value: 'Não sondada; diagnóstico leve',
    },
    {
      category: 'Segurança',
      label: 'Sandbox renderer',
      status: prefs?.sandbox === true ? 'available' : 'unverified',
      value:
        prefs?.sandbox === true
          ? 'Sandbox obrigatório e isolamento configurados; prova efetiva no E2E'
          : 'Sem renderer para inspecionar',
    },
    {
      category: 'Integração',
      label: 'Tray',
      status: trayAvailable ? 'available' : 'unavailable',
      value: trayAvailable
        ? 'Objeto Tray criado; visibilidade no compositor não verificada'
        : 'Tray indisponível',
    },
    {
      category: 'Integração',
      label: 'Notificações',
      status: Notification.isSupported() ? 'available' : 'unavailable',
      value: `Suporte declarado: ${Notification.isSupported()}; preferência: ${notifications.enabled ? 'ativa' : 'desativada'}; último envio: ${notifications.history.at(-1)?.status ?? 'não verificado'}. Não comprova visualização.`,
    },
    {
      category: 'Falhas',
      label: 'Última falha',
      status: lastFailure === 'Não verificado' ? 'unverified' : 'error',
      value: lastFailure,
    },
  ];
}
