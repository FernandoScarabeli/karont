import type { DatabaseSync } from "node:sqlite";
import {
  type ConversationMessage,
  SEARCH_LIMIT_DEFAULT,
  type SearchConversationResult,
  type SearchMessageResult,
  type SearchProjectResult,
  type SearchResult,
  type SearchSnippetSegment,
} from "@karont/contract";

// Caracteres privados: nunca aparecem em texto normal e não são sintaxe do FTS5.
const MARK_START = "";
const MARK_END = "";
const SNIPPET_MAX_CHARS = 160;
const SNIPPET_TOKENS = 20;
const MAX_TERMS = 8;
const MAX_TITLE_SCAN = 20_000;

/** Texto indexável: só partes `text` (nada de saída de comando, diff, anexo ou raciocínio). */
export function searchableText(parts: ConversationMessage["parts"]): string {
  const texts: string[] = [];
  if (!Array.isArray(parts)) return "";
  for (const part of parts) {
    if (part && part.type === "text" && typeof part.markdown === "string") {
      texts.push(part.markdown);
    }
  }
  return texts.join("\n").replaceAll(MARK_START, "").replaceAll(MARK_END, "");
}

/** Reindexa a mensagem. Mensagem em andamento não passa por aqui: ver `indexMessageIfFinished`. */
export function indexMessage(db: DatabaseSync, message: ConversationMessage): void {
  const text = searchableText(message.parts);
  const existing = db
    .prepare("SELECT fts_rowid FROM message_search_map WHERE message_id=?")
    .get(message.id) as { fts_rowid: number } | undefined;
  if (!text.trim()) {
    if (existing) {
      db.prepare("DELETE FROM message_search WHERE rowid=?").run(existing.fts_rowid);
      db.prepare("DELETE FROM message_search_map WHERE message_id=?").run(message.id);
    }
    return;
  }
  if (existing) {
    db.prepare("DELETE FROM message_search WHERE rowid=?").run(existing.fts_rowid);
    db.prepare("INSERT INTO message_search (rowid, text) VALUES (?, ?)").run(
      existing.fts_rowid,
      text,
    );
    return;
  }
  const inserted = db
    .prepare("INSERT INTO message_search_map (message_id) VALUES (?)")
    .run(message.id);
  db.prepare("INSERT INTO message_search (rowid, text) VALUES (?, ?)").run(
    inserted.lastInsertRowid,
    text,
  );
}

/** Mensagem `streaming` só entra no índice quando termina (`done`, `error` ou `interrupted`). */
export function indexMessageIfFinished(db: DatabaseSync, message: ConversationMessage): void {
  if (message.status === "streaming") return;
  indexMessage(db, message);
}

function normalize(text: string): string {
  return text.normalize("NFD").replace(/\p{M}/gu, "").toLowerCase();
}

/** Termos do usuário; só letras e números chegam ao FTS. */
export function searchTerms(query: string): string[] {
  const terms = query.match(/[\p{L}\p{N}\p{M}]+/gu) ?? [];
  return terms.slice(0, MAX_TERMS);
}

function ftsExpression(terms: string[]): string {
  return terms.map((term) => `"${term}"*`).join(" AND ");
}

function toSegments(raw: string): SearchSnippetSegment[] {
  const segments: SearchSnippetSegment[] = [];
  let match = false;
  for (const piece of raw.replace(/\s+/g, " ").split(/([])/u)) {
    if (piece === MARK_START) match = true;
    else if (piece === MARK_END) match = false;
    else if (piece) segments.push({ text: piece, match });
  }
  return segments;
}

