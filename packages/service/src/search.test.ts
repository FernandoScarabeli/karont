import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { DatabaseSync } from "node:sqlite";
import { test } from "node:test";
import type { ConversationMessage, MessagePart } from "@karont/contract";
import {
  addMessage,
  createConversation,
  createProject,
  deleteAllConversations,
  deleteConversation,
  migrations,
  openDatabase,
  saveMessage,
  updateConversation,
} from "./db.ts";
import { clipSegments, searchAll } from "./search.ts";

async function setup(context: { after(fn: () => void | Promise<void>): void }) {
  const root = await mkdtemp(path.join(os.tmpdir(), "karont-search-"));
  const db = openDatabase(path.join(root, "karont.db"));
  context.after(async () => {
    db.close();
    await rm(root, { recursive: true, force: true });
  });
  return db;
}

let counter = 0;
function message(
  conversationId: string,
  parts: MessagePart[],
  extra: Partial<ConversationMessage> = {},
): ConversationMessage {
  counter += 1;
  const stamp = new Date(Date.UTC(2026, 10, 9, 12, 0, counter)).toISOString();
  return {
    id: `m-${counter}`,
    conversationId,
    author: "agent",
    status: "done",
    parts,
    createdAt: stamp,
    updatedAt: stamp,
    ...extra,
  };
}
const text = (markdown: string): MessagePart => ({
  id: `p-${++counter}`,
  type: "text",
  markdown,
});
const chat = (db: ReturnType<typeof openDatabase>, title = "Conversa") =>
  createConversation(db, { agent: "claude", title, cwd: "/tmp", mode: "edit" });
const messageIds = (db: ReturnType<typeof openDatabase>, query: string, limit?: number) =>
  searchAll(db, query, limit).messages.map((item) => item.messageId);

test("FTS5 está disponível no node:sqlite", () => {
  const db = new DatabaseSync(":memory:");
  db.exec("CREATE VIRTUAL TABLE t USING fts5(x, tokenize='unicode61 remove_diacritics 2')");
  db.prepare("INSERT INTO t (x) VALUES (?)").run("ação");
  assert.equal(db.prepare("SELECT count(*) AS n FROM t WHERE t MATCH '\"acao\"'").get()?.n, 1);
  db.close();
});

test("acha sem diferenciar acento e maiúsculas, por prefixo e com dois termos", async (context) => {
  const db = await setup(context);
  const c = chat(db);
  const a = message(c.id, [text("Precisamos de uma AÇÃO imediata no servidor")], {
    author: "user",
  });
  const b = message(c.id, [text("Outra coisa: configuração do banco")]);
  addMessage(db, a);
  addMessage(db, b);
  assert.deepEqual(messageIds(db, "acao"), [a.id]);
  assert.deepEqual(messageIds(db, "AÇÃO"), [a.id]);
  assert.deepEqual(messageIds(db, "config"), [b.id]);
  assert.deepEqual(messageIds(db, "acao servidor"), [a.id]);
  assert.deepEqual(messageIds(db, "acao banco"), []);
});

test("entradas hostis não lançam erro", async (context) => {
  const db = await setup(context);
  const c = chat(db);
  addMessage(db, message(c.id, [text("texto qualquer AND OR NOT x")]));
  for (const query of ['"', "*", "AND", "(", "-x", "   ", "...", '")', "NEAR(", "a:b", "x*y\"'"]) {
    assert.doesNotThrow(() => searchAll(db, query), query);
  }
  for (const query of ['"', "*", "(", "   ", "...", "--"]) {
    assert.deepEqual(searchAll(db, query), { conversations: [], projects: [], messages: [] });
  }
  assert.equal(searchAll(db, "AND").messages.length, 1);
});

test("só partes de texto entram no índice", async (context) => {
  const db = await setup(context);
  const c = chat(db);
  const m = message(c.id, [
    text("resposta visível"),
    {
      id: "act",
      type: "action",
      actionType: "command",
      title: "ls",
      input: "ls segredoentrada",
      output: "segredosaida",
      truncated: false,
      state: "ok",
      durationMs: 1,
    },
    { id: "th", type: "thinking", text: "segredopensamento" },
  ]);
  addMessage(db, m);
  assert.deepEqual(messageIds(db, "visível"), [m.id]);
  assert.deepEqual(messageIds(db, "segredosaida"), []);
  assert.deepEqual(messageIds(db, "segredoentrada"), []);
  assert.deepEqual(messageIds(db, "segredopensamento"), []);
});

