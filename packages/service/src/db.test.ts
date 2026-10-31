import assert from "node:assert/strict";
import { mkdtemp, stat } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { DatabaseSync } from "node:sqlite";
import { test } from "node:test";
import {
  addCustomAgent,
  getSetting,
  listCustomAgents,
  openDatabase,
  removeCustomAgent,
  setSetting,
} from "./db.ts";

test("migra settings, persiste user_version e permite reabrir", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "ks-"));
  const dbPath = path.join(root, "karont.db");
  let db = openDatabase(dbPath);
  assert.equal(
    (db.prepare("PRAGMA user_version").get() as { user_version: number }).user_version,
    2,
  );
  setSetting(db, "appearance.theme", { mode: "dark", enabled: true });
  assert.deepEqual(getSetting(db, "appearance.theme"), { mode: "dark", enabled: true });
  assert.equal((await stat(dbPath)).mode & 0o777, 0o600);
  db.close();

  db = openDatabase(dbPath);
  assert.deepEqual(getSetting(db, "appearance.theme"), { mode: "dark", enabled: true });
  db.close();
});

test("migração 2 aplica sobre a versão 1", async () => {
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
    2,
  );
  assert.deepEqual(listCustomAgents(db), []);
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

test("recusa banco criado por versão mais nova", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "ks-"));
  const dbPath = path.join(root, "karont.db");
  const db = openDatabase(dbPath);
  db.exec("PRAGMA user_version = 99");
  db.close();
  assert.throws(() => openDatabase(dbPath), /versão mais nova do Karont/);
});
