import { randomUUID } from "node:crypto";
import { chmodSync, closeSync, lstatSync, openSync } from "node:fs";
import { DatabaseSync } from "node:sqlite";
import type {
  Conversation,
  ConversationAttachmentMetadata,
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
  {
    version: 6,
    up: "ALTER TABLE messages ADD COLUMN attachments_json TEXT;",
  },
  {
    version: 7,
    up: "ALTER TABLE conversations ADD COLUMN plan INTEGER NOT NULL DEFAULT 0 CHECK (plan IN (0, 1));",
  },
  {
    version: 8,
    up: "ALTER TABLE conversations ADD COLUMN title_manually_set INTEGER NOT NULL DEFAULT 0 CHECK (title_manually_set IN (0, 1));",
  },
  {
    version: 9,
    up: `ALTER TABLE conversations ADD COLUMN pinned_at TEXT;
    ALTER TABLE conversations ADD COLUMN archived_at TEXT;`,
  },
  {
    version: 10,
    up: "ALTER TABLE conversations ADD COLUMN unread_at TEXT;",
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
  Partial<Pick<Conversation, "model" | "effort" | "plan">>;

export function createConversation(db: DatabaseSync, input: NewConversation): Conversation {
  const now = new Date().toISOString();
  const conversation: Conversation = {
    id: randomUUID(),
    ...input,
    plan: input.plan ?? false,
    pinnedAt: null,
    archivedAt: null,
    unreadAt: null,
    state: "idle",
    createdAt: now,
    updatedAt: now,
  };
  db.prepare(
    "INSERT INTO conversations (id,agent,title,cwd,mode,model,effort,plan,state,created_at,updated_at,title_manually_set,pinned_at,archived_at,unread_at) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)",
  ).run(
    conversation.id,
    conversation.agent,
    conversation.title,
    conversation.cwd,
    conversation.mode,
    conversation.model ?? null,
    conversation.effort ?? null,
    conversation.plan ? 1 : 0,
    conversation.state,
    now,
    now,
    conversation.title === "Nova conversa" ? 0 : 1,
    conversation.pinnedAt,
    conversation.archivedAt,
    conversation.unreadAt,
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
  filters: { agent?: string; cwd?: string; archived?: boolean; limit: number },
): Conversation[] {
  const clauses: string[] = [];
  const values: (string | number)[] = [];
  clauses.push(filters.archived ? "archived_at IS NOT NULL" : "archived_at IS NULL");
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
      `SELECT * FROM conversations WHERE ${clauses.join(" AND ")} ORDER BY CASE WHEN pinned_at IS NULL THEN 1 ELSE 0 END, pinned_at DESC, updated_at DESC LIMIT ?`,
    )
    .all(...values) as ConversationRow[];
  return rows.map(mapConversation);
}

export function countConversations(db: DatabaseSync): number {
  const row = db.prepare("SELECT COUNT(*) AS count FROM conversations").get() as
    | { count: number }
    | undefined;
  return row?.count ?? 0;
}

export function listConversationStates(
  db: DatabaseSync,
): { id: string; state: Conversation["state"] }[] {
  return db.prepare("SELECT id, state FROM conversations").all() as {
    id: string;
    state: Conversation["state"];
  }[];
}

export function updateConversation(db: DatabaseSync, conversation: Conversation): void {
  db.prepare(
    "UPDATE conversations SET title=?,mode=?,model=?,effort=?,plan=?,state=?,updated_at=?,pinned_at=?,archived_at=?,unread_at=? WHERE id=?",
  ).run(
    conversation.title,
    conversation.mode,
    conversation.model ?? null,
    conversation.effort ?? null,
    conversation.plan ? 1 : 0,
    conversation.state,
    conversation.updatedAt,
    conversation.pinnedAt,
    conversation.archivedAt,
    conversation.unreadAt,
    conversation.id,
  );
}

export function markConversationSeen(
  db: DatabaseSync,
  id: string,
): { conversation: Conversation | null; changed: boolean } {
  const changed =
    db
      .prepare("UPDATE conversations SET unread_at=NULL WHERE id=? AND unread_at IS NOT NULL")
      .run(id).changes > 0;
  return { conversation: getConversation(db, id), changed };
}

export function setConversationTitle(
  db: DatabaseSync,
  id: string,
  title: string,
  updatedAt: string,
  manual: boolean,
): Conversation | null {
  const result = manual
    ? db
        .prepare("UPDATE conversations SET title=?,title_manually_set=1,updated_at=? WHERE id=?")
        .run(title, updatedAt, id)
    : db
        .prepare(
          "UPDATE conversations SET title=?,updated_at=? WHERE id=? AND title_manually_set=0 AND title='Nova conversa'",
        )
        .run(title, updatedAt, id);
  if (result.changes === 0) return null;
  return getConversation(db, id);
}

export function addMessage(db: DatabaseSync, message: ConversationMessage): void {
  db.prepare(
    "INSERT INTO messages (id,conversation_id,author,status,parts,attachments_json,created_at,updated_at,started_at_ms,ended_at_ms) VALUES (?,?,?,?,?,?,?,?,?,?)",
  ).run(
    message.id,
    message.conversationId,
    message.author,
    message.status,
    JSON.stringify(message.parts),
    message.attachments ? JSON.stringify(message.attachments) : null,
    message.createdAt,
    message.updatedAt,
    message.startedAt ?? null,
    message.endedAt ?? null,
  );
}

export function saveMessage(db: DatabaseSync, message: ConversationMessage): void {
  db.prepare(
    "UPDATE messages SET status=?,parts=?,attachments_json=?,updated_at=?,started_at_ms=?,ended_at_ms=? WHERE id=?",
  ).run(
    message.status,
    JSON.stringify(message.parts),
    message.attachments ? JSON.stringify(message.attachments) : null,
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

export function deleteAllConversations(db: DatabaseSync): number {
  db.exec("BEGIN IMMEDIATE");
  try {
    const changes = db.prepare("DELETE FROM conversations").run().changes;
    const deleted = typeof changes === "bigint" ? Number(changes) : changes;
    if (!Number.isSafeInteger(deleted)) throw new Error("A quantidade de conversas é inválida.");
    db.exec("COMMIT");
    return deleted;
  } catch (error) {
    db.exec("ROLLBACK");
    throw error;
  }
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
  plan: number;
  pinned_at: string | null;
  archived_at: string | null;
  unread_at: string | null;
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
  attachments_json: string | null;
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
    plan: row.plan === 1,
    pinnedAt: row.pinned_at,
    archivedAt: row.archived_at,
    unreadAt: row.unread_at,
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
    ...(row.attachments_json
      ? { attachments: JSON.parse(row.attachments_json) as ConversationAttachmentMetadata[] }
      : {}),
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