test("mensagem em andamento só é indexada quando termina", async (context) => {
  const db = await setup(context);
  const c = chat(db);
  const m = message(c.id, [text("parcial banana")], { status: "streaming" });
  addMessage(db, m);
  assert.deepEqual(messageIds(db, "banana"), []);
  m.parts = [text("parcial banana maçã")];
  saveMessage(db, m);
  assert.deepEqual(messageIds(db, "maca"), []);
  m.status = "done";
  saveMessage(db, m);
  assert.deepEqual(messageIds(db, "maca"), [m.id]);
  // reindexar substitui, sem duplicar
  m.parts = [text("agora só laranja")];
  saveMessage(db, m);
  assert.deepEqual(messageIds(db, "maca"), []);
  assert.deepEqual(messageIds(db, "laranja"), [m.id]);
  // interrompida e com erro também entram
  for (const status of ["interrupted", "error"] as const) {
    const other = message(c.id, [text(`final ${status}xyz`)], { status: "streaming" });
    addMessage(db, other);
    other.status = status;
    saveMessage(db, other);
    assert.deepEqual(messageIds(db, `${status}xyz`), [other.id]);
  }
});

test("mensagem recuperada como interrompida ao reiniciar entra no índice", async (context) => {
  const root = await mkdtemp(path.join(os.tmpdir(), "karont-search-recover-"));
  context.after(() => rm(root, { recursive: true, force: true }));
  const dbPath = path.join(root, "karont.db");
  let db = openDatabase(dbPath);
  const c = chat(db);
  const m = message(c.id, [text("resposta pela metade abacaxi")], { status: "streaming" });
  addMessage(db, m);
  assert.deepEqual(messageIds(db, "abacaxi"), []);
  db.close();
  db = openDatabase(dbPath);
  context.after(() => db.close());
  assert.deepEqual(messageIds(db, "abacaxi"), [m.id]);
});

test("apagar conversa, em cascata e deleteAll, tira do índice", async (context) => {
  const db = await setup(context);
  const count = () =>
    (db.prepare("SELECT count(*) AS n FROM message_search").get() as { n: number }).n;
  const mapCount = () =>
    (db.prepare("SELECT count(*) AS n FROM message_search_map").get() as { n: number }).n;
  const c1 = chat(db);
  const c2 = chat(db);
  addMessage(db, message(c1.id, [text("alfa")]));
  addMessage(db, message(c1.id, [text("alfa beta")]));
  addMessage(db, message(c2.id, [text("alfa gama")]));
  assert.equal(count(), 3);
  db.prepare("DELETE FROM messages WHERE id=?").run("m-" + (counter - 2 - 0));
  assert.equal(count(), 2);
  assert.equal(deleteConversation(db, c1.id), true);
  assert.equal(count(), 1);
  assert.equal(mapCount(), 1);
  assert.equal(searchAll(db, "alfa").messages.length, 1);
  deleteAllConversations(db);
  assert.equal(count(), 0);
  assert.equal(mapCount(), 0);
  assert.deepEqual(searchAll(db, "alfa").messages, []);
});

test("conversas e projetos: título sem acento/caixa, arquivadas marcadas e ordem", async (context) => {
  const db = await setup(context);
  const old = chat(db, "Revisão do Código");
  const recent = chat(db, "codigo novo");
  const archived = chat(db, "CÓDIGO velho");
  archived.archivedAt = "2026-11-09T10:00:00.000Z";
  archived.updatedAt = "2026-11-09T23:00:00.000Z";
  updateConversation(db, archived);
  old.updatedAt = "2026-11-01T00:00:00.000Z";
  updateConversation(db, old);
  recent.updatedAt = "2026-11-08T00:00:00.000Z";
  updateConversation(db, recent);
  chat(db, "outra coisa");
  const project = createProject(db, {
    name: "Código Aberto",
    icon: "code",
    path: "/tmp/p",
    defaultAgent: "claude",
  } as Parameters<typeof createProject>[1]);
  const result = searchAll(db, "codigo");
  assert.deepEqual(
    result.conversations.map((item) => [item.title, item.archived]),
    [
      ["codigo novo", false],
      ["Revisão do Código", false],
      ["CÓDIGO velho", true],
    ],
  );
  assert.deepEqual(
    result.projects.map((item) => item.projectId),
    [project.id],
  );
  assert.equal(searchAll(db, "codigo", 2).conversations.length, 2);
});

