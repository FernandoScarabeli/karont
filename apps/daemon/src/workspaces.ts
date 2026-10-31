import { createHash, randomUUID } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import type { DatabaseSync } from 'node:sqlite';
import {
  type PermissionMode,
  chatDetailsSchema,
  chatSchema,
  chatSummarySchema,
  deliverySchema,
  messageSchema,
  movePreviewSchema,
  navigationSchema,
  workspaceProjectSchema,
  workspaceSchema,
  taskAssigneeInputSchema,
  taskAssigneeSchema,
  taskDetailsSchema,
  taskEventPageSchema,
  taskEventSchema,
  taskPageSchema,
  taskRunSchema,
  taskStateSchema,
  taskSummarySchema,
} from '../../../packages/contracts/src';
import type { DotConfig } from './database';
import { dotAllowedInProject } from './dotAuthorization';
import { TERMINAL_DOT_ID } from './builtinDots';

const ACTIVE_STATES = [
  'queued',
  'running',
  'paused',
  'waiting_quota',
  'waiting_approval',
  'recovery_needed',
];
const TERMINAL_STATES = ['completed', 'failed', 'cancelled'];
const RESPONSE_BUDGET = 60 * 1024;

type StoredOperation<T> = { result: T; replayed: boolean };
type ProjectRow = {
  id: string;
  name: string;
  root: string;
  git_root: string;
  icon: string;
  workspace_id: string;
  origin: 'config' | 'ui';
  created_at: number;
};
type ChatRow = {
  id: string;
  workspace_id: string | null;
  project_id: string | null;
  dot_id: string | null;
  title: string;
  draft: string;
  created_at: number;
  updated_at: number;
  last_opened_at: number;
  favorite: number;
  revision: number;
  workspace_name: string | null;
  project_name: string | null;
  run_count?: number;
};
type TaskRow = {
  id: string;
  project_id: string;
  title: string;
  description: string;
  state: string;
  origin_chat_id: string | null;
  origin_message_id: string | null;
  created_at: number;
  updated_at: number;
  revision: number;
  workspace_id: string;
  workspace_name: string;
  project_name: string;
  chat_title: string | null;
  run_count?: number;
};

