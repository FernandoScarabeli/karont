import fs from 'node:fs';
import net from 'node:net';
import { randomBytes } from 'node:crypto';
import { paths, privateFile } from './paths';
import { frames, send, proof, equal } from './wire';
import {
  checkpointSchema,
  recoverySchema,
  approvalSchema,
  diagnosticSchema,
  snapshotSchema,
  terminalEventSchema,
  dotListSchema,
  projectListSchema,
  runSchema,
  terminalSessionSchema,
  diffResultSchema,
  rollbackResultSchema,
  fileChangeSchema,
  addProjectResultSchema,
  chatDetailsSchema,
  chatPageSchema,
  chatRunPageSchema,
  deliveryListSchema,
  deliverySchema,
  messagePageSchema,
  messageSaveResultSchema,
  movePreviewSchema,
  navigationSchema,
  projectPageSchema,
  workspacePageSchema,
  workspaceSchema,
  workspaceProjectSchema,
  taskDetailsSchema,
  taskEventPageSchema,
  taskPageSchema,
  type Command,
  type Snapshot,
  type TerminalEvent,
} from '../../contracts/src';
import { z } from 'zod';
const okSchema = z.object({ ok: z.literal(true) }).strict();
function responseValidator(command: Command) {
  let schema: z.ZodType;
  switch (command.method) {
    case 'workspaces.list':
      schema = workspacePageSchema;
      break;
    case 'workspaces.create':
    case 'workspaces.rename':
      schema = workspaceSchema;
      break;
    case 'projects.update':
      schema = workspaceProjectSchema;
      break;
    case 'projects.add':
      schema = addProjectResultSchema;
      break;
    case 'projects.list':
      schema = command.value ? projectPageSchema : projectListSchema;
      break;
    case 'chats.list':
      schema = chatPageSchema;
      break;
    case 'chats.create':
    case 'chats.get':
    case 'chats.rename':
    case 'chats.open':
    case 'chats.favorite':
    case 'chats.draft':
    case 'chats.move':
      schema = chatDetailsSchema;
      break;
    case 'chats.move.preview':
      schema = movePreviewSchema;
      break;
    case 'messages.list':
      schema = messagePageSchema;
      break;
    case 'messages.save':
      schema = messageSaveResultSchema;
      break;
    case 'messages.send':
      schema = deliverySchema;
      break;
    case 'messages.deliveries':
      schema = deliveryListSchema;
      break;
    case 'chats.runs.list':
      schema = chatRunPageSchema;
      break;
    case 'tasks.list':
      schema = taskPageSchema;
      break;
    case 'tasks.events.list':
      schema = taskEventPageSchema;
      break;
    case 'tasks.get':
    case 'tasks.create':
    case 'tasks.update':
    case 'tasks.assignees.set':
    case 'tasks.runs.link':
    case 'tasks.runs.unlink':
      schema = taskDetailsSchema;
      break;
    case 'navigation.get':
    case 'navigation.set':
      schema = navigationSchema;
      break;
    case 'checkpoints.list':
    case 'checkpoints.create':
      schema = z.array(checkpointSchema).max(100);
      break;
    case 'recovery.inspect':
      schema = recoverySchema;
      break;
    case 'runs.autoResume':
      schema = z.object({ enabled: z.boolean(), supported: z.literal(false) }).strict();
      break;
    case 'runs.pause':
    case 'runs.resume':
      schema = runSchema;
      break;
    case 'diagnostics':
      schema = diagnosticSchema;
      break;
    case 'approvals.list':
      schema = z.array(approvalSchema).max(100);
      break;
    case 'approvals.decide':
      schema = approvalSchema;
      break;
    case 'snapshot':
    case 'ping':
    case 'layout':
    case 'stream':
      schema = snapshotSchema;
      break;
    case 'dots.list':
      schema = dotListSchema;
      break;
    case 'runs.list':
      schema = z.array(runSchema).max(100);
      break;
    case 'runs.start':
    case 'runs.cancel':
      schema = runSchema;
      break;
    case 'terminal.attach':
      schema = terminalSessionSchema;
      break;
    case 'runs.diff':
      schema = diffResultSchema;
      break;
    case 'rollback.preview':
    case 'rollback.apply':
      schema = rollbackResultSchema;
      break;
    case 'terminal.write':
    case 'terminal.resize':
    case 'terminal.detachAll':
    case 'worktree.remove':
      schema = okSchema;
      break;
    case 'shutdown':
      schema = snapshotSchema;
      break;
  }
  return (value: unknown) => {
    const parsed = schema.safeParse(value);
    return parsed.success ? parsed.data : undefined;
  };
}
export class Client {
  private socket?: net.Socket;
  private transport?: net.Socket;
  private connecting?: Promise<void>;
  private next = 0;
  private pending = new Map<
    number,
    {
      resolve: (s: unknown) => void;
      reject: (e: Error) => void;
      timer: NodeJS.Timeout;
      socket: net.Socket;
      validate?: (value: unknown) => unknown | undefined;
    }
  >();
  private listeners = new Set<(event: TerminalEvent) => void>();
  onEvent(listener: (event: TerminalEvent) => void) {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }
  async connect() {
    if (this.socket && !this.socket.destroyed) return;
    if (this.connecting) return this.connecting;
    this.connecting = new Promise<void>((resolve, reject) => {
      const p = paths();
      privateFile(p.session);
      const meta = JSON.parse(fs.readFileSync(p.session, 'utf8'));
      if (meta.version !== 1 || !/^([a-f0-9]{64})$/.test(meta.secret))
        throw Error('Sessão inválida');
      const s = net.createConnection(p.socket);
      this.transport = s;
      let ready = false;
      let challenged = false;
      let serverNonce = '';
      const clientNonce = randomBytes(32).toString('hex');
      const timer = setTimeout(() => s.destroy(Error('Handshake expirou')), 2000);
      const fail = (e: Error) => {
        clearTimeout(timer);
        reject(e);
        for (const [id, t] of this.pending) {
          if (t.socket !== s) continue;
          clearTimeout(t.timer);
          this.pending.delete(id);
          t.reject(e);
        }
      };
      s.on('error', fail);
      s.on('close', () => {
        if (this.socket === s) this.socket = undefined;
        if (this.transport === s) this.transport = undefined;
        fail(Error('Daemon desconectado'));
      });
      frames(s, (v) => {
        if (!ready) {
          if (
            !challenged &&
            v.type === 'challenge' &&
            v.version === 1 &&
            typeof v.nonce === 'string' &&
            /^[a-f0-9]{64}$/.test(v.nonce) &&
            equal(v.proof, proof(meta.secret, 'server', v.nonce))
          ) {
            challenged = true;
            serverNonce = v.nonce;
            send(s, {
              type: 'authenticate',
              version: 1,
              nonce: clientNonce,
              proof: proof(meta.secret, 'client', serverNonce + ':' + clientNonce),
            });
            return;
          }
          if (
            challenged &&
            v.type === 'ready' &&
            v.version === 1 &&
            equal(v.proof, proof(meta.secret, 'ready', serverNonce + ':' + clientNonce))
          ) {
            ready = true;
            clearTimeout(timer);
            this.socket = s;
            resolve();
            return;
          }
          s.destroy(Error('Identidade do servidor inválida'));
          return;
        }
        if (v?.type === 'event') {
          const event = terminalEventSchema.safeParse(v.event);
          if (!event.success) {
            s.destroy(Error('Evento do daemon inválido'));
            return;
          }
          for (const listener of this.listeners) listener(event.data);
          return;
        }
        const task = this.pending.get(v.id);
        if (!task) {
          s.destroy(Error('Resposta inválida'));
          return;
        }
        if (typeof v.error === 'string') {
          clearTimeout(task.timer);
          this.pending.delete(v.id);
          task.reject(Error(v.error));
          return;
        }
        if (!Object.hasOwn(v, 'result')) {
          s.destroy(Error('Resposta inválida'));
          return;
        }
        const result = task.validate ? task.validate(v.result) : v.result;
        if (result === undefined) {
          s.destroy(Error('Resposta inválida'));
          return;
        }
        clearTimeout(task.timer);
        this.pending.delete(v.id);
        task.resolve(result);
      });
    }).finally(() => {
      this.connecting = undefined;
    });
    return this.connecting;
  }
  async request<T = unknown>(command: Command): Promise<T> {
    await this.connect();
    const socket = this.socket;
    if (!socket || socket.destroyed) throw Error('Cliente fechado');
    const id = ++this.next;
    return new Promise<T>((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pending.delete(id);
        this.close();
        reject(Error('Heartbeat/resposta expirou'));
      }, 3000);
      const validate = responseValidator(command);
      this.pending.set(id, {
        resolve: resolve as (value: unknown) => void,
        reject,
        timer,
        socket,
        validate,
      });
      send(socket, { id, ...command });
    });
  }
  close() {
    this.transport?.destroy();
    this.transport = undefined;
    this.socket = undefined;
  }
}