/** Recorta para ~160 caracteres (por pontos de código, sem quebrar acentos), mantendo o primeiro destaque. */
export function clipSegments(
  segments: SearchSnippetSegment[],
  max = SNIPPET_MAX_CHARS,
): SearchSnippetSegment[] {
  const chars = segments.flatMap((segment) =>
    Array.from(segment.text, (char) => ({ char, match: segment.match })),
  );
  if (chars.length <= max) return segments;
  const firstMatch = chars.findIndex((item) => item.match);
  const start = Math.max(0, Math.min(firstMatch < 0 ? 0 : firstMatch - 40, chars.length - max));
  const window = chars.slice(start, start + max);
  const result: SearchSnippetSegment[] = [];
  const push = (text: string, match: boolean) => {
    const last = result.at(-1);
    if (last && last.match === match) last.text += text;
    else result.push({ text, match });
  };
  if (start > 0) push("…", false);
  for (const item of window) push(item.char, item.match);
  if (start + max < chars.length) push("…", false);
  return result;
}

type MessageHit = {
  message_id: string;
  snip: string;
  author: "user" | "agent";
  created_at: string;
  conversation_id: string;
  title: string;
  workspace_id: string;
  project_id: string | null;
  agent: "claude" | "codex";
  archived_at: string | null;
};

type ConversationHit = {
  id: string;
  title: string;
  workspace_id: string;
  project_id: string | null;
  agent: "claude" | "codex";
  archived_at: string | null;
  updated_at: string;
};

type ProjectHit = { id: string; name: string; icon: string; workspace_id: string };

export function searchAll(
  db: DatabaseSync,
  query: string,
  limit: number = SEARCH_LIMIT_DEFAULT,
): SearchResult {
  const terms = searchTerms(query);
  if (terms.length === 0) return { conversations: [], projects: [], messages: [] };
  const normalizedTerms = terms.map(normalize);
  const matches = (text: string) => {
    const normalized = normalize(text);
    return normalizedTerms.every((term) => normalized.includes(term));
  };

  const conversations: SearchConversationResult[] = (
    db
      .prepare(
        "SELECT id,title,workspace_id,project_id,agent,archived_at,updated_at FROM conversations ORDER BY (archived_at IS NOT NULL) ASC, updated_at DESC LIMIT ?",
      )
      .all(MAX_TITLE_SCAN) as ConversationHit[]
  )
    .filter((row) => matches(row.title))
    .slice(0, limit)
    .map((row) => ({
      conversationId: row.id,
      title: row.title,
      workspaceId: row.workspace_id,
      ...(row.project_id ? { projectId: row.project_id } : {}),
      agent: row.agent,
      archived: row.archived_at !== null,
      updatedAt: row.updated_at,
    }));

  const projects: SearchProjectResult[] = (
    db
      .prepare("SELECT id,name,icon,workspace_id FROM projects ORDER BY name COLLATE NOCASE ASC")
      .all() as ProjectHit[]
  )
    .filter((row) => matches(row.name))
    .slice(0, limit)
    .map((row) => ({
      projectId: row.id,
      name: row.name,
      icon: row.icon,
      workspaceId: row.workspace_id,
    }));

  const hits = db
    .prepare(
      `SELECT map.message_id AS message_id,
        snippet(message_search, 0, '${MARK_START}', '${MARK_END}', '…', ${SNIPPET_TOKENS}) AS snip,
        m.author AS author, m.created_at AS created_at, c.id AS conversation_id, c.title AS title,
        c.workspace_id AS workspace_id, c.project_id AS project_id, c.agent AS agent,
        c.archived_at AS archived_at
      FROM message_search
      JOIN message_search_map map ON map.fts_rowid = message_search.rowid
      JOIN messages m ON m.id = map.message_id
      JOIN conversations c ON c.id = m.conversation_id
      WHERE message_search MATCH ?
      ORDER BY message_search.rank ASC, m.created_at DESC
      LIMIT ?`,
    )
    .all(ftsExpression(terms), limit) as MessageHit[];
  const messages: SearchMessageResult[] = hits.map((row) => ({
    messageId: row.message_id,
    conversationId: row.conversation_id,
    conversationTitle: row.title,
    workspaceId: row.workspace_id,
    ...(row.project_id ? { projectId: row.project_id } : {}),
    agent: row.agent,
    archived: row.archived_at !== null,
    author: row.author,
    createdAt: row.created_at,
    snippet: clipSegments(toSegments(row.snip)),
  }));

  return { conversations, projects, messages };
}
