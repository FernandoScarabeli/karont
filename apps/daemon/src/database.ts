import fs from 'node:fs';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { DatabaseSync } from 'node:sqlite';
import { z } from 'zod';
import { dotSchema, projectSchema, type Dot, type Project } from '../../../packages/contracts/src';
import { paths, privateFile } from '../../../packages/local/src/paths';

const configSchema = z
  .object({
    version: z.literal(1),
    projects: z
      .array(z.object({ id: z.string(), name: z.string(), root: z.string() }).strict())
      .max(100),
    dots: z
      .array(
        z
          .object({
            id: z.string(),
            name: z.string(),
            role: z.string().max(1600),
            executable: z.string(),
            adapter: z.enum(['generic', 'codex']).default('generic'),
            autoResume: z.boolean().default(true),
            args: z.array(z.string()).default([]),
            projectIds: z.array(z.string()),
          })
          .strict(),
      )
      .max(8),
  })
  .strict();

export type DotConfig = Dot & { projectIds: string[] };

export function openDatabase(file: string) {
  try {
    fs.lstatSync(file);
    privateFile(file);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
  }
  const db = new DatabaseSync(file);
  db.exec(
    'PRAGMA journal_mode=WAL; PRAGMA synchronous=NORMAL; PRAGMA busy_timeout=2000; PRAGMA foreign_keys=ON;',
  );
  if (db.prepare('PRAGMA journal_mode').get()?.journal_mode !== 'wal')
    throw Error('SQLite não ativou WAL');
  const version = Number(
    (db.prepare('PRAGMA user_version').get() as { user_version: number }).user_version,
  );
  if (version > 7) throw Error('Banco de dados criado por uma versão mais nova do Karont');
  if (version < 1) {
    db.exec(
      'BEGIN; CREATE TABLE IF NOT EXISTS settings(key TEXT PRIMARY KEY,value TEXT NOT NULL); CREATE VIRTUAL TABLE IF NOT EXISTS phase0_search USING fts5(content); PRAGMA user_version=1; COMMIT;',
    );
  }
  if (
    Number((db.prepare('PRAGMA user_version').get() as { user_version: number }).user_version) < 2
  ) {
    db.exec(`BEGIN;
      CREATE TABLE dots(id TEXT PRIMARY KEY, name TEXT NOT NULL, role TEXT NOT NULL, executable TEXT NOT NULL, args_json TEXT NOT NULL, project_ids_json TEXT NOT NULL, updated_at INTEGER NOT NULL);
      CREATE TABLE projects(id TEXT PRIMARY KEY, name TEXT NOT NULL, root TEXT NOT NULL, git_root TEXT NOT NULL, created_at INTEGER NOT NULL);
      CREATE TABLE runs(id TEXT PRIMARY KEY, dot_id TEXT NOT NULL REFERENCES dots(id), project_id TEXT NOT NULL REFERENCES projects(id), state TEXT NOT NULL CHECK(state IN ('queued','running','completed','failed','cancelled')), created_at INTEGER NOT NULL, started_at INTEGER, finished_at INTEGER, exit_code INTEGER, error TEXT, branch TEXT);
      CREATE INDEX runs_created_at ON runs(created_at DESC);
      CREATE TABLE sessions(id TEXT PRIMARY KEY, run_id TEXT NOT NULL UNIQUE REFERENCES runs(id), pid INTEGER NOT NULL, cols INTEGER NOT NULL, rows INTEGER NOT NULL, state TEXT NOT NULL, started_at INTEGER NOT NULL, finished_at INTEGER);
      CREATE TABLE run_events(id INTEGER PRIMARY KEY AUTOINCREMENT, run_id TEXT NOT NULL REFERENCES runs(id), type TEXT NOT NULL, created_at INTEGER NOT NULL, metadata_json TEXT NOT NULL);
      CREATE INDEX run_events_run_id ON run_events(run_id,id);
      CREATE TABLE worktrees(run_id TEXT PRIMARY KEY REFERENCES runs(id), path TEXT NOT NULL UNIQUE, branch TEXT NOT NULL, base_ref TEXT NOT NULL, created_at INTEGER NOT NULL, removed_at INTEGER);
      CREATE TABLE file_changes(run_id TEXT NOT NULL REFERENCES runs(id), path TEXT NOT NULL, kind TEXT NOT NULL CHECK(kind IN ('created','modified','deleted')), before_hash TEXT, after_hash TEXT, additions INTEGER NOT NULL DEFAULT 0, deletions INTEGER NOT NULL DEFAULT 0, PRIMARY KEY(run_id,path));
      PRAGMA user_version=2; COMMIT;`);
  }
  if (version < 3)
    db.exec(`BEGIN;
    ALTER TABLE runs ADD COLUMN permission_mode TEXT NOT NULL DEFAULT 'ask';
    CREATE TABLE approvals(id TEXT PRIMARY KEY, run_id TEXT NOT NULL REFERENCES runs(id), status TEXT NOT NULL CHECK(status IN ('pending','denied','applied','failed')), created_at INTEGER NOT NULL, decided_at INTEGER);
    PRAGMA user_version=3; COMMIT;`);
  if (version < 4) {
    // Rebuild CHECK constraint without renaming the referenced table.
    db.exec('PRAGMA foreign_keys=OFF');
    try {
      db.exec(`BEGIN IMMEDIATE;
        CREATE TABLE runs_v4(id TEXT PRIMARY KEY, dot_id TEXT NOT NULL REFERENCES dots(id), project_id TEXT NOT NULL REFERENCES projects(id), state TEXT NOT NULL CHECK(state IN ('queued','running','paused','waiting_quota','waiting_approval','recovery_needed','completed','failed','cancelled')), created_at INTEGER NOT NULL, started_at INTEGER, finished_at INTEGER, exit_code INTEGER, error TEXT, branch TEXT, permission_mode TEXT NOT NULL DEFAULT 'ask', auto_resume INTEGER NOT NULL DEFAULT 1);
        INSERT INTO runs_v4 SELECT *,1 FROM runs;
        DROP TABLE runs; ALTER TABLE runs_v4 RENAME TO runs;
        CREATE INDEX runs_created_at ON runs(created_at DESC);
        ALTER TABLE sessions ADD COLUMN identity_json TEXT;
        CREATE TABLE checkpoints(id TEXT PRIMARY KEY, run_id TEXT NOT NULL REFERENCES runs(id), created_at INTEGER NOT NULL, origin TEXT NOT NULL, state TEXT NOT NULL, snapshot_json TEXT NOT NULL);
        CREATE INDEX checkpoints_run ON checkpoints(run_id,created_at DESC);
        CREATE TABLE operations(id TEXT PRIMARY KEY, run_id TEXT NOT NULL REFERENCES runs(id), kind TEXT NOT NULL, status TEXT NOT NULL CHECK(status IN ('pending','completed','uncertain')), created_at INTEGER NOT NULL, updated_at INTEGER NOT NULL);
        CREATE TABLE resume_jobs(run_id TEXT PRIMARY KEY REFERENCES runs(id), session_id TEXT NOT NULL, reset_at INTEGER, attempts INTEGER NOT NULL DEFAULT 0, due_at INTEGER, status TEXT NOT NULL, fingerprint TEXT NOT NULL);
        PRAGMA user_version=4; COMMIT;`);
    } catch (error) {
      db.exec('ROLLBACK');
      throw error;
    } finally {
      db.exec('PRAGMA foreign_keys=ON');
    }
    if (db.prepare('PRAGMA foreign_key_check').all().length)
      throw Error('Migração com referências inválidas');
  }
  if (version < 5) {
    const workspaceId = randomUUID();
    db.exec('BEGIN IMMEDIATE');
    try {
      db.exec(`
        CREATE TABLE workspaces(
          id TEXT PRIMARY KEY,
          name TEXT NOT NULL CHECK(length(trim(name)) BETWEEN 1 AND 120),
          created_at INTEGER NOT NULL,
          updated_at INTEGER NOT NULL
        );
        ALTER TABLE projects ADD COLUMN workspace_id TEXT REFERENCES workspaces(id);
        ALTER TABLE projects ADD COLUMN origin TEXT NOT NULL DEFAULT 'config' CHECK(origin IN ('config','ui'));
        INSERT INTO workspaces(id,name,created_at,updated_at) VALUES('${workspaceId}','Meus projetos',${Date.now()},${Date.now()});
        UPDATE projects SET workspace_id='${workspaceId}' WHERE workspace_id IS NULL;
        CREATE UNIQUE INDEX projects_workspace_id ON projects(workspace_id,id);
        CREATE INDEX projects_workspace_created ON projects(workspace_id,created_at,id);
        CREATE TRIGGER projects_require_workspace_insert BEFORE INSERT ON projects
        WHEN NEW.workspace_id IS NULL BEGIN SELECT RAISE(ABORT,'Projeto precisa pertencer a um workspace'); END;
        CREATE TRIGGER projects_require_workspace_update BEFORE UPDATE OF workspace_id ON projects
        WHEN NEW.workspace_id IS NULL BEGIN SELECT RAISE(ABORT,'Projeto precisa pertencer a um workspace'); END;
        CREATE TABLE chats(
          id TEXT PRIMARY KEY,
          workspace_id TEXT REFERENCES workspaces(id),
          project_id TEXT,
          dot_id TEXT REFERENCES dots(id),
          title TEXT NOT NULL CHECK(length(trim(title)) BETWEEN 1 AND 120),
          draft TEXT NOT NULL DEFAULT '',
          created_at INTEGER NOT NULL,
          updated_at INTEGER NOT NULL,
          last_opened_at INTEGER NOT NULL,
          favorite INTEGER NOT NULL DEFAULT 0 CHECK(favorite IN (0,1)),
          revision INTEGER NOT NULL DEFAULT 1 CHECK(revision > 0),
          FOREIGN KEY(workspace_id,project_id) REFERENCES projects(workspace_id,id),
          CHECK(project_id IS NULL OR workspace_id IS NOT NULL)
        );
        CREATE INDEX chats_recent ON chats(last_opened_at DESC,id DESC);
        CREATE INDEX chats_favorites ON chats(favorite,last_opened_at DESC,id DESC);
        CREATE INDEX chats_workspace ON chats(workspace_id,project_id,updated_at DESC,id DESC);
        CREATE TABLE messages(
          id TEXT PRIMARY KEY,
          chat_id TEXT NOT NULL REFERENCES chats(id),
          sequence INTEGER NOT NULL CHECK(sequence > 0),
          role TEXT NOT NULL CHECK(role='user'),
          body TEXT NOT NULL CHECK(length(CAST(body AS BLOB)) <= 8000),
          created_at INTEGER NOT NULL,
          UNIQUE(chat_id,sequence)
        );
        CREATE INDEX messages_chat_sequence ON messages(chat_id,sequence);
        CREATE TABLE message_deliveries(
          message_id TEXT NOT NULL REFERENCES messages(id),
          run_id TEXT NOT NULL REFERENCES runs(id),
          operation_id TEXT NOT NULL UNIQUE,
          status TEXT NOT NULL CHECK(status IN ('pending','sent','uncertain')),
          created_at INTEGER NOT NULL,
          updated_at INTEGER NOT NULL,
          PRIMARY KEY(message_id,operation_id)
        );
        CREATE INDEX message_deliveries_message ON message_deliveries(message_id,created_at,operation_id);
        CREATE TABLE project_dot_grants(
          project_id TEXT NOT NULL REFERENCES projects(id),
          dot_id TEXT NOT NULL REFERENCES dots(id),
          created_at INTEGER NOT NULL,
          PRIMARY KEY(project_id,dot_id)
        );
        CREATE TABLE product_operations(
          id TEXT PRIMARY KEY,
          method TEXT NOT NULL,
          payload_hash TEXT NOT NULL,
          result_json TEXT NOT NULL,
          created_at INTEGER NOT NULL
        );
        CREATE TABLE chat_events(
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          chat_id TEXT NOT NULL REFERENCES chats(id),
          kind TEXT NOT NULL,
          created_at INTEGER NOT NULL,
          metadata_json TEXT NOT NULL
        );
        CREATE INDEX chat_events_chat ON chat_events(chat_id,id);
        ALTER TABLE runs ADD COLUMN chat_id TEXT REFERENCES chats(id);
        CREATE INDEX runs_chat_created ON runs(chat_id,created_at DESC,id DESC);
        CREATE TRIGGER runs_chat_context_insert BEFORE INSERT ON runs
        WHEN NEW.chat_id IS NOT NULL AND NOT EXISTS(
          SELECT 1 FROM chats c WHERE c.id=NEW.chat_id AND c.project_id=NEW.project_id AND c.dot_id=NEW.dot_id
        ) BEGIN SELECT RAISE(ABORT,'Execução diverge do contexto da conversa'); END;
        CREATE TRIGGER runs_chat_context_update BEFORE UPDATE OF chat_id,dot_id,project_id ON runs
        WHEN NEW.chat_id IS NOT NULL AND NOT EXISTS(
          SELECT 1 FROM chats c WHERE c.id=NEW.chat_id AND c.project_id=NEW.project_id AND c.dot_id=NEW.dot_id
        ) BEGIN SELECT RAISE(ABORT,'Execução diverge do contexto da conversa'); END;
        INSERT INTO settings(key,value) VALUES('default_workspace_id','${workspaceId}');
        PRAGMA user_version=5;
      `);
      db.exec('COMMIT');
    } catch (error) {
      db.exec('ROLLBACK');
      throw error;
    }
    if (db.prepare('PRAGMA foreign_key_check').all().length)
      throw Error('Migração v5 com referências inválidas');
  }
  if (version < 6) {
    db.exec('BEGIN IMMEDIATE');
    try {
      db.exec(`
        CREATE TABLE tasks(
          id TEXT PRIMARY KEY,
          project_id TEXT NOT NULL REFERENCES projects(id),
          title TEXT NOT NULL CHECK(length(trim(title)) BETWEEN 1 AND 120),
          description TEXT NOT NULL DEFAULT '' CHECK(length(CAST(description AS BLOB)) <= 16000),
          state TEXT NOT NULL CHECK(state IN ('todo','in_progress','review','done')),
          origin_chat_id TEXT REFERENCES chats(id),
          origin_message_id TEXT REFERENCES messages(id),
          created_at INTEGER NOT NULL,
          updated_at INTEGER NOT NULL,
          revision INTEGER NOT NULL DEFAULT 1 CHECK(revision > 0),
          CHECK(origin_message_id IS NULL OR origin_chat_id IS NOT NULL)
        );
        CREATE INDEX tasks_project_state_order ON tasks(project_id,state,created_at,id);
        CREATE INDEX tasks_updated_order ON tasks(updated_at DESC,id DESC);
        CREATE INDEX tasks_origin_chat ON tasks(origin_chat_id,created_at DESC,id DESC);
        CREATE TABLE task_assignees(
          task_id TEXT NOT NULL REFERENCES tasks(id),
          assignee_kind TEXT NOT NULL CHECK(assignee_kind IN ('local','dot')),
          assignee_id TEXT NOT NULL CHECK(length(assignee_id) BETWEEN 1 AND 80),
          created_at INTEGER NOT NULL,
          PRIMARY KEY(task_id,assignee_kind,assignee_id)
        );
        CREATE INDEX task_assignees_identity ON task_assignees(assignee_kind,assignee_id,task_id);
        CREATE TABLE task_run_links(
          task_id TEXT NOT NULL REFERENCES tasks(id),
          run_id TEXT NOT NULL REFERENCES runs(id),
          created_at INTEGER NOT NULL,
          PRIMARY KEY(task_id,run_id)
        );
        CREATE INDEX task_run_links_run ON task_run_links(run_id,task_id);
        CREATE TRIGGER task_run_same_project_insert BEFORE INSERT ON task_run_links
        WHEN NOT EXISTS(
          SELECT 1 FROM tasks t JOIN runs r ON r.id=NEW.run_id
          WHERE t.id=NEW.task_id AND t.project_id=r.project_id
        ) BEGIN SELECT RAISE(ABORT,'Tarefa e execução precisam pertencer ao mesmo projeto'); END;
        CREATE TABLE task_events(
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          task_id TEXT NOT NULL REFERENCES tasks(id),
          kind TEXT NOT NULL CHECK(kind IN ('task.created','task.updated','task.state_changed','task.assignees_changed','task.run_linked','task.run_unlinked')),
          actor TEXT NOT NULL DEFAULT 'local-user',
          created_at INTEGER NOT NULL,
          metadata_json TEXT NOT NULL DEFAULT '{}'
        );
        CREATE INDEX task_events_task ON task_events(task_id,id DESC);
        CREATE TRIGGER task_events_no_update BEFORE UPDATE ON task_events
        BEGIN SELECT RAISE(ABORT,'Histórico de tarefa é append-only'); END;
        CREATE TRIGGER task_events_no_delete BEFORE DELETE ON task_events
        BEGIN SELECT RAISE(ABORT,'Histórico de tarefa é append-only'); END;
        CREATE TRIGGER task_origin_context_insert BEFORE INSERT ON tasks
        WHEN NEW.origin_chat_id IS NOT NULL AND NOT EXISTS(
          SELECT 1 FROM chats c WHERE c.id=NEW.origin_chat_id AND c.project_id=NEW.project_id
        ) BEGIN SELECT RAISE(ABORT,'Conversa de origem precisa pertencer ao projeto da tarefa'); END;
        CREATE TRIGGER task_origin_context_update BEFORE UPDATE OF project_id,origin_chat_id,origin_message_id ON tasks
        WHEN NEW.origin_chat_id IS NOT NULL AND NOT EXISTS(
          SELECT 1 FROM chats c WHERE c.id=NEW.origin_chat_id AND c.project_id=NEW.project_id
            AND (NEW.origin_message_id IS NULL OR EXISTS(SELECT 1 FROM messages m WHERE m.id=NEW.origin_message_id AND m.chat_id=c.id))
        ) BEGIN SELECT RAISE(ABORT,'Origem da tarefa diverge do projeto ou da conversa'); END;
        PRAGMA user_version=6;
      `);
      db.exec('COMMIT');
    } catch (error) {
      db.exec('ROLLBACK');
      throw error;
    }
    if (db.prepare('PRAGMA foreign_key_check').all().length)
      throw Error('Migração v6 com referências inválidas');
  }
  if ((db.prepare('PRAGMA user_version').get() as { user_version: number }).user_version < 7) {
    db.exec("BEGIN; ALTER TABLE projects ADD COLUMN icon TEXT NOT NULL DEFAULT 'folder'; PRAGMA user_version=7; COMMIT;");
  }
  return db;
}

