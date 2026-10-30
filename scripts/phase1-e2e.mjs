import { _electron as electron } from 'playwright';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawn, execFileSync } from 'node:child_process';
import { once } from 'node:events';
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
const { Client } = require('../dist/local/client.cjs');
const { environment, wait, until, sample, openDiagnostics, require: harnessRequire } = await import('./harness.mjs');
const ctx = environment();
const repo = path.join(ctx.root, 'repo');
fs.mkdirSync(repo);
const git = (...args) => execFileSync('git', args, { cwd: repo, stdio: 'ignore' });
git('init', '--quiet');
git('config', 'user.email', 'e2e@local.invalid');
git('config', 'user.name', 'eros e2e');
fs.writeFileSync(path.join(repo, 'base.txt'), 'before\n');
git('add', '.');
git('commit', '--quiet', '-m', 'fixture');
const fakeCli = `const fs=require('node:fs');const readline=require('node:readline');const name=process.argv[1];console.log('PTY_READY '+name+' '+process.pid);readline.createInterface({input:process.stdin}).on('line',line=>{if(line==='write'){fs.writeFileSync('base.txt','after '+name+'\\n');fs.writeFileSync(name+'.txt','created '+name+'\\n');console.log('PTY_WROTE '+name)}if(line==='fail')process.exit(1);if(line==='finish'){console.log('PTY_FINISHED '+name);process.exit(0)}});setInterval(()=>{},1000);`;
const config = path.join(ctx.root, 'dots.json');
fs.writeFileSync(
  config,
  JSON.stringify({
    version: 1,
    projects: [{ id: 'fixture', name: 'Fixture', root: repo }],
    dots: ['alpha', 'beta'].map((id) => ({
      id,
      name: id.toUpperCase(),
      role: `Work on ${id}`,
      executable: process.execPath,
      args: ['-e', fakeCli, id],
      projectIds: ['fixture'],
    })),
  }),
  { mode: 0o600 },
);
ctx.env.EROS_DOTS_CONFIG = config;
Object.assign(process.env, {
  EROS_RUNTIME_DIR: ctx.env.EROS_RUNTIME_DIR,
  EROS_DATA_DIR: ctx.env.EROS_DATA_DIR,
  EROS_DOTS_CONFIG: config,
});
const notificationLog = path.join(ctx.root, 'notifications.jsonl');
let notificationService;
let notificationErrors = '';
const client = new Client();
let app;
let electronProcess;
let daemonPid;
let second;
let startedRuns = [];
const events = [];
client.onEvent((event) => events.push(event));
async function attach(runId) {
  const session = await client.request({ method: 'terminal.attach', value: { runId } });
  const scrollback = await until(() => {
    const matching = events.filter(
      (event) => event.type === 'terminal.snapshot' && event.runId === runId,
    );
    const lastFinal = matching.findLastIndex((event) => event.final);
    assert.ok(lastFinal >= 0);
    const previousFinal = matching.findLastIndex(
      (event, index) => index < lastFinal && event.final,
    );
    return matching
      .slice(previousFinal + 1, lastFinal + 1)
      .map((event) => event.data)
      .join('');
  });
  return { ...session, scrollback };
}
const idStamp = new Date().toISOString().replace(/[:.]/g, '-');
const evidence = path.join('benchmarks', 'runs', idStamp);
fs.mkdirSync(evidence, { recursive: true });
const result = { status: 'running', stage: 'launch', checks: [], artifacts: [], runId: idStamp };
const clockTicks = Number(execFileSync('getconf', ['CLK_TCK'], { encoding: 'utf8' }).trim());
function oneProcess(pid) {
  const stat = fs.readFileSync(`/proc/${pid}/stat`, 'utf8');
  const fields = stat.slice(stat.lastIndexOf(')') + 2).split(' ');
  const status = fs.readFileSync(`/proc/${pid}/status`, 'utf8');
  let pssBytes = null;
  try {
    pssBytes =
      Number(fs.readFileSync(`/proc/${pid}/smaps_rollup`, 'utf8').match(/^Pss:\s+(\d+)/m)[1]) *
      1024;
  } catch {}
  return {
    pid,
    startTicks: fields[19],
    cpuSeconds: (Number(fields[11]) + Number(fields[12])) / clockTicks,
    rssMiB: Number(status.match(/^VmRSS:\s+(\d+)/m)?.[1] ?? 0) / 1024,
    pssMiB: pssBytes === null ? null : pssBytes / 1048576,
  };
}
async function sampleOne(pid, ms = 2500) {
  const before = oneProcess(pid);
  await wait(ms);
  const after = oneProcess(pid);
  assert.equal(after.startTicks, before.startTicks, 'processo foi substituído durante a amostra');
  return {
    rssMiB: after.rssMiB,
    pssMiB: after.pssMiB,
    cpuPercentOneCore: ((after.cpuSeconds - before.cpuSeconds) / (ms / 1000)) * 100,
  };
}
async function measure(electronPid, daemon, cliPids = []) {
  const [electronSample, daemonSample, ...cliSamples] = await Promise.all([
    sample(electronPid, 2500),
    sampleOne(daemon, 2500),
    ...cliPids.map((pid) => sample(pid, 2500)),
  ]);
  const compact = (value) => ({
    durationMs: value.durationMs ?? 2500,
    processCount: value.processes?.length ?? 1,
    rssMiB: value.rssMiB,
    pssMiB: value.pssMiB,
    cpuPercentOneCore: value.cpuPercentOneCore,
  });
  const components = [electronSample, daemonSample, ...cliSamples].map(compact);
  return {
    electron: components[0],
    daemon: components[1],
    clis: components.slice(2),
    total: {
      rssMiB: components.reduce((sum, value) => sum + value.rssMiB, 0),
      pssMiB: components.every((value) => value.pssMiB !== null)
        ? components.reduce((sum, value) => sum + value.pssMiB, 0)
        : null,
      cpuPercentOneCore: components.reduce((sum, value) => sum + value.cpuPercentOneCore, 0),
    },
  };
}
try {
  if (process.env.EROS_TEST_NOTIFICATIONS === '1') {
    notificationService = spawn(
      '/usr/bin/python3',
      ['tests/fixtures/notification-service.py', notificationLog],
      { env: ctx.env, stdio: ['ignore', 'pipe', 'pipe'] },
    );
    notificationService.stderr.on('data', (chunk) => {
      notificationErrors += chunk.toString();
    });
    await new Promise((resolve, reject) => {
      const timer = setTimeout(() => reject(Error('notification fixture timeout')), 5000);
      notificationService.stdout.once('data', () => {
        clearTimeout(timer);
        resolve();
      });
      notificationService.once('exit', () => {
        clearTimeout(timer);
        reject(Error('notification fixture unavailable'));
      });
    });
  }
  app = await electron.launch({
    chromiumSandbox: true,
    args: ['dist/desktop/main.cjs'],
    env: ctx.env,
    timeout: 20000,
  });
  const page = await app.firstWindow();
  page.setDefaultTimeout(12000);
  await openDiagnostics(page);
  electronProcess = app.process();
  const electronPid = electronProcess.pid;
  daemonPid = (await client.request({ method: 'ping' })).pid;
  result.metrics = { idle: await measure(electronPid, daemonPid) };
  assert.equal(await page.evaluate(() => window.eros.runtime.sandboxed), true);
  const rendererPid = await app.evaluate(({ webContents }) =>
    webContents
      .getAllWebContents()
      .find((w) => w.getType() === 'window')
      .getOSProcessId(),
  );
  const sandboxStatus = fs.readFileSync(`/proc/${rendererPid}/status`, 'utf8');
  assert.match(sandboxStatus, /Seccomp:\s+2/);
  assert.match(sandboxStatus, /NoNewPrivs:\s+1/);
  result.checks.push('sandbox runtime, Seccomp=2 e NoNewPrivs=1');
  await page.getByRole('button', { name: 'Diagnóstico', exact: true }).click();
  await page.getByText('Coleta sob demanda. “Não verificado” não significa disponível.').waitFor();
  await page.waitForFunction(() => document.querySelectorAll('.diagnostic-list dt').length > 5);
  const diagnosticShot = path.join(evidence, 'phase2-diagnostics.png');
  await page.screenshot({ path: diagnosticShot, fullPage: true });
  result.artifacts.push(diagnosticShot);
  await page.getByRole('button', { name: 'Reportar problema', exact: true }).click();
  await until(async () => {
    assert.ok(
      (await page.getByRole('textbox', { name: 'Prévia do relatório' }).inputValue()).includes(
        '# Karont',
      ),
    );
    return true;
  });
  const report = await page.getByRole('textbox', { name: 'Prévia do relatório' }).inputValue();
  assert.ok(!report.includes(ctx.root));
  assert.ok(!report.includes('PTY_READY'));
  assert.ok(!report.includes(repo));
  await page.getByRole('button', { name: 'Copiar relatório', exact: true }).click();
  await page.getByText('Relatório copiado.', { exact: true }).waitFor();
  assert.match(await app.evaluate(({ clipboard }) => clipboard.readText()), /# Karont/);
  const savedReport = path.join(ctx.root, 'saved-report.md');
  await app.evaluate(({ dialog }, file) => {
    dialog.showSaveDialog = async () => ({ canceled: false, filePath: file });
  }, savedReport);
  await page.getByRole('button', { name: 'Salvar Markdown', exact: true }).click();
  await until(() => {
    assert.ok(fs.readFileSync(savedReport, 'utf8').includes('# Karont'));
    return true;
  });
  assert.ok(!fs.readFileSync(savedReport, 'utf8').includes(repo));
  const reportFile = path.join(evidence, 'phase2-report.md');
  fs.writeFileSync(reportFile, report);
  result.artifacts.push(reportFile);
  await assert.rejects(() => page.evaluate(() => window.eros.decideApproval('invalid', true)));
  await assert.rejects(() =>
    page.evaluate(() => window.eros.startRun('alpha', 'fixture', 'readOnly')),
  );
  await app.evaluate(({ dialog }) => {
    globalThis.__erosOriginalConfirm = dialog.showMessageBox;
    globalThis.__erosConfirms = 0;
    dialog.showMessageBox = async () => {
      globalThis.__erosConfirms++;
      return { response: 0, checkboxChecked: false };
    };
  });
  await assert.rejects(() =>
    page.evaluate(() => window.eros.startRun('alpha', 'fixture', 'full', true)),
  );
  assert.equal(
    await app.evaluate(() => globalThis.__erosConfirms),
    1,
    'renderer não pode pular confirmação nativa de acesso total',
  );
  await app.evaluate(({ dialog }) => {
    dialog.showMessageBox = globalThis.__erosOriginalConfirm;
  });
  await page.getByRole('button', { name: 'Fechar painel', exact: true }).click();
  result.checks.push('Diagnóstico, prévia de relatório sanitizado e IPC inválido recusado');
  await page.getByRole('combobox', { name: 'Projeto Git' }).selectOption('fixture');
  await page.getByRole('button', { name: 'Iniciar dot', exact: true }).nth(0).click();
  await page.getByRole('button', { name: 'Iniciar dot', exact: true }).nth(1).click();
  await page.locator('.run-card').nth(1).waitFor();
  const runs = await until(async () => {
    const list = await client.request({ method: 'runs.list', value: { limit: 10 } });
    const pair = list.filter((run) => ['alpha', 'beta'].includes(run.dotId)).slice(0, 2);
    assert.equal(pair.length, 2);
    assert.ok(pair.every((run) => run.state === 'running' && run.pid > 0));
    return pair;
  });
  startedRuns = runs;
  result.runs = runs.map(({ id, dotId, pid, branch }) => ({ id, dotId, pid, branch }));
  for (const run of runs) assert.ok(process.kill(run.pid, 0), `PTY ${run.pid} não está ativo`);
  result.metrics.twoTerminals = await measure(
    electronPid,
    daemonPid,
    runs.map((run) => run.pid),
  );
  const initialOutput = await until(async () => {
    const cards = await page.locator('.terminal-shell').evaluateAll((nodes) =>
      nodes.map((node) =>
        Array.from(node.querySelectorAll('.xterm-rows > div'))
          .map((row) => row.textContent?.trim() ?? '')
          .filter(Boolean)
          .join('\n'),
      ),
    );
    assert.equal(cards.length, 2);
    assert.ok(cards.every((value) => value.includes('PTY_READY')));
    return cards;
  });
  result.initialTerminalOutput = initialOutput;
  const backendInitial = await Promise.all(runs.map((run) => attach(run.id)));
  result.backendReadyCounts = backendInitial.map(
    (session) => (session.scrollback.match(/PTY_READY/g) ?? []).length,
  );
  const activeShot = path.join(evidence, 'phase1-two-terminals.png');
  await page.screenshot({ path: activeShot, fullPage: true });
  result.artifacts.push(activeShot);
  fs.writeFileSync(path.join(evidence, 'phase1-e2e.json'), JSON.stringify(result, null, 2));
  for (const value of initialOutput)
    assert.equal(
      (value.match(/PTY_READY/g) ?? []).length,
      1,
      'a saída inicial do PTY foi renderizada mais de uma vez',
    );
  await page
    .locator('.terminal-shell')
    .nth(0)
    .getByText(/PTY_READY/)
    .waitFor()
    .catch(async () => {
      await until(async () => {
        const values = await Promise.all(runs.map((run) => attach(run.id)));
        assert.ok(values.every((s) => s.scrollback.includes('PTY_READY')));
        return values;
      });
    });
  result.checks.push('dois dots iniciados em PTYs independentes');
  result.stage = 'close-window';
  const closed = page.waitForEvent('close');
  await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].close());
  await closed;
  assert.equal((await client.request({ method: 'ping' })).pid, daemonPid);
  for (const run of runs)
    assert.ok(process.kill(run.pid, 0), `PTY ${run.pid} encerrou junto da janela`);
  result.metrics.windowClosed = await measure(
    electronPid,
    daemonPid,
    runs.map((run) => run.pid),
  );
  result.checks.push('BrowserWindow destruída; daemon e dois processos PTY permaneceram ativos');
  result.stage = 'reopen-window';
  const nextWindow = app.waitForEvent('window');
  second = spawn(harnessRequire('electron'), ['dist/desktop/main.cjs'], {
    env: ctx.env,
    stdio: 'ignore',
  });
  let restored = await nextWindow;
  await openDiagnostics(restored);
  assert.equal(
    (await client.request({ method: 'ping' })).pid,
    daemonPid,
    'a janela reabriu conectada a outro daemon',
  );
  if (second.exitCode === null && second.signalCode === null) await once(second, 'exit');
  await restored.locator('.run-card').nth(1).waitFor();
  const scrollback = await Promise.all(runs.map((run) => attach(run.id)));
  assert.deepEqual(
    scrollback.map((session) => session.run.pid),
    runs.map((run) => run.pid),
    'a reabertura recuperou outros processos PTY',
  );
  assert.ok(scrollback.every((session) => session.scrollback.includes('PTY_READY')));
  for (const run of runs)
    await restored.evaluate((id) => window.eros.writeTerminal(id, 'write\r'), run.id);
  await until(async () => {
    const sessions = await Promise.all(runs.map((run) => attach(run.id)));
    assert.ok(sessions.every((session) => session.scrollback.includes('PTY_WROTE')));
    return sessions;
  });
  const restoredShot = path.join(evidence, 'phase1-reconnected.png');
  await restored.screenshot({ path: restoredShot, fullPage: true });
  result.artifacts.push(restoredShot);
  result.checks.push('janela reaberta recuperou os mesmos PIDs, saída PTY e entrada interativa');
  for (const run of runs)
    await restored.evaluate((id) => window.eros.writeTerminal(id, 'finish\r'), run.id);
  await until(async () => {
    const all = await client.request({ method: 'runs.list', value: { limit: 10 } });
    assert.ok(runs.every((run) => all.find((item) => item.id === run.id).state === 'completed'));
    return all;
  });
  await restored.getByRole('button', { name: 'Diff', exact: true }).first().click();
  await restored.getByRole('heading', { name: 'Alterações desta execução' }).waitFor();
  assert.ok((await restored.locator('.file-list li').count()) >= 2);
  await restored.getByRole('button', { name: 'Desfazer alterações', exact: true }).click();
  await restored.getByRole('dialog').waitFor();
  assert.equal(
    await restored.evaluate(() => Boolean(document.activeElement?.closest('dialog'))),
    true,
  );
  assert.equal(
    await restored.getByRole('button', { name: 'Confirmar reversão', exact: true }).isEnabled(),
    true,
    'Rollback deve ter aprovação válida',
  );
  await restored.keyboard.press('Escape');
  await restored.getByRole('dialog').waitFor({ state: 'hidden' });
  await until(async () => {
    assert.ok(
      (await client.request({ method: 'approvals.list' })).some((a) => a.status === 'denied'),
    );
    return true;
  });
  await restored.getByRole('button', { name: 'Desfazer alterações', exact: true }).click();
  await restored.getByRole('dialog').waitFor();
  await restored.getByRole('button', { name: 'Confirmar reversão' }).click();
  await until(async () => {
    const approvals = await client.request({ method: 'approvals.list' });
    assert.ok(approvals.some((a) => a.status === 'applied'));
    return true;
  });
  await restored.getByRole('button', { name: 'Central de Aprovações', exact: true }).click();
  await restored.getByText('Rollback · applied', { exact: true }).waitFor();
  const approvalShot = path.join(evidence, 'phase2-approvals.png');
  await restored.screenshot({ path: approvalShot, fullPage: true });
  result.artifacts.push(approvalShot);
  result.checks.push('diff exibido, prévia confirmada, rollback auditado na Central de Aprovações');
  if (notificationService) {
    result.nativeNotificationState = await restored.evaluate(() => window.eros.notifications());
    await until(() => {
      const records = fs
        .readFileSync(notificationLog, 'utf8')
        .trim()
        .split('\n')
        .map((line) => JSON.parse(line));
      assert.equal(records.filter((r) => r.title === 'Execução concluída').length, 2);
      assert.equal(records.filter((r) => r.title === 'Rollback concluído').length, 1);
      return records;
    });
    result.notifications = fs
      .readFileSync(notificationLog, 'utf8')
      .trim()
      .split('\n')
      .map((line) => JSON.parse(line));
    result.checks.push(
      'Notificações recebidas via D-Bus freedesktop, conteúdo fixo e sem duplicação',
    );
  }
  const beforeBackground = restored.waitForEvent('close');
  await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].close());
  await beforeBackground;
  assert.equal(await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows().length), 0);
  const background = await client.request({
    method: 'runs.start',
    value: { dotId: 'alpha', projectId: 'fixture' },
  });
  startedRuns.push(background);
  await until(async () => {
    const session = await attach(background.id);
    assert.ok(session.scrollback.includes('PTY_READY'));
    return true;
  });
  await client.request({
    method: 'terminal.write',
    value: { runId: background.id, data: 'fail\r' },
  });
  await until(async () => {
    assert.equal(
      (await client.request({ method: 'runs.list', value: { limit: 10 } })).find(
        (r) => r.id === background.id,
      ).state,
      'failed',
    );
    return true;
  });
  if (notificationService) {
    await until(() => {
      const records = fs
        .readFileSync(notificationLog, 'utf8')
        .trim()
        .split('\n')
        .map((line) => JSON.parse(line));
      assert.equal(records.filter((r) => r.title === 'Execução com erro').length, 1);
      return true;
    });
    result.notifications = fs
      .readFileSync(notificationLog, 'utf8')
      .trim()
      .split('\n')
      .map((line) => JSON.parse(line));
  }
  result.checks.push(
    notificationService
      ? 'Notificação de erro entregue sem BrowserWindow e sem renderer adicional'
      : 'Run falhou sem BrowserWindow; entrega nativa não verificada sem fixture',
  );
  const nextAgain = app.waitForEvent('window');
  second = spawn(harnessRequire('electron'), ['dist/desktop/main.cjs'], {
    env: ctx.env,
    stdio: 'ignore',
  });
  restored = await nextAgain;
  await openDiagnostics(restored);
  if (second.exitCode === null && second.signalCode === null) await once(second, 'exit');
  const reconnectRun = await client.request({
    method: 'runs.start',
    value: { dotId: 'beta', projectId: 'fixture' },
  });
  startedRuns.push(reconnectRun);
  await until(async () => {
    assert.ok((await attach(reconnectRun.id)).scrollback.includes('PTY_READY'));
    return true;
  });
  await restored.locator(`#run-${reconnectRun.id}`).waitFor();
  process.kill(daemonPid, 'SIGSTOP');
  await restored.getByText('Desconectado', { exact: true }).waitFor();
  process.kill(daemonPid, 'SIGCONT');
  await restored.getByText('Daemon conectado', { exact: true }).waitFor();
  assert.equal((await client.request({ method: 'ping' })).pid, daemonPid);
  await restored.evaluate((id) => window.eros.writeTerminal(id, 'write\r'), reconnectRun.id);
  await until(async () => {
    const text = await restored.locator(`#run-${reconnectRun.id} .terminal-shell`).innerText();
    assert.ok(text.includes('PTY_WROTE'));
    return true;
  });
  if (notificationService) {
    await until(() => {
      const records = fs
        .readFileSync(notificationLog, 'utf8')
        .trim()
        .split('\n')
        .map((line) => JSON.parse(line));
      assert.equal(records.filter((r) => r.title === 'Conexão com daemon interrompida').length, 1);
      return true;
    });
    result.notifications = fs
      .readFileSync(notificationLog, 'utf8')
      .trim()
      .split('\n')
      .map((line) => JSON.parse(line));
  }
  await restored.getByRole('button', { name: 'Diagnóstico', exact: true }).click();
  await until(async () => {
    assert.equal(
      await restored
        .getByText('Daemon desconectado. Tentando reconectar…', { exact: true })
        .count(),
      0,
    );
    return true;
  });
  const attentionShot = path.join(evidence, 'phase2-diagnostics-after-events.png');
  await restored.screenshot({ path: attentionShot, fullPage: true });
  result.artifacts.push(attentionShot);
  await restored.getByRole('checkbox', { name: 'Notificações nativas' }).uncheck();
  assert.equal((await restored.evaluate(() => window.eros.notifications())).enabled, false);
  await restored.getByRole('button', { name: 'Fechar painel', exact: true }).click();
  await restored.evaluate((id) => window.eros.writeTerminal(id, 'finish\r'), reconnectRun.id);
  await until(async () => {
    const n = await restored.evaluate(() => window.eros.notifications());
    assert.equal(n.history.at(-1).status, 'disabled');
    result.nativeNotificationState = n;
    return true;
  });
  await restored.setViewportSize({ width: 900, height: 1000 });
  assert.ok(
    await restored.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth),
    'overflow horizontal em 900px',
  );
  const compactShot = path.join(evidence, 'phase2-compact.png');
  await restored.screenshot({ path: compactShot, fullPage: true });
  result.artifacts.push(compactShot);
  result.checks.push(
    'Layout 900px sem overflow horizontal; mensagens de reconexão removidas após recuperar a conexão',
  );
  result.checks.push('Falha de conexão, reconexão ao mesmo daemon e preferência de notificações');
  result.stage = 'phase3-crash-recovery';
  await restored.setViewportSize({ width: 1440, height: 1000 });
  const crashRuns = [];
  for (const dotId of ['alpha', 'beta']) {
    const run = await restored.evaluate((dotId) => window.eros.startRun(dotId, 'fixture'), dotId);
    crashRuns.push(run);
    startedRuns.push(run);
  }
  await until(async () => {
    const runs = await restored.evaluate(() => window.eros.runs());
    for (const run of crashRuns) assert.equal(runs.find((r) => r.id === run.id).state, 'running');
  });
  const entry = restored
    .locator('.history-entry')
    .filter({ has: restored.locator('.history-row strong', { hasText: 'ALPHA' }) })
    .first();
  await entry.getByRole('button', { name: 'Criar checkpoint', exact: true }).click();
  await until(async () => {
    const cps = await restored.evaluate((id) => window.eros.checkpoints(id), crashRuns[0].id);
    assert.ok(cps.some((c) => c.origin === 'manual'));
  });
  const optOut = restored
    .locator(`[aria-label="Continuidade ${crashRuns[0].id.slice(0, 8)}"]`)
    .getByRole('checkbox', { name: 'Impedir retomada automática nesta Run' });
  await optOut.check();
  await until(async () =>
    assert.equal(
      (await restored.evaluate(() => window.eros.runs())).find((run) => run.id === crashRuns[0].id)
        .autoResumeEnabled,
      false,
    ),
  );
  await restored.evaluate(() => window.eros.notifications(true));
  process.kill(daemonPid, 'SIGKILL');
  client.close();
  await wait(500);
  const replacement = spawn(process.execPath, ['dist/daemon/entry.cjs'], {
    env: ctx.env,
    stdio: 'ignore',
  });
  daemonPid = replacement.pid;
  await until(() => client.request({ method: 'ping' }));
  await until(async () => {
    const runs = await restored.evaluate(() => window.eros.runs());
    for (const run of crashRuns)
      assert.equal(runs.find((r) => r.id === run.id).state, 'recovery_needed');
  });
  await restored
    .locator(`[aria-label="Continuidade ${crashRuns[0].id.slice(0, 8)}"]`)
    .getByRole('button', { name: 'Retomar', exact: true })
    .click();
  const recovery = restored.locator('.recovery-dialog');
  await recovery.waitFor({ state: 'visible' });
  assert.match(await recovery.innerText(), /Nova sessão pode repetir/);
  const recoveryShot = path.join(evidence, 'phase3-recovery.png');
  await restored.screenshot({ path: recoveryShot, fullPage: true });
  result.artifacts.push(recoveryShot);
  await recovery.getByRole('button', { name: 'Confirmar nova sessão', exact: true }).click();
  await until(async () => {
    const runs = await restored.evaluate(() => window.eros.runs());
    assert.ok(crashRuns.some((run) => runs.find((r) => r.id === run.id).state === 'running'));
  });
  result.checks.push(
    'Checkpoint manual na UI; SIGKILL real do daemon com duas Runs; reconexão; aviso de risco e nova sessão explicitamente confirmada',
  );
  if (notificationService) {
    const continuationNotices = () =>
      fs
        .readFileSync(notificationLog, 'utf8')
        .trim()
        .split('\n')
        .filter(Boolean)
        .map((line) => JSON.parse(line));
    await until(() => {
      const notices = continuationNotices();
      assert.equal(notices.filter((n) => n.title === 'Recuperação necessária').length, 2);
      assert.equal(notices.filter((n) => n.title === 'Execução retomada em nova sessão').length, 1);
    });
    await wait(2500);
    const notices = continuationNotices();
    assert.equal(notices.filter((n) => n.title === 'Recuperação necessária').length, 2);
    assert.equal(notices.filter((n) => n.title === 'Execução retomada em nova sessão').length, 1);
    result.continuityNotifications = notices
      .filter((n) =>
        ['Recuperação necessária', 'Execução retomada em nova sessão'].includes(n.title),
      )
      .map((n) => ({
        title: n.title,
        bodySafe: n.bodySafe === true,
      }));
    assert.ok(result.continuityNotifications.every((n) => n.bodySafe));
    result.checks.push(
      'D-Bus recebeu duas notificações de recuperação e uma de nova sessão; títulos/corpos fixos, sem repetição no polling após restart do daemon',
    );
  }

  const recoveryCompact = path.join(evidence, 'phase3-compact.png');
  await restored.setViewportSize({ width: 900, height: 1000 });
  assert.ok(await restored.evaluate(() => document.documentElement.scrollWidth <= innerWidth));
  await restored.screenshot({ path: recoveryCompact, fullPage: true });
  result.artifacts.push(recoveryCompact);
  result.status = 'passed';
  result.stage = 'complete';
  fs.writeFileSync(path.join(evidence, 'phase1-e2e.json'), JSON.stringify(result, null, 2));
  console.log(JSON.stringify(result, null, 2));
} catch (error) {
  result.status = 'failed';
  result.notificationFixtureErrors = notificationErrors;
  result.error = String(error);
  fs.writeFileSync(path.join(evidence, 'phase1-e2e.json'), JSON.stringify(result, null, 2));
  throw error;
} finally {
  for (const run of startedRuns) {
    try {
      await client.request({ method: 'runs.cancel', value: { runId: run.id } });
    } catch {}
  }
  if (notificationService) {
    notificationService.kill();
    await once(notificationService, 'exit').catch(() => {});
  }
  if (daemonPid)
    try {
      process.kill(daemonPid, 'SIGCONT');
    } catch {}
  client.close();
  if (second?.exitCode === null && second.signalCode === null) {
    second.kill();
    await Promise.race([once(second, 'exit').catch(() => {}), wait(3000)]);
  }
  if (app) {
    await Promise.race([app.close().catch(() => {}), wait(5000)]);
    if (electronProcess?.exitCode === null && electronProcess?.signalCode === null)
      electronProcess.kill('SIGTERM');
  }
  try {
    const control = new Client();
    await control.request({ method: 'shutdown' });
    control.close();
  } catch {}
  if (daemonPid) {
    try {
      process.kill(daemonPid, 'SIGTERM');
    } catch {}
  }
  fs.rmSync(ctx.root, { recursive: true, force: true });
}
