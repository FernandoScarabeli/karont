// Captura as telas principais (PNG + DOM normalizado) para provar que uma refatoração
// não mudou nada visível. Uso:
//   node scripts/visual-snapshot.mjs <nome>            grava em artifacts/visual/<nome>/
//   node scripts/visual-snapshot.mjs --compare <a> <b> compara duas capturas
import { _electron as electron } from 'playwright';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import assert from 'node:assert/strict';
import { daemon, openConversation, openDiagnostics, until, wait } from './harness.mjs';

const base = path.resolve('artifacts/visual');

if (process.argv[2] === '--compare') {
  const [a, b] = process.argv.slice(3).map((name) => path.join(base, name));
  if (!a || !b) throw Error('Uso: --compare <captura-a> <captura-b>');
  const names = [...new Set([...fs.readdirSync(a), ...fs.readdirSync(b)])].sort();
  const different = [];
  for (const name of names) {
    const left = path.join(a, name);
    const right = path.join(b, name);
    if (!fs.existsSync(left) || !fs.existsSync(right)) {
      different.push(`${name}: só existe em ${fs.existsSync(left) ? 'a' : 'b'}`);
      continue;
    }
    const x = fs.readFileSync(left);
    const y = fs.readFileSync(right);
    if (x.equals(y)) continue;
    if (name.endsWith('.html')) {
      const xl = x.toString().split('\n');
      const yl = y.toString().split('\n');
      const line = xl.findIndex((value, index) => value !== yl[index]);
      different.push(
        `${name}: linha ${line + 1}\n  a: ${xl[line]?.slice(0, 300)}\n  b: ${yl[line]?.slice(0, 300)}`,
      );
    } else different.push(`${name}: pixels diferentes`);
  }
  if (different.length) {
    console.log(`${different.length} diferença(s):\n${different.join('\n')}`);
    process.exit(1);
  }
  console.log(`Sem diferenças (${names.length} arquivos).`);
  process.exit(0);
}

const label = process.argv[2];
if (!label || label.startsWith('-')) throw Error('Uso: node scripts/visual-snapshot.mjs <nome>');
const output = path.join(base, label);
fs.rmSync(output, { recursive: true, force: true });
fs.mkdirSync(output, { recursive: true });

// Caminhos fixos: aparecem na tela (raiz do projeto) e precisam ser iguais entre capturas.
const root = path.join(os.tmpdir(), 'karont-visual');
fs.rmSync(root, { recursive: true, force: true });
fs.mkdirSync(root, { recursive: true });
const env = {
  ...process.env,
  KARONT_RUNTIME_DIR: path.join(root, 'run'),
  KARONT_DATA_DIR: path.join(root, 'data'),
  KARONT_DESKTOP_DATA: path.join(root, 'desktop'),
  KARONT_CONFIG_DIR: path.join(root, 'config'),
  KARONT_DOTS_CONFIG: path.join(root, 'dots.json'),
  TZ: 'America/Sao_Paulo',
  LANG: 'pt_BR.UTF-8',
};
if (!env.XDG_RUNTIME_DIR && process.getuid) env.XDG_RUNTIME_DIR = `/run/user/${process.getuid()}`;
if (!env.XAUTHORITY && env.DISPLAY && fs.existsSync(env.XDG_RUNTIME_DIR)) {
  const xauthority = fs
    .readdirSync(env.XDG_RUNTIME_DIR)
    .find((name) => name.startsWith('.mutter-Xwaylandauth.'));
  if (xauthority) env.XAUTHORITY = path.join(env.XDG_RUNTIME_DIR, xauthority);
}

const repo = path.join(root, 'projeto visual');
fs.mkdirSync(repo);
const gitEnv = {
  ...process.env,
  GIT_AUTHOR_DATE: '2026-01-15T10:00:00Z',
  GIT_COMMITTER_DATE: '2026-01-15T10:00:00Z',
};
for (const args of [
  ['init', '--quiet', '--initial-branch=main'],
  ['config', 'user.email', 'visual@local.invalid'],
  ['config', 'user.name', 'Karont visual'],
])
  execFileSync('git', args, { cwd: repo, env: gitEnv });
