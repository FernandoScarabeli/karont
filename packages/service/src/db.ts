import { randomUUID } from "node:crypto";
import { chmodSync, closeSync, lstatSync, openSync } from "node:fs";
import { DatabaseSync } from "node:sqlite";
import type { JsonValue, RecentFolder } from "@karont/contract";

export const migrations: { version: number; up: string }[] = [
  {
    version: 1,
    up: "CREATE TABLE settings (key TEXT PRIMARY KEY, value TEXT NOT NULL, updated_at TEXT NOT NULL) STRICT;",
  },
  {
    version: 2,
    up: "CREATE TABLE agents (id TEXT PRIMARY KEY, name TEXT NOT NULL, command TEXT NOT NULL, created_at TEXT NOT NULL) STRICT;",
  },
  {
    version: 3,
    up: "CREATE TABLE recent_folders (path TEXT PRIMARY KEY, used_at TEXT NOT NULL) STRICT;",
  },
];

export type RecentFolderRecord = Pick<RecentFolder, "path" | "usedAt">;

export type CustomAgentRecord = {
  id: string;
  name: string;
  command: string;
  createdAt: string;
};

export function openDatabase(dbPath: string): DatabaseSync {
  try {
    const existing = lstatSync(dbPath);
    if (existing.isSymbolicLink() || !existing.isFile()) {
      throw new Error("O caminho do banco precisa ser um arquivo regular, sem link simbólico.");
    }
  } catch (error) {
    if (!(error instanceof Error && "code" in error && error.code === "ENOENT")) throw error;
    const fileDescriptor = openSync(dbPath, "wx", 0o600);
    closeSync(fileDescriptor);
  }

  const db = new DatabaseSync(dbPath);
  try {
    chmodSync(dbPath, 0o600);
    db.exec("PRAGMA journal_mode = WAL");
    db.exec("PRAGMA foreign_keys = ON");
    db.exec("PRAGMA busy_timeout = 5000");

    const currentVersion = readUserVersion(db);
    const latestVersion = migrations.at(-1)?.version ?? 0;
    if (currentVersion > latestVersion) {
      throw new Error("O banco foi criado por uma versão mais nova do Karont.");
    }

    for (const migration of migrations) {
      if (migration.version <= currentVersion) continue;
      db.exec("BEGIN IMMEDIATE");
      try {
        db.exec(migration.up);
        db.exec(`PRAGMA user_version = ${migration.version}`);
        db.exec("COMMIT");
      } catch (error) {
        db.exec("ROLLBACK");
        throw error;
      }
    }
    return db;
  } catch (error) {
    db.close();
    throw error;
  }
}

export function getSetting(db: DatabaseSync, key: string): JsonValue | null {
  const row = db.prepare("SELECT value FROM settings WHERE key = ?").get(key) as
    | { value: string }
    | undefined;
  return row ? (JSON.parse(row.value) as JsonValue) : null;
}

export function setSetting(db: DatabaseSync, key: string, value: JsonValue): void {
  const serialized = JSON.stringify(value);
  if (serialized === undefined) throw new TypeError("O valor da configuração não é serializável.");
  db.prepare(
    "INSERT INTO settings (key, value, updated_at) VALUES (?, ?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at",
  ).run(key, serialized, new Date().toISOString());
}

export function listCustomAgents(db: DatabaseSync): CustomAgentRecord[] {
  const rows = db
    .prepare("SELECT id, name, command, created_at FROM agents ORDER BY created_at ASC, rowid ASC")
    .all() as { id: string; name: string; command: string; created_at: string }[];
  return rows.map(({ id, name, command, created_at }) => ({
    id,
    name,
    command,
    createdAt: created_at,
  }));
}

export function addCustomAgent(
  db: DatabaseSync,
  { name, command }: { name: string; command: string },
): CustomAgentRecord {
  const agent = {
    id: `custom-${randomUUID()}`,
    name,
    command,
    createdAt: new Date().toISOString(),
  };
  db.prepare("INSERT INTO agents (id, name, command, created_at) VALUES (?, ?, ?, ?)").run(
    agent.id,
    agent.name,
    agent.command,
    agent.createdAt,
  );
  return agent;
}

export function removeCustomAgent(db: DatabaseSync, id: string): boolean {
  return db.prepare("DELETE FROM agents WHERE id = ?").run(id).changes > 0;
}

export function recordRecentFolder(db: DatabaseSync, folder: RecentFolderRecord): void {
  db.prepare("INSERT OR REPLACE INTO recent_folders (path, used_at) VALUES (?, ?)").run(
    folder.path,
    folder.usedAt,
  );
  db.exec(
    "DELETE FROM recent_folders WHERE path NOT IN (SELECT path FROM recent_folders ORDER BY used_at DESC, rowid DESC LIMIT 50)",
  );
}

export function listRecentFolderRecords(db: DatabaseSync): RecentFolderRecord[] {
  const rows = db
    .prepare("SELECT path, used_at FROM recent_folders ORDER BY used_at DESC, rowid DESC LIMIT 50")
    .all() as { path: string; used_at: string }[];
  return rows.map(({ path, used_at }) => ({ path, usedAt: used_at }));
}

function readUserVersion(db: DatabaseSync): number {
  const row = db.prepare("PRAGMA user_version").get() as { user_version: number };
  return row.user_version;
}