function stable(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(stable).join(',')}]`;
  if (value && typeof value === 'object') {
    const object = value as Record<string, unknown>;
    return `{${Object.keys(object)
      .sort()
      .map((key) => `${JSON.stringify(key)}:${stable(object[key])}`)
      .join(',')}}`;
  }
  return JSON.stringify(value);
}
function digest(value: unknown) {
  return createHash('sha256').update(stable(value)).digest('hex');
}
function cursorEncode(values: unknown[]) {
  return Buffer.from(JSON.stringify(values)).toString('base64url');
}
function cursorDecode(cursor: string | undefined, length: number): unknown[] | undefined {
  if (!cursor) return undefined;
  try {
    const parsed = JSON.parse(Buffer.from(cursor, 'base64url').toString('utf8'));
    if (!Array.isArray(parsed) || parsed.length !== length) throw Error();
    return parsed;
  } catch {
    throw Error('Cursor de paginação inválido');
  }
}
function bytes(value: string) {
  return Buffer.byteLength(value, 'utf8');
}
function verifyText(value: string, label: string, maxBytes: number) {
  if (!value.trim()) throw Error(`${label} não pode ficar vazio`);
  if (value.length > 120) throw Error(`${label} excede 120 caracteres`);
  if (bytes(value) > maxBytes) throw Error(`${label} excede o limite em bytes UTF-8`);
  return value.trim();
}
function isDirectoryAvailable(root: string) {
  try {
    const real = fs.realpathSync(root);
    const stat = fs.statSync(real);
    fs.accessSync(real, fs.constants.R_OK | fs.constants.X_OK);
    if (!stat.isDirectory()) return false;
    const top = execFileSync('git', ['rev-parse', '--show-toplevel'], {
      cwd: real,
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'ignore'],
    }).trim();
    return fs.realpathSync(top) === real;
  } catch {
    return false;
  }
}
function verifyGitRoot(rootValue: string) {
  let root: string;
  try {
    root = fs.realpathSync(rootValue);
    const stat = fs.statSync(root);
    fs.accessSync(root, fs.constants.R_OK | fs.constants.X_OK);
    if (!stat.isDirectory()) throw Error();
    const top = execFileSync('git', ['rev-parse', '--show-toplevel'], {
      cwd: root,
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'ignore'],
    }).trim();
    if (fs.realpathSync(top) !== root) throw Error();
    execFileSync('git', ['rev-parse', '--verify', 'HEAD'], {
      cwd: root,
      stdio: 'ignore',
    });
  } catch {
    throw Error(
      'Diretório inválido: selecione a raiz de um repositório Git acessível com commit inicial',
    );
  }
  return root;
}

export class WorkspaceManager {
  private listeners = new Set<(event: unknown) => void>();

  constructor(
    private readonly db: DatabaseSync,
    private readonly configuredDots: DotConfig[],
  ) {
    // A crash between the durable intent and PTY confirmation is never replayed.
    this.db
      .prepare(
        "UPDATE message_deliveries SET status='uncertain',updated_at=? WHERE status='pending'",
      )
      .run(Date.now());
  }

  onEvent(listener: (event: unknown) => void) {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  private emit(event: unknown) {
    for (const listener of this.listeners) {
      try {
        listener(event);
      } catch {
        // Event delivery is best effort after the durable mutation commits.
      }
    }
  }

  private operationResult<T>(operationId: string, method: string, payload: unknown): T | undefined {
    const row = this.db
      .prepare('SELECT method,payload_hash,result_json FROM product_operations WHERE id=?')
      .get(operationId) as
      | { method: string; payload_hash: string; result_json: string }
      | undefined;
    if (!row) return undefined;
    if (row.method !== method || row.payload_hash !== digest(payload))
      throw Error('Chave de operação reutilizada com conteúdo diferente');
    return JSON.parse(row.result_json) as T;
  }

  private mutation<T>(
    operationId: string,
    method: string,
    payload: unknown,
    work: () => { result: T; events?: unknown[] },
  ): StoredOperation<T> {
    const payloadHash = digest(payload);
    this.db.exec('BEGIN IMMEDIATE');
    let events: unknown[] = [];
    let result!: T;
    try {
      const old = this.db
        .prepare('SELECT method,payload_hash,result_json FROM product_operations WHERE id=?')
        .get(operationId) as
        | { method: string; payload_hash: string; result_json: string }
        | undefined;
      if (old) {
        if (old.method !== method || old.payload_hash !== payloadHash)
          throw Error('Chave de operação reutilizada com conteúdo diferente');
        const result = JSON.parse(old.result_json) as T;
        this.db.exec('COMMIT');
        return { result, replayed: true };
      }
      const output = work();
      result = output.result;
      events = output.events ?? [];
      this.db
        .prepare(
          'INSERT INTO product_operations(id,method,payload_hash,result_json,created_at) VALUES(?,?,?,?,?)',
        )
        .run(operationId, method, payloadHash, JSON.stringify(output.result), Date.now());
      this.db.exec('COMMIT');
    } catch (error) {
      this.db.exec('ROLLBACK');
      throw error;
    }
    for (const event of events) this.emit(event);
    return { result, replayed: false };
  }

  private getWorkspace(id: string) {
    const row = this.db.prepare('SELECT * FROM workspaces WHERE id=?').get(id) as
      | { id: string; name: string; created_at: number; updated_at: number }
      | undefined;
    if (!row) throw Error('Workspace não encontrado');
    return workspaceSchema.parse({
      id: row.id,
      name: row.name,
      createdAt: row.created_at,
      updatedAt: row.updated_at,
    });
  }

  listWorkspaces(cursor?: string, limit = 100) {
    const values = cursorDecode(cursor, 2) as [number, string] | undefined;
    const rows = (
      values
        ? this.db
            .prepare(
              'SELECT * FROM workspaces WHERE created_at>? OR (created_at=? AND id>?) ORDER BY created_at,id LIMIT ?',
            )
            .all(values[0], values[0], values[1], limit + 1)
        : this.db.prepare('SELECT * FROM workspaces ORDER BY created_at,id LIMIT ?').all(limit + 1)
    ) as {
      id: string;
      name: string;
      created_at: number;
      updated_at: number;
    }[];
    const more = rows.length > limit;
    const items = rows.slice(0, limit).map((row) =>
      workspaceSchema.parse({
        id: row.id,
        name: row.name,
        createdAt: row.created_at,
        updatedAt: row.updated_at,
      }),
    );
    const last = rows[items.length - 1];
    return { items, nextCursor: more && last ? cursorEncode([last.created_at, last.id]) : null };
  }

  createWorkspace(nameValue: string, operationId: string) {
    const name = verifyText(nameValue, 'Nome do workspace', 512);
    const { result } = this.mutation(operationId, 'workspaces.create', { name }, () => {
      const id = randomUUID();
      const now = Date.now();
      this.db
        .prepare('INSERT INTO workspaces(id,name,created_at,updated_at) VALUES(?,?,?,?)')
        .run(id, name, now, now);
      return {
        result: this.getWorkspace(id),
        events: [{ type: 'workspace.updated', workspaceId: id }],
      };
    });
    return result;
  }

  renameWorkspace(workspaceId: string, nameValue: string, operationId: string) {
    const name = verifyText(nameValue, 'Nome do workspace', 512);
    const { result } = this.mutation(
      operationId,
      'workspaces.rename',
      { workspaceId, name },
      () => {
        this.getWorkspace(workspaceId);
        this.db
          .prepare('UPDATE workspaces SET name=?,updated_at=? WHERE id=?')
          .run(name, Date.now(), workspaceId);
        return {
          result: this.getWorkspace(workspaceId),
          events: [{ type: 'workspace.updated', workspaceId }],
        };
      },
    );
    return result;
  }

  private isAuthorized(dotId: string, project: ProjectRow) {
    const dot = this.configuredDots.find((item) => item.id === dotId);
    if (!dot) return false;
    return dotAllowedInProject(dot, project, (projectId, authorizedDotId) =>
      Boolean(
        this.db
          .prepare('SELECT 1 FROM project_dot_grants WHERE project_id=? AND dot_id=?')
          .get(projectId, authorizedDotId),
      ),
    );
  }

  private dotIds(project: ProjectRow) {
    // dotIds contém só Dots de dots.json com concessão explícita. Dots embutidos, detectados
    // e adicionados são autorizados em qualquer projeto sem criar concessão.
    return this.configuredDots
      .filter(
        (dot) =>
          dot.id !== TERMINAL_DOT_ID &&
          (dot.source === undefined || dot.source === 'config') &&
          this.isAuthorized(dot.id, project),
      )
      .map((dot) => dot.id);
  }

  private projectRow(projectId: string) {
    const row = this.db.prepare('SELECT * FROM projects WHERE id=?').get(projectId) as
      | ProjectRow
      | undefined;
    if (!row) throw Error('Projeto não encontrado');
    return row;
  }

  private projectSummary(project: ProjectRow) {
    return workspaceProjectSchema.parse({
      id: project.id,
      name: project.name,
      workspaceId: project.workspace_id,
      origin: project.origin,
      icon: project.icon,
      root: project.root,
      available: isDirectoryAvailable(project.root),
      dotIds: this.dotIds(project),
    });
  }

  listProjects(workspaceId?: string, cursor?: string, limit = 100) {
    if (workspaceId) this.getWorkspace(workspaceId);
    const values = cursorDecode(cursor, 2) as [number, string] | undefined;
    const clauses: string[] = [];
    const params: (string | number)[] = [];
    if (workspaceId) {
      clauses.push('workspace_id=?');
      params.push(workspaceId);
    }
    if (values) {
      clauses.push('(created_at>? OR (created_at=? AND id>?))');
      params.push(values[0], values[0], values[1]);
    }
    const where = clauses.length ? `WHERE ${clauses.join(' AND ')}` : '';
    const rows = this.db
      .prepare(`SELECT * FROM projects ${where} ORDER BY created_at,id LIMIT ?`)
      .all(...params, limit + 1) as ProjectRow[];
    const more = rows.length > limit;
    const items = rows.slice(0, limit).map((row) => this.projectSummary(row));
    const last = rows[items.length - 1];
    return { items, nextCursor: more && last ? cursorEncode([last.created_at, last.id]) : null };
  }

  addProject(input: {
    workspaceId: string;
    name: string;
    root: string;
    icon?: import('zod').infer<typeof import('../../../packages/contracts/src').projectIconSchema>;
    dotIds: string[];
    operationId: string;
  }) {
    const name = verifyText(input.name, 'Nome do projeto', 512);
    const payload = {
      workspaceId: input.workspaceId,
      name,
      root: input.root,
      icon: input.icon ?? 'folder',
      dotIds: [...input.dotIds].sort(),
    };
    const old = this.operationResult<{ project: unknown; duplicate: boolean }>(
      input.operationId,
      'projects.add',
      payload,
    );
    if (old) return old;
    this.getWorkspace(input.workspaceId);
    if (input.dotIds.some((id) => !this.configuredDots.some((dot) => dot.id === id)))
      throw Error('Dot da concessão não está configurado');
    const root = verifyGitRoot(input.root);
    const result = this.mutation(input.operationId, 'projects.add', payload, () => {
      const duplicates = this.db
        .prepare('SELECT * FROM projects ORDER BY created_at,id')
        .all() as ProjectRow[];
      for (const candidate of duplicates) {
        let candidateRoot: string;
        try {
          candidateRoot = fs.realpathSync(candidate.root);
        } catch {
          candidateRoot = path.resolve(candidate.root);
        }
        if (candidateRoot === root)
          return {
            result: { project: this.projectSummary(candidate), duplicate: true },
          };
      }
      const id = randomUUID();
      const now = Date.now();
      this.db
        .prepare(
          "INSERT INTO projects(id,name,root,git_root,created_at,workspace_id,icon,origin) VALUES(?,?,?,?,?,?,?,'ui')",
        )
        .run(id, name, root, root, now, input.workspaceId, input.icon ?? 'folder');
      const grant = this.db.prepare(
        'INSERT INTO project_dot_grants(project_id,dot_id,created_at) VALUES(?,?,?)',
      );
      for (const dotId of input.dotIds) grant.run(id, dotId, now);
      const project = this.projectSummary(this.projectRow(id));
      return {
        result: { project, duplicate: false },
        events: [{ type: 'project.updated', projectId: id, workspaceId: input.workspaceId }],
      };
    });
    return result.result;
  }

  updateProject(input: {
    projectId: string;
    name: string;
    root: string;
    icon: import('zod').infer<typeof import('../../../packages/contracts/src').projectIconSchema>;
    operationId: string;
  }) {
    const name = verifyText(input.name, 'Nome do projeto', 512);
    const payload = { projectId: input.projectId, name, root: input.root, icon: input.icon };
    const previous = this.operationResult(input.operationId, 'projects.update', payload);
    if (previous) return previous;
    const project = this.projectRow(input.projectId);
    if (project.origin === 'config')
      throw Error('Projeto gerenciado pelo arquivo de configuração local');
    const root = verifyGitRoot(input.root);
    if (root !== project.root) {
      if (
        this.db
          .prepare(
            "SELECT 1 FROM runs WHERE project_id=? AND state NOT IN ('completed','failed','cancelled')",
          )
          .get(project.id)
      )
        throw Error('Encerre as execuções antes de alterar a pasta');
      if (this.db.prepare('SELECT 1 FROM projects WHERE id<>? AND root=?').get(project.id, root))
        throw Error('Pasta já vinculada a outro projeto');
    }
    return this.mutation(input.operationId, 'projects.update', payload, () => {
      this.db
        .prepare('UPDATE projects SET name=?,root=?,git_root=?,icon=? WHERE id=?')
        .run(name, root, root, input.icon, project.id);
      return {
        result: this.projectSummary(this.projectRow(project.id)),
        events: [
          { type: 'project.updated', projectId: project.id, workspaceId: project.workspace_id },
        ],
      };
    }).result;
  }

  private chatRow(chatId: string): ChatRow {
    const row = this.db
      .prepare(`
      SELECT c.*,w.name AS workspace_name,p.name AS project_name,
        (SELECT COUNT(*) FROM runs r WHERE r.chat_id=c.id) AS run_count
      FROM chats c LEFT JOIN workspaces w ON w.id=c.workspace_id
      LEFT JOIN projects p ON p.id=c.project_id WHERE c.id=?
    `)
      .get(chatId) as ChatRow | undefined;
    if (!row) throw Error('Conversa não encontrada');
    return row;
  }

  private chatDetails(chatId: string) {
    const row = this.chatRow(chatId);
    return chatDetailsSchema.parse({
      chat: chatSchema.parse({
        id: row.id,
        workspaceId: row.workspace_id,
        projectId: row.project_id,
        dotId: row.dot_id,
        title: row.title,
        draft: row.draft,
        createdAt: row.created_at,
        updatedAt: row.updated_at,
        lastOpenedAt: row.last_opened_at,
        favorite: row.favorite === 1,
        revision: row.revision,
      }),
      origin: { workspaceName: row.workspace_name, projectName: row.project_name },
    });
  }

  private chatSummary(row: ChatRow) {
    return chatSummarySchema.parse({
      id: row.id,
      workspaceId: row.workspace_id,
      projectId: row.project_id,
      dotId: row.dot_id,
      title: row.title,
      createdAt: row.created_at,
      updatedAt: row.updated_at,
      lastOpenedAt: row.last_opened_at,
      favorite: row.favorite === 1,
      revision: row.revision,
      origin: { workspaceName: row.workspace_name, projectName: row.project_name },
      runCount: row.run_count ?? 0,
    });
  }

  listChats(input: {
    scope?: 'all' | 'favorites' | 'recent' | 'free';
    workspaceId?: string;
    projectId?: string;
    cursor?: string;
    limit?: number;
  }) {
    const scope = input.scope ?? 'all';
    const limit = input.limit ?? 100;
    const order =
      scope === 'recent' || scope === 'favorites'
        ? (['last_opened_at DESC,id DESC', 'last_opened_at'] as const)
        : (['updated_at DESC,id DESC', 'updated_at'] as const);
    const values = cursorDecode(input.cursor, 2) as [number, string] | undefined;
    const clauses: string[] = [];
    const params: (string | number)[] = [];
    if (scope === 'favorites') clauses.push('c.favorite=1');
    if (scope === 'free') clauses.push('c.project_id IS NULL');
    if (input.workspaceId) {
      clauses.push('c.workspace_id=?');
      params.push(input.workspaceId);
    }
    if (input.projectId) {
      clauses.push('c.project_id=?');
      params.push(input.projectId);
    }
    if (values) {
      clauses.push(`(c.${order[1]}<? OR (c.${order[1]}=? AND c.id<?))`);
      params.push(values[0], values[0], values[1]);
    }
    const where = clauses.length ? `WHERE ${clauses.join(' AND ')}` : '';
    const rows = this.db
      .prepare(`
      SELECT c.*,w.name AS workspace_name,p.name AS project_name,
        (SELECT COUNT(*) FROM runs r WHERE r.chat_id=c.id) AS run_count
      FROM chats c LEFT JOIN workspaces w ON w.id=c.workspace_id
      LEFT JOIN projects p ON p.id=c.project_id ${where}
      ORDER BY ${order[0]} LIMIT ?
    `)
      .all(...params, limit + 1) as ChatRow[];
    const more = rows.length > limit;
    const items = rows.slice(0, limit).map((row) => this.chatSummary(row));
    const last = rows[items.length - 1];
    return {
      items,
      nextCursor:
        more && last
          ? cursorEncode([last[order[1] as 'updated_at' | 'last_opened_at'], last.id])
          : null,
    };
  }

  createChat(input: {
    workspaceId?: string | null;
    projectId?: string | null;
    dotId?: string | null;
    title: string;
    operationId: string;
  }) {
    const title = verifyText(input.title, 'Título da conversa', 512);
    const payload = {
      workspaceId: input.workspaceId ?? null,
      projectId: input.projectId ?? null,
      dotId: input.dotId ?? null,
      title,
    };
    const { result } = this.mutation(input.operationId, 'chats.create', payload, () => {
      let workspaceId = input.workspaceId ?? null;
      const projectId = input.projectId ?? null;
      const dotId = input.dotId ?? null;
      if (projectId) {
        const project = this.projectRow(projectId);
        if (workspaceId && workspaceId !== project.workspace_id)
          throw Error('Projeto não pertence ao workspace selecionado');
        workspaceId = project.workspace_id;
        if (dotId && !this.isAuthorized(dotId, project))
          throw Error('Dot não autorizado para este projeto');
      } else if (workspaceId) {
        this.getWorkspace(workspaceId);
      }
      if (dotId && !this.configuredDots.some((dot) => dot.id === dotId))
        throw Error('Dot não está configurado');
      const id = randomUUID();
      const now = Date.now();
      this.db
        .prepare(
          'INSERT INTO chats(id,workspace_id,project_id,dot_id,title,draft,created_at,updated_at,last_opened_at,favorite,revision) VALUES(?,?,?,?,?,?, ?,?,?,0,1)',
        )
        .run(id, workspaceId, projectId, dotId, title, '', now, now, now);
      return {
        result: this.chatDetails(id),
        events: [{ type: 'chat.updated', chatId: id, revision: 1 }],
      };
    });
    return result;
  }

  getChat(chatId: string) {
    return this.chatDetails(chatId);
  }

  renameChat(chatId: string, titleValue: string, expectedRevision: number, operationId: string) {
    const title = verifyText(titleValue, 'Título da conversa', 512);
    const { result } = this.mutation(
      operationId,
      'chats.rename',
      { chatId, title, expectedRevision },
      () => {
        const row = this.chatRow(chatId);
        if (row.revision !== expectedRevision)
          throw Error('Conversa mudou em outro cliente; atualize antes de tentar novamente');
        this.db
          .prepare(
            'UPDATE chats SET title=?,updated_at=?,revision=revision+1 WHERE id=? AND revision=?',
          )
          .run(title, Date.now(), chatId, expectedRevision);
        const chat = this.chatDetails(chatId);
        return {
          result: chat,
          events: [{ type: 'chat.updated', chatId, revision: chat.chat.revision }],
        };
      },
    );
    return result;
  }

  favoriteChat(chatId: string, favorite: boolean, expectedRevision: number, operationId: string) {
    const { result } = this.mutation(
      operationId,
      'chats.favorite',
      { chatId, favorite, expectedRevision },
      () => {
        const row = this.chatRow(chatId);
        if (row.revision !== expectedRevision)
          throw Error('Conversa mudou em outro cliente; atualize antes de tentar novamente');
        if ((row.favorite === 1) !== favorite)
          this.db
            .prepare(
              'UPDATE chats SET favorite=?,updated_at=?,revision=revision+1 WHERE id=? AND revision=?',
            )
            .run(favorite ? 1 : 0, Date.now(), chatId, expectedRevision);
        const chat = this.chatDetails(chatId);
        return {
          result: chat,
          events: [{ type: 'chat.updated', chatId, revision: chat.chat.revision }],
        };
      },
    );
    return result;
  }

  setDraft(chatId: string, draft: string, expectedRevision: number, operationId: string) {
    if (bytes(draft) > 8000) throw Error('Rascunho excede 8.000 bytes UTF-8');
    const { result } = this.mutation(
      operationId,
      'chats.draft',
      { chatId, draft, expectedRevision },
      () => {
        const row = this.chatRow(chatId);
        if (row.revision !== expectedRevision)
          throw Error('Conversa mudou em outro cliente; atualize antes de tentar novamente');
        if (row.draft !== draft)
          this.db
            .prepare(
              'UPDATE chats SET draft=?,updated_at=?,revision=revision+1 WHERE id=? AND revision=?',
            )
            .run(draft, Date.now(), chatId, expectedRevision);
        const chat = this.chatDetails(chatId);
        return {
          result: chat,
          events: [{ type: 'chat.updated', chatId, revision: chat.chat.revision }],
        };
      },
    );
    return result;
  }

  openChat(chatId: string, operationId: string) {
    const { result } = this.mutation(operationId, 'chats.open', { chatId }, () => {
      const row = this.chatRow(chatId);
      const navigation = navigationSchema.parse({
        workspaceId: row.workspace_id,
        projectId: row.project_id,
        chatId,
      });
      const now = Math.max(Date.now(), row.last_opened_at + 1);
      this.db.prepare('UPDATE chats SET last_opened_at=? WHERE id=?').run(now, chatId);
      this.db
        .prepare(
          "INSERT INTO settings(key,value) VALUES('navigation',?) ON CONFLICT(key) DO UPDATE SET value=excluded.value",
        )
        .run(JSON.stringify(navigation));
      return { result: this.chatDetails(chatId) };
    });
    return result;
  }

  listMessages(chatId: string, cursor: string | undefined, limit = 100) {
    this.chatRow(chatId);
    const sequence = cursor ? Number(cursor) : 0;
    if (!Number.isSafeInteger(sequence) || sequence < 0 || (cursor && String(sequence) !== cursor))
      throw Error('Cursor de mensagens inválido');
    const rows = this.db
      .prepare('SELECT * FROM messages WHERE chat_id=? AND sequence>? ORDER BY sequence LIMIT ?')
      .all(chatId, sequence, limit + 1) as {
      id: string;
      chat_id: string;
      sequence: number;
      role: 'user';
      body: string;
      created_at: number;
    }[];
    let items = rows.slice(0, limit).map((row) =>
      messageSchema.parse({
        id: row.id,
        chatId: row.chat_id,
        sequence: row.sequence,
        role: row.role,
        body: row.body,
        createdAt: row.created_at,
      }),
    );
    let hasMore = rows.length > limit;
    let deliveries = this.latestDeliveries(
      chatId,
      items.map((item) => item.id),
    );
    const size = () =>
      bytes(
        JSON.stringify({
          items,
          deliveries,
          nextCursor: hasMore && items.length ? String(items.at(-1)!.sequence) : null,
        }),
      );
    while (items.length > 1 && size() > RESPONSE_BUDGET) {
      items = items.slice(0, -1);
      hasMore = true;
      deliveries = this.latestDeliveries(
        chatId,
        items.map((item) => item.id),
      );
    }
    const last = items.at(-1);
    return {
      items,
      deliveries,
      nextCursor: hasMore && last ? String(last.sequence) : null,
    };
  }

  private latestDeliveries(chatId: string, messageIds: string[]) {
    if (!messageIds.length) return [];
    const placeholders = messageIds.map(() => '?').join(',');
    // Deliveries are appended to this rowid table. Insertion order is the attempt
    // order; millisecond timestamps can tie or go backwards and UUIDs are random.
    const rows = this.db
      .prepare(`
      SELECT message_id,run_id,operation_id,status,created_at,updated_at FROM (
        SELECT d.message_id,d.run_id,d.operation_id,d.status,d.created_at,d.updated_at,m.sequence,
          ROW_NUMBER() OVER(PARTITION BY d.message_id ORDER BY d.rowid DESC) AS rn
        FROM message_deliveries d JOIN messages m ON m.id=d.message_id
        WHERE m.chat_id=? AND d.message_id IN (${placeholders})
      ) WHERE rn=1 ORDER BY sequence
    `)
      .all(chatId, ...messageIds) as {
      message_id: string;
      run_id: string;
      operation_id: string;
      status: string;
      created_at: number;
      updated_at: number;
    }[];
    return rows.map((row) =>
      deliverySchema.parse({
        chatId,
        messageId: row.message_id,
        runId: row.run_id,
        operationId: row.operation_id,
        status: row.status,
        createdAt: row.created_at,
        updatedAt: row.updated_at,
      }),
    );
  }

  saveMessage(chatId: string, body: string, expectedRevision: number, operationId: string) {
    if (!body.trim()) throw Error('Mensagem vazia não pode ser salva');
    if (bytes(body) > 8000) throw Error('Mensagem excede 8.000 bytes UTF-8');
    const payload = { chatId, body, expectedRevision };
    const { result } = this.mutation(operationId, 'messages.save', payload, () => {
      const row = this.chatRow(chatId);
      if (row.revision !== expectedRevision)
        throw Error('Conversa mudou em outro cliente; atualize antes de tentar novamente');
      const sequence = Number(
        this.db
          .prepare('SELECT COALESCE(MAX(sequence),0)+1 AS next FROM messages WHERE chat_id=?')
          .get(chatId)?.next,
      );
      const id = randomUUID();
      const now = Date.now();
      this.db
        .prepare(
          "INSERT INTO messages(id,chat_id,sequence,role,body,created_at) VALUES(?,?,?,'user',?,?)",
        )
        .run(id, chatId, sequence, body, now);
      this.db
        .prepare(
          "UPDATE chats SET draft='',updated_at=?,revision=revision+1 WHERE id=? AND revision=?",
        )
        .run(now, chatId, expectedRevision);
      const message = messageSchema.parse({
        id,
        chatId,
        sequence,
        role: 'user',
        body,
        createdAt: now,
      });
      const chat = this.chatDetails(chatId);
      return {
        result: { message, chat },
        events: [
          {
            type: 'message.created',
            chatId,
            messageId: id,
            sequence,
            revision: chat.chat.revision,
          },
        ],
      };
    });
    return result;
  }

  listDeliveries(chatId: string, messageId: string) {
    this.chatRow(chatId);
    const rows = this.db
      .prepare(`
      SELECT d.message_id,d.run_id,d.operation_id,d.status,d.created_at,d.updated_at
      FROM message_deliveries d JOIN messages m ON m.id=d.message_id
      WHERE m.chat_id=? AND d.message_id=? ORDER BY d.rowid LIMIT 100
    `)
      .all(chatId, messageId) as {
      message_id: string;
      run_id: string;
      operation_id: string;
      status: string;
      created_at: number;
      updated_at: number;
    }[];
    return rows.map((row) =>
      deliverySchema.parse({
        chatId,
        messageId: row.message_id,
        runId: row.run_id,
        operationId: row.operation_id,
        status: row.status,
        createdAt: row.created_at,
        updatedAt: row.updated_at,
      }),
    );
  }

  sendMessage(
    input: {
      chatId: string;
      messageId: string;
      runId: string;
      reviewedUncertain: boolean;
      operationId: string;
    },
    isRunActive: (runId: string) => boolean,
    writeToRun: (runId: string, data: string) => unknown,
  ) {
    const payload = {
      chatId: input.chatId,
      messageId: input.messageId,
      runId: input.runId,
      reviewedUncertain: input.reviewedUncertain,
    };
    const payloadHash = digest(payload);
    const existingOperation = this.db
      .prepare('SELECT method,payload_hash FROM product_operations WHERE id=?')
      .get(input.operationId) as { method: string; payload_hash: string } | undefined;
    if (existingOperation) {
      if (
        existingOperation.method !== 'messages.send' ||
        existingOperation.payload_hash !== payloadHash
      )
        throw Error('Chave de operação reutilizada com conteúdo diferente');
      const row = this.db
        .prepare('SELECT status,created_at,updated_at FROM message_deliveries WHERE operation_id=?')
        .get(input.operationId) as
        | { status: string; created_at: number; updated_at: number }
        | undefined;
      if (!row) throw Error('Registro de entrega inconsistente');
      return deliverySchema.parse({
        chatId: input.chatId,
        messageId: input.messageId,
        runId: input.runId,
        operationId: input.operationId,
        status: row.status,
        createdAt: row.created_at,
        updatedAt: row.updated_at,
      });
    }

    const row = this.chatRow(input.chatId);
    const message = this.db
      .prepare('SELECT body FROM messages WHERE id=? AND chat_id=?')
      .get(input.messageId, input.chatId) as { body: string } | undefined;
    if (!message) throw Error('Mensagem não pertence a esta conversa');
    const run = this.db.prepare('SELECT state,chat_id FROM runs WHERE id=?').get(input.runId) as
      | { state: string; chat_id: string | null }
      | undefined;
    if (!run || run.chat_id !== input.chatId) throw Error('Execução não pertence a esta conversa');
    if (run.state !== 'running' || !isRunActive(input.runId))
      throw Error('Terminal desta conversa não está ativo');
    if (bytes(message.body) > 8000) throw Error('Mensagem excede 8.000 bytes UTF-8');
    const prior = this.db
      .prepare(
        "SELECT status FROM message_deliveries WHERE message_id=? AND status IN ('pending','sent','uncertain') ORDER BY rowid DESC LIMIT 1",
      )
      .get(input.messageId) as { status: string } | undefined;
    if (prior?.status === 'sent') throw Error('Mensagem já foi enviada ao terminal');
    if (prior && !input.reviewedUncertain)
      throw Error('Entrega incerta; revise antes de uma nova tentativa');

    const createdAt = Date.now();
    this.db.exec('BEGIN IMMEDIATE');
    try {
      const raced = this.db
        .prepare('SELECT method,payload_hash FROM product_operations WHERE id=?')
        .get(input.operationId) as { method: string; payload_hash: string } | undefined;
      if (raced) throw Error('Operação de envio concorrente; consulte o estado da entrega');
      this.db
        .prepare(
          "INSERT INTO message_deliveries(message_id,run_id,operation_id,status,created_at,updated_at) VALUES(?,?,?,'pending',?,?)",
        )
        .run(input.messageId, input.runId, input.operationId, createdAt, createdAt);
      const pending = deliverySchema.parse({
        chatId: input.chatId,
        messageId: input.messageId,
        runId: input.runId,
        operationId: input.operationId,
        status: 'pending',
        createdAt,
        updatedAt: createdAt,
      });
      this.db
        .prepare(
          'INSERT INTO product_operations(id,method,payload_hash,result_json,created_at) VALUES(?,?,?,?,?)',
        )
        .run(input.operationId, 'messages.send', payloadHash, JSON.stringify(pending), createdAt);
      this.db.exec('COMMIT');
      this.emit({
        type: 'message.delivery.updated',
        chatId: input.chatId,
        messageId: input.messageId,
        runId: input.runId,
        operationId: input.operationId,
        status: 'pending',
      });
    } catch (error) {
      this.db.exec('ROLLBACK');
      throw error;
    }

    const terminalInput = `\x1b[200~${message.body}\x1b[201~\r`;
    if (bytes(terminalInput) > 8192) {
      this.db
        .prepare(
          "UPDATE message_deliveries SET status='uncertain',updated_at=? WHERE operation_id=?",
        )
        .run(Date.now(), input.operationId);
      throw Error('Mensagem com controle de colagem excede o limite do terminal');
    }
    let status: 'sent' | 'uncertain' = 'sent';
    try {
      writeToRun(input.runId, terminalInput);
    } catch {
      status = 'uncertain';
    }
    const updatedAt = Date.now();
    this.db
      .prepare('UPDATE message_deliveries SET status=?,updated_at=? WHERE operation_id=?')
      .run(status, updatedAt, input.operationId);
    const delivery = deliverySchema.parse({
      chatId: input.chatId,
      messageId: input.messageId,
      runId: input.runId,
      operationId: input.operationId,
      status,
      createdAt,
      updatedAt,
    });
    this.db
      .prepare('UPDATE product_operations SET result_json=? WHERE id=?')
      .run(JSON.stringify(delivery), input.operationId);
    this.emit({
      type: 'message.delivery.updated',
      chatId: input.chatId,
      messageId: input.messageId,
      runId: input.runId,
      operationId: input.operationId,
      status,
    });
    return delivery;
  }

  private movePreview(chatId: string, projectId: string, requestedDotId?: string) {
    const chat = this.chatRow(chatId);
    const project = this.projectRow(projectId);
    const dotId = chat.dot_id ?? requestedDotId ?? null;
    const dot = dotId ? this.configuredDots.find((item) => item.id === dotId) : undefined;
    const authorized = Boolean(
      dotId && dot && this.isAuthorized(dotId, project) && (!chat.dot_id || chat.dot_id === dotId),
    );
    const hasNonterminalRun = Boolean(
      this.db
        .prepare(
          `SELECT 1 FROM runs WHERE chat_id=? AND state IN (${ACTIVE_STATES.map(() => '?').join(',')}) LIMIT 1`,
        )
        .get(chatId, ...ACTIVE_STATES),
    );
    return movePreviewSchema.parse({
      chatId,
      title: chat.title,
      revision: chat.revision,
      source: { workspaceName: chat.workspace_name, projectName: chat.project_name },
      destinationWorkspaceId: project.workspace_id,
      destinationWorkspaceName: this.getWorkspace(project.workspace_id).name,
      destinationProjectId: project.id,
      destinationProjectName: project.name,
      dotId,
      dotName: dot?.name ?? null,
      authorized,
      hasNonterminalRun,
      canMove: chat.project_id === null && authorized && !hasNonterminalRun,
    });
  }

  previewMove(chatId: string, projectId: string, dotId?: string) {
    return this.movePreview(chatId, projectId, dotId);
  }

  moveChat(input: {
    chatId: string;
    projectId: string;
    dotId: string;
    expectedRevision: number;
    confirmed: true;
    operationId: string;
  }) {
    const payload = {
      chatId: input.chatId,
      projectId: input.projectId,
      dotId: input.dotId,
      expectedRevision: input.expectedRevision,
      confirmed: input.confirmed,
    };
    const { result } = this.mutation(input.operationId, 'chats.move', payload, () => {
      const preview = this.movePreview(input.chatId, input.projectId, input.dotId);
      if (preview.revision !== input.expectedRevision)
        throw Error('Conversa mudou em outro cliente; atualize antes de tentar novamente');
      if (!preview.canMove) {
        if (preview.hasNonterminalRun) throw Error('Conversa tem execução não terminal vinculada');
        if (!preview.authorized) throw Error('Dot não autorizado para este projeto');
        throw Error('Somente conversas livres podem ser movidas para projeto');
      }
      if (!input.confirmed) throw Error('Movimentação exige confirmação explícita');
      const old = this.chatRow(input.chatId);
      const now = Date.now();
      this.db
        .prepare(
          'UPDATE chats SET workspace_id=?,project_id=?,dot_id=?,updated_at=?,revision=revision+1 WHERE id=? AND revision=? AND project_id IS NULL',
        )
        .run(
          preview.destinationWorkspaceId,
          input.projectId,
          preview.dotId,
          now,
          input.chatId,
          input.expectedRevision,
        );
      if (this.db.prepare('SELECT changes() AS n').get()?.n !== 1)
        throw Error('Conversa mudou em outro cliente; atualize antes de tentar novamente');
      this.db
        .prepare('INSERT INTO chat_events(chat_id,kind,created_at,metadata_json) VALUES(?,?,?,?)')
        .run(
          input.chatId,
          'chat.moved',
          now,
          JSON.stringify({
            fromWorkspaceId: old.workspace_id,
            fromProjectId: old.project_id,
            toWorkspaceId: preview.destinationWorkspaceId,
            toProjectId: input.projectId,
            dotId: preview.dotId,
          }),
        );
      const chat = this.chatDetails(input.chatId);
      return {
        result: chat,
        events: [{ type: 'chat.updated', chatId: input.chatId, revision: chat.chat.revision }],
      };
    });
    return result;
  }

  listChatRuns(chatId: string, cursor: string | undefined, limit = 100) {
    this.chatRow(chatId);
    const values = cursorDecode(cursor, 2) as [number, string] | undefined;
    const rows = (
      values
        ? this.db
            .prepare(
              'SELECT * FROM runs WHERE chat_id=? AND (created_at<? OR (created_at=? AND id<?)) ORDER BY created_at DESC,id DESC LIMIT ?',
            )
            .all(chatId, values[0], values[0], values[1], limit + 1)
        : this.db
            .prepare('SELECT * FROM runs WHERE chat_id=? ORDER BY created_at DESC,id DESC LIMIT ?')
            .all(chatId, limit + 1)
    ) as {
      id: string;
      chat_id: string | null;
      dot_id: string;
      project_id: string | null;
      state: string;
      created_at: number;
      started_at: number | null;
      finished_at: number | null;
      exit_code: number | null;
      error: string | null;
      branch: string | null;
      permission_mode: PermissionMode;
      auto_resume: number;
    }[];
    const items = rows.slice(0, limit).map((row) => {
      const session = this.db.prepare('SELECT id,pid FROM sessions WHERE run_id=?').get(row.id) as
        | { id: string; pid: number }
        | undefined;
      return {
        autoResumeEnabled: row.auto_resume === 1,
        id: row.id,
        chatId: row.chat_id,
        dotId: row.dot_id,
        projectId: row.project_id,
        location: row.project_id === null ? 'home' : 'worktree',
        state: row.state,
        createdAt: row.created_at,
        startedAt: row.started_at,
        finishedAt: row.finished_at,
        exitCode: row.exit_code,
        error: row.error,
        branch: row.branch,
        sessionId: session?.id ?? null,
        pid: session?.pid ?? null,
        permissionMode: row.permission_mode,
      };
    });
    const more = rows.length > limit;
    const last = rows[items.length - 1];
    return { items, nextCursor: more && last ? cursorEncode([last.created_at, last.id]) : null };
  }

  private taskRow(taskId: string): TaskRow {
    const row = this.db
      .prepare(`
      SELECT t.*,p.name AS project_name,w.id AS workspace_id,w.name AS workspace_name,
        c.title AS chat_title,
        (SELECT COUNT(*) FROM task_run_links l WHERE l.task_id=t.id) AS run_count
      FROM tasks t JOIN projects p ON p.id=t.project_id JOIN workspaces w ON w.id=p.workspace_id
      LEFT JOIN chats c ON c.id=t.origin_chat_id WHERE t.id=?
    `)
      .get(taskId) as TaskRow | undefined;
    if (!row) throw Error('Tarefa não encontrada');
    return row;
  }

  private taskAssignees(rows: TaskRow[]) {
    const byTask = new Map<string, ReturnType<typeof taskAssigneeSchema.parse>[]>();
    if (!rows.length) return byTask;
    const taskIds = [...new Set(rows.map((row) => row.id))];
    const projectIds = [...new Set(rows.map((row) => row.project_id))];
    const assigned = this.db
      .prepare(
        `SELECT task_id,assignee_kind,assignee_id FROM task_assignees WHERE task_id IN (${taskIds.map(() => '?').join(',')}) ORDER BY assignee_kind,assignee_id`,
      )
      .all(...taskIds) as {
      task_id: string;
      assignee_kind: 'local' | 'dot';
      assignee_id: string;
    }[];
    const projects = this.db
      .prepare(`SELECT * FROM projects WHERE id IN (${projectIds.map(() => '?').join(',')})`)
      .all(...projectIds) as ProjectRow[];
    const projectById = new Map(projects.map((project) => [project.id, project]));
    const uiGrants = new Set(
      (
        this.db
          .prepare(
            `SELECT project_id,dot_id FROM project_dot_grants WHERE project_id IN (${projectIds.map(() => '?').join(',')})`,
          )
          .all(...projectIds) as { project_id: string; dot_id: string }[]
      ).map((row) => `${row.project_id}\u0000${row.dot_id}`),
    );
    for (const row of rows) byTask.set(row.id, []);
    for (const item of assigned) {
      if (item.assignee_kind === 'local') {
        byTask.get(item.task_id)?.push(
          taskAssigneeSchema.parse({
            kind: 'local',
            id: 'local-user',
            name: 'Você',
            available: true,
          }),
        );
        continue;
      }
      const projectId = rows.find((row) => row.id === item.task_id)?.project_id;
      const project = projectId ? projectById.get(projectId) : undefined;
      const dot = this.configuredDots.find((entry) => entry.id === item.assignee_id);
      const available = Boolean(
        dot &&
          project &&
          dotAllowedInProject(dot, project, (projectId, dotId) =>
            uiGrants.has(`${projectId}\u0000${dotId}`),
          ),
      );
      byTask.get(item.task_id)?.push(
        taskAssigneeSchema.parse({
          kind: 'dot',
          id: item.assignee_id,
          name: dot?.name ?? item.assignee_id,
          available,
        }),
      );
    }
    return byTask;
  }

  private taskSummary(row: TaskRow, assignees: ReturnType<typeof taskAssigneeSchema.parse>[]) {
    return taskSummarySchema.parse({
      id: row.id,
      projectId: row.project_id,
      title: row.title,
      state: row.state,
      createdAt: row.created_at,
      updatedAt: row.updated_at,
      revision: row.revision,
      assignees,
      origin: {
        workspaceId: row.workspace_id,
        workspaceName: row.workspace_name,
        projectName: row.project_name,
        chatId: row.origin_chat_id,
        chatTitle: row.chat_title,
        messageId: row.origin_message_id,
      },
      runCount: row.run_count ?? 0,
    });
  }

  private taskDetails(taskId: string) {
    const row = this.taskRow(taskId);
    const assignees = this.taskAssignees([row]).get(taskId) ?? [];
    const runs = this.db
      .prepare(`
      SELECT r.id,r.state,r.dot_id,r.created_at,d.name AS dot_name
      FROM task_run_links l JOIN runs r ON r.id=l.run_id LEFT JOIN dots d ON d.id=r.dot_id
      WHERE l.task_id=? ORDER BY r.created_at DESC,r.id DESC LIMIT 100
    `)
      .all(taskId) as {
      id: string;
      state: string;
      dot_id: string;
      created_at: number;
      dot_name: string | null;
    }[];
    return taskDetailsSchema.parse({
      ...this.taskSummary(row, assignees),
      description: row.description,
      runs: runs.map((run) =>
        taskRunSchema.parse({
          id: run.id,
          state: run.state,
          dotId: run.dot_id,
          dotName: run.dot_name,
          createdAt: run.created_at,
        }),
      ),
    });
  }

  private validateTaskAssignees(
    project: ProjectRow,
    assignees: { kind: 'local' | 'dot'; id: string }[],
    retainedHistorical: Set<string> = new Set(),
  ) {
    const parsed = assignees.map((assignee) => taskAssigneeInputSchema.parse(assignee));
    const keys = parsed.map((assignee) => `${assignee.kind}:${assignee.id}`);
    if (new Set(keys).size !== keys.length) throw Error('Responsáveis duplicados');
    for (const assignee of parsed) {
      if (
        assignee.kind === 'dot' &&
        !this.configuredDots.some((dot) => dot.id === assignee.id) &&
        !retainedHistorical.has(`${assignee.kind}:${assignee.id}`)
      )
        throw Error('Este Dot não está mais configurado e não pode ser atribuído');
      if (
        assignee.kind === 'dot' &&
        !this.isAuthorized(assignee.id, project) &&
        !retainedHistorical.has(`${assignee.kind}:${assignee.id}`)
      )
        throw Error('Dot não autorizado para este projeto');
    }
    return parsed.sort((a, b) => a.kind.localeCompare(b.kind) || a.id.localeCompare(b.id));
  }

  private recordTaskEvent(taskId: string, kind: string, metadata: Record<string, string>) {
    this.db
      .prepare('INSERT INTO task_events(task_id,kind,created_at,metadata_json) VALUES(?,?,?,?)')
      .run(taskId, kind, Date.now(), JSON.stringify(metadata));
  }

  listTasks(input: {
    workspaceId?: string;
    projectId?: string;
    state?: string;
    assignee?: { kind: 'local' | 'dot'; id: string };
    cursor?: string;
    limit?: number;
  }) {
    const limit = input.limit ?? 100;
    if (input.workspaceId) this.getWorkspace(input.workspaceId);
    if (input.projectId) {
      const project = this.projectRow(input.projectId);
      if (input.workspaceId && project.workspace_id !== input.workspaceId)
        throw Error('Projeto não pertence ao workspace selecionado');
    }
    const cursor = cursorDecode(input.cursor, 2) as [number, string] | undefined;
    const clauses: string[] = [];
    const params: (string | number)[] = [];
    if (input.workspaceId) {
      clauses.push('p.workspace_id=?');
      params.push(input.workspaceId);
    }
    if (input.projectId) {
      clauses.push('t.project_id=?');
      params.push(input.projectId);
    }
    if (input.state) {
      clauses.push('t.state=?');
      params.push(taskStateSchema.parse(input.state));
    }
    if (input.assignee) {
      const assignee = taskAssigneeInputSchema.parse(input.assignee);
      clauses.push(
        'EXISTS(SELECT 1 FROM task_assignees a WHERE a.task_id=t.id AND a.assignee_kind=? AND a.assignee_id=?)',
      );
      params.push(assignee.kind, assignee.id);
    }
    if (cursor) {
      clauses.push('(t.created_at<? OR (t.created_at=? AND t.id<?))');
      params.push(cursor[0], cursor[0], cursor[1]);
    }
    const where = clauses.length ? `WHERE ${clauses.join(' AND ')}` : '';
    const rows = this.db
      .prepare(`
      SELECT t.*,p.name AS project_name,w.id AS workspace_id,w.name AS workspace_name,
        c.title AS chat_title,(SELECT COUNT(*) FROM task_run_links l WHERE l.task_id=t.id) AS run_count
      FROM tasks t JOIN projects p ON p.id=t.project_id JOIN workspaces w ON w.id=p.workspace_id
      LEFT JOIN chats c ON c.id=t.origin_chat_id ${where}
      ORDER BY t.created_at DESC,t.id DESC LIMIT ?
    `)
      .all(...params, limit + 1) as TaskRow[];
    const more = rows.length > limit;
    const visibleRows = rows.slice(0, limit);
    const assignees = this.taskAssignees(visibleRows);
    let items = visibleRows.map((row) => this.taskSummary(row, assignees.get(row.id) ?? []));
    let hasMore = more;
    while (
      items.length &&
      bytes(JSON.stringify({ items, nextCursor: hasMore ? 'cursor' : null })) > RESPONSE_BUDGET
    ) {
      items = items.slice(0, -1);
      hasMore = true;
    }
    const last = items.at(-1);
    const lastRow = last ? visibleRows.find((row) => row.id === last.id) : undefined;
    return taskPageSchema.parse({
      items,
      nextCursor: hasMore && lastRow ? cursorEncode([lastRow.created_at, lastRow.id]) : null,
    });
  }

  getTask(taskId: string) {
    return this.taskDetails(taskId);
  }

  createTask(input: {
    projectId: string;
    title: string;
    description?: string;
    state?: ReturnType<typeof taskStateSchema.parse>;
    assignees?: { kind: 'local' | 'dot'; id: string }[];
    originChatId?: string | null;
    originMessageId?: string | null;
    operationId: string;
  }) {
    const title = verifyText(input.title, 'Título da tarefa', 512);
    const description = input.description ?? '';
    if (bytes(description) > 16000) throw Error('Descrição excede 16.000 bytes UTF-8');
    const state = taskStateSchema.parse(input.state ?? 'todo');
    const assignees = [...(input.assignees ?? [])].sort(
      (a, b) => a.kind.localeCompare(b.kind) || a.id.localeCompare(b.id),
    );
    const originChatId = input.originChatId ?? null;
    const originMessageId = input.originMessageId ?? null;
    const payload = {
      projectId: input.projectId,
      title,
      description,
      state,
      assignees,
      originChatId,
      originMessageId,
    };
    const { result } = this.mutation(input.operationId, 'tasks.create', payload, () => {
      const project = this.projectRow(input.projectId);
      const validAssignees = this.validateTaskAssignees(project, assignees);
      if (originMessageId && !originChatId)
        throw Error('Mensagem de origem exige uma conversa de origem');
      if (originChatId) {
        const chat = this.db
          .prepare('SELECT id,project_id FROM chats WHERE id=?')
          .get(originChatId) as { id: string; project_id: string | null } | undefined;
        if (!chat || chat.project_id !== project.id)
          throw Error('Conversa de origem precisa pertencer ao projeto da tarefa');
      }
      if (originMessageId) {
        const message = this.db
          .prepare('SELECT id FROM messages WHERE id=? AND chat_id=?')
          .get(originMessageId, originChatId);
        if (!message) throw Error('Mensagem de origem não pertence à conversa indicada');
      }
      const id = randomUUID();
      const now = Date.now();
      this.db
        .prepare(
          'INSERT INTO tasks(id,project_id,title,description,state,origin_chat_id,origin_message_id,created_at,updated_at,revision) VALUES(?,?,?,?,?,?,?,?,?,1)',
        )
        .run(id, project.id, title, description, state, originChatId, originMessageId, now, now);
      const insertAssignee = this.db.prepare(
        'INSERT INTO task_assignees(task_id,assignee_kind,assignee_id,created_at) VALUES(?,?,?,?)',
      );
      for (const assignee of validAssignees)
        insertAssignee.run(id, assignee.kind, assignee.id, now);
      this.recordTaskEvent(id, 'task.created', {
        projectId: project.id,
        state,
        originChatId: originChatId ?? '',
        originMessageId: originMessageId ?? '',
      });
      return {
        result: this.taskDetails(id),
        events: [{ type: 'task.updated', taskId: id, revision: 1 }],
      };
    });
    return result;
  }

  updateTask(input: {
    taskId: string;
    title?: string;
    description?: string;
    state?: ReturnType<typeof taskStateSchema.parse>;
    expectedRevision: number;
    operationId: string;
  }) {
    const title =
      input.title === undefined ? undefined : verifyText(input.title, 'Título da tarefa', 512);
    const description = input.description;
    if (description !== undefined && bytes(description) > 16000)
      throw Error('Descrição excede 16.000 bytes UTF-8');
    const state = input.state === undefined ? undefined : taskStateSchema.parse(input.state);
    const payload = {
      taskId: input.taskId,
      title,
      description,
      state,
      expectedRevision: input.expectedRevision,
    };
    const { result } = this.mutation(input.operationId, 'tasks.update', payload, () => {
      const before = this.taskRow(input.taskId);
      if (before.revision !== input.expectedRevision)
        throw Error('Tarefa mudou em outro cliente; atualize antes de tentar novamente');
      const nextTitle = title ?? before.title;
      const nextDescription = description ?? before.description;
      const nextState = state ?? before.state;
      const titleChanged = nextTitle !== before.title;
      const descriptionChanged = nextDescription !== before.description;
      const stateChanged = nextState !== before.state;
      if (titleChanged || descriptionChanged || stateChanged) {
        const now = Date.now();
        this.db
          .prepare(
            'UPDATE tasks SET title=?,description=?,state=?,updated_at=?,revision=revision+1 WHERE id=? AND revision=?',
          )
          .run(nextTitle, nextDescription, nextState, now, input.taskId, input.expectedRevision);
        if (this.db.prepare('SELECT changes() AS n').get()?.n !== 1)
          throw Error('Tarefa mudou em outro cliente; atualize antes de tentar novamente');
        if (stateChanged)
          this.recordTaskEvent(input.taskId, 'task.state_changed', {
            from: before.state,
            to: nextState,
          });
        const changed = [
          titleChanged ? 'title' : '',
          descriptionChanged ? 'description' : '',
        ].filter(Boolean);
        if (changed.length)
          this.recordTaskEvent(input.taskId, 'task.updated', { fields: changed.join(',') });
      }
      const task = this.taskDetails(input.taskId);
      return {
        result: task,
        events: [{ type: 'task.updated', taskId: task.id, revision: task.revision }],
      };
    });
    return result;
  }

  setTaskAssignees(input: {
    taskId: string;
    assignees: { kind: 'local' | 'dot'; id: string }[];
    expectedRevision: number;
    operationId: string;
  }) {
    const assignees = [...input.assignees].sort(
      (a, b) => a.kind.localeCompare(b.kind) || a.id.localeCompare(b.id),
    );
    const payload = { taskId: input.taskId, assignees, expectedRevision: input.expectedRevision };
    const { result } = this.mutation(input.operationId, 'tasks.assignees.set', payload, () => {
      const task = this.taskRow(input.taskId);
      if (task.revision !== input.expectedRevision)
        throw Error('Tarefa mudou em outro cliente; atualize antes de tentar novamente');
      const old = this.db
        .prepare(
          'SELECT assignee_kind,assignee_id FROM task_assignees WHERE task_id=? ORDER BY assignee_kind,assignee_id',
        )
        .all(input.taskId) as { assignee_kind: string; assignee_id: string }[];
      const oldKeys = old.map((item) => `${item.assignee_kind}:${item.assignee_id}`);
      const next = this.validateTaskAssignees(
        this.projectRow(task.project_id),
        assignees,
        new Set(oldKeys),
      );
      const nextKeys = next.map((item) => `${item.kind}:${item.id}`);
      if (oldKeys.join('|') !== nextKeys.join('|')) {
        const oldSet = new Set(oldKeys),
          nextSet = new Set(nextKeys);
        this.db.prepare('DELETE FROM task_assignees WHERE task_id=?').run(input.taskId);
        const insert = this.db.prepare(
          'INSERT INTO task_assignees(task_id,assignee_kind,assignee_id,created_at) VALUES(?,?,?,?)',
        );
        const now = Date.now();
        for (const assignee of next) insert.run(input.taskId, assignee.kind, assignee.id, now);
        this.db
          .prepare('UPDATE tasks SET updated_at=?,revision=revision+1 WHERE id=? AND revision=?')
          .run(now, input.taskId, input.expectedRevision);
        this.recordTaskEvent(input.taskId, 'task.assignees_changed', {
          added: nextKeys.filter((key) => !oldSet.has(key)).join(','),
          removed: oldKeys.filter((key) => !nextSet.has(key)).join(','),
        });
      }
      const details = this.taskDetails(input.taskId);
      return {
        result: details,
        events: [{ type: 'task.updated', taskId: details.id, revision: details.revision }],
      };
    });
    return result;
  }

  linkTaskRun(
    input: { taskId: string; runId: string; expectedRevision: number; operationId: string },
    linked: boolean,
  ) {
    const method = linked ? 'tasks.runs.link' : 'tasks.runs.unlink';
    const payload = {
      taskId: input.taskId,
      runId: input.runId,
      expectedRevision: input.expectedRevision,
    };
    const { result } = this.mutation(input.operationId, method, payload, () => {
      const task = this.taskRow(input.taskId);
      if (task.revision !== input.expectedRevision)
        throw Error('Tarefa mudou em outro cliente; atualize antes de tentar novamente');
      const run = this.db.prepare('SELECT id,project_id FROM runs WHERE id=?').get(input.runId) as
        | { id: string; project_id: string }
        | undefined;
      if (!run) throw Error('Execução não encontrada');
      if (run.project_id !== task.project_id)
        throw Error('Execução precisa pertencer ao mesmo projeto da tarefa');
      const exists = Boolean(
        this.db
          .prepare('SELECT 1 FROM task_run_links WHERE task_id=? AND run_id=?')
          .get(input.taskId, input.runId),
      );
      let changed = false;
      if (linked && !exists) {
        this.db
          .prepare('INSERT INTO task_run_links(task_id,run_id,created_at) VALUES(?,?,?)')
          .run(input.taskId, input.runId, Date.now());
        changed = true;
      } else if (!linked && exists) {
        this.db
          .prepare('DELETE FROM task_run_links WHERE task_id=? AND run_id=?')
          .run(input.taskId, input.runId);
        changed = true;
      }
      if (changed) {
        const now = Date.now();
        this.db
          .prepare('UPDATE tasks SET updated_at=?,revision=revision+1 WHERE id=? AND revision=?')
          .run(now, input.taskId, input.expectedRevision);
        this.recordTaskEvent(input.taskId, linked ? 'task.run_linked' : 'task.run_unlinked', {
          runId: input.runId,
        });
      }
      const details = this.taskDetails(input.taskId);
      return {
        result: details,
        events: [{ type: 'task.updated', taskId: details.id, revision: details.revision }],
      };
    });
    return result;
  }

  listTaskEvents(taskId: string, cursor?: string, limit = 100) {
    this.taskRow(taskId);
    const lastId = cursor === undefined ? 0 : Number(cursor);
    if (
      !Number.isSafeInteger(lastId) ||
      lastId < 0 ||
      (cursor !== undefined && String(lastId) !== cursor)
    )
      throw Error('Cursor do histórico de tarefa inválido');
    const rows = this.db
      .prepare(
        'SELECT id,task_id,kind,created_at,metadata_json FROM task_events WHERE task_id=? AND id>? ORDER BY id LIMIT ?',
      )
      .all(taskId, lastId, limit + 1) as {
      id: number;
      task_id: string;
      kind: string;
      created_at: number;
      metadata_json: string;
    }[];
    let items = rows.slice(0, limit).map((row) =>
      taskEventSchema.parse({
        id: row.id,
        taskId: row.task_id,
        kind: row.kind,
        createdAt: row.created_at,
        metadata: JSON.parse(row.metadata_json) as Record<string, string>,
      }),
    );
    let more = rows.length > limit;
    while (
      items.length &&
      bytes(JSON.stringify({ items, nextCursor: more ? 'cursor' : null })) > RESPONSE_BUDGET
    ) {
      items = items.slice(0, -1);
      more = true;
    }
    return taskEventPageSchema.parse({
      items,
      nextCursor: more && items.length ? String(items.at(-1)!.id) : null,
    });
  }

  getNavigation() {
    const row = this.db.prepare("SELECT value FROM settings WHERE key='navigation'").get() as
      | { value: string }
      | undefined;
    const defaultRow = this.db
      .prepare("SELECT value FROM settings WHERE key='default_workspace_id'")
      .get() as { value: string } | undefined;
    const fallback = { workspaceId: defaultRow?.value ?? null, projectId: null, chatId: null };
    if (!row) return navigationSchema.parse(fallback);
    let value: ReturnType<typeof navigationSchema.parse>;
    try {
      value = navigationSchema.parse(JSON.parse(row.value));
    } catch {
      return navigationSchema.parse(fallback);
    }
    if (value.chatId) {
      try {
        const chat = this.chatRow(value.chatId);
        return navigationSchema.parse({
          workspaceId: chat.workspace_id,
          projectId: chat.project_id,
          chatId: chat.id,
        });
      } catch {
        return navigationSchema.parse(fallback);
      }
    }
    if (value.workspaceId) {
      try {
        this.getWorkspace(value.workspaceId);
      } catch {
        return navigationSchema.parse(fallback);
      }
    }
    if (value.projectId) {
      try {
        const project = this.projectRow(value.projectId);
        if (project.workspace_id !== value.workspaceId) return navigationSchema.parse(fallback);
      } catch {
        return navigationSchema.parse(fallback);
      }
    }
    return value;
  }

  setNavigation(input: {
    workspaceId: string | null;
    projectId: string | null;
    chatId: string | null;
    operationId: string;
  }) {
    const navigation = navigationSchema.parse({
      workspaceId: input.workspaceId,
      projectId: input.projectId,
      chatId: input.chatId,
    });
    const { result } = this.mutation(input.operationId, 'navigation.set', navigation, () => {
      if (navigation.chatId) {
        const chat = this.chatRow(navigation.chatId);
        if (
          chat.workspace_id !== navigation.workspaceId ||
          chat.project_id !== navigation.projectId
        )
          throw Error('Navegação não corresponde à conversa');
      } else {
        if (navigation.workspaceId) this.getWorkspace(navigation.workspaceId);
        if (navigation.projectId) {
          const project = this.projectRow(navigation.projectId);
          if (project.workspace_id !== navigation.workspaceId)
            throw Error('Projeto não pertence ao workspace selecionado');
        }
      }
      this.db
        .prepare(
          "INSERT INTO settings(key,value) VALUES('navigation',?) ON CONFLICT(key) DO UPDATE SET value=excluded.value",
        )
        .run(JSON.stringify(navigation));
      return { result: navigation };
    });
    return result;
  }
}
