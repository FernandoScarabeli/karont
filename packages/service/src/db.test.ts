import assert from "node:assert/strict";
import { mkdtemp, stat } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { test } from "node:test";
import { getSetting, openDatabase, setSetting } from "./db.ts";

test("migra settings, persiste user_version e permite reabrir", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "ks-"));
  const dbPath = path.join(root, "karont.db");
  let db = openDatabase(dbPath);
  assert.equal(
    (db.prepare("PRAGMA user_version").get() as { user_version: number }).user_version,
    1,
  );
  setSetting(db, "appearance.theme", { mode: "dark", enabled: true });
  assert.deepEqual(getSetting(db, "appearance.theme"), { mode: "dark", enabled: true });
  assert.equal((await stat(dbPath)).mode & 0o777, 0o600);
  db.close();

  db = openDatabase(dbPath);
  assert.deepEqual(getSetting(db, "appearance.theme"), { mode: "dark", enabled: true });
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
