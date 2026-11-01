import assert from "node:assert/strict";
import { mkdtemp, stat } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { DatabaseSync } from "node:sqlite";
import { test } from "node:test";
import {
  addCustomAgent,
  createConversation,
  getConversation,
  getSetting,
  listCustomAgents,
  listMessages,
  listRecentFolderRecords,
  migrations,
  openDatabase,
  recordRecentFolder,
  removeCustomAgent,
  setSetting,
} from "./db.ts";

test("migra settings e pastas recentes, persiste user_version e permite reabrir", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "ks-"));
  const dbPath = path.join(root, "karont.db");
  let db = openDatabase(dbPath);
  assert.equal(
    (db.prepare("PRAGMA user_version").get() as { user_version: number }).user_version,
    7,
  );
  assert.equal(
    (
      db
        .prepare("SELECT name FROM sqlite_master WHERE type = 'table' AND name = ?")
        .get("recent_folders") as { name: string } | undefined
    )?.name,
    "recent_folders",
  );
  const messageColumns = new Set(
    (db.prepare("PRAGMA table_info(messages)").all() as { name: string }[]).map(
      (column) => column.name,
    ),
  );
  assert.ok(messageColumns.has("started_at_ms"));
  assert.ok(messageColumns.has("ended_at_ms"));
  assert.ok(messageColumns.has("attachments_json"));
  setSetting(db, "appearance.theme", { mode: "dark", enabled: true });
  assert.deepEqual(getSetting(db, "appearance.theme"), { mode: "dark", enabled: true });
  assert.equal((await stat(dbPath)).mode & 0o777, 0o600);
  db.close();

  db = openDatabase(dbPath);
  assert.deepEqual(getSetting(db, "appearance.theme"), { mode: "dark", enabled: true });
  db.close();
});

test("migrações 2 e 3 aplicam sobre a versão 1", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "ks-"));
  const dbPath = path.join(root, "karont.db");
  const versionOneDb = new DatabaseSync(dbPath);
  versionOneDb.exec(
    "CREATE TABLE settings (key TEXT PRIMARY KEY, value TEXT NOT NULL, updated_at TEXT NOT NULL) STRICT; PRAGMA user_version = 1;",
  );
  versionOneDb.close();

  const db = openDatabase(dbPath);
  assert.equal(
    (db.prepare("PRAGMA user_version").get() as { user_version: number }).user_version,
    7,
  );
  assert.deepEqual(listCustomAgents(db), []);
  db.close();
});

test("migra conversas antigas sem perder preferências existentes nem mensagens", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "ks-legacy-conversations-"));
  const dbPath = path.join(root, "karont.db");
  const legacyDb = new DatabaseSync(dbPath);
  for (const migration of migrations.filter((entry) => entry.version <= 6)) {
    legacyDb.exec(migration.up);
    legacyDb.exec(`PRAGMA user_version = ${migration.version}`);
  }
  legacyDb
    .prepare(
      "INSERT INTO conversations (id,agent,title,cwd,mode,model,effort,state,created_at,updated_at) VALUES (?,?,?,?,?,?,?,?,?,?)",
    )
    .run(
      "legacy-1",
      "claude",
      "Conversa antiga",
      "/tmp/projeto",
      "read-only",
      "haiku",
      "low",
      "idle",
      "2026-10-31T10:00:00.000Z",
      "2026-10-31T10:01:00.000Z",
    );
  legacyDb
    .prepare(
      "INSERT INTO messages (id,conversation_id,author,status,parts,created_at,updated_at) VALUES (?,?,?,?,?,?,?)",
    )
    .run(
      "message-1",
      "legacy-1",
      "user",
      "done",
      JSON.stringify([{ id: "part-1", type: "text", markdown: "Mensagem preservada" }]),
      "2026-10-31T10:00:30.000Z",
      "2026-10-31T10:00:30.000Z",
    );
  legacyDb.close();

  const db = openDatabase(dbPath);
  const conversation = getConversation(db, "legacy-1");
  assert.deepEqual(
    {
      agent: conversation?.agent,
      title: conversation?.title,
      cwd: conversation?.cwd,
      mode: conversation?.mode,
      model: conversation?.model,
      effort: conversation?.effort,
      plan: conversation?.plan,
    },
    {
      agent: "claude",
      title: "Conversa antiga",
      cwd: "/tmp/projeto",
      mode: "read-only",
      model: "haiku",
      effort: "low",
      plan: false,
    },
  );
  const legacyMessages = listMessages(db, "legacy-1");
  const legacyPart = legacyMessages[0]?.parts[0];
  assert.equal(legacyPart?.type, "text");
  assert.equal(
    legacyPart?.type === "text" ? legacyPart.markdown : undefined,
    "Mensagem preservada",
  );

  const planned = createConversation(db, {
    agent: "codex",
    title: "Nova planejada",
    cwd: "/tmp",
    mode: "edit",
    plan: true,
  });
  const defaulted = createConversation(db, {
    agent: "claude",
    title: "Nova padrão",
    cwd: "/tmp",
    mode: "edit",
  });
  assert.equal(getConversation(db, planned.id)?.plan, true);
  assert.equal(defaulted.plan, false);
  db.close();
});

test("CLIs personalizadas são armazenadas, listadas e removidas", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "ks-"));
  const db = openDatabase(path.join(root, "karont.db"));
  const first = addCustomAgent(db, { name: "Primeira", command: "first-cli" });
  const second = addCustomAgent(db, { name: "Segunda", command: "/opt/second-cli" });
  assert.match(first.id, /^custom-[0-9a-f-]{36}$/);
  assert.deepEqual(listCustomAgents(db), [first, second]);
  assert.equal(removeCustomAgent(db, first.id), true);
  assert.equal(removeCustomAgent(db, first.id), false);
  assert.deepEqual(listCustomAgents(db), [second]);
  db.close();
});

test("pastas recentes mantêm somente as 50 mais novas", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "ks-"));
  const db = openDatabase(path.join(root, "karont.db"));
  for (let index = 0; index < 55; index += 1) {
    recordRecentFolder(db, {
      path: path.join(root, `projeto-${index}`),
      usedAt: new Date(Date.UTC(2026, 0, 1, 0, 0, index)).toISOString(),
    });
  }
  const folders = listRecentFolderRecords(db);
  assert.equal(folders.length, 50);
  assert.equal(folders[0]?.path.endsWith("projeto-54"), true);
  assert.equal(folders.at(-1)?.path.endsWith("projeto-5"), true);
  assert.equal(
    folders.some((folder) => folder.path.endsWith("projeto-4")),
    false,
  );
  db.close();
});

test("recusa banco criado por versão mais nova", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "ks-"));
  const dbPath = path.join(root, "karont.db");
  const db = openDatabase(dbPath);
  db.exec("PRAGMA user_version = 99");
  db.close();
  assert.throws(() => openDatabase(dbPath), /versão mais nova do Karont/);
});
