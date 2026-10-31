import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
const { openDatabase } = require('../dist/daemon/database.cjs');
const { DatabaseSync } = require('node:sqlite');

test('migração v8 permite project_id nulo e preserva Runs e referências da v7', () => {
  const temp = fs.mkdtempSync(path.join(os.tmpdir(), 'karont-migration-v8-'));
  const file = path.join(temp, 'phase0.sqlite');
  const legacy = new DatabaseSync(file);
  legacy.exec(`
    PRAGMA foreign_keys=ON;
    CREATE TABLE dots(id TEXT PRIMARY KEY);
    CREATE TABLE projects(id TEXT PRIMARY KEY);
    CREATE TABLE chats(id TEXT PRIMARY KEY,project_id TEXT,dot_id TEXT);
    CREATE TABLE runs(
      id TEXT PRIMARY KEY,
      dot_id TEXT NOT NULL REFERENCES dots(id),
      project_id TEXT NOT NULL REFERENCES projects(id),
      state TEXT NOT NULL CHECK(state IN ('queued','running','paused','waiting_quota','waiting_approval','recovery_needed','completed','failed','cancelled')),
      created_at INTEGER NOT NULL,
      started_at INTEGER,
      finished_at INTEGER,
      exit_code INTEGER,
      error TEXT,
      branch TEXT,
      permission_mode TEXT NOT NULL DEFAULT 'ask',
      auto_resume INTEGER NOT NULL DEFAULT 1,
      chat_id TEXT REFERENCES chats(id)
    );
    CREATE INDEX runs_created_at ON runs(created_at DESC);
    CREATE INDEX runs_chat_created ON runs(chat_id,created_at DESC,id DESC);
    CREATE TRIGGER runs_chat_context_insert BEFORE INSERT ON runs
    WHEN NEW.chat_id IS NOT NULL AND NOT EXISTS(
      SELECT 1 FROM chats c WHERE c.id=NEW.chat_id AND c.project_id=NEW.project_id AND c.dot_id=NEW.dot_id
    ) BEGIN SELECT RAISE(ABORT,'Execução diverge do contexto da conversa'); END;
    CREATE TRIGGER runs_chat_context_update BEFORE UPDATE OF chat_id,dot_id,project_id ON runs
    WHEN NEW.chat_id IS NOT NULL AND NOT EXISTS(
      SELECT 1 FROM chats c WHERE c.id=NEW.chat_id AND c.project_id=NEW.project_id AND c.dot_id=NEW.dot_id
    ) BEGIN SELECT RAISE(ABORT,'Execução diverge do contexto da conversa'); END;
    CREATE TABLE sessions(id TEXT PRIMARY KEY,run_id TEXT NOT NULL UNIQUE REFERENCES runs(id));
    CREATE TABLE tasks(id TEXT PRIMARY KEY,project_id TEXT NOT NULL REFERENCES projects(id));
    CREATE TABLE task_run_links(
      task_id TEXT NOT NULL REFERENCES tasks(id),
      run_id TEXT NOT NULL REFERENCES runs(id),
      created_at INTEGER NOT NULL
    );
    CREATE TRIGGER task_run_same_project_insert BEFORE INSERT ON task_run_links
    WHEN NOT EXISTS(
      SELECT 1 FROM tasks t JOIN runs r ON r.id=NEW.run_id
      WHERE t.id=NEW.task_id AND t.project_id=r.project_id
    ) BEGIN SELECT RAISE(ABORT,'Tarefa e execução precisam pertencer ao mesmo projeto'); END;
    INSERT INTO dots VALUES('alpha');
    INSERT INTO projects VALUES('repo');
    INSERT INTO chats VALUES('project-chat','repo','alpha');
    INSERT INTO chats VALUES('free-chat',NULL,'alpha');
    INSERT INTO runs VALUES('existing','alpha','repo','completed',100,110,120,0,NULL,'karont/run-existing','ask',1,'project-chat');
    INSERT INTO sessions VALUES('session-existing','existing');
    PRAGMA user_version=7;
  `);
  legacy.close();
  fs.chmodSync(file, 0o600);

  try {
    const db = openDatabase(file);
    assert.equal(db.prepare('PRAGMA user_version').get().user_version, 8);
    assert.equal(
      db
        .prepare('PRAGMA table_info(runs)')
        .all()
        .find((column) => column.name === 'project_id').notnull,
      0,
    );
    assert.deepEqual(
      { ...db.prepare('SELECT * FROM runs WHERE id=?').get('existing') },
      {
        id: 'existing',
        dot_id: 'alpha',
        project_id: 'repo',
        state: 'completed',
        created_at: 100,
        started_at: 110,
        finished_at: 120,
        exit_code: 0,
        error: null,
        branch: 'karont/run-existing',
        permission_mode: 'ask',
        auto_resume: 1,
        chat_id: 'project-chat',
      },
    );
    assert.equal(
      db.prepare('SELECT run_id FROM sessions WHERE id=?').get('session-existing').run_id,
      'existing',
    );
    db.prepare('INSERT INTO tasks(id,project_id) VALUES(?,?)').run('task', 'repo');
    db.prepare('INSERT INTO task_run_links(task_id,run_id,created_at) VALUES(?,?,?)').run(
      'task',
      'existing',
      150,
    );
    db.prepare(
      "INSERT INTO runs(id,dot_id,project_id,chat_id,state,created_at,permission_mode,auto_resume) VALUES('home','alpha',NULL,'free-chat','queued',200,'ask',1)",
    ).run();
    assert.equal(db.prepare('SELECT project_id FROM runs WHERE id=?').get('home').project_id, null);
    assert.throws(() =>
      db
        .prepare('INSERT INTO task_run_links(task_id,run_id,created_at) VALUES(?,?,?)')
        .run('task', 'home', 200),
    );
    assert.equal(db.prepare('PRAGMA foreign_keys').get().foreign_keys, 1);
    assert.deepEqual(db.prepare('PRAGMA foreign_key_check').all(), []);
    db.close();
  } finally {
    fs.rmSync(temp, { recursive: true, force: true });
  }
});
