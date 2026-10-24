import fs from 'node:fs';
import path from 'node:path';
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
  if (version > 4) throw Error('Banco de dados criado por uma versão mais nova do eros');
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
  const upsertProject = db.prepare(
    'INSERT INTO projects(id,name,root,git_root,created_at) VALUES(?,?,?,?,?) ON CONFLICT(id) DO UPDATE SET name=excluded.name,root=excluded.root,git_root=excluded.git_root',
  );
  db.exec('BEGIN');
  try {
    const now = Date.now();
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
    for (const project of projects)
      upsertProject.run(project.id, project.name, project.root, project.gitRoot, now);
    db.exec('COMMIT');
  } catch (error) {
    db.exec('ROLLBACK');
    throw error;
  }
}
