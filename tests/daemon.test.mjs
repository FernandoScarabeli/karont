import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import net from 'node:net';
import { spawn } from 'node:child_process';
import { once } from 'node:events';
import { createRequire } from 'node:module';
import { DatabaseSync } from 'node:sqlite';
import { createHmac, randomBytes } from 'node:crypto';
const require = createRequire(import.meta.url);
const { Client } = require('../dist/local/client.cjs');
const wait = (ms) => new Promise((r) => setTimeout(r, ms));
async function until(fn) {
  for (let i = 0; i < 100; i++) {
    try {
      return await fn();
    } catch {
      await wait(30);
    }
  }
  throw Error('Timeout');
}
function launch(env) {
  return spawn(process.execPath, ['dist/daemon/entry.cjs'], {
    env,
    stdio: ['ignore', 'pipe', 'pipe'],
  });
}
async function refused(socket, payload) {
  const s = net.createConnection(socket);
  s.on('error', () => {});
  const closed = once(s, 'close');
  await once(s, 'data');
  if (payload) s.write(payload);
  await Promise.race([
    closed,
    wait(3500).then(() => {
      s.destroy();
      throw Error('Conexão não recusada');
    }),
  ]);
}
test('daemon: singleton concorrente, socket, handshake, limites, heartbeat, reconexão e SQLite', async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'karont-test-'));
  const env = {
    ...process.env,
    KARONT_DETECT_AGENTS: '0',
    KARONT_RUNTIME_DIR: path.join(root, 'run'),
    KARONT_DATA_DIR: path.join(root, 'data'),
    KARONT_CONFIG_DIR: path.join(root, 'config'),
  };
  Object.assign(process.env, {
    KARONT_DETECT_AGENTS: '0',
    KARONT_RUNTIME_DIR: env.KARONT_RUNTIME_DIR,
    KARONT_DATA_DIR: env.KARONT_DATA_DIR,
    KARONT_CONFIG_DIR: env.KARONT_CONFIG_DIR,
  });
  const children = [];
  const clients = [];
  let pid;
  try {
    children.push(launch(env));
    const c = new Client();
    clients.push(c);
    const first = await until(() => c.request({ method: 'snapshot' }));
    pid = first.pid;
    assert.equal(first.pid, children[0].pid);
    assert.equal(fs.statSync(path.join(env.KARONT_RUNTIME_DIR, 'daemon.sock')).mode & 0o777, 0o600);
    assert.equal(fs.statSync(env.KARONT_RUNTIME_DIR).mode & 0o777, 0o700);
    assert.equal(
      fs.statSync(path.join(env.KARONT_RUNTIME_DIR, 'session.json')).mode & 0o777,
      0o600,
    );
    const duplicates = Array.from({ length: 5 }, () => launch(env));
    children.push(...duplicates);
    const codes = await Promise.all(duplicates.map((p) => once(p, 'exit').then(([code]) => code)));
    assert.deepEqual(codes, [73, 73, 73, 73, 73]);
    assert.equal((await c.request({ method: 'ping' })).pid, pid);
    const meta = JSON.parse(
      fs.readFileSync(path.join(env.KARONT_RUNTIME_DIR, 'session.json'), 'utf8'),
    );
    const raw = net.createConnection(path.join(env.KARONT_RUNTIME_DIR, 'daemon.sock'));
    raw.on('error', () => {});
    const challenge = JSON.parse((await once(raw, 'data'))[0]);
    const nonce = randomBytes(32).toString('hex');
    const h = (role, value) =>
      createHmac('sha256', meta.secret).update(`karont:1:${role}:${value}`).digest('hex');
    const auth =
      JSON.stringify({
        type: 'authenticate',
        version: 1,
        nonce,
        proof: h('client', challenge.nonce + ':' + nonce),
      }) + '\n';
    raw.write(auth);
    const ready = JSON.parse((await once(raw, 'data'))[0]);
    assert.equal(ready.proof, h('ready', challenge.nonce + ':' + nonce));
    raw.destroy();
    await refused(path.join(env.KARONT_RUNTIME_DIR, 'daemon.sock'), auth); // replay across connections
    await refused(path.join(env.KARONT_RUNTIME_DIR, 'daemon.sock'), '{}\n');
    await refused(
      path.join(env.KARONT_RUNTIME_DIR, 'daemon.sock'),
      JSON.stringify({ type: 'authenticate', version: 99, proof: 'x' }) + '\n',
    );
    await refused(path.join(env.KARONT_RUNTIME_DIR, 'daemon.sock'), '{broken\n');
    await refused(path.join(env.KARONT_RUNTIME_DIR, 'daemon.sock'), 'x'.repeat(65537));
    await refused(path.join(env.KARONT_RUNTIME_DIR, 'daemon.sock'));
    await assert.rejects(() => c.request({ method: 'layout', value: { columns: 99 } }));
    await until(() => c.request({ method: 'ping' }));
    await c.request({
      method: 'layout',
      value: { columns: 2, editor: 'estado persistido ✓', editorOpen: true },
    });
    await c.request({ method: 'stream', value: true });
    c.close();
    await wait(1300);
    const c2 = new Client();
    clients.push(c2);
    const later = await c2.request({ method: 'snapshot' });
    assert.equal(later.pid, pid);
    assert.ok(later.heartbeat > first.heartbeat);
    assert.ok(later.sequence > 0);
    assert.equal(later.layout.editor, 'estado persistido ✓');
    process.kill(pid, 'SIGSTOP');
    await assert.rejects(() => c2.request({ method: 'ping' }), /expirou|desconectado/);
    process.kill(pid, 'SIGCONT');
    await until(() => c2.request({ method: 'ping' }));
    process.kill(pid, 'SIGKILL');
    await wait(150);
    children.push(launch(env));
    const recovered = await until(() => c2.request({ method: 'snapshot' }));
    assert.notEqual(recovered.pid, pid);
    pid = recovered.pid;
    assert.equal(recovered.layout.columns, 2);
    assert.equal(recovered.layout.editor, 'estado persistido ✓');
    const db = new DatabaseSync(path.join(env.KARONT_DATA_DIR, 'phase0.sqlite'));
    assert.equal(db.prepare('PRAGMA journal_mode').get().journal_mode, 'wal');
    db.prepare('INSERT INTO phase0_search(content) VALUES(?)').run('prototipo local');
    assert.equal(
      db.prepare("SELECT count(*) AS n FROM phase0_search WHERE phase0_search MATCH 'local'").get()
        .n,
      1,
    );
    db.close();
    await c2.request({ method: 'shutdown' });
    await wait(150);
    assert.ok(!fs.existsSync(path.join(env.KARONT_RUNTIME_DIR, 'daemon.sock')));
    assert.ok(!fs.existsSync(path.join(env.KARONT_RUNTIME_DIR, 'session.json')));
    pid = undefined;
  } finally {
    for (const c of clients) c.close();
    if (pid) {
      try {
        process.kill(pid, 'SIGCONT');
        process.kill(pid, 'SIGTERM');
      } catch {}
    }
    for (const p of children) p.kill();
    await wait(150);
    fs.rmSync(root, { recursive: true, force: true });
  }
});
test('recusa diretório público e symlink no lock', async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'karont-unsafe-'));
  // Usa os nomes antigos de propósito para cobrir a compatibilidade EROS_*.
  const env = {
    ...process.env,
    EROS_RUNTIME_DIR: path.join(root, 'run'),
    EROS_DATA_DIR: path.join(root, 'data'),
    EROS_CONFIG_DIR: path.join(root, 'config'),
  };
  delete env.KARONT_RUNTIME_DIR;
  delete env.KARONT_DATA_DIR;
  delete env.KARONT_CONFIG_DIR;
  try {
    fs.mkdirSync(env.EROS_RUNTIME_DIR, { mode: 0o755 });
    // mkdir's mode is filtered by the caller's umask; make the insecure fixture exact.
    fs.chmodSync(env.EROS_RUNTIME_DIR, 0o755);
    let p = launch(env);
    assert.equal((await once(p, 'exit'))[0], 1);
    fs.chmodSync(env.EROS_RUNTIME_DIR, 0o700);
    fs.symlinkSync(path.join(root, 'victim'), path.join(env.EROS_RUNTIME_DIR, 'daemon.lock'));
    p = launch(env);
    assert.equal((await once(p, 'exit'))[0], 1);
    assert.ok(!fs.existsSync(path.join(root, 'victim')));
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test('cliente recusa prova de servidor inválida e confirmação antiga', async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'karont-fake-'));
  const runtime = path.join(root, 'run');
  const data = path.join(root, 'data');
  fs.mkdirSync(runtime, { mode: 0o700 });
  fs.mkdirSync(data, { mode: 0o700 });
  Object.assign(process.env, {
    KARONT_DETECT_AGENTS: '0',
    KARONT_RUNTIME_DIR: runtime,
    KARONT_DATA_DIR: data,
    KARONT_CONFIG_DIR: path.join(root, 'config'),
  });
  const secret = randomBytes(32).toString('hex');
  const ns = randomBytes(32).toString('hex');
  const h = (role, value) =>
    createHmac('sha256', secret).update(`karont:1:${role}:${value}`).digest('hex');
  fs.writeFileSync(path.join(runtime, 'session.json'), JSON.stringify({ version: 1, secret }), {
    mode: 0o600,
  });
  let invalidChallenge = true;
  const sockets = new Set();
  const server = net.createServer((s) => {
    sockets.add(s);
    s.on('error', () => {});
    s.on('close', () => sockets.delete(s));
    s.write(
      JSON.stringify({
        type: 'challenge',
        version: 1,
        nonce: ns,
        proof: invalidChallenge ? '0'.repeat(64) : h('server', ns),
      }) + '\n',
    );
    s.on('data', () =>
      s.write(
        JSON.stringify({
          type: 'ready',
          version: 1,
          proof: h('ready', ns + ':' + '0'.repeat(64)),
        }) + '\n',
      ),
    );
  });
  try {
    server.listen(path.join(runtime, 'daemon.sock'));
    await once(server, 'listening');
    const a = new Client();
    await assert.rejects(() => a.request({ method: 'ping' }), /Identidade|desconectado/);
    a.close();
    invalidChallenge = false;
    const b = new Client();
    await assert.rejects(() => b.request({ method: 'ping' }), /Identidade|desconectado/);
    b.close();
  } finally {
    for (const s of sockets) s.destroy();
    await new Promise((r) => server.close(r));
    fs.rmSync(root, { recursive: true, force: true });
  }
});
