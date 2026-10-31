import fs from 'node:fs';
import net from 'node:net';
import { randomBytes } from 'node:crypto';
import { paths } from '../../../packages/local/src/paths';
import { frames, send, proof, equal, LIMIT } from '../../../packages/local/src/wire';
import { requestSchema, defaultLayout, layoutSchema } from '../../../packages/contracts/src';
import { openDatabase, readDotConfig, syncConfig } from './database';
import { daemonDiagnostics } from './diagnostics';
import { RunManager } from './runs';
import { WorkspaceManager } from './workspaces';
process.umask(0o077);
const p = paths();
const secret = randomBytes(32).toString('hex');
let db: ReturnType<typeof openDatabase> | undefined;
let timer: NodeJS.Timeout | undefined;
let streamTimer: NodeJS.Timeout | undefined;
let manager: RunManager | undefined;
let work: WorkspaceManager | undefined;
const sockets = new Set<net.Socket>();
let stopping = false;
const server = net.createServer();
function clean() {
  if (stopping) return;
  stopping = true;
  clearInterval(timer);
  clearInterval(streamTimer);
  for (const s of sockets) s.destroy();
  server.close();
  manager?.shutdown();
  db?.close();
  for (const f of [p.socket, p.session]) fs.rmSync(f, { force: true });
}
for (const sig of ['SIGINT', 'SIGTERM'] as const)
  process.on(sig, () => {
    clean();
    process.exit(0);
  });
