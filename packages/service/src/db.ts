import { randomUUID } from "node:crypto";
import { chmodSync, closeSync, lstatSync, openSync } from "node:fs";
import { DatabaseSync } from "node:sqlite";
import type {
  Conversation,
  ConversationAttachmentMetadata,
  ConversationContextUsage,
  ConversationMessage,
  JsonValue,
  MessagePart,
  Project,
  RecentFolder,
  Workspace,
  Worktree,
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
  {
    version: 11,
    up: `ALTER TABLE conversations ADD COLUMN branched_from_id TEXT;
    ALTER TABLE conversations ADD COLUMN branched_from_message_id TEXT;
    ALTER TABLE conversations ADD COLUMN branch_context_enabled INTEGER NOT NULL DEFAULT 0 CHECK (branch_context_enabled IN (0, 1));
    ALTER TABLE conversations ADD COLUMN branch_context_pending TEXT;
    ALTER TABLE conversations ADD COLUMN fork_pending INTEGER NOT NULL DEFAULT 0 CHECK (fork_pending IN (0, 1));
    ALTER TABLE messages ADD COLUMN agent_turn_id TEXT;`,
  },
  {
    version: 12,
    up: "ALTER TABLE conversations ADD COLUMN fast INTEGER NOT NULL DEFAULT 0 CHECK (fast IN (0, 1));",
  },
  {
    version: 13,
    up: `CREATE TABLE conversation_context_usage (
      conversation_id TEXT PRIMARY KEY REFERENCES conversations(id) ON DELETE CASCADE,
      used_tokens INTEGER NOT NULL CHECK (used_tokens >= 0),
      window_tokens INTEGER NOT NULL CHECK (window_tokens > 0)
    ) STRICT;`,
  },
  {
    version: 14,
    up: `CREATE TABLE projects (
      id TEXT PRIMARY KEY, name TEXT NOT NULL, icon TEXT NOT NULL, path TEXT NOT NULL UNIQUE,
      default_agent TEXT, created_at TEXT NOT NULL, updated_at TEXT NOT NULL
    ) STRICT;
    ALTER TABLE conversations ADD COLUMN project_id TEXT REFERENCES projects(id) ON DELETE SET NULL;
    CREATE INDEX conversations_project ON conversations(project_id);`,
  },
  {
    version: 15,
    up: `CREATE TABLE restore_points (
      message_id TEXT PRIMARY KEY REFERENCES messages(id) ON DELETE CASCADE,
      conversation_id TEXT NOT NULL REFERENCES conversations(id) ON DELETE CASCADE,
      repo_root TEXT, before_commit TEXT, after_commit TEXT, head_before TEXT, head_after TEXT,
      unavailable_reason TEXT,
      concurrent INTEGER NOT NULL DEFAULT 0 CHECK (concurrent IN (0, 1)),
      created_at TEXT NOT NULL, updated_at TEXT NOT NULL
    ) STRICT;
    CREATE INDEX restore_points_conversation ON restore_points(conversation_id, created_at);`,
  },
  {
    version: 16,
    up: `ALTER TABLE restore_points ADD COLUMN changed_files INTEGER NOT NULL DEFAULT 0;
    ALTER TABLE restore_points ADD COLUMN undone_at TEXT;
    ALTER TABLE restore_points ADD COLUMN undo_commit TEXT;`,
  },
  {
    version: 17,
    up: `CREATE TABLE worktrees (
      id TEXT PRIMARY KEY,
      project_id TEXT REFERENCES projects(id) ON DELETE SET NULL,
      repo_root TEXT NOT NULL, path TEXT NOT NULL UNIQUE, branch TEXT NOT NULL,
      base_commit TEXT NOT NULL, created_at TEXT NOT NULL, merged_at TEXT
    ) STRICT;
    CREATE INDEX worktrees_project ON worktrees(project_id);
    ALTER TABLE conversations ADD COLUMN worktree_id TEXT REFERENCES worktrees(id) ON DELETE SET NULL;
    CREATE INDEX conversations_worktree ON conversations(worktree_id);`,
  },
  {
    version: 18,
    up: `CREATE TABLE workspaces (
      id TEXT PRIMARY KEY, name TEXT NOT NULL, icon TEXT NOT NULL,
      position INTEGER NOT NULL, created_at TEXT NOT NULL, updated_at TEXT NOT NULL
    ) STRICT;
    INSERT INTO workspaces (id,name,icon,position,created_at,updated_at)
      VALUES (lower(hex(randomblob(16))),'Pessoal','folder',0,
        strftime('%Y-%m-%dT%H:%M:%fZ','now'),strftime('%Y-%m-%dT%H:%M:%fZ','now'));
    ALTER TABLE projects ADD COLUMN workspace_id TEXT REFERENCES workspaces(id);
    ALTER TABLE conversations ADD COLUMN workspace_id TEXT REFERENCES workspaces(id);
    UPDATE projects SET workspace_id=(SELECT id FROM workspaces ORDER BY position LIMIT 1);
    UPDATE conversations SET workspace_id=(SELECT id FROM workspaces ORDER BY position LIMIT 1);
    CREATE INDEX projects_workspace ON projects(workspace_id);
    CREATE INDEX conversations_workspace ON conversations(workspace_id);`,
  },
];