test("mensagens de conversa arquivada vêm marcadas; limite vale", async (context) => {
  const db = await setup(context);
  const c = chat(db);
  c.archivedAt = "2026-11-09T10:00:00.000Z";
  updateConversation(db, c);
  for (let i = 0; i < 5; i += 1) addMessage(db, message(c.id, [text(`pera ${i}`)]));
  const all = searchAll(db, "pera", 50).messages;
  assert.equal(all.length, 5);
  assert.ok(all.every((item) => item.archived && item.conversationTitle === c.title));
  assert.equal(searchAll(db, "pera", 3).messages.length, 3);
  // desempate pela mais recente (mesma relevância)
  assert.ok(all[0] && all[1] && all[0].createdAt >= all[1].createdAt);
});

test("trecho vem em segmentos, com destaque e sem HTML", async (context) => {
  const db = await setup(context);
  const c = chat(db);
  addMessage(db, message(c.id, [text("Veja a <b>ação</b> rápida\ncom calma")]));
  const [hit] = searchAll(db, "acao").messages;
  assert.ok(hit);
  assert.equal(hit.snippet.map((s) => s.text).join(""), "Veja a <b>ação</b> rápida com calma");
  assert.deepEqual(
    hit.snippet.filter((s) => s.match).map((s) => s.text),
    ["ação"],
  );
  assert.ok(hit.snippet.every((s) => !/[]/.test(s.text)));
});

test("clipSegments recorta perto do destaque, sem quebrar acentos", () => {
  const long = "ção ".repeat(100);
  const clipped = clipSegments([
    { text: long, match: false },
    { text: "alvo", match: true },
    { text: long, match: false },
  ]);
  const joined = clipped.map((s) => s.text).join("");
  assert.ok(Array.from(joined).length <= 162);
  assert.ok(clipped.some((s) => s.match && s.text === "alvo"));
  assert.ok(!joined.includes("�"));
});

test("migração 20 preenche o índice sobre banco com dados e tolera JSON inesperado", async (context) => {
  const root = await mkdtemp(path.join(os.tmpdir(), "karont-search-migrate-"));
  context.after(() => rm(root, { recursive: true, force: true }));
  const dbPath = path.join(root, "karont.db");
  const old = new DatabaseSync(dbPath);
  for (const migration of migrations.filter((entry) => entry.version <= 19)) {
    old.exec(migration.up);
    old.exec(`PRAGMA user_version = ${migration.version}`);
  }
  const workspace = old.prepare("SELECT id FROM workspaces LIMIT 1").get() as { id: string };
  old
    .prepare(
      "INSERT INTO conversations (id,agent,title,cwd,mode,state,created_at,updated_at,workspace_id) VALUES ('c','claude','T','/tmp','edit','idle','2026-11-01T00:00:00.000Z','2026-11-01T00:00:00.000Z',?)",
    )
    .run(workspace.id);
  const insert = old.prepare(
    "INSERT INTO messages (id,conversation_id,author,status,parts,created_at,updated_at) VALUES (?,'c','agent',?,?,'2026-11-01T00:00:00.000Z','2026-11-01T00:00:00.000Z')",
  );
  insert.run("ok", "done", JSON.stringify([{ id: "1", type: "text", markdown: "Ação antiga" }]));
  insert.run("bad-json", "done", "{isso não é json");
  insert.run("not-array", "done", JSON.stringify({ type: "text", markdown: "solto" }));
  insert.run(
    "weird",
    "done",
    JSON.stringify([null, 3, "x", { type: "text", markdown: 5 }, { type: "text" }, [1]]),
  );
  insert.run(
    "stream",
    "streaming",
    JSON.stringify([{ id: "2", type: "text", markdown: "pendente" }]),
  );
  insert.run(
    "cmd",
    "done",
    JSON.stringify([{ id: "3", type: "action", output: "saidasecreta", input: "x" }]),
  );
  old.close();
  const db = openDatabase(dbPath);
  context.after(() => db.close());
  assert.deepEqual(messageIds(db, "acao"), ["ok"]);
  assert.deepEqual(messageIds(db, "solto"), []);
  assert.deepEqual(messageIds(db, "saidasecreta"), []);
  // a em andamento virou interrompida na recuperação e foi indexada
  assert.deepEqual(messageIds(db, "pendente"), ["stream"]);
});
