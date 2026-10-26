import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { once } from 'node:events';
import { createRequire } from 'node:module';
import { daemon, environment, until, wait } from '../scripts/harness.mjs';
const require = createRequire(import.meta.url);
const { openDatabase } = require('../dist/daemon/database.cjs');
const {
  Continuity,
  processIdentity,
  sameProcess,
  worktreeFingerprint,
} = require('../dist/daemon/continuity.cjs');
const { AutoResumeScheduler } = require('../dist/daemon/auto-resume.cjs');
const { requestSchema } = require('../dist/contracts/index.cjs');
function fixture() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'eros-continuity-'));
  const db = openDatabase(path.join(root, 'test.sqlite'));
  fs.chmodSync(path.join(root, 'test.sqlite'), 0o600);
  db.prepare('INSERT INTO dots VALUES(?,?,?,?,?,?,?)').run(
    'dot',
    'Dot',
    'role',
    process.execPath,
    '[]',
    '["repo"]',
    Date.now(),
  );
  const workspaceId = db
    .prepare("SELECT value FROM settings WHERE key='default_workspace_id'")
    .get().value;
  db.prepare(
    "INSERT INTO projects(id,name,root,git_root,created_at,workspace_id,origin) VALUES(?,?,?,?,?,?,'config')",
  ).run('repo', 'Repo', root, root, Date.now(), workspaceId);
  const run = (state = 'queued') => {
    const id = randomUUID();
    db.prepare('INSERT INTO runs(id,dot_id,project_id,state,created_at) VALUES(?,?,?,?,?)').run(
      id,
      'dot',
      'repo',
      state,
      Date.now(),
    );
    return id;
  };
  return {
    root,
    db,
    run,
    close() {
      this.db.close();
      fs.rmSync(root, { recursive: true, force: true });
    },
  };
}
test('migração v3→v6 preserva Runs, sessões, referências, checkpoints e WAL', () => {
  const f = fixture();
  try {
    const id = f.run();
    f.db
      .prepare(
        "INSERT INTO sessions(id,run_id,pid,cols,rows,state,started_at) VALUES(?,?,?,100,30,'queued',?)",
      )
      .run(randomUUID(), id, 123, Date.now());
    f.db.exec(`PRAGMA foreign_keys=OFF; BEGIN IMMEDIATE;
      DROP TRIGGER task_run_same_project_insert;
      DROP TRIGGER task_events_no_update;
      DROP TRIGGER task_events_no_delete;
      DROP TRIGGER task_origin_context_insert;
      DROP TRIGGER task_origin_context_update;
      DROP TABLE task_events;
      DROP TABLE task_run_links;
      DROP TABLE task_assignees;
      DROP TABLE tasks;
      DROP TRIGGER projects_require_workspace_insert;
      DROP TRIGGER projects_require_workspace_update;
      DROP TRIGGER runs_chat_context_insert;
      DROP TRIGGER runs_chat_context_update;
      DROP INDEX runs_chat_created;
      DROP INDEX projects_workspace_id;
      DROP INDEX projects_workspace_created;
      DROP TABLE message_deliveries;
      DROP TABLE messages;
      DROP TABLE chat_events;
      DROP TABLE chats;
      DROP TABLE project_dot_grants;
      DROP TABLE product_operations;
      DELETE FROM settings WHERE key='default_workspace_id';
      ALTER TABLE runs DROP COLUMN chat_id;
      ALTER TABLE projects DROP COLUMN origin;
      ALTER TABLE projects DROP COLUMN workspace_id;
      DROP TABLE workspaces;
      DROP TABLE checkpoints; DROP TABLE operations; DROP TABLE resume_jobs;
      ALTER TABLE sessions DROP COLUMN identity_json;
      ALTER TABLE runs DROP COLUMN auto_resume;
      ALTER TABLE projects DROP COLUMN icon;
      PRAGMA user_version=3;
      COMMIT; PRAGMA foreign_keys=ON;`);
    f.db.close();
    f.db = openDatabase(path.join(f.root, 'test.sqlite'));
    const c = new Continuity(f.db);
    c.checkpoint(id, 'manual');
    assert.equal(f.db.prepare('SELECT run_id FROM sessions').get().run_id, id);
    assert.equal(f.db.prepare('PRAGMA user_version').get().user_version, 7);
    assert.equal(f.db.prepare('PRAGMA journal_mode').get().journal_mode, 'wal');
    assert.deepEqual(f.db.prepare('PRAGMA foreign_key_check').all(), []);
    // Reopen is idempotent, including actual SQLite rollback/recovery.
    f.db.close();
    f.db = openDatabase(path.join(f.root, 'test.sqlite'));
    assert.equal(new Continuity(f.db).checkpoints(id).length, 1);
  } finally {
    f.close();
  }
});
test('transições auditáveis transacionais; repetição, estados inválidos e falha não alteram dados', () => {
  const f = fixture();
  try {
    const c = new Continuity(f.db),
      id = f.run();
    c.transition(id, 'paused', 'test');
    c.transition(id, 'paused', 'replay');
    assert.equal(c.checkpoints(id).length, 1);
    assert.throws(() => c.transition(id, 'completed', 'invalid'));
    c.transition(id, 'queued', 'test');
    c.transition(id, 'running', 'test');
    c.transition(id, 'recovery_needed', 'crash');
    assert.throws(() => c.transition(id, 'completed', 'unsafe'));
    assert.equal(f.db.prepare('SELECT count(*) n FROM run_events WHERE run_id=?').get(id).n, 4);
    assert.throws(() =>
      c.transaction(() => {
        c.checkpoint(id, 'manual');
        throw Error('fault');
      }),
    );
    assert.equal(c.checkpoints(id).length, 4);
  } finally {
    f.close();
  }
});
test('identidade Linux recusa PID reutilizado, boot alterado, executável e início falsificados', () => {
  const expected = processIdentity(process.pid);
  assert.ok(expected);
  assert.equal(sameProcess(expected), true);
  for (const change of [
    { start: '0' },
    { boot: 'other' },
    { exe: '/bad' },
    { uid: -1 },
    { pid: 2147483647 },
  ])
    assert.equal(sameProcess({ ...expected, ...change }), false);
  assert.equal(sameProcess(null), false);
});
test('operação incerta após crash não é repetida; chave não troca Run ou tipo', () => {
  const f = fixture();
  try {
    let c = new Continuity(f.db);
    const a = f.run('running'),
      b = f.run();
    c.begin('rollback:' + a, a, 'rollback');
    c.begin('done', b, 'enqueue');
    c.complete('done');
    c = new Continuity(f.db);
    assert.equal(c.previousShutdown, 'false');
    c.recover();
    assert.equal(c.begin('rollback:' + a, a, 'rollback'), 'uncertain');
    assert.equal(c.begin('done', b, 'enqueue'), 'completed');
    assert.throws(() => c.begin('done', a, 'rollback'));
    assert.equal(f.db.prepare('SELECT state FROM runs WHERE id=?').get(a).state, 'recovery_needed');
    assert.equal(c.checkpoints(a)[0].origin, 'recovery');
  } finally {
    f.close();
  }
});
test('scheduler: reset conhecido/desconhecido, relógio, restart, backoff limitado e opt-out Dot/Run', async () => {
  const f = fixture();
  try {
    const c = new Continuity(f.db);
    let enabled = true,
      calls = 0,
      result = 'temporary_error';
    const adapter = {
      capabilities: {
        level: 2,
        verified: true,
        nativeResume: true,
        structuredQuota: true,
        reliableReset: true,
      },
      validate: async () => true,
      resume: async () => {
        calls++;
        return result;
      },
    };
    let scheduler = new AutoResumeScheduler(
      c,
      () => adapter,
      () => enabled,
      () => 'hash',
    );
    const id = f.run('running');
    scheduler.confirm(id, { confirmed: true, sessionId: 'fixture-only', resetAt: 10000 });
    await scheduler.tick(9000);
    assert.equal(calls, 0);
    enabled = false;
    await scheduler.tick(11000);
    assert.equal(calls, 0);
    enabled = true;
    await scheduler.tick(11000);
    assert.equal(calls, 1);
    await scheduler.tick(11001);
    assert.equal(calls, 1);
    const due = f.db.prepare('SELECT due_at FROM resume_jobs WHERE run_id=?').get(id).due_at;
    scheduler.stop();
    scheduler = new AutoResumeScheduler(
      c,
      () => adapter,
      () => enabled,
      () => 'hash',
    );
    await scheduler.tick(due);
    assert.equal(calls, 2);
    await scheduler.tick(due + 120000);
    assert.equal(calls, 3);
    assert.equal(
      f.db.prepare('SELECT state FROM runs WHERE id=?').get(id).state,
      'recovery_needed',
    );
    await scheduler.tick(due + 99999999);
    assert.equal(calls, 3);
    const unknown = f.run('running');
    scheduler.confirm(unknown, { confirmed: true, sessionId: 'unknown', resetAt: null });
    await scheduler.tick(Number.MAX_SAFE_INTEGER);
    assert.equal(calls, 3);
    assert.equal(
      f.db.prepare('SELECT status FROM resume_jobs WHERE run_id=?').get(unknown).status,
      'manual',
    );
    const good = f.run('running');
    result = 'resumed';
    scheduler.confirm(good, { confirmed: true, sessionId: 'good', resetAt: 10 });
    await scheduler.tick(20);
    assert.equal(f.db.prepare('SELECT state FROM runs WHERE id=?').get(good).state, 'running');
    scheduler.stop();
  } finally {
    f.close();
  }
});
test('scheduler: ausência de suporte, autenticação, worktree alterada e cancelamento durante validação', async () => {
  const f = fixture();
  try {
    const c = new Continuity(f.db);
    let adapter,
      hash = 'hash',
      calls = 0,
      validation = async () => true;
    const scheduler = new AutoResumeScheduler(
      c,
      () => adapter,
      () => true,
      () => hash,
    );
    const unsupported = f.run('running');
    assert.throws(() =>
      scheduler.confirm(unsupported, { confirmed: true, sessionId: 's', resetAt: 10 }),
    );
    adapter = {
      capabilities: {
        level: 2,
        verified: true,
        nativeResume: true,
        structuredQuota: true,
        reliableReset: true,
      },
      validate: () => validation(),
      resume: async () => {
        calls++;
        return 'authentication_error';
      },
    };
    const auth = f.run('running');
    scheduler.confirm(auth, { confirmed: true, sessionId: 's', resetAt: 10 });
    await scheduler.tick(11);
    await scheduler.tick(999999);
    assert.equal(calls, 1);
    const changed = f.run('running');
    scheduler.confirm(changed, { confirmed: true, sessionId: 's', resetAt: 10 });
    hash = 'other';
    await scheduler.tick(11);
    assert.equal(calls, 1);
    assert.equal(
      f.db.prepare('SELECT status FROM resume_jobs WHERE run_id=?').get(changed).status,
      'blocked',
    );
    const cancelled = f.run('running');
    scheduler.confirm(cancelled, { confirmed: true, sessionId: 's', resetAt: 10 });
    validation = async () => {
      c.transition(cancelled, 'cancelled', 'user');
      return true;
    };
    await scheduler.tick(11);
    assert.equal(calls, 1);
    assert.equal(
      f.db.prepare('SELECT state FROM runs WHERE id=?').get(cancelled).state,
      'cancelled',
    );
    scheduler.stop();
  } finally {
    f.close();
  }
});
test('IPC de continuidade recusa estado, snapshot, comandos, sessão e confirmação inventados', () => {
  const runId = randomUUID();
  for (const command of [
    {
      method: 'checkpoints.create',
      value: { runId, operationId: randomUUID(), snapshot: { state: 'completed' } },
    },
    { method: 'runs.resume', value: { runId, operationId: randomUUID(), command: '/bin/sh' } },
    { method: 'runs.resume', value: { runId, operationId: randomUUID(), sessionId: 'fake' } },
    { method: 'runs.pause', value: { runId, state: 'completed' } },
    { method: 'runs.autoResume', value: { runId, enabled: true, resetAt: 0 } },
  ])
    assert.equal(requestSchema.safeParse({ id: 1, ...command }).success, false);
});
test('SIGKILL real: duas Runs, filho sobrevivente, fila persistente, replay e nova sessão explícita', async () => {
  const e = environment();
  const root = path.join(e.root, 'repo');
  fs.mkdirSync(root);
  const git = (...args) => execFileSync('git', args, { cwd: root, stdio: 'ignore' });
  git('init', '--quiet');
  git('config', 'user.name', 'Fixture');
  git('config', 'user.email', 'fixture@local.invalid');
  fs.writeFileSync(path.join(root, 'base.txt'), 'base\n');
  git('add', '.');
  git('commit', '--quiet', '-m', 'base');
  const config = path.join(e.root, 'dots.json');
  const script = `const fs=require('fs');if(process.argv[1]==='survivor'){process.on('SIGHUP',()=>{});}fs.writeFileSync('progress.txt','persisted');setInterval(()=>{},1000);`;
  fs.writeFileSync(
    config,
    JSON.stringify({
      version: 1,
      projects: [{ id: 'repo', name: 'Repo', root }],
      dots: ['normal', 'survivor'].map((id) => ({
        id,
        name: id,
        autoResume: id !== 'normal',
        role: 'Fixture',
        executable: process.execPath,
        args: ['-e', script, id],
        projectIds: ['repo'],
      })),
    }),
    { mode: 0o600 },
  );
  e.env.EROS_DOTS_CONFIG = config;
  let d;
  const pids = [];
  try {
    d = await daemon(e.env);
    let client = d.client;
    const key = randomUUID();
    const start = {
      method: 'runs.start',
      value: { dotId: 'normal', projectId: 'repo', operationId: key },
    };
    const [a, replay] = await Promise.all([client.request(start), client.request(start)]);
    assert.equal(a.id, replay.id);
    const b = await client.request({
      method: 'runs.start',
      value: { dotId: 'survivor', projectId: 'repo' },
    });
    const q = await client.request({
      method: 'runs.start',
      value: { dotId: 'normal', projectId: 'repo' },
    });
    await client.request({ method: 'runs.pause', value: { runId: q.id } });
    const pending = await client.request({
      method: 'runs.start',
      value: { dotId: 'normal', projectId: 'repo' },
    });
    assert.equal(a.autoResumeEnabled, false);
    assert.deepEqual(
      await client.request({ method: 'runs.autoResume', value: { runId: q.id, enabled: false } }),
      { enabled: false, supported: false },
    );
    let runs = await client.request({ method: 'runs.list', value: { limit: 100 } });
    assert.equal(runs.find((r) => r.id === q.id).state, 'paused');
    assert.equal(runs.find((r) => r.id === q.id).autoResumeEnabled, false);
    for (const id of [a.id, b.id])
      await until(async () => {
        runs = await client.request({ method: 'runs.list', value: { limit: 100 } });
        const run = runs.find((r) => r.id === id);
        assert.equal(run.state, 'running');
        assert.ok(run.pid);
        pids.push(processIdentity(run.pid));
        assert.equal(
          fs.readFileSync(
            path.join(e.env.EROS_DATA_DIR, 'worktrees', 'repo', id, 'progress.txt'),
            'utf8',
          ),
          'persisted',
        );
      });
    const manual = randomUUID();
    await client.request({
      method: 'checkpoints.create',
      value: { runId: a.id, operationId: manual },
    });
    await client.request({
      method: 'checkpoints.create',
      value: { runId: a.id, operationId: manual },
    });
    assert.equal(
      (await client.request({ method: 'checkpoints.list', value: { runId: a.id } })).filter(
        (c) => c.id === manual,
      ).length,
      1,
    );
    const exited = once(d.child, 'exit');
    d.child.kill('SIGKILL');
    await exited;
    client.close();
    await wait(200);
    d = await daemon(e.env);
    client = d.client;
    runs = await client.request({ method: 'runs.list', value: { limit: 100 } });
    assert.equal(runs.length, 4);
    await until(async () =>
      assert.equal(
        (await client.request({ method: 'runs.list', value: { limit: 100 } })).find(
          (run) => run.id === pending.id,
        ).state,
        'running',
      ),
    );
    assert.equal(runs.find((r) => r.id === a.id).state, 'recovery_needed');
    assert.equal(runs.find((r) => r.id === b.id).state, 'recovery_needed');
    assert.equal(runs.find((r) => r.id === q.id).state, 'paused');
    assert.equal(runs.find((r) => r.id === q.id).autoResumeEnabled, false);
    const survivor = await client.request({ method: 'recovery.inspect', value: { runId: b.id } });
    assert.equal(survivor.survivingProcess, true);
    assert.equal(survivor.canStartNewSession, false);
    await assert.rejects(
      client.request({
        method: 'runs.resume',
        value: { runId: b.id, operationId: randomUUID(), newSessionConfirmed: true },
      }),
    );
    // Kill only a fixture whose real Linux identity matches the stored session.
    const survivorPid = runs.find((r) => r.id === b.id).pid;
    const identity = processIdentity(survivorPid);
    assert.ok(identity);
    process.kill(survivorPid, 'SIGKILL');
    await until(() => assert.equal(sameProcess(identity), false));
    await assert.rejects(
      client.request({ method: 'runs.resume', value: { runId: a.id, operationId: randomUUID() } }),
    );
    const wt = path.join(e.env.EROS_DATA_DIR, 'worktrees', 'repo', a.id);
    fs.writeFileSync(path.join(wt, 'progress.txt'), 'reviewed');
    assert.equal(
      (await client.request({ method: 'recovery.inspect', value: { runId: a.id } }))
        .worktreeChanged,
      true,
    );
    const op = randomUUID();
    const [continued, again] = await Promise.all([
      client.request({
        method: 'runs.resume',
        value: { runId: a.id, operationId: op, newSessionConfirmed: true },
      }),
      client.request({
        method: 'runs.resume',
        value: { runId: a.id, operationId: op, newSessionConfirmed: true },
      }),
    ]);
    assert.equal(continued.id, again.id);
    assert.equal((await client.request({ method: 'runs.list', value: { limit: 100 } })).length, 4);
    await client.request({ method: 'runs.cancel', value: { runId: a.id } });
    await client.request({ method: 'runs.cancel', value: { runId: q.id } });
    await client.request({ method: 'runs.cancel', value: { runId: pending.id } });
    await client.request({ method: 'shutdown' });
    client.close();
  } finally {
    if (d) {
      d.client.close();
      d.child.kill();
    }
    for (const identity of pids) {
      if (sameProcess(identity))
        try {
          process.kill(identity.pid, 'SIGKILL');
        } catch {}
    }
    fs.rmSync(e.root, { recursive: true, force: true });
  }
});
test('SIGKILL durante rollback deixa operação incerta; restauração parcial nunca é repetida', async () => {
  const e = environment(),
    root = path.join(e.root, 'repo');
  fs.mkdirSync(root);
  const git = (...args) => execFileSync('git', args, { cwd: root, stdio: 'ignore' });
  git('init', '--quiet');
  git('config', 'user.name', 'Fixture');
  git('config', 'user.email', 'fixture@local.invalid');
  for (const name of ['a.txt', 'b.txt']) fs.writeFileSync(path.join(root, name), 'before\n');
  git('add', '.');
  git('commit', '--quiet', '-m', 'base');
  const bin = path.join(e.root, 'bin');
  fs.mkdirSync(bin);
  const realGit = execFileSync('which', ['git'], { encoding: 'utf8' }).trim();
  const shim = path.join(bin, 'git');
  const shimScript = path.join(bin, 'git-shim.cjs');
  const shellQuote = (value) => "'" + value.replaceAll("'", "'\\''") + "'";
  fs.writeFileSync(
    shimScript,
    `const {spawnSync}=require('child_process');const args=process.argv.slice(2);const r=spawnSync(${JSON.stringify(realGit)},args,{stdio:'inherit'});if(args[0]==='restore'&&r.status===0)process.kill(process.ppid,'SIGKILL');process.exit(r.status??1);`,
  );
  fs.writeFileSync(
    shim,
    `#!/bin/sh\nexec ${shellQuote(process.execPath)} ${shellQuote(shimScript)} "$@"\n`,
    { mode: 0o700 },
  );
  const config = path.join(e.root, 'dots.json');
  fs.writeFileSync(
    config,
    JSON.stringify({
      version: 1,
      projects: [{ id: 'repo', name: 'Repo', root }],
      dots: [
        {
          id: 'dot',
          name: 'Dot',
          role: 'Fixture',
          executable: process.execPath,
          args: [
            '-e',
            "require('fs').writeFileSync('a.txt','after\\n');require('fs').writeFileSync('b.txt','after\\n');",
          ],
          projectIds: ['repo'],
        },
      ],
    }),
    { mode: 0o600 },
  );
  e.env.EROS_DOTS_CONFIG = config;
  e.env.PATH = bin + ':' + process.env.PATH;
  let d;
  try {
    d = await daemon(e.env);
    const run = await d.client.request({
      method: 'runs.start',
      value: { dotId: 'dot', projectId: 'repo' },
    });
    await until(async () => {
      const runs = await d.client.request({ method: 'runs.list', value: { limit: 10 } });
      assert.equal(runs[0].state, 'completed');
    });
    const preview = await d.client.request({
      method: 'rollback.preview',
      value: { runId: run.id },
    });
    assert.equal(preview.files.length, 2);
    assert.equal(preview.canRollback, true);
    const exited = once(d.child, 'exit');
    await assert.rejects(
      d.client.request({
        method: 'approvals.decide',
        value: { approvalId: preview.approvalId, allow: true },
      }),
    );
    await exited;
    d.client.close();
    e.env.PATH = process.env.PATH;
    d = await daemon(e.env);
    const inspection = await d.client.request({
      method: 'recovery.inspect',
      value: { runId: run.id },
    });
    assert.equal(inspection.state, 'recovery_needed');
    assert.deepEqual(inspection.uncertainOperations, ['rollback']);
    assert.equal(inspection.canStartNewSession, false);
    const wt = path.join(e.env.EROS_DATA_DIR, 'worktrees', 'repo', run.id);
    assert.equal(fs.readFileSync(path.join(wt, 'a.txt'), 'utf8'), 'before\n');
    assert.equal(fs.readFileSync(path.join(wt, 'b.txt'), 'utf8'), 'after\n');
    const again = await d.client.request({ method: 'rollback.preview', value: { runId: run.id } });
    assert.equal(again.canRollback, false);
    assert.equal(again.approvalId, undefined);
    await assert.rejects(
      d.client.request({
        method: 'approvals.decide',
        value: { approvalId: preview.approvalId, allow: true },
      }),
    );
    assert.equal(fs.readFileSync(path.join(wt, 'b.txt'), 'utf8'), 'after\n');
    await d.client.request({ method: 'shutdown' });
    d.client.close();
  } finally {
    if (d) {
      d.client.close();
      d.child.kill();
    }
    fs.rmSync(e.root, { recursive: true, force: true });
  }
});
test('job persistido em tentativa incerta após reabrir SQLite nunca chama continuação de novo', async () => {
  const f = fixture();
  let scheduler;
  try {
    let c = new Continuity(f.db);
    const id = f.run('running');
    let calls = 0;
    const adapter = {
      capabilities: {
        level: 2,
        verified: true,
        nativeResume: true,
        structuredQuota: true,
        reliableReset: true,
      },
      validate: async () => true,
      resume: async () => {
        calls++;
        return 'resumed';
      },
    };
    scheduler = new AutoResumeScheduler(
      c,
      () => adapter,
      () => true,
      () => 'hash',
    );
    scheduler.confirm(id, { confirmed: true, sessionId: 'fixture', resetAt: 1000 });
    scheduler.stop();
    f.db.prepare("UPDATE resume_jobs SET status='attempting',attempts=1 WHERE run_id=?").run(id);
    f.db.close();
    f.db = openDatabase(path.join(f.root, 'test.sqlite'));
    c = new Continuity(f.db);
    c.recover();
    scheduler = new AutoResumeScheduler(
      c,
      () => adapter,
      () => true,
      () => 'hash',
    );
    await scheduler.tick(2000);
    assert.equal(calls, 0);
    assert.equal(
      f.db.prepare('SELECT state FROM runs WHERE id=?').get(id).state,
      'recovery_needed',
    );
    assert.equal(
      f.db.prepare('SELECT status FROM resume_jobs WHERE run_id=?').get(id).status,
      'uncertain',
    );
  } finally {
    scheduler?.stop();
    f.close();
  }
});
test('socket recusa novas operações de continuidade sem autenticação', async () => {
  const { default: net } = await import('node:net');
  const e = environment();
  let d;
  try {
    d = await daemon(e.env);
    for (const method of ['checkpoints.create', 'runs.resume', 'runs.autoResume']) {
      const s = net.createConnection(path.join(e.env.EROS_RUNTIME_DIR, 'daemon.sock'));
      s.on('error', () => {});
      const closed = new Promise((r) => s.once('close', r));
      await once(s, 'data');
      s.write(
        JSON.stringify({
          id: 1,
          method,
          value: {
            runId: randomUUID(),
            operationId: randomUUID(),
            enabled: true,
            newSessionConfirmed: true,
          },
        }) + '\n',
      );
      let timer;
      try {
        await Promise.race([
          closed,
          new Promise((_, reject) => {
            timer = setTimeout(() => {
              s.destroy();
              reject(Error('unauthenticated connection remained open'));
            }, 1500);
          }),
        ]);
      } finally {
        clearTimeout(timer);
      }
    }
    assert.deepEqual(await d.client.request({ method: 'runs.list', value: { limit: 10 } }), []);
    await d.client.request({ method: 'shutdown' });
    d.client.close();
  } finally {
    d?.client.close();
    d?.child.kill();
    fs.rmSync(e.root, { recursive: true, force: true });
  }
});
