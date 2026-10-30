import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { execFileSync } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { createRequire } from 'node:module';
import { sample, host, environment, daemon } from './harness.mjs';
import { once } from 'node:events';
const require = createRequire(import.meta.url),
  { openDatabase } = require('../dist/daemon/database.cjs'),
  { Continuity } = require('../dist/daemon/continuity.cjs'),
  { AutoResumeScheduler } = require('../dist/daemon/auto-resume.cjs');
const root = fs.mkdtempSync(path.join(os.tmpdir(), 'karont-checkpoint-bench-'));
let db, scheduler;
const result = {
  environment: host(),
  method:
    '5 batches x 100 logical automatic checkpoints; 20 runs queued; one simulated trusted quota job due in 1h; 5 samples x 7s with scheduler timer; actual daemon queue of 20 runs before/after SIGKILL. No window/provider/model. Not a production Codex support test.',
  batches: [],
  waiting: [],
};
try {
  const git = (...args) => execFileSync('git', args, { cwd: root, stdio: 'ignore' });
  git('init', '--quiet');
  git('config', 'user.name', 'Fixture');
  git('config', 'user.email', 'fixture@local.invalid');
  fs.writeFileSync(path.join(root, 'base.txt'), 'base\n');
  fs.writeFileSync(path.join(root, '.gitignore'), 'test.sqlite*\n');
  git('add', 'base.txt');
  git('commit', '--quiet', '-m', 'base');
  const dbPath = path.join(root, 'test.sqlite');
  db = openDatabase(dbPath);
  const c = new Continuity(db);
  db.prepare('INSERT INTO dots VALUES(?,?,?,?,?,?,?)').run(
    'dot',
    'Dot',
    'role',
    '/fixture',
    '[]',
    '["repo"]',
    Date.now(),
  );
  db.prepare('INSERT INTO projects VALUES(?,?,?,?,?)').run('repo', 'Repo', root, root, Date.now());
  const add = (state) => {
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
  const id = add('running');
  db.prepare('INSERT INTO worktrees VALUES(?,?,?,?,?,NULL)').run(
    id,
    root,
    'fixture',
    'HEAD',
    Date.now(),
  );
  for (let i = 0; i < 20; i++) add('queued');
  const sizes = () =>
    Object.fromEntries(
      ['', '-wal', '-shm'].map((s) => [
        s || 'db',
        fs.existsSync(dbPath + s) ? fs.statSync(dbPath + s).size : 0,
      ]),
    );
  const changes = () => Number(db.prepare('SELECT total_changes() AS n').get().n);
  for (let batch = 0; batch < 5; batch++) {
    const times = [],
      before = changes(),
      bytesBefore = sizes();
    for (let i = 0; i < 100; i++) {
      const start = performance.now();
      c.transaction(() => c.checkpoint(id, 'benchmark'));
      times.push(performance.now() - start);
    }
    times.sort((a, b) => a - b);
    result.batches.push({
      batch: batch + 1,
      checkpointMedianMs: (times[49] + times[50]) / 2,
      checkpointP95Ms: times[94],
      sqliteRowChanges: changes() - before,
      bytesBefore,
      bytesAfter: sizes(),
      retained: Number(db.prepare('SELECT count(*) n FROM checkpoints').get().n),
    });
  }
  scheduler = new AutoResumeScheduler(
    c,
    () => ({
      capabilities: {
        level: 2,
        verified: true,
        nativeResume: true,
        structuredQuota: true,
        reliableReset: true,
      },
      validate: async () => true,
      resume: async () => {
        throw Error('not due');
      },
    }),
    () => true,
    () => 'fixture-hash',
  );
  scheduler.confirm(id, { confirmed: true, sessionId: 'simulated', resetAt: Date.now() + 3600000 });
  scheduler.start();
  const before = changes();
  for (let i = 0; i < 5; i++) result.waiting.push(await sample(process.pid, 7000));
  result.waitingRowChanges = changes() - before;
  result.finalSizes = sizes();
  result.checkpoints = Number(db.prepare('SELECT count(*) n FROM checkpoints').get().n);
  scheduler.stop();
  const context = environment();
  let managed;
  try {
    const config = path.join(context.root, 'dots.json');
    fs.writeFileSync(
      config,
      JSON.stringify({
        version: 1,
        projects: [{ id: 'repo', name: 'Fixture', root }],
        dots: [
          {
            id: 'dot',
            name: 'Dot',
            role: 'Fixture',
            executable: process.execPath,
            args: ['-e', 'setInterval(()=>{},1000)'],
            projectIds: ['repo'],
          },
        ],
      }),
      { mode: 0o600 },
    );
    context.env.KARONT_DOTS_CONFIG = config;
    managed = await daemon(context.env);
    for (let i = 0; i < 20; i++)
      await managed.client.request({
        method: 'runs.start',
        value: { dotId: 'dot', projectId: 'repo', operationId: randomUUID() },
      });
    result.queueBefore = (
      await managed.client.request({ method: 'runs.list', value: { limit: 100 } })
    ).reduce((counts, run) => ({ ...counts, [run.state]: (counts[run.state] ?? 0) + 1 }), {});
    result.queueSamples = [];
    for (let i = 0; i < 5; i++) result.queueSamples.push(await sample(managed.pid, 1500));
    const exited = once(managed.child, 'exit');
    managed.child.kill('SIGKILL');
    await exited;
    managed.client.close();
    managed = await daemon(context.env);
    result.queueAfter = (
      await managed.client.request({ method: 'runs.list', value: { limit: 100 } })
    ).reduce((counts, run) => ({ ...counts, [run.state]: (counts[run.state] ?? 0) + 1 }), {});
    result.recoverySamples = [];
    for (let i = 0; i < 5; i++) result.recoverySamples.push(await sample(managed.pid, 1500));
    await managed.client.request({ method: 'shutdown' });
    managed.client.close();
  } finally {
    managed?.client.close();
    managed?.child.kill();
    fs.rmSync(context.root, { recursive: true, force: true });
  }
  result.status = 'passed';
} finally {
  scheduler?.stop();
  db?.close();
  fs.rmSync(root, { recursive: true, force: true });
  fs.mkdirSync('benchmarks/spec004', { recursive: true });
  fs.writeFileSync('benchmarks/spec004/continuity-benchmark.json', JSON.stringify(result, null, 2));
}
console.log(JSON.stringify(result, null, 2));