try {
  fs.rmSync(p.socket, { force: true });
  fs.rmSync(p.session, { force: true });
  db = openDatabase(p.db);
  const row = db.prepare("SELECT value FROM settings WHERE key='layout'").get() as
    | { value: string }
    | undefined;
  let layout = row ? layoutSchema.parse(JSON.parse(row.value)) : defaultLayout;
  if (!row)
    db.prepare("INSERT INTO settings(key,value) VALUES('layout',?)").run(JSON.stringify(layout));
  const config = readDotConfig(p.dots);
  syncConfig(db, config.dots, config.projects);
  manager = new RunManager(db, p.worktrees, config.dots);
  work = new WorkspaceManager(db, config.dots);
  let streaming = false,
    sequence = 0,
    heartbeat = 0;
  timer = setInterval(() => {
    heartbeat++;
  }, 1000);
  const snapshot = () => ({
    pid: process.pid,
    uptime: process.uptime(),
    heartbeat,
    sequence,
    streaming,
    layout,
    rss: process.memoryUsage().rss,
    cpuMicros: process.cpuUsage().user + process.cpuUsage().system,
    journal: 'wal',
    fts: true,
  });
  server.on('connection', (s) => {
    if (sockets.size >= 16) {
      s.destroy();
      return;
    }
    sockets.add(s);
    s.setNoDelay(true);
    s.on('error', () => {});
    s.on('close', () => sockets.delete(s));
    let authenticated = false;
    const subscriptions = new Map<string, (event: unknown) => void>();
    let unsubscribe: (() => void) | undefined;
    let unsubscribeWork: (() => void) | undefined;
    const listener = (event: unknown) => {
      const value = event as { type?: string; runId?: string };
      if (value.type === 'terminal.output' && value.runId && !subscriptions.has(value.runId))
        return;
      if (s.writableLength > 48 * 1024) return; // bounded delivery; a later attach returns the current scrollback.
      send(s, { type: 'event', event });
    };
    const nonce = randomBytes(32).toString('hex');
    const timeout = setTimeout(() => s.destroy(), 2000);
    send(s, { type: 'challenge', version: 1, nonce, proof: proof(secret, 'server', nonce) });
    let budget = 100;
    const rate = setInterval(() => (budget = 100), 1000);
    s.on('close', () => {
      clearTimeout(timeout);
      clearInterval(rate);
      unsubscribe?.();
      unsubscribeWork?.();
      for (const callback of subscriptions.values()) manager!.detach(callback);
      subscriptions.clear();
    });
    frames(s, async (v) => {
      if (--budget < 0) {
        s.destroy();
        return;
      }
      if (!authenticated) {
        if (
          v?.type !== 'authenticate' ||
          v.version !== 1 ||
          typeof v.nonce !== 'string' ||
          !/^[a-f0-9]{64}$/.test(v.nonce) ||
          !equal(v.proof, proof(secret, 'client', nonce + ':' + v.nonce))
        ) {
          s.destroy();
          return;
        }
        authenticated = true;
        clearTimeout(timeout);
        send(s, {
          type: 'ready',
          version: 1,
          proof: proof(secret, 'ready', nonce + ':' + v.nonce),
        });
        unsubscribe = manager!.onEvent(listener);
        unsubscribeWork = work!.onEvent(listener);
        return;
      }
      const parsed = requestSchema.safeParse(v);
      if (!parsed.success) {
        s.destroy();
        return;
      }
      const r = parsed.data;
      try {
        let result: unknown = snapshot();
        let terminalReplay: { runId: string; data: string } | undefined;
        switch (r.method) {
          case 'snapshot':
          case 'ping':
            result = snapshot();
            break;
          case 'layout':
            db!
              .prepare(
                "INSERT INTO settings(key,value) VALUES('layout',?) ON CONFLICT(key) DO UPDATE SET value=excluded.value",
              )
              .run(JSON.stringify(r.value));
            layout = r.value;
            result = snapshot();
            break;
          case 'stream':
            if (streaming !== r.value) {
              streaming = r.value;
              clearInterval(streamTimer);
              if (streaming)
                streamTimer = setInterval(() => {
                  sequence++;
                }, 250);
            }
            result = snapshot();
            break;
          case 'dots.list':
            result = manager!.listDots();
            break;
          case 'projects.list':
            result = r.value
              ? work!.listProjects(r.value.workspaceId, r.value.cursor, r.value.limit)
              : manager!.listProjects();
            break;
          case 'workspaces.list':
            result = work!.listWorkspaces(r.value.cursor, r.value.limit);
            break;
          case 'workspaces.create':
            result = work!.createWorkspace(r.value.name, r.value.operationId);
            break;
          case 'workspaces.rename':
            result = work!.renameWorkspace(r.value.workspaceId, r.value.name, r.value.operationId);
            break;
          case 'projects.update':
            result = work!.updateProject(r.value);
            break;
          case 'projects.add':
            result = work!.addProject(r.value);
            break;
          case 'chats.list':
            result = work!.listChats(r.value);
            break;
          case 'chats.create':
            result = work!.createChat(r.value);
            break;
          case 'chats.get':
            result = work!.getChat(r.value.chatId);
            break;
          case 'chats.rename':
            result = work!.renameChat(
              r.value.chatId,
              r.value.title,
              r.value.expectedRevision,
              r.value.operationId,
            );
            break;
          case 'chats.open':
            result = work!.openChat(r.value.chatId, r.value.operationId);
            break;
          case 'chats.favorite':
            result = work!.favoriteChat(
              r.value.chatId,
              r.value.favorite,
              r.value.expectedRevision,
              r.value.operationId,
            );
            break;
          case 'chats.draft':
            result = work!.setDraft(
              r.value.chatId,
              r.value.draft,
              r.value.expectedRevision,
              r.value.operationId,
            );
            break;
          case 'chats.move.preview':
            result = work!.previewMove(r.value.chatId, r.value.projectId, r.value.dotId);
            break;
          case 'chats.move':
            result = work!.moveChat(r.value);
            break;
          case 'messages.list':
            result = work!.listMessages(r.value.chatId, r.value.cursor, r.value.limit);
            break;
          case 'messages.save':
            result = work!.saveMessage(
              r.value.chatId,
              r.value.body,
              r.value.expectedRevision,
              r.value.operationId,
            );
            break;
          case 'messages.send':
            result = work!.sendMessage(
              r.value,
              (runId) => manager!.isActive(runId),
              (runId, data) => manager!.write(runId, data),
            );
            break;
          case 'messages.deliveries':
            result = work!.listDeliveries(r.value.chatId, r.value.messageId);
            break;
          case 'chats.runs.list':
            result = work!.listChatRuns(r.value.chatId, r.value.cursor, r.value.limit);
            break;
          case 'tasks.list':
            result = work!.listTasks(r.value);
            break;
          case 'tasks.get':
            result = work!.getTask(r.value.taskId);
            break;
          case 'tasks.create':
            result = work!.createTask(r.value);
            break;
          case 'tasks.update':
            result = work!.updateTask(r.value);
            break;
          case 'tasks.assignees.set':
            result = work!.setTaskAssignees(r.value);
            break;
          case 'tasks.runs.link':
            result = work!.linkTaskRun(r.value, true);
            break;
          case 'tasks.runs.unlink':
            result = work!.linkTaskRun(r.value, false);
            break;
          case 'tasks.events.list':
            result = work!.listTaskEvents(r.value.taskId, r.value.cursor, r.value.limit);
            break;
          case 'navigation.get':
            result = work!.getNavigation();
            break;
          case 'navigation.set':
            result = work!.setNavigation(r.value);
            break;
          case 'runs.list':
            result = manager!.listRuns(r.value.limit, r.value.projectId);
            break;
          case 'diagnostics':
            result = daemonDiagnostics(config.dots);
            break;
          case 'approvals.list':
            result = manager!.listApprovals();
            break;
          case 'approvals.decide':
            result = manager!.decideApproval(r.value.approvalId, r.value.allow);
            break;
          case 'checkpoints.list':
            manager!.inspect(r.value.runId);
            result = manager!.continuity.checkpoints(r.value.runId);
            break;
          case 'checkpoints.create':
            result = manager!.checkpoint(r.value.runId, r.value.operationId);
            break;
          case 'recovery.inspect':
            result = manager!.inspect(r.value.runId);
            break;
          case 'runs.pause':
            result = manager!.pause(r.value.runId);
            break;
          case 'runs.resume':
            result = await manager!.resume(
              r.value.runId,
              r.value.operationId,
              r.value.newSessionConfirmed,
            );
            break;
          case 'runs.autoResume':
            result = manager!.autoResume(r.value.runId, r.value.enabled);
            break;
          case 'runs.start':
            result = await manager!.start(
              r.value.dotId,
              r.value.projectId,
              r.value.permissionMode,
              r.value.elevatedConfirmed,
              r.value.operationId,
              r.value.chatId,
            );
            break;
          case 'terminal.attach': {
            const old = subscriptions.get(r.value.runId);
            if (old) manager!.detach(old);
            const callback = (event: unknown) => listener(event);
            const attached = manager!.attach(r.value.runId, callback);
            result = { run: attached.run, cols: attached.cols, rows: attached.rows };
            terminalReplay = { runId: r.value.runId, data: attached.scrollback };
            subscriptions.set(r.value.runId, callback);
            break;
          }
          case 'terminal.detachAll':
            for (const callback of subscriptions.values()) manager!.detach(callback);
            subscriptions.clear();
            result = { ok: true };
            break;
          case 'terminal.write':
            result = manager!.write(r.value.runId, r.value.data);
            break;
          case 'terminal.resize':
            result = manager!.resize(r.value.runId, r.value.cols, r.value.rows);
            break;
          case 'runs.cancel':
            result = manager!.cancel(r.value.runId);
            break;
          case 'worktree.remove':
            result = manager!.cleanup(r.value.runId);
            break;
          case 'runs.diff':
            result = manager!.diff(r.value.runId);
            break;
          case 'rollback.preview':
            result = manager!.previewRollback(r.value.runId);
            break;
          case 'rollback.apply':
            result = manager!.applyRollback(r.value.runId);
            break;
          case 'shutdown':
            sendResult(s, r.id, snapshot());
            setTimeout(() => {
              clean();
              process.exit(0);
            }, 50);
            return;
        }
        sendResult(s, r.id, result);
        if (terminalReplay) await replayTerminal(s, terminalReplay.runId, terminalReplay.data);
      } catch (error) {
        const known = error instanceof Error ? error.message : 'Falha na operação';
        const safe =
          /^(Transição de execução|Retomada exige|Pausa disponível|Operação de|Chave de operação|Modo de permissão|Acesso total exige|Pedido de aprovação|Dot não autorizado|Dot da concessão|Dot não está|Projeto não encontrado|Projeto Git|Diretório inválido|Workspace não encontrado|Nome do |Título da |Descrição |Responsáveis |Tarefa |Mensagem |Mensagem vazia|Mensagem não |Rascunho |Conversa |Execução |Terminal |Cursor |Entrega incerta|Movimentação|Navegação |Somente conversas|Projeto não pertence|Conversa de origem|Mensagem de origem|Execução precisa|Histórico de tarefa|Repositório|Conflitos detectados|Não há alterações|Worktree desta execução|Worktree de execução ativa|Conflito de caminho|Caminho fora da worktree|Caminho Git inválido)/.test(
            known,
          )
            ? known
            : 'Não foi possível concluir a operação solicitada';
        send(s, { id: r.id, error: safe });
      }
    });
  });
  server.on('error', () => {
    clean();
    process.exitCode = 1;
  });
  server.listen(p.socket, () => {
    try {
      fs.chmodSync(p.socket, 0o600);
      fs.writeFileSync(p.session, JSON.stringify({ pid: process.pid, secret, version: 1 }), {
        flag: 'wx',
        mode: 0o600,
      });
      console.log(JSON.stringify({ event: 'ready', pid: process.pid }));
    } catch {
      clean();
      process.exitCode = 1;
    }
  });
} catch {
  clean();
  process.exitCode = 1;
}