fs.writeFileSync(path.join(repo, 'README.md'), '# Projeto visual\n\nLinha original.\n');
execFileSync('git', ['add', '.'], { cwd: repo, env: gitEnv });
execFileSync('git', ['commit', '--quiet', '-m', 'base'], { cwd: repo, env: gitEnv });

// Dot de fixture: saída fixa (sem PID) e uma alteração para a tela de diff.
const cli = `const fs=require('node:fs');fs.writeFileSync('README.md','# Projeto visual\\n\\nLinha alterada pelo Dot.\\n');fs.writeFileSync('nota.txt','nova nota\\n');console.log('Dot visual pronto');require('node:readline').createInterface({input:process.stdin}).on('line',()=>{});setInterval(()=>{},1000);`;
fs.writeFileSync(
  env.KARONT_DOTS_CONFIG,
  JSON.stringify({
    version: 1,
    projects: [{ id: 'visual-project', name: 'Projeto visual', root: repo }],
    dots: [
      {
        id: 'visual-dot',
        name: 'Dot visual',
        role: 'Fixture de comparação visual',
        executable: process.execPath,
        adapter: 'generic',
        autoResume: false,
        args: ['-e', cli],
        projectIds: ['visual-project'],
      },
    ],
  }),
  { mode: 0o600 },
);

// Troca em textos e atributos tudo o que varia entre capturas (ids, horários, PIDs, medições)
// por um texto do mesmo tamanho, para a comparação acusar só mudanças de verdade.
function maskText(value) {
  return value
    .replace(/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/gi, (m) =>
      m.replace(/[0-9a-f]/gi, 'x'),
    )
    .replace(/\b(?=[0-9a-f]*\d)[0-9a-f]{8}\b/g, 'xxxxxxxx')
    .replace(/\bPID \d+/g, (m) => m.replace(/\d/g, '0'))
    .replace(/\b\d{1,2}\/\d{1,2}\/\d{2,4}\b/g, (m) => m.replace(/\d/g, '0'))
    .replace(/\b\d{1,2}:\d{2}(:\d{2})?\b/g, (m) => m.replace(/\d/g, '0'));
}
const masks = [];

async function capture(page, name) {
  await page.evaluate(() => document.fonts.ready);
  // O ponteiro real do sistema deixaria um item da sidebar em hover; fixamos num canto vazio.
  // A posição do polegar da barra de rolagem varia entre execuções; o conteúdo rolado não.
  await page.addStyleTag({
    content: '* { scrollbar-color: transparent transparent !important; }',
  });
  const viewport = page.viewportSize();
  await page.mouse.move(viewport.width - 2, viewport.height - 2);
  await wait(300);
  await page.evaluate(
    ({ source, selectors }) => {
      const mask = new Function('value', `return (${source})(value)`);
      const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT);
      for (let node = walker.nextNode(); node; node = walker.nextNode()) {
        const next = mask(node.nodeValue);
        if (next !== node.nodeValue) node.nodeValue = next;
      }
      // O React divide `PID {pid}` em vários nós de texto; mascara o texto juntado.
      for (const el of document.body.querySelectorAll('*')) {
        const nodes = [...el.childNodes];
        if (nodes.length < 2 || nodes.some((node) => node.nodeType !== Node.TEXT_NODE)) continue;
        const next = mask(el.textContent);
        if (next !== el.textContent) el.textContent = next;
      }
      for (const selector of selectors)
        for (const el of document.querySelectorAll(selector)) {
          const inner = document.createTreeWalker(el, NodeFilter.SHOW_TEXT);
          for (let node = inner.nextNode(); node; node = inner.nextNode())
            node.nodeValue = node.nodeValue.replace(/\d/g, '0');
        }
      for (const el of document.querySelectorAll('input, textarea'))
        if (el.value) el.value = mask(el.value);
    },
    { source: maskText.toString(), selectors: masks },
  );
  await page.screenshot({
    path: path.join(output, `${name}.png`),
    scale: 'css',
    animations: 'disabled',
    caret: 'hide',
  });
  const html = await page.evaluate(() => document.body.outerHTML);
  fs.writeFileSync(
    path.join(output, `${name}.html`),
    maskText(html)
      .replace(/(class="xterm-char-measure-element"[^>]*>)[^<]*/g, '$1')
      .replace(/></g, '>\n<')
      .replace(new RegExp(root.replaceAll('/', '\\/'), 'g'), '<raiz>'),
  );
}

