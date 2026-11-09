import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { DatabaseSync } from "node:sqlite";
import test from "node:test";
import type { AnyEvent } from "@karont/contract";
import { getSetting, migrations, openDatabase, setSetting } from "./db.ts";
import { getDot, updateDot } from "./dot.ts";
import { createHandlers } from "./handlers.ts";

test("Dot: banco novo, atualização parcial atômica, validação e persistência", () => {
  const root = mkdtempSync(path.join(os.tmpdir(), "karont-dot-"));
  const file = path.join(root, "db.sqlite");
  let db = openDatabase(file);
  try {
    const initial = getDot(db);
    assert.equal(initial.name, "Dot");
    assert.equal(initial.color, "#232325");
    assert.equal(initial.enabled, true);
    assert.deepEqual(initial.personality, { explanation: 50, playfulness: 50, boldness: 50 });
    const changed = updateDot(db, { name: "  Caronte  ", color: "#FF4F8B" });
    assert.equal(changed.name, "Caronte");
    assert.equal(changed.color, "#ff4f8b");
    assert.equal(changed.id, initial.id);
    assert.equal(changed.createdAt, initial.createdAt);
    assert.deepEqual(changed.personality, initial.personality);
    assert.throws(() =>
      updateDot(db, {
        name: "Outro",
        personality: { explanation: 101, playfulness: 0, boldness: 50 },
      }),
    );
    assert.deepEqual(getDot(db), changed);
    assert.throws(() => updateDot(db, { name: " " }));
    assert.throws(() => updateDot(db, { color: "red" }));
    assert.throws(() => updateDot(db, { name: "a".repeat(81) }));
    assert.throws(() => updateDot(db, { name: "a\nb" }));
    const disabled = updateDot(db, { enabled: false });
    assert.equal(disabled.color, changed.color);
    db.close();
    db = openDatabase(file);
    assert.deepEqual(getDot(db), disabled);
    updateDot(db, { enabled: true });
    assert.equal(getDot(db).name, "Caronte");
  } finally {
    db.close();
    rmSync(root, { recursive: true, force: true });
  }
});

test("migração 22 preserva dados existentes e cria apenas um Dot ao reabrir", () => {
  const root = mkdtempSync(path.join(os.tmpdir(), "karont-dot-upgrade-"));
  const file = path.join(root, "db.sqlite");
  const legacy = new DatabaseSync(file);
  for (const migration of migrations.filter((m) => m.version <= 21)) {
    legacy.exec(migration.up);
    legacy.exec(`PRAGMA user_version=${migration.version}`);
  }
  setSetting(legacy, "profile.userNameOverride", "Fernando");
  legacy.close();
  let db = openDatabase(file);
  try {
    assert.equal(getSetting(db, "profile.userNameOverride"), "Fernando");
    updateDot(db, { name: "Alminha" });
    db.close();
    db = openDatabase(file);
    assert.equal(getDot(db).name, "Alminha");
    assert.equal(db.prepare("SELECT count(*) AS count FROM dots").get()?.count, 1);
  } finally {
    db.close();
    rmSync(root, { recursive: true, force: true });
  }
});

test("dot.update publica a identidade salva para todas as janelas", async () => {
  const root = mkdtempSync(path.join(os.tmpdir(), "karont-dot-handler-"));
  const db = openDatabase(path.join(root, "db.sqlite"));
  const events: AnyEvent[] = [];
  const handlers = createHandlers({
    db,
    startedAt: new Date().toISOString(),
    dev: false,
    emit: async () => {},
    env: { KARONT_DISABLE_AGENT_DETECTION: "1", PATH: "" },
    broadcast: async (event) => {
      events.push(event);
    },
  });
  const conn = { emit: async () => {}, afterResponse: () => {}, isOpen: () => true };
  try {
    const result = await handlers.handle(
      { type: "request", id: "1", method: "dot.update", params: { name: "Caronte" } },
      conn,
    );
    assert.deepEqual(events, [{ event: "dot.updated", payload: result }]);
    assert.deepEqual(
      await handlers.handle({ type: "request", id: "2", method: "dot.get", params: {} }, conn),
      result,
    );
  } finally {
    await handlers.closeAgents();
    await handlers.closeTerminals();
    db.close();
    rmSync(root, { recursive: true, force: true });
  }
});
