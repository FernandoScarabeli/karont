import { _electron as electron } from 'playwright';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { spawn } from 'node:child_process';
import { once } from 'node:events';
import { Client, daemon, environment, openConversation, openDiagnostics, require as harnessRequire, sample, until, wait } from './harness.mjs';

function makeRepo(root, name) {
  const repo = path.join(root, name);
  fs.mkdirSync(repo);
  const git = (...args) => require('node:child_process').execFileSync('git', args, { cwd: repo, stdio: 'ignore' });
  git('init', '--quiet');
  git('config', 'user.email', 'spec005@local.invalid');
  git('config', 'user.name', 'eros SPEC-005 E2E');
  fs.writeFileSync(path.join(repo, 'base.txt'), 'baseline\n');
  git('add', '.');
  git('commit', '--quiet', '-m', 'baseline');
  return repo;
}

const ctx = environment();
const require = harnessRequire;
const stamp = new Date().toISOString().replace(/[:.]/g, '-');
const evidenceDir = path.join('benchmarks', 'spec005', stamp);
fs.mkdirSync(evidenceDir, { recursive: true });
const repo = makeRepo(ctx.root, 'fixture project with spaces');
const invalidFolder = path.join(ctx.root, 'not-a-repository');
fs.mkdirSync(invalidFolder);
const unavailableFolder = path.join(ctx.root, 'unavailable-after-selection');
const cli = `const readline=require('node:readline');const name=process.argv[1];console.log('SPEC005_READY '+name+' '+process.pid);readline.createInterface({input:process.stdin}).on('line',line=>{console.log('SPEC005_INPUT '+line);if(line==='FINISH')process.exit(0)});setInterval(()=>{},1000);`;
const config = path.join(ctx.root, 'dots.json');
fs.writeFileSync(config, JSON.stringify({
  version: 1,
  projects: [],
  dots: [{ id: 'fixture-dot', name: 'Fixture Dot', role: 'Automated local E2E fixture', executable: process.execPath, adapter: 'generic', autoResume: false, args: ['-e', cli, 'fixture-dot'], projectIds: [] }],
}), { mode: 0o600 });
ctx.env.EROS_DOTS_CONFIG = config;
Object.assign(process.env, { EROS_RUNTIME_DIR: ctx.env.EROS_RUNTIME_DIR, EROS_DATA_DIR: ctx.env.EROS_DATA_DIR, EROS_DOTS_CONFIG: config });
const result = { runId: stamp, status: 'running', stage: 'setup', checks: [], artifacts: [], metrics: {} };
let app;
let d;
let secondInstance;
let client = new Client();
const startedRuns = [];
const daemonErrors = [];

function compact(sampleValue) {
  return {
    durationMs: sampleValue.durationMs,
    processCount: sampleValue.processes?.length ?? 1,
    rssMiB: sampleValue.rssMiB,
    pssMiB: sampleValue.pssMiB,
    cpuPercentOneCore: sampleValue.cpuPercentOneCore,
  };
}
function percentile(values, p) {
  const sorted = [...values].sort((a, b) => a - b);
  return sorted[Math.min(sorted.length - 1, Math.ceil(sorted.length * p) - 1)];
}
function summarize(samples, key) {
  const values = samples.map((item) => item[key]).filter((value) => value !== null);
  return values.length ? { median: percentile(values, 0.5), p95: percentile(values, 0.95) } : null;
}
async function sampleProcesses() {
  const [electronTree, daemonTree] = await Promise.all([
    sample(app.process().pid, 2500),
    sample(d.pid, 2500),
  ]);
  return {
    electron: compact(electronTree),
    daemonTree: compact(daemonTree),
    combined: {
      rssMiB: electronTree.rssMiB + daemonTree.rssMiB,
      pssMiB: electronTree.pssMiB === null || daemonTree.pssMiB === null ? null : electronTree.pssMiB + daemonTree.pssMiB,
      cpuPercentOneCore: electronTree.cpuPercentOneCore + daemonTree.cpuPercentOneCore,
    },
  };
}
async function recordSeries(name, action) {
  const samples = [];
  const skipMeasurements = process.env.EROS_TEST_SKIP_SPEC005_METRICS === '1';
  for (let round = 0; round < 5; round++) {
    if (action) await action(round);
    if (!skipMeasurements) samples.push({ round: round + 1, ...(await sampleProcesses()) });
  }
  if (skipMeasurements) {
    result.metrics[name] = { skipped: true, reason: 'diagnostic execution' };
    return;
  }
  result.metrics[name] = {
    rounds: samples,
    median: {
      electronRssMiB: summarize(samples.map((item) => item.electron), 'rssMiB'),
      electronPssMiB: summarize(samples.map((item) => item.electron), 'pssMiB'),
      electronCpuPercentOneCore: summarize(samples.map((item) => item.electron), 'cpuPercentOneCore'),
      daemonTreeRssMiB: summarize(samples.map((item) => item.daemonTree), 'rssMiB'),
      daemonTreePssMiB: summarize(samples.map((item) => item.daemonTree), 'pssMiB'),
      daemonTreeCpuPercentOneCore: summarize(samples.map((item) => item.daemonTree), 'cpuPercentOneCore'),
      combinedRssMiB: summarize(samples.map((item) => item.combined), 'rssMiB'),
      combinedPssMiB: summarize(samples.map((item) => item.combined), 'pssMiB'),
      combinedCpuPercentOneCore: summarize(samples.map((item) => item.combined), 'cpuPercentOneCore'),
    },
  };
}