/** Roda `work` numa transação; desfaz tudo se ela lançar. */
export function inTransaction<T>(db: DatabaseSync, work: () => T): T {
  db.exec("BEGIN IMMEDIATE");
  try {
    const result = work();
    db.exec("COMMIT");
    return result;
  } catch (error) {
    db.exec("ROLLBACK");
    throw error;
  }
}

export type RecentFolderRecord = Pick<RecentFolder, "path" | "usedAt">;

export type CustomAgentRecord = {
  id: string;
  name: string;
  command: string;
  createdAt: string;
};

export type NewConversation = Pick<Conversation, "agent" | "title" | "cwd" | "mode"> &
  Partial<
    Pick<
      Conversation,
      | "model"
      | "effort"
      | "plan"
      | "fast"
      | "branchedFromId"
      | "branchedFromMessageId"
      | "branchContext"
      | "projectId"
      | "workspaceId"
      | "worktreeId"
    >
  >;

export function createConversation(db: DatabaseSync, input: NewConversation): Conversation {
  const now = new Date().toISOString();
  // A conversa de um projeto sempre fica no workspace do projeto; a solta, no pedido ou no primeiro.
  const workspaceId =
    (input.projectId ? getProject(db, input.projectId)?.workspaceId : undefined) ??
    input.workspaceId ??
    defaultWorkspaceId(db);
  const conversation: Conversation = {
    id: randomUUID(),
    ...input,
    workspaceId,
    plan: input.plan ?? false,
    fast: input.fast ?? false,
    pinnedAt: null,
    archivedAt: null,
    unreadAt: null,
    state: "idle",
    createdAt: now,
    updatedAt: now,
  };
  db.prepare(
    "INSERT INTO conversations (id,agent,title,cwd,mode,model,effort,plan,fast,state,created_at,updated_at,title_manually_set,pinned_at,archived_at,unread_at,branched_from_id,branched_from_message_id,branch_context_enabled,project_id,worktree_id,workspace_id) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)",
  ).run(
    conversation.id,
    conversation.agent,
    conversation.title,
    conversation.cwd,
    conversation.mode,
    conversation.model ?? null,
    conversation.effort ?? null,
    conversation.plan ? 1 : 0,
    conversation.fast ? 1 : 0,
    conversation.state,
    now,
    now,
    conversation.title === "Nova conversa" ? 0 : 1,
    conversation.pinnedAt,
    conversation.archivedAt,
    conversation.unreadAt,
    conversation.branchedFromId ?? null,
    conversation.branchedFromMessageId ?? null,
    conversation.branchContext ? 1 : 0,
    conversation.projectId ?? null,
    conversation.worktreeId ?? null,
    conversation.workspaceId,
  );
  return conversation;
}