export function readDotConfig(file = paths().dots) {
  if (!fs.existsSync(file)) return { dots: [] as DotConfig[], projects: [] as Project[] };
  privateFile(file);
  const config = configSchema.parse(JSON.parse(fs.readFileSync(file, 'utf8')));
  const projects = config.projects.map((project) =>
    projectSchema.parse({
      ...project,
      root: path.isAbsolute(project.root)
        ? path.resolve(project.root)
        : (() => {
            throw Error('Projeto deve usar caminho absoluto');
          })(),
      gitRoot: path.isAbsolute(project.root)
        ? path.resolve(project.root)
        : (() => {
            throw Error('Projeto deve usar caminho absoluto');
          })(),
    }),
  );
  const projectIds = new Set(projects.map((project) => project.id));
  const dots = config.dots.map((dot) => {
    const parsed = dotSchema.parse(dot);
    if (!path.isAbsolute(parsed.executable))
      throw Error('CLI deve ser configurada com caminho absoluto');
    if (parsed.args.some((arg) => arg.includes('\0'))) throw Error('Argumento de CLI inválido');
    if (parsed.projectIds.some((id) => !projectIds.has(id)))
      throw Error('Dot referencia projeto inexistente');
    return { ...parsed, projectIds: [...parsed.projectIds] };
  });
  if (new Set(dots.map((dot) => dot.id)).size !== dots.length) throw Error('IDs de Dot duplicados');
  if (new Set(projects.map((project) => project.id)).size !== projects.length)
    throw Error('IDs de projeto duplicados');
  return { dots, projects };
}

