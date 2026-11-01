import { randomUUID } from "node:crypto";
import { chmodSync, closeSync, lstatSync, openSync } from "node:fs";
import { DatabaseSync } from "node:sqlite";
import type {
  Conversation,
  ConversationMessage,
  JsonValue,
  MessagePart,
  RecentFolder,
} from "@karont/contract";

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
  {
    version: 4,
    up: `CREATE TABLE conversations (
      id TEXT PRIMARY KEY, agent TEXT NOT NULL, title TEXT NOT NULL, cwd TEXT NOT NULL,
      mode TEXT NOT NULL, model TEXT, effort TEXT, state TEXT NOT NULL,
      created_at TEXT NOT NULL, updated_at TEXT NOT NULL
    ) STRICT;
    CREATE TABLE messages (
      id TEXT PRIMARY KEY, conversation_id TEXT NOT NULL REFERENCES conversations(id) ON DELETE CASCADE,
      author TEXT NOT NULL, status TEXT NOT NULL, parts TEXT NOT NULL,
      created_at TEXT NOT NULL, updated_at TEXT NOT NULL
    ) STRICT;
    CREATE INDEX messages_conversation_order ON messages(conversation_id, created_at);
    CREATE TABLE agent_sessions (
      conversation_id TEXT PRIMARY KEY REFERENCES conversations(id) ON DELETE CASCADE,
      session_id TEXT NOT NULL, updated_at TEXT NOT NULL
    ) STRICT;`,
  },
  {
    version: 5,
    up: `ALTER TABLE messages ADD COLUMN started_at_ms INTEGER;
    ALTER TABLE messages ADD COLUMN ended_at_ms INTEGER;`,
  },
];

export type RecentFolderRecord = Pick<RecentFolder, "path" | "usedAt">;

export type CustomAgentRecord = {
  id: string;
  name: string;
  command: string;
  createdAt: string;
};

export type NewConversation = Pick<Conversation, "agent" | "title" | "cwd" | "mode"> &
  Partial<Pick<Conversation, "model" | "effort">>;

export function createConversation(db: DatabaseSync, input: NewConversation): Conversation {
  const now = new Date().toISOString();
  const conversation: Conversation = {
    id: randomUUID(),
    ...input,
    state: "idle",
    createdAt: now,
    updatedAt: now,
  };
  db.prepare(
    "INSERT INTO conversations (id,agent,title,cwd,mode,model,effort,state,created_at,updated_at) VALUES (?,?,?,?,?,?,?,?,?,?)",
  ).run(
    conversation.id,
    conversation.agent,
    conversation.title,
    conversation.cwd,
    conversation.mode,
    conversation.model ?? null,
    conversation.effort ?? null,
    conversation.state,
    now,
    now,
  );
  return conversation;
}

export function getConversation(db: DatabaseSync, id: string): Conversation | null {
  const row = db.prepare("SELECT * FROM conversations WHERE id=?").get(id) as
    | ConversationRow
    | undefined;
  return row ? mapConversation(row) : null;
}

export function listConversations(
  db: DatabaseSync,
  filters: { agent?: string; cwd?: string; limit: number },
): Conversation[] {
  const clauses: string[] = [];
  const values: (string | number)[] = [];
  if (filters.agent) {
    clauses.push("agent=?");
    values.push(filters.agent);
  }
  if (filters.cwd) {
    clauses.push("cwd=?");
    values.push(filters.cwd);
  }
  values.push(filters.limit);
  const rows = db
    .prepare(
      `SELECT * FROM conversations ${clauses.length ? `WHERE ${clauses.join(" AND ")}` : ""} ORDER BY updated_at DESC LIMIT ?`,
    )
    .all(...values) as ConversationRow[];
  return rows.map(mapConversation);
}

export function updateConversation(db: DatabaseSync, conversation: Conversation): void {
  db.prepare(
    "UPDATE conversations SET title=?,mode=?,model=?,effort=?,state=?,updated_at=? WHERE id=?",
  ).run(
    conversation.title,
    conversation.mode,
    conversation.model ?? null,
    conversation.effort ?? null,
    conversation.state,
    conversation.updatedAt,
    conversation.id,
  );
}