export function getConversation(db: DatabaseSync, id: string): Conversation | null {
  const row = db.prepare("SELECT * FROM conversations WHERE id=?").get(id) as
    | ConversationRow
    | undefined;
  return row ? mapConversation(row) : null;
}

export function listConversationContextUsage(
  db: DatabaseSync,
): [string, ConversationContextUsage][] {
  const rows = db
    .prepare("SELECT conversation_id, used_tokens, window_tokens FROM conversation_context_usage")
    .all() as { conversation_id: string; used_tokens: number; window_tokens: number }[];
  return rows.map((row) => [
    row.conversation_id,
    {
      usedTokens: row.used_tokens,
      windowTokens: row.window_tokens,
    },
  ]);
}

export function setConversationContextUsage(
  db: DatabaseSync,
  conversationId: string,
  usage: ConversationContextUsage,
): void {
  db.prepare(
    `INSERT INTO conversation_context_usage (conversation_id, used_tokens, window_tokens)
    VALUES (?, ?, ?) ON CONFLICT(conversation_id) DO UPDATE SET
      used_tokens=excluded.used_tokens, window_tokens=excluded.window_tokens`,
  ).run(conversationId, usage.usedTokens, usage.windowTokens);
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

export function listSlotConversationStates(
  db: DatabaseSync,
): { id: string; state: Conversation["state"] }[] {
  return db
    .prepare("SELECT id, state FROM conversations WHERE state IN ('working','waiting')")
    .all() as { id: string; state: Conversation["state"] }[];
}

export function updateConversation(db: DatabaseSync, conversation: Conversation): void {
  db.prepare(
    "UPDATE conversations SET title=?,mode=?,model=?,effort=?,plan=?,fast=?,state=?,updated_at=?,pinned_at=?,archived_at=?,unread_at=? WHERE id=?",
  ).run(
    conversation.title,
    conversation.mode,
    conversation.model ?? null,
    conversation.effort ?? null,
    conversation.plan ? 1 : 0,
    conversation.fast ? 1 : 0,
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
    "INSERT INTO messages (id,conversation_id,author,status,parts,attachments_json,created_at,updated_at,started_at_ms,ended_at_ms,agent_turn_id) VALUES (?,?,?,?,?,?,?,?,?,?,?)",
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
    message.agentTurnId ?? null,
  );
}

export function saveMessage(db: DatabaseSync, message: ConversationMessage): void {
  db.prepare(
    "UPDATE messages SET status=?,parts=?,attachments_json=?,updated_at=?,started_at_ms=?,ended_at_ms=?,agent_turn_id=? WHERE id=?",
  ).run(
    message.status,
    JSON.stringify(message.parts),
    message.attachments ? JSON.stringify(message.attachments) : null,
    message.updatedAt,
    message.startedAt ?? null,
    message.endedAt ?? null,
    message.agentTurnId ?? null,
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

export function listMessagesPage(
  db: DatabaseSync,
  conversationId: string,
  options: { limit: number; before?: string },
): { messages: ConversationMessage[]; hasOlderMessages: boolean } {
  const cursor = options.before
    ? (db
        .prepare("SELECT created_at,rowid FROM messages WHERE conversation_id=? AND id=?")
        .get(conversationId, options.before) as { created_at: string; rowid: number } | undefined)
    : undefined;
  if (options.before && !cursor) return { messages: [], hasOlderMessages: false };

  const rows = cursor
    ? (db
        .prepare(
          "SELECT * FROM messages WHERE conversation_id=? AND (created_at<? OR (created_at=? AND rowid<?)) ORDER BY created_at DESC,rowid DESC LIMIT ?",
        )
        .all(
          conversationId,
          cursor.created_at,
          cursor.created_at,
          cursor.rowid,
          options.limit + 1,
        ) as MessageRow[])
    : (db
        .prepare(
          "SELECT * FROM messages WHERE conversation_id=? ORDER BY created_at DESC,rowid DESC LIMIT ?",
        )
        .all(conversationId, options.limit + 1) as MessageRow[]);
  const hasOlderMessages = rows.length > options.limit;
  const page = rows.slice(0, options.limit).reverse().map(mapMessage);
  return { messages: page, hasOlderMessages };
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

export function getBranchContextPending(db: DatabaseSync, conversationId: string): string | null {
  const row = db
    .prepare("SELECT branch_context_pending FROM conversations WHERE id=?")
    .get(conversationId) as { branch_context_pending: string | null } | undefined;
  return row?.branch_context_pending ?? null;
}

export function completeBranchContext(db: DatabaseSync, conversationId: string): void {
  db.prepare("UPDATE conversations SET branch_context_pending=NULL WHERE id=?").run(conversationId);
}

export function setBranchContextPending(
  db: DatabaseSync,
  conversationId: string,
  context: string,
): void {
  db.prepare("UPDATE conversations SET branch_context_pending=? WHERE id=?").run(
    context,
    conversationId,
  );
}

export function isBranchForkPending(db: DatabaseSync, conversationId: string): boolean {
  const row = db.prepare("SELECT fork_pending FROM conversations WHERE id=?").get(conversationId) as
    | { fork_pending: number }
    | undefined;
  return row?.fork_pending === 1;
}

export function completeBranchFork(db: DatabaseSync, conversationId: string): void {
  db.prepare("UPDATE conversations SET fork_pending=0 WHERE id=?").run(conversationId);
}

export function setBranchSession(
  db: DatabaseSync,
  conversationId: string,
  sessionId: string,
  forkPending: boolean,
): void {
  setAgentSession(db, conversationId, sessionId);
  db.prepare("UPDATE conversations SET fork_pending=? WHERE id=?").run(
    forkPending ? 1 : 0,
    conversationId,
  );
}

export function setMessageAgentTurnId(
  db: DatabaseSync,
  messageId: string,
  agentTurnId: string,
): void {
  db.prepare("UPDATE messages SET agent_turn_id=? WHERE id=?").run(agentTurnId, messageId);
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
    "UPDATE conversations SET state='idle',updated_at=? WHERE state IN ('queued','working','waiting')",
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
  fast: number;
  pinned_at: string | null;
  archived_at: string | null;
  unread_at: string | null;
  branched_from_id: string | null;
  branched_from_message_id: string | null;
  branch_context_enabled: number;
  project_id: string | null;
  worktree_id: string | null;
  workspace_id: string;
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
  agent_turn_id: string | null;
  created_at: string;
  updated_at: string;
};
function mapConversation(row: ConversationRow): Conversation {
  return {
    id: row.id,
    agent: row.agent,
    title: row.title,
    cwd: row.cwd,
    ...(row.project_id ? { projectId: row.project_id } : {}),
    workspaceId: row.workspace_id,
    ...(row.worktree_id ? { worktreeId: row.worktree_id } : {}),
    mode: row.mode,
    ...(row.model ? { model: row.model } : {}),
    ...(row.effort ? { effort: row.effort } : {}),
    plan: row.plan === 1,
    fast: row.fast === 1,
    ...(row.branched_from_id ? { branchedFromId: row.branched_from_id } : {}),
    ...(row.branched_from_message_id
      ? { branchedFromMessageId: row.branched_from_message_id }
      : {}),
    ...(row.branch_context_enabled === 1 ? { branchContext: true } : {}),
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
    ...(row.agent_turn_id ? { agentTurnId: row.agent_turn_id } : {}),
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

type ProjectRow = {
  id: string;
  name: string;
  icon: string;
  path: string;
  default_agent: string | null;
  workspace_id: string;
  created_at: string;
  updated_at: string;
};

function mapProject(row: ProjectRow): Project {
  return {
    id: row.id,
    workspaceId: row.workspace_id,
    name: row.name,
    icon: row.icon,
    path: row.path,
    defaultAgent: row.default_agent,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

export function createProject(
  db: DatabaseSync,
  input: {
    name: string;
    icon: string;
    path: string;
    defaultAgent?: string | null;
    workspaceId?: string;
  },
): Project {
  const now = new Date().toISOString();
  const project: Project = {
    id: randomUUID(),
    workspaceId: input.workspaceId ?? defaultWorkspaceId(db),
    name: input.name,
    icon: input.icon,
    path: input.path,
    defaultAgent: input.defaultAgent ?? null,
    createdAt: now,
    updatedAt: now,
  };
  db.prepare(
    "INSERT INTO projects (id,name,icon,path,default_agent,workspace_id,created_at,updated_at) VALUES (?,?,?,?,?,?,?,?)",
  ).run(
    project.id,
    project.name,
    project.icon,
    project.path,
    project.defaultAgent,
    project.workspaceId,
    now,
    now,
  );
  return project;
}

export function listProjects(db: DatabaseSync): Project[] {
  const rows = db
    .prepare("SELECT * FROM projects ORDER BY name COLLATE NOCASE ASC, name ASC, rowid ASC")
    .all() as ProjectRow[];
  return rows.map(mapProject);
}

export function getProject(db: DatabaseSync, id: string): Project | null {
  const row = db.prepare("SELECT * FROM projects WHERE id=?").get(id) as ProjectRow | undefined;
  return row ? mapProject(row) : null;
}

export function getProjectByPath(db: DatabaseSync, projectPath: string): Project | null {
  const row = db.prepare("SELECT * FROM projects WHERE path=?").get(projectPath) as
    | ProjectRow
    | undefined;
  return row ? mapProject(row) : null;
}

/**
 * Atualiza nome, ícone, agente padrão e workspace. A pasta nunca muda depois de criada.
 * Mover o projeto de workspace move, na mesma transação, as conversas dele.
 */
export function updateProject(
  db: DatabaseSync,
  id: string,
  changes: { name?: string; icon?: string; defaultAgent?: string | null; workspaceId?: string },
): Project | null {
  const current = getProject(db, id);
  if (!current) return null;
  const next = {
    name: changes.name ?? current.name,
    icon: changes.icon ?? current.icon,
    defaultAgent: changes.defaultAgent === undefined ? current.defaultAgent : changes.defaultAgent,
  };
  const workspaceId = changes.workspaceId ?? current.workspaceId;
  inTransaction(db, () => {
    db.prepare(
      "UPDATE projects SET name=?,icon=?,default_agent=?,workspace_id=?,updated_at=? WHERE id=?",
    ).run(next.name, next.icon, next.defaultAgent, workspaceId, new Date().toISOString(), id);
    if (workspaceId !== current.workspaceId) {
      db.prepare("UPDATE conversations SET workspace_id=? WHERE project_id=?").run(workspaceId, id);
    }
  });
  return getProject(db, id);
}

type WorkspaceRow = {
  id: string;
  name: string;
  icon: string;
  position: number;
  created_at: string;
  updated_at: string;
};

function mapWorkspace(row: WorkspaceRow): Workspace {
  return {
    id: row.id,
    name: row.name,
    icon: row.icon,
    position: row.position,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

export function listWorkspaces(db: DatabaseSync): Workspace[] {
  const rows = db
    .prepare("SELECT * FROM workspaces ORDER BY position ASC, rowid ASC")
    .all() as WorkspaceRow[];
  return rows.map(mapWorkspace);
}

export function getWorkspace(db: DatabaseSync, id: string): Workspace | null {
  const row = db.prepare("SELECT * FROM workspaces WHERE id=?").get(id) as WorkspaceRow | undefined;
  return row ? mapWorkspace(row) : null;
}

/** O workspace de menor `position`; a migração 18 garante que sempre existe um. */
export function defaultWorkspaceId(db: DatabaseSync): string {
  const row = db
    .prepare("SELECT id FROM workspaces ORDER BY position ASC, rowid ASC LIMIT 1")
    .get() as { id: string } | undefined;
  if (!row) throw new Error("Não existe nenhum workspace.");
  return row.id;
}

export function createWorkspace(
  db: DatabaseSync,
  input: { name: string; icon: string },
): Workspace {
  const now = new Date().toISOString();
  const next = db
    .prepare("SELECT COALESCE(MAX(position) + 1, 0) AS position FROM workspaces")
    .get() as {
    position: number;
  };
  const workspace: Workspace = {
    id: randomUUID(),
    name: input.name,
    icon: input.icon,
    position: next.position,
    createdAt: now,
    updatedAt: now,
  };
  db.prepare(
    "INSERT INTO workspaces (id,name,icon,position,created_at,updated_at) VALUES (?,?,?,?,?,?)",
  ).run(workspace.id, workspace.name, workspace.icon, workspace.position, now, now);
  return workspace;
}

export function updateWorkspace(
  db: DatabaseSync,
  id: string,
  changes: { name?: string; icon?: string },
): Workspace | null {
  const current = getWorkspace(db, id);
  if (!current) return null;
  db.prepare("UPDATE workspaces SET name=?,icon=?,updated_at=? WHERE id=?").run(
    changes.name ?? current.name,
    changes.icon ?? current.icon,
    new Date().toISOString(),
    id,
  );
  return getWorkspace(db, id);
}

/** Grava a nova ordem (`ids` já validado pelo chamador) numa transação. */
export function reorderWorkspaces(db: DatabaseSync, ids: string[]): void {
  inTransaction(db, () => {
    const update = db.prepare("UPDATE workspaces SET position=? WHERE id=?");
    ids.forEach((id, position) => {
      update.run(position, id);
    });
  });
}

/**
 * Apaga o workspace; projetos e conversas dele vão, na mesma transação, para o
 * workspace restante de menor `position`. Devolve o id de destino, `false` se não
 * existe e `null` se for o último.
 */
export function removeWorkspace(db: DatabaseSync, id: string): string | false | null {
  if (!getWorkspace(db, id)) return false;
  return inTransaction(db, () => {
    const target = db
      .prepare("SELECT id FROM workspaces WHERE id<>? ORDER BY position ASC, rowid ASC LIMIT 1")
      .get(id) as { id: string } | undefined;
    if (!target) return null;
    db.prepare("UPDATE projects SET workspace_id=? WHERE workspace_id=?").run(target.id, id);
    db.prepare("UPDATE conversations SET workspace_id=? WHERE workspace_id=?").run(target.id, id);
    db.prepare("DELETE FROM workspaces WHERE id=?").run(id);
    return target.id;
  });
}

export function removeProject(db: DatabaseSync, id: string): boolean {
  return db.prepare("DELETE FROM projects WHERE id=?").run(id).changes > 0;
}

type WorktreeRow = {
  id: string;
  project_id: string | null;
  repo_root: string;
  path: string;
  branch: string;
  base_commit: string;
  created_at: string;
  merged_at: string | null;
};

function mapWorktree(row: WorktreeRow): Worktree {
  return {
    id: row.id,
    projectId: row.project_id,
    repoRoot: row.repo_root,
    path: row.path,
    branch: row.branch,
    baseCommit: row.base_commit,
    createdAt: row.created_at,
    mergedAt: row.merged_at,
  };
}

export function createWorktreeRecord(
  db: DatabaseSync,
  input: Pick<Worktree, "projectId" | "repoRoot" | "path" | "branch" | "baseCommit"> &
    Partial<Pick<Worktree, "id">>,
): Worktree {
  const worktree: Worktree = {
    id: input.id ?? randomUUID(),
    projectId: input.projectId,
    repoRoot: input.repoRoot,
    path: input.path,
    branch: input.branch,
    baseCommit: input.baseCommit,
    createdAt: new Date().toISOString(),
    mergedAt: null,
  };
  db.prepare(
    "INSERT INTO worktrees (id,project_id,repo_root,path,branch,base_commit,created_at,merged_at) VALUES (?,?,?,?,?,?,?,?)",
  ).run(
    worktree.id,
    worktree.projectId,
    worktree.repoRoot,
    worktree.path,
    worktree.branch,
    worktree.baseCommit,
    worktree.createdAt,
    null,
  );
  return worktree;
}

export function getWorktree(db: DatabaseSync, id: string): Worktree | null {
  const row = db.prepare("SELECT * FROM worktrees WHERE id=?").get(id) as WorktreeRow | undefined;
  return row ? mapWorktree(row) : null;
}

/** Mais novas primeiro. */
export function listWorktrees(db: DatabaseSync, projectId: string): Worktree[] {
  const rows = db
    .prepare("SELECT * FROM worktrees WHERE project_id=? ORDER BY created_at DESC, rowid DESC")
    .all(projectId) as WorktreeRow[];
  return rows.map(mapWorktree);
}

export function deleteWorktreeRecord(db: DatabaseSync, id: string): boolean {
  return db.prepare("DELETE FROM worktrees WHERE id=?").run(id).changes > 0;
}

export function countBusyWorktreeConversations(db: DatabaseSync, worktreeId: string): number {
  const row = db
    .prepare(
      "SELECT COUNT(*) AS count FROM conversations WHERE worktree_id=? AND state IN ('queued','working','waiting')",
    )
    .get(worktreeId) as { count: number };
  return row.count;
}

/** Pastas de trabalho das conversas ocupadas (na fila, trabalhando ou esperando). */
export function busyConversationCwds(db: DatabaseSync): string[] {
  const rows = db
    .prepare("SELECT cwd FROM conversations WHERE state IN ('queued','working','waiting')")
    .all() as { cwd: string | null }[];
  return rows.flatMap((row) => (row.cwd ? [row.cwd] : []));
}

export function markWorktreeMerged(db: DatabaseSync, id: string): Worktree | null {
  db.prepare("UPDATE worktrees SET merged_at=? WHERE id=?").run(new Date().toISOString(), id);
  return getWorktree(db, id);
}

export type RestorePointRecord = {
  messageId: string;
  conversationId: string;
  repoRoot: string | null;
  beforeCommit: string | null;
  afterCommit: string | null;
  headBefore: string | null;
  headAfter: string | null;
  unavailableReason: string | null;
  concurrent: boolean;
  changedFiles: number;
  undoneAt: string | null;
  undoCommit: string | null;
  createdAt: string;
  updatedAt: string;
};

type RestorePointRow = {
  message_id: string;
  conversation_id: string;
  repo_root: string | null;
  before_commit: string | null;
  after_commit: string | null;
  head_before: string | null;
  head_after: string | null;
  unavailable_reason: string | null;
  concurrent: number;
  changed_files: number;
  undone_at: string | null;
  undo_commit: string | null;
  created_at: string;
  updated_at: string;
};

function mapRestorePoint(row: RestorePointRow): RestorePointRecord {
  return {
    messageId: row.message_id,
    conversationId: row.conversation_id,
    repoRoot: row.repo_root,
    beforeCommit: row.before_commit,
    afterCommit: row.after_commit,
    headBefore: row.head_before,
    headAfter: row.head_after,
    unavailableReason: row.unavailable_reason,
    concurrent: row.concurrent === 1,
    changedFiles: row.changed_files,
    undoneAt: row.undone_at,
    undoCommit: row.undo_commit,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

export function createRestorePoint(
  db: DatabaseSync,
  input: {
    messageId: string;
    conversationId: string;
    repoRoot?: string | null;
    beforeCommit?: string | null;
    headBefore?: string | null;
    unavailableReason?: string | null;
    concurrent?: boolean;
    now: string;
  },
): void {
  db.prepare(
    `INSERT INTO restore_points
      (message_id,conversation_id,repo_root,before_commit,head_before,unavailable_reason,concurrent,created_at,updated_at)
      VALUES (?,?,?,?,?,?,?,?,?)`,
  ).run(
    input.messageId,
    input.conversationId,
    input.repoRoot ?? null,
    input.beforeCommit ?? null,
    input.headBefore ?? null,
    input.unavailableReason ?? null,
    input.concurrent ? 1 : 0,
    input.now,
    input.now,
  );
}

export function getRestorePoint(db: DatabaseSync, messageId: string): RestorePointRecord | null {
  const row = db.prepare("SELECT * FROM restore_points WHERE message_id=?").get(messageId) as
    | RestorePointRow
    | undefined;
  return row ? mapRestorePoint(row) : null;
}

/** Devolve falso se a linha não existe mais (conversa apagada durante a foto). */
export function setRestorePointAfter(
  db: DatabaseSync,
  messageId: string,
  afterCommit: string,
  headAfter: string | null,
  now: string,
  changedFiles = 0,
): boolean {
  return (
    db
      .prepare(
        "UPDATE restore_points SET after_commit=?,head_after=?,changed_files=?,updated_at=? WHERE message_id=?",
      )
      .run(afterCommit, headAfter, changedFiles, now, messageId).changes > 0
  );
}

/** Guarda a foto de segurança do desfazer antes de qualquer arquivo ser tocado. */
export function setRestorePointUndoCommit(
  db: DatabaseSync,
  messageId: string,
  undoCommit: string,
  now: string,
): boolean {
  return (
    db
      .prepare("UPDATE restore_points SET undo_commit=?,updated_at=? WHERE message_id=?")
      .run(undoCommit, now, messageId).changes > 0
  );
}

export function setRestorePointUndone(db: DatabaseSync, messageId: string, now: string): boolean {
  return (
    db
      .prepare("UPDATE restore_points SET undone_at=?,updated_at=? WHERE message_id=?")
      .run(now, now, messageId).changes > 0
  );
}

export function markRestorePointsConcurrent(
  db: DatabaseSync,
  messageIds: readonly string[],
  now: string,
): void {
  const statement = db.prepare(
    "UPDATE restore_points SET concurrent=1,updated_at=? WHERE message_id=?",
  );
  for (const messageId of messageIds) statement.run(now, messageId);
}

export function listRestorePoints(db: DatabaseSync, conversationId: string): RestorePointRecord[] {
  const rows = db
    .prepare(
      "SELECT * FROM restore_points WHERE conversation_id=? ORDER BY created_at ASC, rowid ASC",
    )
    .all(conversationId) as RestorePointRow[];
  return rows.map(mapRestorePoint);
}

/** Pontos além dos `keep` mais novos da conversa, do mais antigo para o mais novo. */
export function listExcessRestorePoints(
  db: DatabaseSync,
  conversationId: string,
  keep: number,
): RestorePointRecord[] {
  const rows = db
    .prepare(
      `SELECT * FROM restore_points WHERE conversation_id=?
        ORDER BY created_at DESC, rowid DESC LIMIT -1 OFFSET ?`,
    )
    .all(conversationId, keep) as RestorePointRow[];
  return rows.map(mapRestorePoint).reverse();
}

export function deleteRestorePoints(db: DatabaseSync, messageIds: readonly string[]): void {
  const statement = db.prepare("DELETE FROM restore_points WHERE message_id=?");
  for (const messageId of messageIds) statement.run(messageId);
}

function readUserVersion(db: DatabaseSync): number {
  const row = db.prepare("PRAGMA user_version").get() as { user_version: number };
  return row.user_version;
}
