import { _electron as electron } from 'playwright';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { spawn } from 'node:child_process';
import { once } from 'node:events';
import {
  Client,
  daemon,
  environment,
  openConversation,
  openDiagnostics,
  require as harnessRequire,
  sample,
  until,
  wait,
} from './harness.mjs';

function makeRepo(root, name) {
  const repo = path.join(root, name);
  fs.mkdirSync(repo);
  const git = (...args) =>
    harnessRequire('node:child_process').execFileSync('git', args, { cwd: repo, stdio: 'ignore' });
  git('init', '--quiet');
  git('config', 'user.email', 'spec006@local.invalid');
  git('config', 'user.name', 'karont SPEC-006 E2E');
  fs.writeFileSync(path.join(repo, 'fixture.txt'), 'synthetic fixture\n');
  git('add', '.');
  git('commit', '--quiet', '-m', 'synthetic fixture');
  return repo;
}

const ctx = environment();
const desktopRuntimeDir = process.env.XDG_RUNTIME_DIR || `/run/user/${process.getuid()}`;
ctx.env.XDG_RUNTIME_DIR = desktopRuntimeDir;
if (!ctx.env.XAUTHORITY && ctx.env.DISPLAY && fs.existsSync(desktopRuntimeDir)) {
  const xauthority = fs
    .readdirSync(desktopRuntimeDir)
    .find((name) => name.startsWith('.mutter-Xwaylandauth.'));
  if (xauthority) ctx.env.XAUTHORITY = path.join(desktopRuntimeDir, xauthority);
}
const stamp = new Date().toISOString().replace(/[:.]/g, '-');
const evidenceDir = path.join('benchmarks', 'spec006', stamp);
fs.mkdirSync(evidenceDir, { recursive: true });
const repoA = makeRepo(ctx.root, 'project A with spaces');
const repoB = makeRepo(ctx.root, 'project B with spaces');
const cli = `const readline=require('node:readline');console.log('SPEC006_FIXTURE_READY '+process.pid);readline.createInterface({input:process.stdin}).on('line',line=>{if(line==='EXIT')process.exit(0)});setInterval(()=>{},1000);`;
const config = path.join(ctx.root, 'dots.json');
fs.writeFileSync(
  config,
  JSON.stringify({
    version: 1,
    projects: [
      { id: 'project-a', name: 'Projeto A', root: repoA },
      { id: 'project-b', name: 'Projeto B', root: repoB },
    ],
    dots: [
      {
        id: 'dot-a',
        name: 'Dot autorizado',
        role: 'Fixture local SPEC-006',
        executable: process.execPath,
        adapter: 'generic',
        autoResume: false,
        args: ['-e', cli],
        projectIds: ['project-a', 'project-b'],
      },
      {
        id: 'dot-no-project',
        name: 'Dot sem projeto',
        role: 'Fixture local sem grant',
        executable: process.execPath,
        adapter: 'generic',
        autoResume: false,
        args: ['-e', cli],
        projectIds: [],
      },
    ],
  }),
  { mode: 0o600 },
);
ctx.env.KARONT_DOTS_CONFIG = config;
Object.assign(process.env, {
  KARONT_RUNTIME_DIR: ctx.env.KARONT_RUNTIME_DIR,
  KARONT_DATA_DIR: ctx.env.KARONT_DATA_DIR,
  KARONT_DOTS_CONFIG: config,
});

const result = {
  runId: stamp,
  status: 'running',
  stage: 'setup',
  checks: [],
  artifacts: [],
  metrics: {},
  evidence: {},
};
const client = new Client();
let app;
let d;
let secondInstance;
let page;
const pageErrors = [];
const daemonErrors = [];
const startedRuns = [];
const request = (method, value) =>
  client.request(value === undefined ? { method } : { method, value });

function recordScreenshot(name) {
  const filename = path.join(evidenceDir, name);
  return page
    .screenshot({ path: filename, fullPage: true })
    .then(() => result.artifacts.push(filename));
}

async function createTask(input) {
  return request('tasks.create', { ...input, operationId: randomUUID() });
}

async function taskCount(projectId) {
  let cursor;
  let count = 0;
  do {
    const batch = await request('tasks.list', { projectId, cursor, limit: 100 });
    count += batch.items.length;
    cursor = batch.nextCursor;
  } while (cursor);
  return count;
}

async function measureOne(rootPid) {
  const value = await sample(rootPid, 1200);
  return {
    durationMs: value.durationMs,
    processCount: value.processes.length,
    rssMiB: value.rssMiB,
    pssMiB: value.pssMiB,
    cpuPercentOneCore: value.cpuPercentOneCore,
  };
}