async function replayTerminal(socket: net.Socket, runId: string, data: string) {
  const chunks: string[] = [];
  for (let offset = 0; offset < data.length; offset += 2500)
    chunks.push(data.slice(offset, offset + 2500));
  if (!chunks.length) chunks.push('');
  for (let index = 0; index < chunks.length; index++) {
    while (!socket.destroyed && socket.writableLength > 24 * 1024) {
      await new Promise<void>((resolve) => {
        const done = () => {
          clearTimeout(timer);
          socket.removeListener('drain', done);
          socket.removeListener('close', done);
          resolve();
        };
        const timer = setTimeout(done, 1000);
        socket.once('drain', done);
        socket.once('close', done);
      });
    }
    if (socket.destroyed) return;
    send(socket, {
      type: 'event',
      event: {
        type: 'terminal.snapshot',
        runId,
        data: chunks[index],
        final: index === chunks.length - 1,
      },
    });
  }
}

function sendResult(socket: net.Socket, id: number, input: unknown) {
  let result: any = input;
  if (
    result &&
    typeof result === 'object' &&
    Array.isArray(result.files) &&
    result.files.length > 100
  )
    result = {
      ...result,
      totalFiles: result.totalFiles ?? result.files.length,
      files: result.files.slice(0, 100),
      filesTruncated: true,
    };
  if (
    result &&
    typeof result === 'object' &&
    Array.isArray(result.conflicts) &&
    result.conflicts.length > 100
  )
    result = { ...result, conflicts: result.conflicts.slice(0, 100), conflictsTruncated: true };
  const size = () => Buffer.byteLength(JSON.stringify({ id, result })) + 1;
  while (size() > LIMIT) {
    if (
      result &&
      typeof result === 'object' &&
      typeof result.diff === 'string' &&
      result.diff.length
    ) {
      result = {
        ...result,
        diff: result.diff.slice(0, Math.floor(result.diff.length * 0.6)),
        diffTruncated: true,
      };
      continue;
    }
    if (
      result &&
      typeof result === 'object' &&
      Array.isArray(result.files) &&
      result.files.length > 1
    ) {
      result = {
        ...result,
        totalFiles: result.totalFiles ?? result.files.length,
        files: result.files.slice(0, Math.floor(result.files.length / 2)),
        filesTruncated: true,
      };
      continue;
    }
    if (
      result &&
      typeof result === 'object' &&
      Array.isArray(result.conflicts) &&
      result.conflicts.length > 1
    ) {
      result = {
        ...result,
        conflicts: result.conflicts.slice(0, Math.floor(result.conflicts.length / 2)),
        conflictsTruncated: true,
      };
      continue;
    }
    send(socket, { id, error: 'Resposta excede o limite do protocolo local' });
    return;
  }
  send(socket, { id, result });
}