async function resize(app, page, width, height) {
  await app.evaluate(
    ({ BrowserWindow }, size) => BrowserWindow.getAllWindows()[0].setContentSize(...size),
    [width, height],
  );
  await page.setViewportSize({ width, height });
}

let app;
let d;
try {
  d = await daemon(env);
  const request = (method, value) =>
    d.client.request(value === undefined ? { method } : { method, value });
  const workspace = (await request('workspaces.list', { limit: 100 })).items[0];
  const chat = (
    await request('chats.create', {
      workspaceId: workspace.id,
      projectId: 'visual-project',
      dotId: 'visual-dot',
      title: 'Conversa visual',
      operationId: randomUUID(),
    })
  ).chat;
  let revision = chat.revision;
  for (const body of ['Primeira mensagem da conversa.', 'Segunda mensagem, um pouco mais longa.']) {
    const saved = await request('messages.save', {
      chatId: chat.id,
      body,
      expectedRevision: revision,
      operationId: randomUUID(),
    });
    revision = saved.chat?.revision ?? revision + 1;
  }
  await request('chats.create', {
    workspaceId: workspace.id,
    projectId: null,
    dotId: null,
    title: 'Conversa livre visual',
    operationId: randomUUID(),
  });
  for (const [title, state] of [
    ['Tarefa a fazer', 'todo'],
    ['Tarefa em andamento', 'in_progress'],
    ['Tarefa em revisão', 'review'],
    ['Tarefa concluída', 'done'],
  ])
    await request('tasks.create', {
      projectId: 'visual-project',
      title,
      description: `Descrição da ${title.toLowerCase()}.`,
      state,
      operationId: randomUUID(),
    });

  app = await electron.launch({
    chromiumSandbox: true,
    args: ['dist/desktop/main.cjs'],
    env,
    timeout: 20000,
  });
  const page = await app.firstWindow();
  page.setDefaultTimeout(12000);
  // A janela ignora o mouse do sistema; o Playwright controla o ponteiro por fora dele.
  await app.evaluate(({ BrowserWindow }) =>
    BrowserWindow.getAllWindows()[0].setIgnoreMouseEvents(true),
  );
  const errors = [];
  page.on('pageerror', (error) => errors.push(error.message));
  await page.getByRole('button', { name: 'Nova conversa', exact: true }).first().waitFor();
  // Relógio fixo no renderer: a data da home depende do horário local.
  await page.clock.setFixedTime(new Date('2026-01-15T10:00:00-03:00'));
  await page.reload();
  await page.getByRole('button', { name: 'Nova conversa', exact: true }).first().waitFor();

  for (const [width, height, name] of [
    [1440, 900, 'home-1440'],
    [1000, 640, 'home-1000'],
    [840, 620, 'home-840'],
  ]) {
    await resize(app, page, width, height);
    await capture(page, name);
  }
  await resize(app, page, 1440, 900);

  await page.getByRole('textbox', { name: 'Buscar projetos e conversas', exact: true }).focus();
  await page
    .getByRole('heading', { name: 'Recentes · todos os workspaces', exact: true })
    .waitFor();
  await capture(page, 'busca');
  // Sem tirar o foco antes, a lista de recentes some no meio do próximo clique.
  await page.getByRole('textbox', { name: 'Buscar projetos e conversas', exact: true }).blur();
  await page
    .getByRole('heading', { name: 'Recentes · todos os workspaces', exact: true })
    .waitFor({ state: 'detached' });

  await page.getByRole('button', { name: 'Criar projeto', exact: true }).click();
  const projectDialog = page.getByRole('dialog', { name: 'Criar projeto' });
  await projectDialog.waitFor();
  await projectDialog.getByLabel('Nome', { exact: true }).fill('Projeto novo');
  await capture(page, 'modal-projeto');
  await page.keyboard.press('Escape');

  await openConversation(page, 'Conversa visual', `${workspace.name} / Projeto visual`);
  await page.locator('.saved-message pre').filter({ hasText: 'Segunda mensagem' }).waitFor();
  await capture(page, 'chat-1440');
  await resize(app, page, 840, 620);
  await capture(page, 'chat-840');
  await page.getByRole('button', { name: 'Terminal', exact: true }).click();
  await page.getByRole('region', { name: 'Painel da Run', exact: true }).waitFor();
  await capture(page, 'chat-840-terminal');
  await page.keyboard.press('Escape');
  assert.equal(
    await page
      .getByRole('button', { name: 'Terminal', exact: true })
      .evaluate((button) => document.activeElement === button),
    true,
  );
  await resize(app, page, 1440, 900);

  await page.getByRole('region', { name: 'Painel da Run', exact: true }).waitFor();
  // O Terminal embutido também aparece no painel; o teste inicia a CLI de fixture.
  await page
    .locator('.dot-launcher')
    .filter({ hasNotText: 'Terminal do sistema' })
    .getByRole('button', { name: 'Iniciar execução', exact: true })
    .click();
  const run = await until(async () => {
    const runs = (await request('chats.runs.list', { chatId: chat.id, limit: 100 })).items;
    if (runs[0]?.state !== 'running') throw Error('Run ainda não iniciou');
    return runs[0];
  });
  await page
    .locator(`#run-${run.id}`)
    .locator('.live-region')
    .getByText('Dot visual pronto')
    .waitFor({ state: 'attached' });
  // O xterm só desenha as linhas quando o terminal está visível.
  await page.locator(`#run-${run.id}`).scrollIntoViewIfNeeded();
  await page
    .locator(`#run-${run.id} .xterm-rows`)
    .getByText('Dot visual pronto')
    .waitFor({ state: 'attached' });
  await capture(page, 'chat-run');
  await page.getByRole('button', { name: 'Ver mudanças', exact: true }).click();
  await page.getByRole('heading', { name: 'Alterações desta execução', exact: true }).waitFor();
  await page.getByRole('heading', { name: 'Alterações desta execução' }).scrollIntoViewIfNeeded();
  await capture(page, 'chat-diff');

  await page.getByRole('button', { name: 'Tarefas', exact: true }).click();
  await page.getByRole('button', { name: 'Abrir tarefa Tarefa a fazer', exact: true }).waitFor();
  await capture(page, 'tarefas');
  await page
    .locator('.task-filters')
    .getByRole('combobox', { name: 'Projeto', exact: true })
    .selectOption('visual-project');
  await page.getByRole('button', { name: 'Quadro do projeto', exact: true }).click();
  await page.locator('.task-board').waitFor();
  await capture(page, 'tarefas-quadro');
  await page.getByRole('button', { name: 'Abrir tarefa Tarefa em revisão', exact: true }).click();
  await page.getByRole('dialog', { name: 'Detalhes da tarefa', exact: true }).waitFor();
  await capture(page, 'tarefa-detalhes');
  await page.keyboard.press('Escape');
  await page.getByRole('button', { name: 'Nova tarefa', exact: true }).first().click();
  await page.getByRole('dialog').filter({ hasText: 'Criar tarefa' }).first().waitFor();
  await capture(page, 'tarefa-nova');
  await page.keyboard.press('Escape');

  // Diagnóstico e laboratório: PIDs, latência e memória mudam a cada execução.
  masks.push('.health', '.rail-meta', '.metric', 'output', '.latency');
  await page.getByRole('button', { name: 'Início', exact: true }).click();
  await openDiagnostics(page);
  await page.getByRole('heading', { name: 'Laboratório' }).first().waitFor();
  await capture(page, 'laboratorio');
  await page.getByRole('button', { name: 'Execuções anteriores', exact: true }).click();
  await page
    .locator('.app-header')
    .getByRole('heading', { name: 'Execuções anteriores', exact: true })
    .waitFor();
  await capture(page, 'execucoes-anteriores');

  if (errors.length) throw Error(`Erros no renderer: ${errors.join('; ')}`);
  await request('runs.cancel', { runId: run.id }).catch(() => {});
  console.log(`Capturas em ${output}`);
} finally {
  await app?.close().catch(() => {});
  d?.client.close();
  d?.child.kill();
}