try {
  result.stage = 'launch';
  d = await daemon(ctx.env);
  d.child.stderr.on('data', (value) => daemonErrors.push(value.toString()));
  app = await electron.launch({
    chromiumSandbox: true,
    args: ['dist/desktop/main.cjs'],
    env: ctx.env,
    timeout: 20000,
  });
  page = await app.firstWindow();
  page.setDefaultTimeout(12000);
  page.on('pageerror', (error) => pageErrors.push(error.message));
  await openDiagnostics(page);
  assert.equal(
    await page.evaluate(
      () => window.karont.runtime.sandboxed && window.karont.runtime.contextIsolated,
    ),
    true,
  );
  const workspace = (await request('workspaces.list', { limit: 100 })).items[0];
  assert.ok(workspace);
  const isolatedWorkspace = await request('workspaces.create', {
    name: 'Workspace SPEC-006 isolado',
    operationId: randomUUID(),
  });
  const isolatedRepo = makeRepo(ctx.root, 'isolated workspace project');
  const isolatedProject = (
    await request('projects.add', {
      workspaceId: isolatedWorkspace.id,
      name: 'Projeto isolado SPEC-006',
      root: isolatedRepo,
      dotIds: [],
      operationId: randomUUID(),
    })
  ).project;
  await createTask({ projectId: isolatedProject.id, title: 'Tarefa de outro workspace' });
  const projectChat = await request('chats.create', {
    workspaceId: workspace.id,
    projectId: 'project-a',
    dotId: 'dot-a',
    title: 'Conversa de origem SPEC-006',
    operationId: randomUUID(),
  });
  await request('navigation.set', {
    workspaceId: workspace.id,
    projectId: 'project-a',
    chatId: projectChat.chat.id,
    operationId: randomUUID(),
  });
  await page.reload();
  await page.getByRole('navigation', { name: 'Áreas do workspace', exact: true }).waitFor();
  await page.getByRole('heading', { name: 'Conversa de origem SPEC-006', exact: true }).waitFor();

  result.stage = 'kanban-residual-filter';
  const residualFilterTasks = [
    {
      title: 'SPEC-006 filtro residual — A fazer',
      state: 'todo',
      assignees: [{ kind: 'local', id: 'local-user' }],
    },
    { title: 'SPEC-006 filtro residual — Em andamento', state: 'in_progress' },
    { title: 'SPEC-006 filtro residual — Em revisão', state: 'review' },
    { title: 'SPEC-006 filtro residual — Concluída', state: 'done' },
  ];
  for (const task of residualFilterTasks) await createTask({ projectId: 'project-a', ...task });
  const otherProjectFilterTask = await createTask({
    projectId: 'project-b',
    title: 'SPEC-006 filtro residual — Outro projeto',
    state: 'review',
  });
  await page.getByRole('button', { name: 'Tarefas', exact: true }).click();
  const taskFilters = page.locator('.task-filters');
  await taskFilters
    .getByRole('combobox', { name: 'Projeto', exact: true })
    .selectOption('project-a');
  await taskFilters.getByRole('combobox', { name: 'Estado', exact: true }).selectOption('todo');
  const residualTodoTitle = residualFilterTasks[0].title;
  const cardButton = (title) =>
    page.getByRole('button', { name: `Abrir tarefa ${title}`, exact: true });
  await until(async () => {
    assert.equal(await cardButton(residualTodoTitle).count(), 1);
    for (const task of residualFilterTasks.slice(1))
      assert.equal(await cardButton(task.title).count(), 0);
    return true;
  });
  await page.getByRole('button', { name: 'Quadro do projeto', exact: true }).click();
  const board = page.locator('.task-board');
  const columns = board.locator('.task-column');
  const stateLabels = ['A fazer', 'Em andamento', 'Em revisão', 'Concluída'];
  await until(async () => {
    assert.equal(await board.count(), 1);
    for (let index = 0; index < residualFilterTasks.length; index++) {
      assert.equal(
        await columns
          .nth(index)
          .getByRole('button', {
            name: `Abrir tarefa ${residualFilterTasks[index].title}`,
            exact: true,
          })
          .count(),
        1,
        `${residualFilterTasks[index].title} deve aparecer em ${stateLabels[index]}`,
      );
    }
    assert.equal(
      await cardButton(otherProjectFilterTask.title).count(),
      0,
      'o quadro não inclui tarefas de outro projeto',
    );
    return true;
  });
  assert.equal(
    await taskFilters.getByRole('combobox', { name: 'Estado', exact: true }).isDisabled(),
    true,
    'filtro de estado fica desabilitado no quadro',
  );
  assert.equal(
    await taskFilters.getByRole('combobox', { name: 'Responsável', exact: true }).isDisabled(),
    true,
    'filtro de responsável fica desabilitado no quadro',
  );
  const residualReviewTitle = residualFilterTasks[2].title;
  await board
    .getByRole('combobox', { name: `Mover ${residualReviewTitle}`, exact: true })
    .selectOption('done');
  await until(async () => {
    assert.equal(
      await columns
        .nth(2)
        .getByRole('button', { name: `Abrir tarefa ${residualReviewTitle}`, exact: true })
        .count(),
      0,
    );
    assert.equal(
      await columns
        .nth(3)
        .getByRole('button', { name: `Abrir tarefa ${residualReviewTitle}`, exact: true })
        .count(),
      1,
    );
    return true;
  });
  await recordScreenshot('kanban-residual-filter-1440.png');
  await page.getByRole('button', { name: 'Visão agregada', exact: true }).click();
  await until(async () => {
    assert.equal(
      await taskFilters.getByRole('combobox', { name: 'Estado', exact: true }).inputValue(),
      'todo',
      'o filtro A fazer é preservado',
    );
    assert.equal(
      await cardButton(residualTodoTitle).count(),
      1,
      'a visão agregada mantém tarefas A fazer',
    );
    assert.equal(await cardButton(residualFilterTasks[1].title).count(), 0);
    assert.equal(
      await cardButton(residualReviewTitle).count(),
      0,
      'a visão agregada A fazer não inclui a tarefa movida',
    );
    assert.equal(await cardButton(residualFilterTasks[3].title).count(), 0);
    return true;
  });

  await taskFilters.getByRole('combobox', { name: 'Estado', exact: true }).selectOption('');
  await taskFilters
    .getByRole('combobox', { name: 'Responsável', exact: true })
    .selectOption('local:local-user');
  const assignedFilterTitle = residualFilterTasks[0].title;
  const unassignedFilterTitles = residualFilterTasks.slice(1).map((task) => task.title);
  await until(async () => {
    assert.equal(
      await cardButton(assignedFilterTitle).count(),
      1,
      'filtro Você mostra a tarefa atribuída',
    );
    for (const title of unassignedFilterTitles)
      assert.equal(
        await cardButton(title).count(),
        0,
        'filtro Você exclui tarefa sem esse responsável',
      );
    return true;
  });
  await page.getByRole('button', { name: 'Quadro do projeto', exact: true }).click();
  await until(async () => {
    for (let index = 0; index < residualFilterTasks.length; index++) {
      const expectedColumn = [0, 1, 3, 3][index];
      assert.equal(
        await columns
          .nth(expectedColumn)
          .getByRole('button', {
            name: `Abrir tarefa ${residualFilterTasks[index].title}`,
            exact: true,
          })
          .count(),
        1,
      );
    }
    assert.equal(
      await cardButton(otherProjectFilterTask.title).count(),
      0,
      'o filtro de projeto continua limitando o quadro',
    );
    return true;
  });
  assert.equal(
    await taskFilters.getByRole('combobox', { name: 'Responsável', exact: true }).isDisabled(),
    true,
  );
  await page.getByRole('button', { name: 'Visão agregada', exact: true }).click();
  await until(async () => {
    assert.equal(
      await taskFilters.getByRole('combobox', { name: 'Responsável', exact: true }).inputValue(),
      'local:local-user',
      'o filtro de responsável é preservado',
    );
    assert.equal(await cardButton(assignedFilterTitle).count(), 1);
    for (const title of unassignedFilterTitles) assert.equal(await cardButton(title).count(), 0);
    return true;
  });
  result.checks.push(
    'Ajuste 01 / B17: filtros de estado e responsável não restringem as quatro colunas do quadro; mudança de estado move o cartão; filtros são restaurados na visão agregada e projeto diferente permanece excluído',
  );

  result.stage = 'kanban-manual-command';
  const beforeAutomaticRunCount = (await request('runs.list', { limit: 100 })).length;
  await page.getByRole('button', { name: 'Tarefas', exact: true }).click();
  const filterProject = taskFilters.getByRole('combobox', { name: 'Projeto', exact: true });
  await filterProject.selectOption('project-a');
  const boardStartedAt = performance.now();
  await page.getByRole('button', { name: 'Quadro do projeto', exact: true }).click();
  await page.locator('.task-column').first().waitFor();
  result.metrics.boardOpenMs = performance.now() - boardStartedAt;
  await recordScreenshot('kanban-project-1440.png');

  const initialCount = await taskCount('project-a');
  await page.getByRole('button', { name: 'Nova tarefa', exact: true }).click();
  let createDialog = page.getByRole('dialog', { name: 'Nova tarefa', exact: true });
  await createDialog
    .getByRole('textbox', { name: 'Título', exact: true })
    .fill('Rascunho cancelado');
  await createDialog.getByRole('button', { name: 'Cancelar', exact: true }).click();
  await createDialog.waitFor({ state: 'hidden' });
  assert.equal(await taskCount('project-a'), initialCount, 'cancelamento não deve gravar tarefa');

  await page.getByRole('button', { name: 'Visão agregada', exact: true }).click();
  await page.getByRole('button', { name: 'Nova tarefa', exact: true }).click();
  createDialog = page.getByRole('dialog', { name: 'Nova tarefa', exact: true });
  await createDialog
    .getByRole('combobox', { name: 'Projeto', exact: true })
    .selectOption('project-a');
  await createDialog
    .getByRole('textbox', { name: 'Título', exact: true })
    .fill('Tarefa manual SPEC-006');
  await createDialog
    .getByRole('textbox', { name: 'Descrição', exact: true })
    .fill('Descrição sintética para validação manual.');
  await createDialog.getByRole('checkbox', { name: 'Você', exact: true }).check();
  await createDialog.getByRole('checkbox', { name: 'Dot autorizado', exact: true }).check();
  await createDialog.getByRole('button', { name: 'Criar tarefa', exact: true }).click();
  // O diálogo é modal: até ele fechar, o resto da tela não recebe digitação (DIVIDAS #15).
  await createDialog.waitFor({ state: 'hidden' });
  const manualTask = await until(async () => {
    const task = (await request('tasks.list', { projectId: 'project-a', limit: 100 })).items.find(
      (item) => item.title === 'Tarefa manual SPEC-006',
    );
    assert.ok(task);
    return request('tasks.get', { taskId: task.id });
  });
  assert.equal(manualTask.description, 'Descrição sintética para validação manual.');
  assert.ok(manualTask.assignees.some((item) => item.kind === 'local'));
  assert.ok(
    manualTask.assignees.some(
      (item) => item.kind === 'dot' && item.id === 'dot-a' && item.available,
    ),
  );
  assert.equal(
    (await request('runs.list', { limit: 100 })).length,
    beforeAutomaticRunCount,
    'criar tarefa não inicia Run',
  );
  await assert.rejects(
    () =>
      createTask({
        projectId: 'project-a',
        title: 'Dot sem autorização',
        assignees: [{ kind: 'dot', id: 'dot-no-project' }],
      }),
    /Dot não autorizado/,
  );
  await openConversation(page, 'Conversa de origem SPEC-006');
  const middleMention = 'A menção no meio: /kanban não é um comando.';
  await page.getByRole('textbox', { name: 'Nova mensagem', exact: true }).fill(middleMention);
  await page.getByRole('button', { name: 'Salvar mensagem', exact: true }).click();
  await until(async () => {
    assert.ok(
      (await request('messages.list', { chatId: projectChat.chat.id, limit: 100 })).items.some(
        (item) => item.body === middleMention,
      ),
    );
    return true;
  });
  await page
    .getByRole('dialog', { name: 'Prévia da nova tarefa', exact: true })
    .waitFor({ state: 'hidden' });
  const createPreviewCount = await taskCount('project-a');
  await page
    .getByRole('textbox', { name: 'Nova mensagem', exact: true })
    .fill('/kanban Tarefa pelo comando');
  await page.getByRole('button', { name: 'Salvar mensagem', exact: true }).click();
  let taskPreview = page.getByRole('dialog', { name: 'Prévia da nova tarefa', exact: true });
  await taskPreview.waitFor();
  assert.equal(
    await taskPreview.getByRole('textbox', { name: 'Título', exact: true }).inputValue(),
    'Tarefa pelo comando',
  );
  assert.equal(
    await taskPreview.getByRole('textbox', { name: 'Descrição', exact: true }).inputValue(),
    '',
  );
  await taskPreview
    .getByRole('textbox', { name: 'Descrição', exact: true })
    .fill('Descrição revisada antes de confirmar.');
  await taskPreview
    .getByRole('combobox', { name: 'Estado inicial', exact: true })
    .selectOption('review');
  await taskPreview.getByRole('button', { name: 'Cancelar', exact: true }).click();
  assert.equal(
    await taskCount('project-a'),
    createPreviewCount,
    'cancelar prévia não cria evento ou vínculo',
  );
  assert.equal(
    await page.getByRole('textbox', { name: 'Nova mensagem', exact: true }).inputValue(),
    '/kanban Tarefa pelo comando',
  );
  await page.getByRole('button', { name: 'Salvar mensagem', exact: true }).click();
  taskPreview = page.getByRole('dialog', { name: 'Prévia da nova tarefa', exact: true });
  await taskPreview.waitFor();
  await taskPreview
    .getByRole('textbox', { name: 'Descrição', exact: true })
    .fill('Descrição revisada antes de confirmar.');
  assert.equal(
    await taskPreview.getByRole('textbox', { name: 'Descrição', exact: true }).inputValue(),
    'Descrição revisada antes de confirmar.',
    'a prévia deve manter o texto digitado',
  );
  await taskPreview
    .getByRole('combobox', { name: 'Estado inicial', exact: true })
    .selectOption('review');
  await taskPreview.getByRole('checkbox', { name: 'Você', exact: true }).check();
  assert.equal(
    await taskPreview.getByRole('textbox', { name: 'Descrição', exact: true }).inputValue(),
    'Descrição revisada antes de confirmar.',
  );
  await taskPreview.getByRole('button', { name: 'Confirmar e criar tarefa', exact: true }).click();
  await taskPreview.waitFor({ state: 'hidden' });
  const commandTask = await until(async () => {
    const task = (await request('tasks.list', { projectId: 'project-a', limit: 100 })).items.find(
      (item) => item.title === 'Tarefa pelo comando',
    );
    assert.ok(task);
    return request('tasks.get', { taskId: task.id });
  });
  assert.equal(commandTask.state, 'review');
  assert.equal(commandTask.description, 'Descrição revisada antes de confirmar.');
  assert.equal(commandTask.origin.chatId, projectChat.chat.id);
  assert.equal(commandTask.origin.messageId, null);
  const commandMessages = await request('messages.list', {
    chatId: projectChat.chat.id,
    limit: 100,
  });
  assert.equal(commandMessages.items.length, 1, '/kanban não é salvo como Message');
  assert.equal(
    commandMessages.items[0].body,
    middleMention,
    'menção em frase é mensagem comum, não comando',
  );
  assert.equal(
    (await request('runs.list', { limit: 100 })).length,
    beforeAutomaticRunCount,
    '/kanban não inicia Run',
  );
  const replayOperationId = randomUUID();
  const replayInput = {
    projectId: 'project-a',
    title: 'Tarefa de replay',
    description: 'Conteúdo sintético',
    operationId: replayOperationId,
  };
  const replayed = await request('tasks.create', replayInput);
  assert.deepEqual(await request('tasks.create', replayInput), replayed);
  await assert.rejects(
    () => request('tasks.create', { ...replayInput, title: 'Outro conteúdo' }),
    /reutilizada com conteúdo diferente/,
  );
  await request('tasks.update', {
    taskId: replayed.id,
    state: 'review',
    expectedRevision: replayed.revision,
    operationId: randomUUID(),
  });
  await assert.rejects(
    () =>
      request('tasks.update', {
        taskId: replayed.id,
        title: 'Alteração obsoleta',
        expectedRevision: replayed.revision,
        operationId: randomUUID(),
      }),
    /mudou em outro cliente/,
  );
  result.checks.push(
    'B1/B2/B3: tarefa manual com responsável, cancelamento sem efeitos e /kanban com prévia editável/cancelável; comando não foi salvo nem enviado a Run',
  );
  result.checks.push(
    'B11: replay com a mesma chave retorna a tarefa original; payload diferente e revisão obsoleta são recusados',
  );

  result.stage = 'task-update-history';
  await page.getByRole('button', { name: 'Início', exact: true }).click();
  await page.getByRole('button', { name: 'Tarefas', exact: true }).click();
  await page.getByRole('button', { name: 'Visão agregada', exact: true }).click();
  await taskFilters
    .getByRole('combobox', { name: 'Projeto', exact: true })
    .selectOption('project-a');
  await page.getByRole('button', { name: 'Quadro do projeto', exact: true }).click();
  const openManual = page.getByRole('button', {
    name: 'Abrir tarefa Tarefa manual SPEC-006',
    exact: true,
  });
  await openManual.click();
  const detailDialog = page.getByRole('dialog', { name: 'Detalhes da tarefa', exact: true });
  await detailDialog
    .getByRole('textbox', { name: 'Título', exact: true })
    .fill('Tarefa manual revisada');
  const stateControl = detailDialog.getByRole('combobox', {
    name: 'Estado da tarefa',
    exact: true,
  });
  await stateControl.focus();
  await stateControl.press('End');
  await stateControl.press('Enter');
  const saveTaskChanges = detailDialog.getByRole('button', {
    name: 'Salvar alterações',
    exact: true,
  });
  await saveTaskChanges.focus();
  await saveTaskChanges.press('Enter');
  const editedManual = await request('tasks.get', { taskId: manualTask.id });
  assert.equal(editedManual.title, 'Tarefa manual revisada');
  assert.equal(editedManual.state, 'done');
  assert.ok(
    (await request('tasks.events.list', { taskId: manualTask.id, limit: 100 })).items.some(
      (item) => item.kind === 'task.state_changed',
    ),
  );
  await stateControl.focus();
  await stateControl.press('Home');
  await stateControl.press('Enter');
  await saveTaskChanges.focus();
  await saveTaskChanges.press('Enter');
  assert.equal(
    (await request('tasks.get', { taskId: manualTask.id })).state,
    'todo',
    'estado concluído pode ser reaberto explicitamente',
  );
  await detailDialog
    .locator('.dialog-actions')
    .getByRole('button', { name: 'Fechar', exact: true })
    .click();
  result.checks.push(
    'B6/B9: título, descrição e estado persistem; histórico registra alterações; tarefa concluída reabre sem alterar Run',
  );

  result.stage = 'explicit-run-link';
  result.metrics.idleBaseline = await Promise.all([
    measureOne(app.process().pid),
    measureOne(d.pid),
  ]);
  const runA = await request('runs.start', {
    dotId: 'dot-a',
    projectId: 'project-a',
    permissionMode: 'ask',
    operationId: randomUUID(),
  });
  const runB = await request('runs.start', {
    dotId: 'dot-a',
    projectId: 'project-b',
    permissionMode: 'ask',
    operationId: randomUUID(),
  });
  startedRuns.push(runA, runB);
  const activeRuns = await until(async () => {
    const all = await request('runs.list', { limit: 100 });
    const active = [runA, runB].map((run) => all.find((item) => item.id === run.id));
    assert.ok(active.every((run) => run?.state === 'running' && run.pid));
    return active;
  });
  assert.equal(activeRuns.length, 2);
  await page.getByRole('button', { name: 'Início', exact: true }).click();
  await page.getByRole('button', { name: 'Tarefas', exact: true }).click();
  await taskFilters
    .getByRole('combobox', { name: 'Projeto', exact: true })
    .selectOption('project-a');
  await page.getByRole('button', { name: 'Quadro do projeto', exact: true }).click();
  await page
    .getByRole('button', { name: 'Abrir tarefa Tarefa manual revisada', exact: true })
    .click();
  const linkDialog = page.getByRole('dialog', { name: 'Detalhes da tarefa', exact: true });
  await linkDialog
    .getByRole('combobox', { name: 'Associar Run existente deste projeto', exact: true })
    .selectOption(runA.id);
  await linkDialog.getByRole('button', { name: 'Associar Run', exact: true }).click();
  const linkedTask = await request('tasks.get', { taskId: manualTask.id });
  assert.equal(linkedTask.runs.length, 1);
  assert.equal(linkedTask.runs[0].id, runA.id);
  assert.equal(linkedTask.state, 'todo');
  await assert.rejects(
    () =>
      request('tasks.runs.link', {
        taskId: manualTask.id,
        runId: runB.id,
        expectedRevision: linkedTask.revision,
        operationId: randomUUID(),
      }),
    /mesmo projeto/,
  );
  assert.equal(
    (await request('runs.list', { limit: 100 })).find((item) => item.id === runA.id).state,
    'running',
  );
  assert.equal(
    (await request('runs.list', { limit: 100 })).filter((item) => item.state === 'running').length,
    2,
  );
  await linkDialog
    .locator('.dialog-actions')
    .getByRole('button', { name: 'Fechar', exact: true })
    .click();
  result.checks.push(
    'B7/B8/B9: Dot não inicia execução; Run do mesmo projeto associa; Run de outro projeto recusa; estados Task/Run continuam independentes',
  );

  result.stage = 'pagination-and-filtering';
  const pageStartedAt = performance.now();
  const firstPage = await request('tasks.list', {
    workspaceId: workspace.id,
    projectId: 'project-a',
    limit: 100,
  });
  const secondPage = firstPage.nextCursor
    ? await request('tasks.list', {
        workspaceId: workspace.id,
        projectId: 'project-a',
        cursor: firstPage.nextCursor,
        limit: 100,
      })
    : { items: [] };
  result.metrics.pageResponseMs = performance.now() - pageStartedAt;
  const projectTaskCountBeforeMass = await taskCount('project-a');
  assert.equal(firstPage.items.length + secondPage.items.length, projectTaskCountBeforeMass);
  await request('tasks.list', {
    projectId: 'project-a',
    state: 'review',
    assignee: { kind: 'local', id: 'local-user' },
    limit: 100,
  }).then((filtered) => {
    assert.ok(filtered.items.some((item) => item.title === 'Tarefa pelo comando'));
    assert.ok(
      filtered.items.every(
        (item) =>
          item.state === 'review' && item.assignees.some((assignee) => assignee.kind === 'local'),
      ),
    );
  });
  for (let index = 0; index < 102; index++) {
    await createTask({
      projectId: 'project-a',
      title: `Massa SPEC006 ${String(index).padStart(3, '0')}`,
    });
    if (index === 79) await wait(1050); // 100 requests/s daemon limit.
  }
  const allPageOne = await request('tasks.list', { projectId: 'project-a', limit: 100 });
  const allPageTwo = await request('tasks.list', {
    projectId: 'project-a',
    cursor: allPageOne.nextCursor,
    limit: 100,
  });
  assert.ok(allPageOne.nextCursor);
  const expectedProjectTaskCount = projectTaskCountBeforeMass + 102;
  assert.equal(allPageOne.items.length + allPageTwo.items.length, expectedProjectTaskCount);
  await page.getByRole('button', { name: 'Início', exact: true }).click();
  await page.getByRole('button', { name: 'Tarefas', exact: true }).click();
  await page.getByRole('button', { name: 'Visão agregada', exact: true }).click();
  await taskFilters.getByRole('combobox', { name: 'Estado', exact: true }).selectOption('');
  await taskFilters.getByRole('combobox', { name: 'Responsável', exact: true }).selectOption('');
  const workspaceFilter = taskFilters.getByRole('combobox', { name: 'Workspace', exact: true });
  await workspaceFilter.selectOption(workspace.id);
  await until(async () => assert.equal(await page.locator('.task-list .task-card').count(), 100));
  assert.equal(
    await page
      .getByRole('button', { name: 'Abrir tarefa Tarefa de outro workspace', exact: true })
      .count(),
    0,
    'filtro de workspace exclui tarefas de outros contextos',
  );
  await workspaceFilter.selectOption('');
  await taskFilters
    .getByRole('combobox', { name: 'Projeto', exact: true })
    .selectOption('project-a');
  await until(async () => assert.equal(await page.locator('.task-list .task-card').count(), 100));
  assert.ok(
    await page.getByRole('button', { name: 'Carregar próxima página', exact: true }).count(),
  );
  const paginationStartedAt = performance.now();
  await page.getByRole('button', { name: 'Carregar próxima página', exact: true }).click();
  await page
    .getByRole('button', { name: `Abrir tarefa ${allPageTwo.items[0].title}`, exact: true })
    .waitFor();
  result.metrics.uiPaginationMs = performance.now() - paginationStartedAt;
  assert.equal(await page.locator('.task-list .task-card').count(), expectedProjectTaskCount);
  await page.setViewportSize({ width: 1440, height: 1000 });
  await recordScreenshot('tasks-aggregate-1440.png');
  await page.setViewportSize({ width: 900, height: 1000 });
  assert.ok(
    await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth),
    'overflow horizontal em 900px',
  );
  await recordScreenshot('tasks-aggregate-900.png');
  result.checks.push(
    'B12/B13/B16: filtros por workspace/projeto/estado/responsável; paginação carrega mais de 100 tarefas; layouts 900/1440px sem overflow global',
  );

  result.stage = 'global-chat-restoration';
  const globalChat = await request('chats.create', {
    workspaceId: null,
    projectId: null,
    title: 'Conversa global SPEC-006',
    operationId: randomUUID(),
  });
  const globalSaved = await request('messages.save', {
    chatId: globalChat.chat.id,
    body: 'Histórico global sintético.',
    expectedRevision: globalChat.chat.revision,
    operationId: randomUUID(),
  });
  await request('chats.draft', {
    chatId: globalChat.chat.id,
    draft: 'Rascunho global sintético.',
    expectedRevision: globalSaved.chat.chat.revision,
    operationId: randomUUID(),
  });
  await request('navigation.set', {
    workspaceId: null,
    projectId: null,
    chatId: globalChat.chat.id,
    operationId: randomUUID(),
  });
  const closed = page.waitForEvent('close');
  await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].close());
  await closed;
  const reopenedWindow = app.waitForEvent('window');
  secondInstance = spawn(harnessRequire('electron'), ['dist/desktop/main.cjs'], {
    env: ctx.env,
    stdio: 'ignore',
  });
  const secondExit = once(secondInstance, 'exit');
  page = await reopenedWindow;
  page.setDefaultTimeout(12000);
  page.on('pageerror', (error) => pageErrors.push(error.message));
  await page.getByRole('heading', { name: 'Conversa global SPEC-006', exact: true }).waitFor();
  assert.deepEqual(await page.evaluate(() => window.karont.navigation()), {
    workspaceId: null,
    projectId: null,
    chatId: globalChat.chat.id,
  });
  assert.equal(
    await page.getByRole('textbox', { name: 'Nova mensagem', exact: true }).inputValue(),
    'Rascunho global sintético.',
  );
  await page.getByText('Histórico global sintético.', { exact: true }).waitFor();
  await openDiagnostics(page);
  await openConversation(page, 'Conversa global SPEC-006');
  const [secondExitCode] = await secondExit;
  assert.equal(secondExitCode, 0);
  result.checks.push(
    'B0: fechar e recriar a janela restaura conversa global null/null com histórico, rascunho e ID originais',
  );

  result.stage = 'free-chat-link-and-message-origin';
  const taskCountBeforeFree = await taskCount('project-a');
  await page
    .getByRole('textbox', { name: 'Nova mensagem', exact: true })
    .fill('/kanban Tarefa global vinculada');
  await page.getByRole('button', { name: 'Salvar mensagem', exact: true }).click();
  let linkChatDialog = page.getByRole('dialog', {
    name: 'Vincular conversa a projeto',
    exact: true,
  });
  await linkChatDialog.waitFor();
  await linkChatDialog.getByRole('button', { name: 'Cancelar', exact: true }).click();
  assert.equal(
    await taskCount('project-a'),
    taskCountBeforeFree,
    'cancelar vínculo de conversa livre não cria tarefa',
  );
  assert.equal(
    await page.getByRole('textbox', { name: 'Nova mensagem', exact: true }).inputValue(),
    '/kanban Tarefa global vinculada',
  );
  await page.getByRole('button', { name: 'Vincular a projeto', exact: true }).click();
  linkChatDialog = page.getByRole('dialog', { name: 'Vincular conversa a projeto', exact: true });
  await linkChatDialog
    .getByRole('combobox', { name: 'Projeto de destino', exact: true })
    .selectOption('project-a');
  await linkChatDialog
    .getByRole('combobox', { name: 'Dot para esta conversa', exact: true })
    .selectOption('dot-a');
  await linkChatDialog.getByRole('button', { name: 'Confirmar movimentação', exact: true }).click();
  await page.getByRole('heading', { name: 'Conversa global SPEC-006', exact: true }).waitFor();
  assert.equal(
    await page.getByRole('textbox', { name: 'Nova mensagem', exact: true }).inputValue(),
    '/kanban Tarefa global vinculada',
  );
  await page.getByRole('button', { name: 'Salvar mensagem', exact: true }).click();
  taskPreview = page.getByRole('dialog', { name: 'Prévia da nova tarefa', exact: true });
  await taskPreview.waitFor();
  assert.equal(
    await taskPreview.getByRole('textbox', { name: 'Título', exact: true }).inputValue(),
    'Tarefa global vinculada',
  );
  assert.equal(
    await taskPreview.getByRole('textbox', { name: 'Descrição', exact: true }).inputValue(),
    '',
  );
  await taskPreview.getByRole('button', { name: 'Confirmar e criar tarefa', exact: true }).click();
  await taskPreview.waitFor({ state: 'hidden' });
  const linkedFreeTask = await until(async () => {
    const task = (await request('tasks.list', { projectId: 'project-a', limit: 100 })).items.find(
      (item) => item.title === 'Tarefa global vinculada',
    );
    assert.ok(task);
    return request('tasks.get', { taskId: task.id });
  });
  assert.equal(linkedFreeTask.origin.chatId, globalChat.chat.id);
  assert.equal(
    (await request('messages.list', { chatId: globalChat.chat.id, limit: 100 })).items.length,
    1,
    '/kanban não criou mensagem de comando',
  );

  // O rascunho do /kanban é limpo de forma assíncrona; digitar antes disso perde o texto (DIVIDAS #14).
  await until(async () => {
    assert.equal((await request('chats.get', { chatId: globalChat.chat.id })).chat.draft, '');
    assert.equal(
      await page.getByRole('textbox', { name: 'Nova mensagem', exact: true }).inputValue(),
      '',
    );
  });
  const sourceText = 'Mensagem salva usada como descrição inicial.';
  await page.getByRole('textbox', { name: 'Nova mensagem', exact: true }).fill(sourceText);
  await page.getByRole('button', { name: 'Salvar mensagem', exact: true }).click();
  const sourceMessage = await until(async () => {
    const messages = await request('messages.list', { chatId: globalChat.chat.id, limit: 100 });
    const message = messages.items.find((item) => item.body === sourceText);
    assert.ok(message);
    return message;
  });
  const sourceMessageCard = page
    .locator('.saved-message')
    .filter({ has: page.getByText(sourceText, { exact: true }) });
  await sourceMessageCard
    .getByRole('button', { name: 'Criar tarefa a partir desta mensagem', exact: true })
    .waitFor();
  await sourceMessageCard
    .getByRole('button', { name: 'Criar tarefa a partir desta mensagem', exact: true })
    .click();
  taskPreview = page.getByRole('dialog', { name: 'Prévia da nova tarefa', exact: true });
  await taskPreview.waitFor();
  assert.equal(
    await taskPreview.getByRole('textbox', { name: 'Descrição', exact: true }).inputValue(),
    sourceText,
  );
  await taskPreview.getByRole('button', { name: 'Confirmar e criar tarefa', exact: true }).click();
  await taskPreview.waitFor({ state: 'hidden' });
  const fromMessage = await until(async () => {
    const pageOfTasks = await request('tasks.list', { projectId: 'project-a', limit: 100 });
    const summary = pageOfTasks.items.find((item) => item.origin.messageId === sourceMessage.id);
    assert.ok(summary);
    return request('tasks.get', { taskId: summary.id });
  });
  assert.equal(fromMessage.description, sourceText);
  assert.equal(fromMessage.origin.chatId, globalChat.chat.id);
  assert.equal(fromMessage.origin.messageId, sourceMessage.id);
  assert.deepEqual(await request('navigation.get'), {
    workspaceId: workspace.id,
    projectId: 'project-a',
    chatId: globalChat.chat.id,
  });
  result.checks.push(
    'B4/B5: conversa livre exige vinculação, cancelamento não cria tarefa e nova revisão é solicitada; mensagem salva preenche descrição e preserva origem correta',
  );

  result.stage = 'measurements';
  result.metrics.whileTwoRuns = await Promise.all([
    measureOne(app.process().pid),
    measureOne(d.pid),
  ]);
  result.metrics.comparison = {
    scope:
      'mesmo host/processos do aplicativo e daemon, 1,2s por raiz; execuções explicitamente iniciadas para validar vínculos; uma amostra local por cenário',
    idleBaseline:
      'capturada antes de iniciar as duas Runs; ver benchmarks/spec006/<runId>/spec006-e2e.json',
    limitations:
      'carga concorrente do desktop não controlada; RSS soma páginas compartilhadas; uma amostra não certifica consumo prolongado nem CI remota',
  };
  await page.setViewportSize({ width: 1440, height: 1000 });
  await recordScreenshot('global-restored-1440.png');
  const report = await page.evaluate(() => window.karont.report());
  assert.ok(
    !report.includes('Tarefa manual revisada') &&
      !report.includes('Mensagem salva usada como descrição inicial'),
  );
  const notifications = await page.evaluate(() => window.karont.notifications());
  assert.ok(!JSON.stringify(notifications).includes('Tarefa manual revisada'));
  assert.deepEqual(pageErrors, []);
  result.checks.push(
    'B15: conteúdo de tarefas não é incluído em notificações/relatórios; checagem no E2E usa somente dados sintéticos locais',
  );
  result.status = 'passed';
  result.stage = 'complete';
} catch (error) {
  result.status = 'failed';
  result.error = error.stack ?? String(error);
  result.daemonErrors = daemonErrors;
  // Evidência para diagnosticar falhas no CI; a captura pode falhar se a janela já fechou.
  if (page) {
    await recordScreenshot('falha.png').catch((captureError) => {
      result.screenshotError = String(captureError);
    });
    result.failureText = await page.innerText('body').catch((captureError) => String(captureError));
  }
  process.exitCode = 1;
} finally {
  for (const run of startedRuns) {
    if (run?.id)
      await client
        .request({ method: 'terminal.write', value: { runId: run.id, data: 'EXIT\r' } })
        .catch(() => {});
  }
  if (secondInstance && secondInstance.exitCode === null && secondInstance.signalCode === null)
    secondInstance.kill();
  if (app) await app.close().catch(() => {});
  client.close();
  if (d) {
    await d.client.request({ method: 'shutdown' }).catch(() => {});
    d.client.close();
    if (d.child.exitCode === null && d.child.signalCode === null) d.child.kill('SIGTERM');
  }
  await wait(300);
  const evidenceFile = path.join(evidenceDir, 'spec006-e2e.json');
  fs.writeFileSync(evidenceFile, JSON.stringify(result, null, 2));
  console.log(JSON.stringify(result, null, 2));
  fs.rmSync(ctx.root, { recursive: true, force: true });
}