try {
  result.stage = 'launch';
  d = await daemon(ctx.env);
  d.child.stderr.on('data', (data) => daemonErrors.push(data.toString()));
  app = await electron.launch({ chromiumSandbox: true, args: ['dist/desktop/main.cjs'], env: ctx.env, timeout: 20000 });
  let page = await app.firstWindow();
  page.setDefaultTimeout(12000);
  const pageErrors = [];
  const listenForPageErrors = (target) => target.on('pageerror', (error) => pageErrors.push(error.message));
  listenForPageErrors(page);
  await openDiagnostics(page);
  assert.equal(await page.evaluate(() => window.eros.runtime.sandboxed && window.eros.runtime.contextIsolated), true);
  await page.getByRole('button', { name: 'Início', exact: true }).click();
  await page.getByRole('heading', { name: /^(Bom dia|Boa tarde|Boa noite)\.$/ }).waitFor();
  if (process.env.EROS_TEST_SKIP_SPEC005_METRICS !== '1') await recordSeries('idle');
  result.checks.push(process.env.EROS_TEST_SKIP_SPEC005_METRICS === '1'
    ? 'shell Workspaces inicia sem criar Run; referência ociosa omitida na execução de diagnóstico'
    : 'shell Workspaces inicia sem criar Run; amostras de referência ociosa: 5');

  result.stage = 'workspace-and-project';
  const workspacesBeforeCancel = (await client.request({ method: 'workspaces.list', value: { limit: 100 } })).items.length;
  await page.locator('.k-workspace-select').getByRole('button', { expanded: false }).click();
  await page.getByRole('button', { name: 'Criar workspace', exact: true }).click();
  let workspaceDialog = page.getByRole('dialog', { name: 'Criar workspace' });
  await workspaceDialog.getByLabel('Nome do workspace').fill('Workspace cancelado');
  await page.keyboard.press('Escape');
  await workspaceDialog.waitFor({ state: 'hidden' });
  assert.equal((await client.request({ method: 'workspaces.list', value: { limit: 100 } })).items.length, workspacesBeforeCancel);
  result.stage = 'workspace-create';
  await page.locator('.k-workspace-select').getByRole('button', { expanded: false }).click();
  await page.getByRole('button', { name: 'Criar workspace', exact: true }).click();
  workspaceDialog = page.getByRole('dialog', { name: 'Criar workspace' });
  await workspaceDialog.getByLabel('Nome do workspace').fill('Workspace SPEC-005');
  await workspaceDialog.getByLabel('Nome do workspace').press('Enter');
  await page.getByRole('button', { name: 'Workspace SPEC-005', exact: true }).waitFor();
  await page.getByRole('button', { name: 'Workspace SPEC-005', exact: true }).click();
  await page.getByRole('button', { name: 'Renomear workspace', exact: true }).click();
  result.stage = 'workspace-rename';
  const renameDialog = page.getByRole('dialog', { name: 'Renomear workspace' });
  await renameDialog.getByLabel('Nome do workspace').fill('Workspace Produtos');
  await renameDialog.getByRole('button', { name: 'Salvar', exact: true }).click();
  await page.getByRole('button', { name: 'Workspace Produtos', exact: true }).waitFor();
  const workspaces = (await client.request({ method: 'workspaces.list', value: { limit: 100 } })).items;
  const workspace = workspaces.find((item) => item.name === 'Workspace Produtos');
  assert.ok(workspace);
  assert.equal((await client.request({ method: 'dots.list' }))[0].name, 'Fixture Dot');
  assert.equal((await page.evaluate(() => window.eros.dots()))[0].name, 'Fixture Dot');
  result.checks.push('Escape cancela sem gravar; formulário de workspace opera por teclado; workspace criado, renomeado e persistido no daemon');

  await app.evaluate(({ dialog }, invalid) => {
    globalThis.__spec005Folder = invalid;
    globalThis.__spec005Cancel = true;
    globalThis.__spec005ConfirmResponse = 1;
    globalThis.__spec005ConfirmOptions = [];
    globalThis.__spec005OriginalOpen = dialog.showOpenDialog;
    globalThis.__spec005OriginalMessage = dialog.showMessageBox;
    dialog.showOpenDialog = async () => globalThis.__spec005Cancel
      ? { canceled: true, filePaths: [] }
      : { canceled: false, filePaths: [globalThis.__spec005Folder] };
    dialog.showMessageBox = async (_window, options) => {
      globalThis.__spec005ConfirmOptions.push(options.detail);
      return { response: globalThis.__spec005ConfirmResponse, checkboxChecked: false };
    };
  }, invalidFolder);
  result.stage = 'project-before';
  const projectsBefore = (await client.request({ method: 'projects.list', value: { workspaceId: workspace.id, limit: 100 } })).items;
  result.stage = 'project-cancel';
  await page.getByRole('button', { name: 'Criar projeto', exact: true }).click();
  let projectDialog = page.getByRole('dialog', { name: 'Criar projeto' });
  await projectDialog.getByLabel('Nome', { exact: true }).fill('Projeto de teste');
  // Concessão sem equivalente no cadastro atual; ver DIVIDAS #11.
  await projectDialog.getByLabel('Fixture Dot').check();
  await projectDialog.getByRole('button', { name: 'Escolher…', exact: true }).click();
  await projectDialog.getByRole('button', { name: 'Cancelar', exact: true }).click();
  await projectDialog.waitFor({ state: 'hidden' });
  assert.equal((await client.request({ method: 'projects.list', value: { workspaceId: workspace.id, limit: 100 } })).items.length, projectsBefore.length);
  assert.equal(await app.evaluate(() => globalThis.__spec005ConfirmOptions.length), 0);

  await page.getByRole('button', { name: 'Criar projeto', exact: true }).click();
  result.stage = 'project-invalid';
  projectDialog = page.getByRole('dialog', { name: 'Criar projeto' });
  await projectDialog.getByLabel('Nome', { exact: true }).fill('Invalid project');
  await projectDialog.getByLabel('Fixture Dot').check();
  await app.evaluate(({ dialog }) => { globalThis.__spec005Cancel = false; });
  await projectDialog.getByRole('button', { name: 'Escolher…', exact: true }).click();
  await projectDialog.getByRole('button', { name: 'Criar projeto', exact: true }).click();
  await projectDialog.getByRole('alert').getByText(/Não foi possível criar o projeto/).waitFor();
  await projectDialog.getByRole('button', { name: 'Cancelar', exact: true }).click();
  result.stage = 'project-invalid-verify';
  const afterInvalid = await client.request({ method: 'projects.list', value: { workspaceId: workspace.id, limit: 100 } });
  assert.equal(afterInvalid.items.length, projectsBefore.length);

  await page.getByRole('button', { name: 'Criar projeto', exact: true }).click();
  projectDialog = page.getByRole('dialog', { name: 'Criar projeto' });
  await projectDialog.getByLabel('Nome', { exact: true }).fill('Unavailable project');
  await projectDialog.getByLabel('Fixture Dot').check();
  await app.evaluate(({ dialog }, root) => {
    globalThis.__spec005Folder = root;
    globalThis.__spec005ConfirmResponse = 1;
  }, unavailableFolder);
  await projectDialog.getByRole('button', { name: 'Escolher…', exact: true }).click();
  await projectDialog.getByRole('button', { name: 'Criar projeto', exact: true }).click();
  await projectDialog.getByRole('alert').getByText(/Não foi possível criar o projeto/).waitFor();
  await projectDialog.getByRole('button', { name: 'Cancelar', exact: true }).click();
  const afterUnavailable = await client.request({ method: 'projects.list', value: { workspaceId: workspace.id, limit: 100 } });
  assert.equal(afterUnavailable.items.length, projectsBefore.length);

  await page.getByRole('button', { name: 'Criar projeto', exact: true }).click();
  projectDialog = page.getByRole('dialog', { name: 'Criar projeto' });
  await projectDialog.getByLabel('Nome', { exact: true }).fill('Projeto com espaços');
  await projectDialog.getByLabel('Fixture Dot').check();
  result.stage = 'project-add-valid';
  await app.evaluate(({ dialog }, root) => {
    globalThis.__spec005Folder = root;
    globalThis.__spec005ConfirmResponse = 1;
  }, repo);
  await projectDialog.getByRole('button', { name: 'Escolher…', exact: true }).click();
  await projectDialog.getByRole('button', { name: 'Criar projeto', exact: true }).click();
  await projectDialog.waitFor({ state: 'hidden' });
  result.stage = 'project-read-after-add';
  const projectPage = await client.request({ method: 'projects.list', value: { workspaceId: workspace.id, limit: 100 } });
  const project = projectPage.items.find((item) => item.name === 'Projeto com espaços');
  assert.ok(project);
  assert.deepEqual(project.dotIds, ['fixture-dot']);
  const confirmationDetails = await app.evaluate(() => globalThis.__spec005ConfirmOptions.at(-1));
  assert.ok(confirmationDetails.includes(repo));
  assert.match(confirmationDetails, /Fixture Dot/);
  assert.ok((await client.request({ method: 'projects.list' })).some((item) => item.id === project.id));
  result.checks.push('cancelamento não grava; raiz Git inválida e raiz indisponível recusadas; diretório com espaços confirmado; concessão explícita validada');

  await page.locator('.k-workspace-select').getByRole('button', { expanded: false }).click();
  await page.getByRole('button', { name: 'Criar workspace', exact: true }).click();
  workspaceDialog = page.getByRole('dialog', { name: 'Criar workspace' });
  await workspaceDialog.getByLabel('Nome do workspace').fill('Workspace duplicata');
  await workspaceDialog.getByRole('button', { name: 'Salvar', exact: true }).click();
  const secondWorkspace = (await client.request({ method: 'workspaces.list', value: { limit: 100 } })).items.find((item) => item.name === 'Workspace duplicata');
  assert.ok(secondWorkspace);
  result.stage = 'project-duplicate';
  await page.getByRole('button', { name: 'Criar projeto', exact: true }).click();
  projectDialog = page.getByRole('dialog', { name: 'Criar projeto' });
  await projectDialog.getByLabel('Nome', { exact: true }).fill('Mesmo repositório');
  await projectDialog.getByLabel('Fixture Dot').check();
  await app.evaluate(({ dialog }, root) => { globalThis.__spec005Folder = root; }, repo);
  await projectDialog.getByRole('button', { name: 'Escolher…', exact: true }).click();
  await projectDialog.getByRole('button', { name: 'Criar projeto', exact: true }).click();
  await projectDialog.waitFor({ state: 'hidden' });
  await page.getByText(/Pasta já vinculada ao projeto/).waitFor();
  assert.equal((await client.request({ method: 'projects.list', value: { workspaceId: secondWorkspace.id, limit: 100 } })).items.length, 0);
  assert.equal((await client.request({ method: 'projects.list', value: { workspaceId: workspace.id, limit: 100 } })).items[0].id, project.id);
  await app.evaluate(({ dialog }) => {
    dialog.showOpenDialog = globalThis.__spec005OriginalOpen;
    dialog.showMessageBox = globalThis.__spec005OriginalMessage;
  });
  result.checks.push('repositório duplicado reconhecido e não reassociado ao workspace novo');

  result.stage = 'chats-runs-and-delivery';
  await page.getByRole('button', { name: 'Nova conversa em Projeto com espaços', exact: true }).click();
  await page.getByRole('button', { name: 'Renomear conversa', exact: true }).click();
  await page.getByLabel('Título da conversa', { exact: true }).fill('Conversa principal');
  await page.getByRole('button', { name: 'Salvar', exact: true }).click();
  await page.getByRole('heading', { name: 'Conversa principal', exact: true }).waitFor();
  let primaryChat = await client.request({ method: 'chats.list', value: { workspaceId: workspace.id, projectId: project.id, limit: 100 } });
  const primary = primaryChat.items.find((item) => item.title === 'Conversa principal');
  assert.ok(primary);
  assert.equal((await client.request({ method: 'chats.runs.list', value: { chatId: primary.id, limit: 100 } })).items.length, 0);
  await page.getByLabel('Nova mensagem').fill('SPEC005_PRIVATE_TEST_MESSAGE');
  await page.getByRole('button', { name: 'Salvar mensagem', exact: true }).click();
  await page.getByText('SPEC005_PRIVATE_TEST_MESSAGE', { exact: true }).waitFor();
  await page.getByRole('button', { name: /^Terminal e execuções/ }).click();
  await page.getByRole('button', { name: 'Iniciar execução', exact: true }).click();
  let primaryRuns = await until(async () => {
    const pageOfRuns = await client.request({ method: 'chats.runs.list', value: { chatId: primary.id, limit: 100 } });
    const run = pageOfRuns.items[0];
    assert.ok(run && run.state === 'running' && run.pid);
    return pageOfRuns.items;
  });
  const primaryRun = primaryRuns[0];
  startedRuns.push(primaryRun);
  assert.equal(primaryRun.chatId, primary.id);
  await page.getByRole('button', { name: 'Enviar ao agente', exact: true }).click();
  await page.getByText(/Enviado ao terminal/).waitFor();
  await page.locator(`#run-${primaryRun.id} .terminal-shell [role="listitem"]`).getByText(/SPEC005_INPUT SPEC005_PRIVATE_TEST_MESSAGE/).waitFor();
  assert.equal((await client.request({ method: 'messages.list', value: { chatId: primary.id, limit: 100 } })).items.filter((message) => message.role === 'user').length, 1);
  assert.equal(await page.locator('.saved-message').count(), 1);
  result.checks.push('criar chat não iniciou Run; Run vinculada; mensagem salva e enviada só ao PTY ativo, sem stdout persistido');

  await page.getByRole('button', { name: 'Nova conversa em Projeto com espaços', exact: true }).click();
  await page.getByRole('button', { name: 'Renomear conversa', exact: true }).click();
  await page.getByLabel('Título da conversa', { exact: true }).fill('Segunda conversa');
  await page.getByRole('button', { name: 'Salvar', exact: true }).click();
  await page.getByRole('heading', { name: 'Segunda conversa', exact: true }).waitFor();
  const secondChat = (await client.request({ method: 'chats.list', value: { workspaceId: workspace.id, projectId: project.id, limit: 100 } })).items.find((item) => item.title === 'Segunda conversa');
  assert.ok(secondChat);
  await page.getByLabel('Nova mensagem').fill('mensagem independente');
  await page.getByRole('button', { name: 'Salvar mensagem', exact: true }).click();
  const secondMessages = await until(async () => {
    const page = await client.request({ method: 'messages.list', value: { chatId: secondChat.id, limit: 100 } });
    assert.equal(page.items.length, 1);
    return page;
  });
  assert.equal(secondMessages.items.length, 1);
  await page.getByRole('button', { name: /^Terminal e execuções/ }).click();
  await page.getByRole('button', { name: 'Iniciar execução', exact: true }).click();
  const secondRun = await until(async () => {
    const runs = (await client.request({ method: 'chats.runs.list', value: { chatId: secondChat.id, limit: 100 } })).items;
    assert.ok(runs[0]?.state === 'running' && runs[0].pid);
    return runs[0];
  });
  startedRuns.push(secondRun);
  assert.notEqual(secondRun.id, primaryRun.id);
  await assert.rejects(() => page.evaluate(({ dot, projectId, chatId }) => window.eros.startRun(dot, projectId, 'ask', false, chatId), { dot: 'fixture-dot', projectId: project.id, chatId: primary.id }));
  await assert.rejects(() => client.request({ method: 'messages.send', value: { chatId: secondChat.id, messageId: secondMessages.items[0].id, runId: primaryRun.id, operationId: randomUUID() } }));
  const twoRuns = (await client.request({ method: 'runs.list', value: { limit: 100 } })).filter((run) => run.state === 'running');
  assert.equal(twoRuns.length, 2);
  await recordSeries('twoRuns');
  result.checks.push('duas conversas do mesmo Dot têm Runs separadas; não terminal por conversa e teto de dois PTYs; envio cruzado recusado');

  await recordSeries('conversationSwitching', async (round) => {
    const title = round % 2 ? 'Conversa principal' : 'Segunda conversa';
    await openConversation(page, title);
    await page.getByRole('heading', { name: title, exact: true }).waitFor();
    const selectedRun = title === 'Conversa principal' ? primaryRun : secondRun;
    await page.locator(`#run-${selectedRun.id}`).waitFor();
    const current = (await client.request({ method: 'chats.runs.list', value: { chatId: selectedRun.chatId, limit: 100 } })).items[0];
    assert.equal(current.pid, selectedRun.pid);
  });
  result.checks.push('troca entre conversas reanexa as mesmas sessões, sem iniciar nem cancelar Runs');

  result.stage = 'favorites-recent-free-move';
  await openConversation(page, 'Conversa principal');
  await page.getByRole('heading', { name: 'Conversa principal', exact: true }).waitFor();
  await page.locator('.chat-heading-actions').getByRole('button', { name: /Favoritar/ }).click();
  // Sem navegação global equivalente; preservar a checagem de escopo (DIVIDAS #11).
  await page.getByRole('button', { name: 'Conversas livres', exact: true }).click();
  await page.getByRole('button', { name: 'Nova conversa livre', exact: true }).click();
  await page.getByRole('button', { name: 'Renomear conversa', exact: true }).click();
  await page.getByLabel('Título da conversa', { exact: true }).fill('Conversa livre de teste');
  await page.getByRole('button', { name: 'Salvar', exact: true }).click();
  await page.getByRole('heading', { name: 'Conversa livre de teste', exact: true }).waitFor();
  await page.getByText('Conversa local — vincule um projeto para executar um agente.', { exact: true }).waitFor();
  assert.equal(await page.locator('.run-desk').count(), 0);
  await page.getByLabel('Nova mensagem').fill('histórico local antes do vínculo');
  await page.getByRole('button', { name: 'Salvar mensagem', exact: true }).click();
  const freeChat = (await client.request({ method: 'chats.list', value: { scope: 'free', limit: 100 } })).items.find((item) => item.title === 'Conversa livre de teste');
  assert.ok(freeChat);
  await until(async () => {
    const messages = await client.request({ method: 'messages.list', value: { chatId: freeChat.id, limit: 100 } });
    assert.equal(messages.items.length, 1);
  });
  await page.locator('.chat-heading-actions').getByRole('button', { name: /Favoritar/ }).click();
  const draftText = 'rascunho sobrevive à troca de contexto';
  await page.getByLabel('Nova mensagem').fill(draftText);
  await until(async () => {
    const current = await client.request({ method: 'chats.get', value: { chatId: freeChat.id } });
    assert.equal(current.chat.draft, draftText);
  });
  const globalNavigation = { workspaceId: null, projectId: null, chatId: freeChat.id };
  await page.locator('.global-chat-sidebar .chat-row-open').filter({ hasText: 'Conversa livre de teste' }).click();
  await page.getByRole('heading', { name: 'Conversa livre de teste', exact: true }).waitFor();
  assert.deepEqual(await page.evaluate(() => window.eros.navigation()), globalNavigation);
  await page.getByRole('button', { name: 'Favoritos', exact: true }).click();
  await page.locator('.global-chat-sidebar .chat-row-open').filter({ hasText: 'Conversa principal' }).waitFor();
  await page.locator('.global-chat-sidebar .chat-row-open').filter({ hasText: 'Conversa livre de teste' }).click();
  await page.getByRole('heading', { name: 'Conversa livre de teste', exact: true }).waitFor();
  assert.deepEqual(await page.evaluate(() => window.eros.navigation()), globalNavigation);
  await page.getByRole('button', { name: 'Recentes', exact: true }).click();
  await page.locator('.global-chat-sidebar .chat-row-open').filter({ hasText: 'Conversa livre de teste' }).click();
  await page.getByRole('heading', { name: 'Conversa livre de teste', exact: true }).waitFor();
  assert.equal((await client.request({ method: 'chats.get', value: { chatId: freeChat.id } })).chat.draft, draftText);
  assert.deepEqual(await page.evaluate(() => window.eros.navigation()), globalNavigation);
  await page.reload();
  await page.getByRole('heading', { name: 'Conversa livre de teste', exact: true }).waitFor();
  await page.getByLabel('Nova mensagem').waitFor();
  assert.deepEqual(await page.evaluate(() => window.eros.navigation()), globalNavigation);
  assert.equal(await page.getByLabel('Nova mensagem').inputValue(), draftText);
  await page.getByText('histórico local antes do vínculo', { exact: true }).waitFor();
  assert.equal((await client.request({ method: 'chats.runs.list', value: { chatId: freeChat.id, limit: 100 } })).items.length, 0);

  const globalWindowClosed = page.waitForEvent('close');
  await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].close());
  await globalWindowClosed;
  assert.equal((await client.request({ method: 'ping' })).pid, d.pid);
  assert.ok(process.kill(primaryRun.pid, 0));
  assert.ok(process.kill(secondRun.pid, 0));
  const globalWindowOpened = app.waitForEvent('window');
  secondInstance = spawn(harnessRequire('electron'), ['dist/desktop/main.cjs'], { env: ctx.env, stdio: 'ignore' });
  const globalInstanceExit = once(secondInstance, 'exit');
  page = await globalWindowOpened;
  page.setDefaultTimeout(12000);
  listenForPageErrors(page);
  await page.getByRole('heading', { name: 'Conversa livre de teste', exact: true }).waitFor();
  assert.deepEqual(await page.evaluate(() => window.eros.navigation()), globalNavigation);
  assert.equal(await page.getByLabel('Nova mensagem').inputValue(), draftText);
  await page.getByText('histórico local antes do vínculo', { exact: true }).waitFor();
  assert.equal((await client.request({ method: 'chats.runs.list', value: { chatId: freeChat.id, limit: 100 } })).items.length, 0);
  await openDiagnostics(page);
  await openConversation(page, 'Conversa livre de teste');
  const [globalInstanceCode] = await globalInstanceExit;
  assert.equal(globalInstanceCode, 0);
  result.checks.push('conversa global aberta por Conversas livres, Favoritos e Recentes mantém o mesmo ID e escopo null/null após reload e reabertura; mensagem/rascunho intactos e nenhuma Run criada');

  await page.getByRole('button', { name: 'Vincular a projeto', exact: true }).click();
  let moveDialog = page.getByRole('dialog', { name: 'Vincular conversa a projeto' });
  await moveDialog.getByLabel('Projeto de destino').selectOption(project.id);
  await moveDialog.getByLabel('Dot para esta conversa').selectOption('fixture-dot');
  await moveDialog.getByRole('button', { name: 'Cancelar', exact: true }).click();
  assert.equal((await client.request({ method: 'chats.get', value: { chatId: freeChat.id } })).chat.projectId, null);
  await page.getByRole('button', { name: 'Vincular a projeto', exact: true }).click();
  moveDialog = page.getByRole('dialog', { name: 'Vincular conversa a projeto' });
  await moveDialog.getByLabel('Projeto de destino').selectOption(project.id);
  await moveDialog.getByLabel('Dot para esta conversa').selectOption('fixture-dot');
  await moveDialog.getByText(/O histórico, o ID e o favorito serão preservados/).waitFor();
  await moveDialog.getByRole('button', { name: 'Confirmar movimentação' }).click();
  const moved = await until(async () => {
    const current = await client.request({ method: 'chats.get', value: { chatId: freeChat.id } });
    assert.equal(current.chat.projectId, project.id);
    assert.equal(current.chat.dotId, 'fixture-dot');
    return current;
  });
  assert.equal(moved.chat.favorite, true);
  assert.equal((await client.request({ method: 'messages.list', value: { chatId: freeChat.id, limit: 100 } })).items.length, 1);
  // Sem navegação global equivalente; preservar a checagem de escopo (DIVIDAS #11).
  await page.getByRole('button', { name: 'Conversas livres', exact: true }).click();
  await until(async () => assert.equal(await page.locator('.global-chat-sidebar .chat-row-open').filter({ hasText: 'Conversa livre de teste' }).count(), 0));
  result.checks.push('favoritos/recentes globais; conversa livre sem agente; rascunho persistente; mover com confirmação e cancelamento preserva ID, favorito e mensagem antiga');

  result.stage = 'history-pagination';
  const history = await client.request({ method: 'chats.create', value: { workspaceId: workspace.id, projectId: project.id, dotId: 'fixture-dot', title: 'Histórico paginado', operationId: randomUUID() } });
  let historyDetails = history;
  for (let index = 0; index < 105; index++) {
    const saved = await client.request({ method: 'messages.save', value: { chatId: history.chat.id, body: `entrada ${String(index + 1).padStart(3, '0')} · ${'x'.repeat(140)}`, expectedRevision: historyDetails.chat.revision, operationId: randomUUID() } });
    historyDetails = saved.chat;
    if (index % 15 === 14) await wait(250);
  }
  await page.getByRole('button', { name: 'Início', exact: true }).click();
  await openConversation(page, 'Histórico paginado');
  await page.getByRole('heading', { name: 'Histórico paginado', exact: true }).waitFor();
  await until(async () => assert.equal(await page.locator('.saved-message').count(), 100));
  await page.getByRole('button', { name: 'Carregar próxima página do histórico', exact: true }).click();
  await until(async () => assert.equal(await page.locator('.saved-message').count(), 105));
  assert.equal(await page.locator('.chat-workspace .workspace-error').count(), 0, 'o histórico paginado não deve gerar erro de carga');
  const allHistory = await client.request({ method: 'messages.list', value: { chatId: history.chat.id, limit: 100 } });
  assert.equal(allHistory.items.length, 100);
  assert.ok(allHistory.nextCursor);
  const pageStart = performance.now();
  const nextHistoryPage = await client.request({ method: 'messages.list', value: { chatId: history.chat.id, cursor: allHistory.nextCursor, limit: 100 } });
  result.metrics.historyPageResponseMs = performance.now() - pageStart;
  assert.equal(nextHistoryPage.items.length, 5);
  assert.equal(nextHistoryPage.nextCursor, null);
  await recordSeries('paginatedHistory', async () => {
    const started = performance.now();
    const first = await client.request({ method: 'messages.list', value: { chatId: history.chat.id, limit: 100 } });
    const second = await client.request({ method: 'messages.list', value: { chatId: history.chat.id, cursor: first.nextCursor, limit: 100 } });
    result.metrics.historyPageBatchMs ??= [];
    result.metrics.historyPageBatchMs.push(performance.now() - started);
    assert.equal(first.items.length + second.items.length, 105);
  });
  result.checks.push('histórico de 105 mensagens permanece paginado e completo no renderer e no daemon');

  result.stage = 'responsive-and-restart';
  await page.setViewportSize({ width: 1440, height: 1000 });
  assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth));
  const wideShot = path.join(evidenceDir, 'spec005-1440.png');
  await page.screenshot({ path: wideShot, fullPage: true });
  result.artifacts.push(wideShot);
  await page.setViewportSize({ width: 900, height: 1000 });
  assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), 'overflow horizontal em 900px');
  const compactShot = path.join(evidenceDir, 'spec005-900.png');
  await page.screenshot({ path: compactShot, fullPage: true });
  result.artifacts.push(compactShot);
  result.checks.push('layouts de 900px e 1440px sem overflow horizontal');

  await openConversation(page, 'Conversa principal');
  await page.getByRole('heading', { name: 'Conversa principal', exact: true }).waitFor();
  await page.locator(`#run-${primaryRun.id}`).waitFor();
  await recordSeries('windowClosed', async (round) => {
    if (round === 0) {
      const closed = page.waitForEvent('close');
      await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].close());
      await closed;
      assert.equal((await client.request({ method: 'ping' })).pid, d.pid);
      assert.ok(process.kill(primaryRun.pid, 0));
      assert.ok(process.kill(secondRun.pid, 0));
    }
  });
  result.checks.push('fechar janela mantém daemon e dois PTYs com os mesmos PIDs ativos');
  const newWindow = app.waitForEvent('window');
  secondInstance = spawn(harnessRequire('electron'), ['dist/desktop/main.cjs'], { env: ctx.env, stdio: 'ignore' });
  const secondExit = once(secondInstance, 'exit');
  page = await newWindow;
  page.setDefaultTimeout(12000);
  listenForPageErrors(page);
  await page.getByRole('heading', { name: 'Conversa principal', exact: true }).waitFor();
  await page.locator(`#run-${primaryRun.id}`).waitFor();
  const [secondCode] = await secondExit;
  assert.equal(secondCode, 0);
  const restoredRun = (await client.request({ method: 'chats.runs.list', value: { chatId: primary.id, limit: 100 } })).items[0];
  assert.equal(restoredRun.pid, primaryRun.pid);
  assert.equal(restoredRun.state, 'running');
  await page.locator(`#run-${primaryRun.id} .terminal-shell [role="listitem"]`).getByText(/SPEC005_READY fixture-dot/).waitFor();
  await openDiagnostics(page);
  await openConversation(page, 'Conversa principal');
  await recordSeries('windowReopened', async (round) => {
    if (round % 2 === 0) {
      await openConversation(page, 'Segunda conversa');
      await page.getByRole('heading', { name: 'Segunda conversa', exact: true }).waitFor();
      await page.locator(`#run-${secondRun.id}`).waitFor();
    } else {
      await openConversation(page, 'Conversa principal');
      await page.getByRole('heading', { name: 'Conversa principal', exact: true }).waitFor();
      await page.locator(`#run-${primaryRun.id}`).waitFor();
    }
  });
  result.checks.push('reabertura restaura conversa selecionada e reanexa ao mesmo PID e scrollback');

  await openDiagnostics(page);
  await page.getByRole('button', { name: 'Execuções anteriores', exact: true }).click();
  await page.locator('.app-header').getByRole('heading', { name: 'Execuções anteriores', exact: true }).waitFor();
  assert.equal(await page.locator('.history-row').count(), 0);
  assert.ok((await client.request({ method: 'runs.list', value: { limit: 100 } })).some((run) => run.id === primaryRun.id));
  await page.getByRole('button', { name: 'Início', exact: true }).click();
  await openConversation(page, 'Conversa principal');
  await page.getByRole('heading', { name: 'Conversa principal', exact: true }).waitFor();
  await page.getByRole('button', { name: 'Recentes', exact: true }).click();
  await page.locator('.global-chat-sidebar .chat-row-open').filter({ hasText: 'Conversa principal' }).waitFor();
  const report = await page.evaluate(() => window.eros.report());
  assert.ok(!report.includes('SPEC005_PRIVATE_TEST_MESSAGE'));
  const notificationState = await page.evaluate(() => window.eros.notifications());
  assert.ok(!JSON.stringify(notificationState).includes('SPEC005_PRIVATE_TEST_MESSAGE'));
  result.checks.push('runs antigas aparecem em área separada; relatório e notificações não incluem mensagens');

  result.stage = 'cleanup';
  for (const run of startedRuns)
    if (run.state === 'running') await client.request({ method: 'terminal.write', value: { runId: run.id, data: 'FINISH\r' } }).catch(() => {});
  await until(async () => {
    const runs = await client.request({ method: 'runs.list', value: { limit: 100 } });
    assert.ok(startedRuns.every((run) => ['completed', 'failed', 'cancelled'].includes(runs.find((item) => item.id === run.id)?.state)));
  });
  assert.deepEqual(pageErrors, []);
  result.checks.push('nenhum erro de renderer; fixtures encerradas sem processo de CLI pago');
  result.status = 'passed';
  result.stage = 'complete';
} catch (error) {
  result.status = 'failed';
  result.error = error.stack ?? String(error);
  result.daemonErrors = daemonErrors;
  result.daemonExit = d ? { code: d.child.exitCode, signal: d.child.signalCode } : null;
  result.harnessSocket = { destroyed: client.socket?.destroyed, connected: client.socket?.connecting === false };
  process.exitCode = 1;
} finally {
  if (app) await app.close().catch(() => {});
  if (secondInstance && secondInstance.exitCode === null && secondInstance.signalCode === null)
    secondInstance.kill();
  for (const run of startedRuns)
    await client.request({ method: 'terminal.write', value: { runId: run.id, data: 'FINISH\r' } }).catch(() => {});
  client.close();
  if (d) {
    await d.client.request({ method: 'shutdown' }).catch(() => {});
    d.client.close();
    if (d.child.exitCode === null && d.child.signalCode === null) d.child.kill('SIGTERM');
  }
  await wait(250);
  fs.writeFileSync(path.join(evidenceDir, 'spec005-e2e.json'), JSON.stringify(result, null, 2));
  console.log(JSON.stringify(result, null, 2));
  fs.rmSync(ctx.root, { recursive: true, force: true });
}
