import { _electron as electron } from 'playwright';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { spawn } from 'node:child_process';
import { once } from 'node:events';
import path from 'node:path';
import {
  environment,
  daemon,
  wait,
  until,
  sample,
  host,
  require,
  rendererSandbox,
  openDiagnostics,
  processes,
  Client,
} from './harness.mjs';
const ctx = environment();
let app;
let d;
const runId = new Date().toISOString().replace(/[:.]/g, '-');
const runDir = path.join('benchmarks', 'runs', runId);
fs.mkdirSync(runDir, { recursive: true });
const result = {
  host: host(),
  runId,
  status: 'running',
  stage: 'daemon',
  checks: [],
  artifacts: [],
  metrics: {},
};
fs.mkdirSync('benchmarks', { recursive: true });
try {
  result.stage = 'native-preflight';
  // Independent fresh profile + no daemon: integrated process-cold start.
  // OS caches are intentionally NOT dropped; no privileged host changes.
  const cold = environment();
  Object.assign(process.env, {
    KARONT_RUNTIME_DIR: cold.env.KARONT_RUNTIME_DIR,
    KARONT_DATA_DIR: cold.env.KARONT_DATA_DIR,
  });
  const coldClient = new Client();
  const preflightStart = performance.now();
  const preflight = spawn(require('electron'), ['dist/desktop/main.cjs'], {
    env: cold.env,
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  let stderr = '';
  let stdout = '';
  preflight.stderr.on('data', (v) => (stderr += v.toString()));
  try {
    await new Promise((resolve, reject) => {
      const timer = setTimeout(() => reject(Error('Preflight expirou: ' + stderr)), 15000);
      const fail = (error) => {
        clearTimeout(timer);
        reject(error);
      };
      preflight.once('error', fail);
      preflight.once('exit', (code, signal) =>
        fail(Error(`Electron sandbox preflight exited ${code}/${signal}: ${stderr}`)),
      );
      preflight.stdout.on('data', (v) => {
        stdout += v.toString();
        if (stdout.includes('window-ready')) {
          clearTimeout(timer);
          resolve();
        }
      });
    });
    const state = await coldClient.request({ method: 'ping' });
    result.metrics.coldStartMs = performance.now() - preflightStart;
    result.coldStart = {
      definition: 'fresh shell + daemon + profile; OS caches retained',
      daemonPid: state.pid,
    };
  } finally {
    const exit =
      preflight.exitCode === null && preflight.signalCode === null
        ? once(preflight, 'exit').catch(() => {})
        : Promise.resolve();
    preflight.kill();
    await exit;
    await coldClient.request({ method: 'shutdown' }).catch(() => {});
    coldClient.close();
    fs.rmSync(cold.root, { recursive: true, force: true });
  }
  result.stage = 'daemon';
  d = await daemon(ctx.env);
  result.metrics.daemonStartupMs = d.startupMs;
  result.stage = 'playwright-launch';
  const t = performance.now();
  app = await electron.launch({
    chromiumSandbox: true,
    args: ['dist/desktop/main.cjs'],
    env: ctx.env,
    timeout: 20000,
  });
  result.stage = 'renderer-security';
  const page = await app.firstWindow();
  page.setDefaultTimeout(10000);
  const errors = [];
  page.on('pageerror', (e) => errors.push(e.message));
  await openDiagnostics(page);
  result.metrics.electronStartupMs = performance.now() - t;
  assert.equal(await page.locator('.panel').count(), 8);
  result.checks.push('oito painéis em um renderer');
  const security = await app.evaluate(({ BrowserWindow }) => {
    const w = BrowserWindow.getAllWindows()[0];
    const p = w.webContents.getLastWebPreferences();
    return {
      sandbox: p.sandbox,
      contextIsolation: p.contextIsolation,
      nodeIntegration: p.nodeIntegration,
    };
  });
  assert.deepEqual(security, { sandbox: true, contextIsolation: true, nodeIntegration: false });
  const args = app.process().spawnargs;
  for (const flag of [
    '--no-sandbox',
    '--disable-seccomp-filter-sandbox',
    '--disable-namespace-sandbox',
    '--disable-setuid-sandbox',
    '--disable-gpu-sandbox',
    '--single-process',
  ])
    assert.ok(!args.some((a) => a === flag || a.startsWith(flag + '=')), `Flag insegura: ${flag}`);
  const runtime = await page.evaluate(() => window.karont.runtime);
  assert.deepEqual(runtime, { sandboxed: true, contextIsolated: true });
  const rendererPid = await app.evaluate(({ BrowserWindow }) =>
    BrowserWindow.getAllWindows()[0].webContents.getOSProcessId(),
  );
  const kernel = rendererSandbox(rendererPid);
  assert.equal(kernel.seccomp, 2);
  assert.equal(kernel.noNewPrivs, 1);
  result.sandbox = { preferences: security, runtime, kernel, launchArgs: args, verified: true };
  result.checks.push('sandbox efetivo: runtime isolado, filtro seccomp e NoNewPrivs no renderer');
  assert.equal(await page.evaluate(() => typeof window.require), 'undefined');
  result.checks.push('sandbox, contextIsolation e ausência de Node no renderer');
  await assert.rejects(() => page.evaluate(() => window.karont.layout({ columns: 99 })));
  result.checks.push('IPC inválido rejeitado');
  result.stage = 'workload-and-persistence';
  await wait(1000);
  const electronPid = app.process().pid;
  const resources = async (work) => {
    const [electron, daemon] = await Promise.all([sample(electronPid), sample(d.pid), work?.()]);
    return {
      electron,
      daemon,
      total: {
        rssMiB: electron.rssMiB + daemon.rssMiB,
        pssMiB:
          electron.pssMiB === null || daemon.pssMiB === null
            ? null
            : electron.pssMiB + daemon.pssMiB,
        cpuPercentOneCore: electron.cpuPercentOneCore + daemon.cpuPercentOneCore,
      },
    };
  };
  result.metrics.idle = await resources();
  await page.getByRole('button', { name: 'Abrir editor', exact: true }).click();
  await page.locator('.cm-content').waitFor();
  await page.locator('.cm-content').fill('// restauração confirmada\nconst fase = 0;');
  await page.getByLabel('Colunas', { exact: true }).selectOption('2');
  await until(async () => {
    const s = await d.client.request({ method: 'snapshot' });
    assert.equal(s.layout.columns, 2);
    assert.ok(s.layout.editor.includes('restauração confirmada'));
    return s;
  });
  await page.getByLabel('Colunas', { exact: true }).selectOption('4');
  await page.getByRole('button', { name: 'Iniciar streaming', exact: true }).click();
  await wait(1100);
  // rAF gaps and event-to-next-paint latency while all panels stream.
  result.metrics.responsiveness = await page.evaluate(async () => {
    const frames = [];
    let prev = performance.now();
    const end = prev + 2500;
    await new Promise((resolve) => {
      function tick(now) {
        frames.push(now - prev);
        prev = now;
        if (now < end) requestAnimationFrame(tick);
        else resolve();
      }
      requestAnimationFrame(tick);
    });
    frames.sort((a, b) => a - b);
    return {
      frameGapP50Ms: frames[Math.floor(frames.length * 0.5)],
      frameGapP95Ms: frames[Math.floor(frames.length * 0.95)],
      frames: frames.length,
      over50ms: frames.filter((n) => n > 50).length,
    };
  });
  result.metrics.streaming = await resources();
  result.metrics.editor = await resources(async () => {
    await page.locator('.cm-content').focus();
    for (let n = 0; n < 25; n++) {
      await page.keyboard.type('// edição medida\n');
      await wait(100);
    }
  });
  await until(async () =>
    assert.ok(
      (await d.client.request({ method: 'snapshot' })).layout.editor.includes('edição medida'),
    ),
  );
  const interactions = [];
  for (let n = 0; n < 10; n++) {
    interactions.push(
      await page.evaluate(async () => {
        const t = performance.now();
        document.querySelector('select').focus();
        await new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r)));
        return performance.now() - t;
      }),
    );
  }
  result.metrics.focusToPaintMs = interactions;
  const wide = path.join(runDir, 'desktop-eight-panels.png');
  await page.screenshot({ path: wide, fullPage: true });
  result.artifacts.push(wide);
  // Editor state survives responsive viewport changes without horizontal overflow.
  await page.setViewportSize({ width: 900, height: 800 });
  const compact = path.join(runDir, 'desktop-compact.png');
  await page.screenshot({ path: compact, fullPage: true });
  result.artifacts.push(compact);
  assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth));
  result.checks.push('layout compacto sem overflow horizontal');
  result.stage = 'native-close';
  const beforeClose = await d.client.request({ method: 'snapshot' });
  assert.equal(beforeClose.layout.columns, 4);
  const closed = page.waitForEvent('close');
  // BrowserWindow.close follows the native X close event path, without renderer IPC.
  // The compositor's physical X control remains an explicitly manual check.
  await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].close());
  await closed;
  await until(async () => {
    assert.equal(
      await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows().length),
      0,
    );
  });
  assert.equal((await d.client.request({ method: 'ping' })).pid, d.pid);
  const afterClose = await d.client.request({ method: 'ping' });
  await wait(1200);
  const continued = await d.client.request({ method: 'ping' });
  assert.ok(continued.heartbeat > afterClose.heartbeat);
  assert.ok(continued.sequence > afterClose.sequence);
  assert.equal(continued.pid, d.pid);
  await until(async () =>
    assert.equal(
      await app.evaluate(({ app }) => app.getAppMetrics().filter((m) => m.type === 'Tab').length),
      0,
    ),
  );
  result.checks.push(
    'fechamento nativo equivalente ao X destrói BrowserWindow; mesmo daemon continua heartbeat e streaming',
  );
  result.metrics.noWindow = await resources();
  result.stage = 'reopen';
  const reopen = performance.now();
  const nextWindow = app.waitForEvent('window', { timeout: 15000 });
  // Exercise the exact same path as relaunching npm start (second-instance).
  const second = spawn(require('electron'), ['dist/desktop/main.cjs'], {
    env: ctx.env,
    stdio: 'ignore',
  });
  const secondExit = once(second, 'exit');
  const restored = await nextWindow;
  await openDiagnostics(restored);
  result.metrics.reopenMs = performance.now() - reopen;
  await restored.locator('.cm-content').waitFor();
  assert.ok((await restored.locator('.cm-content').innerText()).includes('restauração confirmada'));
  assert.equal(await restored.getByLabel('Colunas', { exact: true }).inputValue(), '4');
  assert.equal((await d.client.request({ method: 'ping' })).pid, d.pid);
  result.checks.push('segunda execução reabre janela, restaura editor e colunas com mesmo daemon');
  assert.equal((await secondExit)[0], 0);
  await restored.getByRole('button', { name: 'Pausar streaming', exact: true }).click();
  result.stage = 'suspend-resume-simulation';
  // Scheduling pause, NOT a claim of physical suspend or compositor integration.
  const daemonIdentity = processes(d.pid)[0];
  const shellIdentity = processes(electronPid).find((p) => p.pid === electronPid);
  const resumedHeartbeat = (await d.client.request({ method: 'ping' })).heartbeat;
  try {
    app.process().kill('SIGSTOP');
    d.child.kill('SIGSTOP');
    await assert.rejects(() => d.client.request({ method: 'ping' }), /expirou|desconectado/);
    await wait(1200);
  } finally {
    d.child.kill('SIGCONT');
    app.process().kill('SIGCONT');
  }
  await until(async () => {
    const state = await d.client.request({ method: 'ping' });
    assert.equal(state.pid, d.pid);
    assert.ok(state.heartbeat > resumedHeartbeat);
  });
  await restored.getByText('Daemon conectado', { exact: true }).waitFor();
  assert.equal(processes(d.pid)[0].startTicks, daemonIdentity.startTicks);
  assert.equal(
    processes(electronPid).find((p) => p.pid === electronPid).startTicks,
    shellIdentity.startTicks,
  );
  const duplicate = spawn(process.execPath, ['dist/daemon/entry.cjs'], {
    env: ctx.env,
    stdio: 'ignore',
  });
  assert.equal((await once(duplicate, 'exit'))[0], 73);
  result.suspendResume = {
    simulated: true,
    mechanism: 'SIGSTOP/SIGCONT main + daemon; client timeout >3s',
    daemon: daemonIdentity,
    shell: shellIdentity,
    duplicateExitCode: 73,
    passed: true,
  };
  result.checks.push(
    'pausa simulada e retomada: reconexão, identidades preservadas, singleton continua recusando duplicado',
  );
  result.stage = 'shell-quit';
  await app.close();
  app = undefined;
  assert.equal((await d.client.request({ method: 'ping' })).pid, d.pid);
  result.checks.push('encerrar Electron preserva daemon independente');
  assert.deepEqual(errors, []);
  result.checks.push('nenhum erro no renderer');
  result.passed = true;
  result.status = 'passed';
  result.stage = 'complete';
} catch (e) {
  result.passed = false;
  result.error = e.stack;
  const sandboxHost =
    result.stage === 'native-preflight' &&
    /SUID sandbox|No usable sandbox|user namespace/i.test(e.message);
  result.status = sandboxHost ? 'blocked' : 'failed';
  result.failure = {
    kind: sandboxHost ? 'sandbox-host' : 'test-failure',
    stage: result.stage,
    message: e.message,
  };
  process.exitCode = 1;
  console.error(e);
} finally {
  if (app) await app.close().catch(() => {});
  if (d) {
    d.client.close();
    d.child.kill('SIGTERM');
  }
  await wait(200);
  fs.rmSync(ctx.root, { recursive: true, force: true });
  fs.writeFileSync(path.join(runDir, 'desktop.json'), JSON.stringify(result, null, 2));
  fs.writeFileSync('benchmarks/desktop-latest.json', JSON.stringify(result, null, 2));
  console.log(JSON.stringify(result, null, 2));
}
