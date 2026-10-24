import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import net from 'node:net';
import { once } from 'node:events';
import { Client, sample } from '../scripts/harness.mjs';

test('benchmark recusa PID inexistente em vez de reportar consumo zero', async () => {
  await assert.rejects(() => sample(2147483647, 1), /processo|Processo/);
});

test('fechar cliente durante handshake cancela a conexão imediatamente', async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'eros-close-test-'));
  const runtime = path.join(root, 'run');
  const data = path.join(root, 'data');
  fs.mkdirSync(runtime, { mode: 0o700 });
  fs.mkdirSync(data, { mode: 0o700 });
  const previous = {
    EROS_RUNTIME_DIR: process.env.EROS_RUNTIME_DIR,
    EROS_DATA_DIR: process.env.EROS_DATA_DIR,
  };
  Object.assign(process.env, { EROS_RUNTIME_DIR: runtime, EROS_DATA_DIR: data });
  fs.writeFileSync(
    path.join(runtime, 'session.json'),
    JSON.stringify({ version: 1, secret: 'a'.repeat(64) }),
    { mode: 0o600 },
  );
  const sockets = new Set();
  const server = net.createServer((s) => {
    sockets.add(s);
    s.on('error', () => {});
    s.on('close', () => sockets.delete(s));
  });
  const c = new Client();
  let timer;
  try {
    server.listen(path.join(runtime, 'daemon.sock'));
    await once(server, 'listening');
    const connected = once(server, 'connection');
    // A peer that never sends a challenge must still be cancellable by its owner.
    const request = assert.rejects(
      () => c.request({ method: 'ping' }),
      /desconectado|fechado|cancelado/i,
    );
    await connected;
    c.close();
    await Promise.race([
      request,
      new Promise((_, reject) => {
        timer = setTimeout(() => reject(Error('Cliente não cancelou handshake')), 200);
      }),
    ]);
  } finally {
    clearTimeout(timer);
    c.close();
    for (const s of sockets) s.destroy();
    await new Promise((r) => server.close(r));
    for (const [key, value] of Object.entries(previous)) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test('benchmark recusa processo que encerra durante a amostra', async () => {
  const { spawn } = await import('node:child_process');
  const child = spawn(process.execPath, ['-e', 'setInterval(()=>{},1000)'], { stdio: 'ignore' });
  await once(child, 'spawn');
  const exit = once(child, 'exit');
  const timer = setTimeout(() => child.kill(), 20);
  try {
    await assert.rejects(() => sample(child.pid, 100), /encerrou|reutilizado/);
  } finally {
    clearTimeout(timer);
    child.kill();
    await exit;
  }
});

test('relatório não converte falha funcional em diagnóstico de sandbox nem aceita prova ausente', async () => {
  const { renderReport } = await import('../scripts/report.mjs');
  const functional = renderReport(null, {
    passed: false,
    stage: 'reopen',
    failure: { kind: 'test-failure', stage: 'reopen', message: 'editor não restaurado' },
  });
  assert.match(functional, /execução falhou na etapa \*\*reopen\*\*/);
  assert.doesNotMatch(functional, /O preflight nativo falhou/);
  const unproven = renderReport(null, { passed: true });
  assert.match(unproven, /não contém a evidência mínima/);
  assert.doesNotMatch(unproven, /Desktop — verificado com sandbox/);
});

test('aceite recusa evidência contraditória e argumentos inseguros mesmo com passed:true', async () => {
  const { desktopValid } = await import('../scripts/desktop-proof.mjs');
  const valid = {
    passed: true,
    sandbox: {
      verified: true,
      preferences: { sandbox: true, contextIsolation: true, nodeIntegration: false },
      runtime: { sandboxed: true, contextIsolated: true },
      kernel: { pid: 123, seccomp: 2, noNewPrivs: 1 },
      launchArgs: ['electron', 'main.cjs'],
    },
  };
  assert.equal(desktopValid(valid), true);
  for (const change of [
    (r) => (r.sandbox.preferences.contextIsolation = false),
    (r) => (r.sandbox.runtime.contextIsolated = false),
    (r) => (r.sandbox.preferences.nodeIntegration = true),
    (r) => (r.sandbox.kernel.pid = 0),
    (r) => r.sandbox.launchArgs.push('--disable-seccomp-filter-sandbox=true'),
    (r) => delete r.sandbox.launchArgs,
  ]) {
    const r = structuredClone(valid);
    change(r);
    assert.equal(desktopValid(r), false);
  }
});

test('série exige cinco rodadas válidas; percentil usa nearest-rank e não inventa amostras', async () => {
  const { summarize } = await import('../scripts/benchmark-series.mjs');
  const { distribution } = await import('../scripts/desktop-proof.mjs');
  assert.throws(() => summarize([]), /cinco/);
  assert.throws(() => summarize(Array(5).fill({ passed: true })), /sandbox/);
  assert.throws(() => distribution([1, null]), /inválidas/);
  assert.deepEqual(distribution([5, 1, 4, 2, 3]), {
    samples: 5,
    median: 3,
    p95: 5,
    min: 1,
    max: 5,
  });
});