export function addMessage(db: DatabaseSync, message: ConversationMessage): void {
  db.prepare(
    "INSERT INTO messages (id,conversation_id,author,status,parts,created_at,updated_at,started_at_ms,ended_at_ms) VALUES (?,?,?,?,?,?,?,?,?)",
  ).run(
    message.id,
    message.conversationId,
    message.author,
    message.status,
    JSON.stringify(message.parts),
    message.createdAt,
    message.updatedAt,
    message.startedAt ?? null,
    message.endedAt ?? null,
  );
}

export function saveMessage(db: DatabaseSync, message: ConversationMessage): void {
  db.prepare(
    "UPDATE messages SET status=?,parts=?,updated_at=?,started_at_ms=?,ended_at_ms=? WHERE id=?",
  ).run(
    message.status,
    JSON.stringify(message.parts),
    message.updatedAt,
    message.startedAt ?? null,
    message.endedAt ?? null,
    message.id,
  );
}

export function getMessage(db: DatabaseSync, id: string): ConversationMessage | null {
  const row = db.prepare("SELECT * FROM messages WHERE id=?").get(id) as MessageRow | undefined;
  return row ? mapMessage(row) : null;
}

export function listMessages(db: DatabaseSync, conversationId: string): ConversationMessage[] {
  return (
    db
      .prepare("SELECT * FROM messages WHERE conversation_id=? ORDER BY created_at ASC,rowid ASC")
      .all(conversationId) as MessageRow[]
  ).map(mapMessage);
}

export function deleteConversation(db: DatabaseSync, id: string): boolean {
  return db.prepare("DELETE FROM conversations WHERE id=?").run(id).changes > 0;
}

export function getAgentSession(db: DatabaseSync, conversationId: string): string | null {
  const row = db
    .prepare("SELECT session_id FROM agent_sessions WHERE conversation_id=?")
    .get(conversationId) as { session_id: string } | undefined;
  return row?.session_id ?? null;
}

export function setAgentSession(db: DatabaseSync, conversationId: string, sessionId: string): void {
  db.prepare(
    "INSERT INTO agent_sessions (conversation_id,session_id,updated_at) VALUES (?,?,?) ON CONFLICT(conversation_id) DO UPDATE SET session_id=excluded.session_id,updated_at=excluded.updated_at",
  ).run(conversationId, sessionId, new Date().toISOString());
}

export function recoverInterruptedMessages(db: DatabaseSync): void {
  const rows = db.prepare("SELECT * FROM messages WHERE status='streaming'").all() as MessageRow[];
  const now = new Date().toISOString();
  for (const row of rows) {
    const message = mapMessage(row);
    const error: MessagePart = {
      id: randomUUID(),
      type: "error",
      errorType: "interrupted",
      text: "Serviço reiniciado durante a resposta. Tente de novo.",
      retryable: true,
      startedAt: Date.parse(now),
      endedAt: Date.parse(now),
    };
    message.parts.push(error);
    message.status = "interrupted";
    message.updatedAt = now;
    message.endedAt = Date.parse(now);
    saveMessage(db, message);
  }
  db.prepare(
    "UPDATE conversations SET state='idle',updated_at=? WHERE state IN ('working','waiting')",
  ).run(now);
}

type ConversationRow = {
  id: string;
  agent: Conversation["agent"];
  title: string;
  cwd: string;
  mode: Conversation["mode"];
  model: string | null;
  effort: Conversation["effort"] | null;
  state: Conversation["state"];
  created_at: string;
  updated_at: string;
};
type MessageRow = {
  id: string;
  conversation_id: string;
  author: ConversationMessage["author"];
  status: ConversationMessage["status"];
  parts: string;
  started_at_ms: number | null;
  ended_at_ms: number | null;
  created_at: string;
  updated_at: string;
};
function mapConversation(row: ConversationRow): Conversation {
  return {
    id: row.id,
    agent: row.agent,
    title: row.title,
    cwd: row.cwd,
    mode: row.mode,
    ...(row.model ? { model: row.model } : {}),
    ...(row.effort ? { effort: row.effort } : {}),
    state: row.state,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}
function mapMessage(row: MessageRow): ConversationMessage {
  return {
    id: row.id,
    conversationId: row.conversation_id,
    author: row.author,
    status: row.status,
    parts: JSON.parse(row.parts) as MessagePart[],
    ...(row.started_at_ms !== null ? { startedAt: row.started_at_ms } : {}),
    ...(row.ended_at_ms !== null ? { endedAt: row.ended_at_ms } : {}),
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

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
    recoverInterruptedMessages(db);
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
