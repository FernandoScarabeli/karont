import { _electron as electron } from 'playwright';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { environment, daemon, until } from './harness.mjs';
const ctx = environment();
ctx.env.KARONT_DOTS_CONFIG = path.join(ctx.root, 'dots.json');
fs.writeFileSync(
  ctx.env.KARONT_DOTS_CONFIG,
  JSON.stringify({ version: 1, dots: [], projects: [] }),
);
fs.chmodSync(ctx.env.KARONT_DOTS_CONFIG, 0o600);
ctx.env.KARONT_CONFIG_DIR = path.join(ctx.root, 'config');
const output = path.resolve('.impeccable/review');
fs.mkdirSync(output, { recursive: true });
let app, d;
try {
  d = await daemon(ctx.env);
  app = await electron.launch({
    chromiumSandbox: true,
    args: ['dist/desktop/main.cjs'],
    env: ctx.env,
    timeout: 20000,
  });
  const page = await app.firstWindow();
  const errors = [];
  page.on('pageerror', (error) => errors.push(error.message));
  await page.getByRole('button', { name: 'Nova conversa', exact: true }).waitFor();
  await page.getByRole('heading', { name: /Bom dia|Boa tarde|Boa noite/ }).waitFor();
  await page.evaluate(() => document.fonts.ready);
  for (const [width, height, name] of [
    [1440, 900, 'desktop'],
    [1000, 640, 'compact'],
    [840, 620, 'minimum'],
  ]) {
    await app.evaluate(
      ({ BrowserWindow }, size) => BrowserWindow.getAllWindows()[0].setContentSize(...size),
      [width, height],
    );
    await page.setViewportSize({ width, height });
    assert.deepEqual(await page.evaluate(() => ({ width: innerWidth, height: innerHeight })), {
      width,
      height,
    });
    await page.screenshot({ scale: 'css', path: path.join(output, `${name}.png`) });
    assert.equal(
      await page.evaluate(() => document.documentElement.scrollWidth > innerWidth),
      false,
    );
  }
  const beforeOversize = await d.client.request({
    method: 'chats.list',
    value: { scope: 'all', limit: 100 },
  });
  await page.getByRole('textbox', { name: 'Nova ideia' }).fill('€'.repeat(3000));
  await page.getByRole('textbox', { name: 'Nova ideia' }).press('Enter');
  await page.getByRole('textbox', { name: 'Nova ideia' }).press('Enter');
  assert.equal(
    await page.getByRole('textbox', { name: 'Nova ideia' }).inputValue(),
    '€'.repeat(3000),
  );
  const afterOversize = await d.client.request({
    method: 'chats.list',
    value: { scope: 'all', limit: 100 },
  });
  assert.equal(afterOversize.items.length, beforeOversize.items.length);
  await page.getByRole('textbox', { name: 'Nova ideia' }).fill('');
  await page.getByRole('button', { name: 'Explorar uma ideia' }).click();
  assert.equal(
    await page.getByRole('textbox', { name: 'Nova ideia' }).inputValue(),
    'Explorar uma ideia',
  );
  await page.getByRole('button', { name: 'Abrir conversa com este rascunho' }).click();
  await page.getByRole('heading', { name: 'Nova conversa', exact: true }).waitFor();
  assert.equal(await page.locator('dialog[open]').count(), 0);
  assert.equal(
    await page.getByRole('textbox', { name: 'Nova mensagem', exact: true }).inputValue(),
    'Explorar uma ideia',
  );
  await page
    .getByRole('textbox', { name: 'Nova mensagem', exact: true })
    .fill('Olá, teste de persistência.');
  await page.getByRole('button', { name: 'Salvar mensagem', exact: true }).click();
  await page
    .locator('.saved-message pre')
    .filter({ hasText: 'Olá, teste de persistência.' })
    .waitFor();
  assert.equal(
    await page.locator('.k-sidebar-scroll').evaluate((el) => el.scrollWidth <= el.clientWidth),
    true,
  );
  await page.screenshot({ scale: 'css', path: path.join(output, 'chat.png') });
  await page
    .getByRole('textbox', { name: 'Nova mensagem', exact: true })
    .fill('Rascunho preservado');
  await until(async () => {
    const nav = await d.client.request({ method: 'navigation.get' });
    const details = await d.client.request({ method: 'chats.get', value: { chatId: nav.chatId } });
    assert.equal(details.chat.draft, 'Rascunho preservado');
  });
  await page.getByRole('button', { name: 'Fechar conversa', exact: true }).click();
  await page.getByRole('button', { name: 'Nova conversa', exact: true }).last().click();
  await page.getByRole('textbox', { name: 'Nova mensagem', exact: true }).waitFor();
  await page.getByRole('button', { name: 'Recolher sidebar' }).click();
  await page.getByRole('button', { name: 'Mostrar sidebar' }).click();
  await page.getByRole('button', { name: 'Criar projeto', exact: true }).click();
  const dialog = page.getByRole('dialog', { name: 'Criar projeto' });
  await dialog.waitFor();
  assert.equal(
    await dialog.getByRole('button', { name: 'Criar projeto', exact: true }).isDisabled(),
    true,
  );
  assert.equal(await dialog.locator('select').count(), 0);
  await dialog.getByLabel('Nome', { exact: true }).fill('Projeto de teste');
  await dialog.getByRole('button', { name: 'Código', exact: true }).click();
  await page.screenshot({ scale: 'css', path: path.join(output, 'project-modal.png') });
  await page.keyboard.press('Escape');
  assert.equal(await page.locator('dialog[open]').count(), 0);
  const repo = path.join(ctx.root, 'projeto');
  fs.mkdirSync(repo);
  for (const args of [
    ['init', '-q'],
    ['config', 'user.email', 'test@local.invalid'],
    ['config', 'user.name', 'Karont test'],
    ['commit', '-q', '--allow-empty', '-m', 'initial'],
  ])
    execFileSync('git', args, { cwd: repo });
  const nav = await d.client.request({ method: 'navigation.get' });
  const added = await d.client.request({
    method: 'projects.add',
    value: {
      workspaceId: nav.workspaceId,
      name: 'Projeto teste',
      root: repo,
      icon: 'rocket',
      dotIds: [],
      operationId: crypto.randomUUID(),
    },
  });
  assert.equal(added.project.icon, 'rocket');
  await page.getByRole('button', { name: 'Nova conversa em Projeto teste' }).waitFor();
  await page.getByRole('button', { name: 'Nova conversa em Projeto teste' }).click({ force: true });
  await page.getByRole('heading', { name: 'O que vamos construir?' }).waitFor();
  await page.locator('.chat-heading').filter({ hasText: 'Projeto teste' }).waitFor();
  assert.equal(await page.locator('dialog[open]').count(), 0);
  await page
    .getByRole('textbox', { name: 'Nova mensagem', exact: true })
    .fill('Projeto sem Dot: mensagem local.');
  await page.getByRole('textbox', { name: 'Nova mensagem', exact: true }).press('Enter');
  await page
    .locator('.saved-message pre')
    .filter({ hasText: 'Projeto sem Dot: mensagem local.' })
    .waitFor();
  await page.reload();
  await page
    .locator('.saved-message pre')
    .filter({ hasText: 'Projeto sem Dot: mensagem local.' })
    .waitFor();
  await page.getByRole('button', { name: 'ToDo', exact: true }).click();
  await page.locator('.task-desk').waitFor();
  await page.getByRole('button', { name: 'Automações', exact: true }).click();
  await page.getByRole('heading', { name: 'Um espaço para os próximos fluxos' }).waitFor();
  await page.getByRole('textbox', { name: 'Buscar projetos e conversas' }).fill('Nova conversa');
  await page.locator('.k-search-result').first().waitFor();
  assert.equal(
    await page.locator('.k-sidebar-scroll').evaluate((el) => el.scrollWidth <= el.clientWidth),
    true,
  );
  assert.deepEqual(errors, []);
  console.log(
    'PASS: home, 3 viewports, suggestions, direct chat, messages/drafts, sidebar, modal, project icon, chat without Dot, restore, ToDo and automations.',
  );
} finally {
  if (app) await app.close();
  if (d) {
    await d.client.request({ method: 'shutdown' }).catch(() => {});
    d.client.close();
    d.child.kill();
  }
  fs.rmSync(ctx.root, { recursive: true, force: true });
}