export function syncConfig(db: DatabaseSync, dots: DotConfig[], projects: Project[]) {
  const upsertDot = db.prepare(
    'INSERT INTO dots(id,name,role,executable,args_json,project_ids_json,updated_at) VALUES(?,?,?,?,?,?,?) ON CONFLICT(id) DO UPDATE SET name=excluded.name,role=excluded.role,executable=excluded.executable,args_json=excluded.args_json,project_ids_json=excluded.project_ids_json,updated_at=excluded.updated_at',
  );
  const defaultWorkspace = db
    .prepare("SELECT value FROM settings WHERE key='default_workspace_id'")
    .get() as { value: string } | undefined;
  if (!defaultWorkspace) throw Error('Workspace padrão ausente após migração');
  const insertProject = db.prepare(
    "INSERT INTO projects(id,name,root,git_root,created_at,workspace_id,origin) VALUES(?,?,?,?,?,?,'config')",
  );
  const updateProject = db.prepare(
    "UPDATE projects SET name=?,root=?,git_root=?,origin='config' WHERE id=?",
  );
  db.exec('BEGIN');
  try {
    const now = Date.now();
    const comparable = (value: string) => {
      try {
        return fs.realpathSync(value);
      } catch {
        return path.resolve(value);
      }
    };
    for (const dot of dots)
      upsertDot.run(
        dot.id,
        dot.name,
        dot.role,
        dot.executable,
        JSON.stringify(dot.args),
        JSON.stringify(dot.projectIds),
        now,
      );
    for (const project of projects) {
      const existing = db
        .prepare('SELECT root,origin FROM projects WHERE id=?')
        .get(project.id) as { root: string; origin: 'config' | 'ui' } | undefined;
      if (!existing) {
        const sameRoot = (db.prepare('SELECT id,root FROM projects WHERE id<>?').all(project.id) as { id: string; root: string }[])
          .find((candidate) => comparable(candidate.root) === comparable(project.root));
        if (sameRoot)
          throw Error(`Repositório já cadastrado com ID diferente: ${sameRoot.id} / ${project.id}`);
        insertProject.run(
          project.id,
          project.name,
          project.root,
          project.gitRoot,
          now,
          defaultWorkspace.value,
        );
        continue;
      }
      if (comparable(existing.root) !== comparable(project.root))
        throw Error(`Colisão de ID de projeto com raiz diferente: ${project.id}`);
      updateProject.run(project.name, project.root, project.gitRoot, project.id);
    }
    db.exec('COMMIT');
  } catch (error) {
    db.exec('ROLLBACK');
    throw error;
  }
}
