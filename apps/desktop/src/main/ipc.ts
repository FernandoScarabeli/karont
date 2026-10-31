import { clipboard, dialog, ipcMain } from 'electron';
import fs from 'node:fs';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { z } from 'zod';
import { issueReport } from '../../../../packages/local/src/report';
import { layoutSchema, requestSchema, type Command } from '../../../../packages/contracts/src';
import { attachedRuns, client, state } from './state';
import { authorize } from './window';
import { diagnostics } from './diagnostics';
import { notifications, preferencesPath } from './notify';
import { localUserName } from './systemUser';

export type ChannelHandler = (value: unknown, recheck: () => void) => Promise<unknown> | unknown;

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

function noValue(value: unknown) {
  if (value !== undefined) throw Error('Argumento inesperado');
  return {};
}

export function channelHandlers(): Map<string, ChannelHandler> {
  const handlers = new Map<string, ChannelHandler>();

  handlers.set('karont:command', async (command) => {
    if (!command || typeof command !== 'object') throw Error('Mensagem inválida');
    const c = command as Record<string, unknown>;
    if (c.method === 'snapshot' && Object.keys(c).length === 1)
      return client.request({ method: 'snapshot' });
    if (c.method === 'layout' && Object.keys(c).length === 2)
      return client.request({ method: 'layout', value: layoutSchema.parse(c.value) });
    if (c.method === 'stream' && typeof c.value === 'boolean' && Object.keys(c).length === 2)
      return client.request({ method: 'stream', value: c.value });
    if (c.method === 'close' && Object.keys(c).length === 1) {
      state.win?.close();
      return;
    }
    throw Error('Comando IPC recusado');
  });
  handlers.set('karont:diagnostics', (value) => {
    noValue(value);
    return diagnostics();
  });
  handlers.set('karont:system:user', (value) => {
    noValue(value);
    return { name: localUserName() };
  });
  handlers.set('karont:report', async (value) => {
    noValue(value);
    return issueReport(await diagnostics());
  });
  handlers.set('karont:report:save', async (value) => {
    noValue(value);
    const report = issueReport(await diagnostics());
    const options = {
      title: 'Salvar relatório local',
      defaultPath: 'karont-problema.md',
      filters: [{ name: 'Markdown', extensions: ['md'] }],
    };
    const result = state.win
      ? await dialog.showSaveDialog(state.win, options)
      : await dialog.showSaveDialog(options);
    if (result.canceled || !result.filePath) return false;
    fs.writeFileSync(result.filePath, report, { mode: 0o600 });
    return true;
  });
  handlers.set('karont:report:copy', async (value) => {
    noValue(value);
    clipboard.writeText(issueReport(await diagnostics()));
    return true;
  });
  handlers.set('karont:notifications', (value) => {
    if (value !== undefined && typeof value !== 'boolean') throw Error('Preferência inválida');
    if (typeof value === 'boolean') {
      notifications.enabled = value;
      fs.mkdirSync(path.dirname(preferencesPath()), { recursive: true, mode: 0o700 });
      fs.writeFileSync(preferencesPath(), JSON.stringify({ enabled: value }), { mode: 0o600 });
    }
    return { enabled: notifications.enabled, history: notifications.history };
  });
  handlers.set('karont:focus-target', (value) => {
    noValue(value);
    const id = state.targetRun;
    state.targetRun = undefined;
    return id;
  });
  handlers.set('karont:projects:choose-folder', async (_value, recheck) => {
    const options = {
      title: 'Escolher pasta raiz',
      buttonLabel: 'Selecionar pasta',
      properties: ['openDirectory'] as Array<'openDirectory'>,
    };
    const selected = state.win
      ? await dialog.showOpenDialog(state.win, options)
      : await dialog.showOpenDialog(options);
    recheck();
    return selected.canceled ? null : (selected.filePaths[0] ?? null);
  });
  handlers.set('karont:projects:add', async (value) => {
    const input = projectAddUiSchema.parse(value);
    if (input.dotIds.length)
      throw Error('Concessões são configuradas separadamente do cadastro de projeto');
    return client.request({
      method: 'projects.add',
      value: { ...input, operationId: randomUUID() },
    });
  });

  const commandHandlers: [string, Command['method'], (value: unknown) => object][] = [
    ['karont:agents:list', 'agents.list', noValue],
    ['karont:agents:add', 'agents.add', (value) => ({ value })],
    ['karont:agents:remove', 'agents.remove', (value) => ({ value })],
    ['karont:agents:refresh', 'agents.refresh', noValue],
    ['karont:workspaces:list', 'workspaces.list', (value) => ({ value })],
    ['karont:workspaces:create', 'workspaces.create', (value) => ({ value })],
    ['karont:workspaces:rename', 'workspaces.rename', (value) => ({ value })],
    ['karont:approvals:list', 'approvals.list', noValue],
    ['karont:approvals:decide', 'approvals.decide', (value) => ({ value })],
    ['karont:dots:list', 'dots.list', noValue],
    ['karont:projects:list', 'projects.list', (value) => (value === undefined ? {} : { value })],
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
  for (const [channel, method, payload] of commandHandlers) {
    handlers.set(channel, async (value, recheck) => {
      const request = requestSchema.parse({ id: 1, method, ...payload(value) });
      if (request.method === 'runs.start' && request.value.permissionMode === 'full') {
        const options = {
          type: 'warning' as const,
          title: 'Acesso total para esta execução',
          message: 'Permitir acesso ampliado à sua conta?',
          detail:
            'O Codex poderá executar comandos, acessar a rede e alterar arquivos fora da worktree. A worktree não é sandbox. Esta autorização vale somente para a nova execução.',
          buttons: ['Cancelar', 'Habilitar acesso total'],
          defaultId: 0,
          cancelId: 0,
          noLink: true,
        };
        const consent = state.win
          ? await dialog.showMessageBox(state.win, options)
          : await dialog.showMessageBox(options);
        if (consent.response !== 1) throw Error('Acesso total não autorizado');
        recheck();
        request.value.elevatedConfirmed = true;
      }
      const { id: _id, ...command } = request;
      const result = await client.request(command as Command);
      if (request.method === 'terminal.attach') attachedRuns.add(request.value.runId);
      if (request.method === 'terminal.detachAll') attachedRuns.clear();
      return result;
    });
  }

  return handlers;
}

export function registerIpc() {
  for (const [channel, handler] of channelHandlers()) {
    ipcMain.handle(channel, async (event, value: unknown) => {
      authorize(event);
      return handler(value, () => authorize(event));
    });
  }
}
