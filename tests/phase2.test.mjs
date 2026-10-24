import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
const { capabilities, permissionArgs } = require('../dist/daemon/permissions.cjs');
const { NotificationCenter } = require('../dist/desktop/notifications.cjs');
const { sanitize, issueReport } = require('../dist/local/report.cjs');
const { daemonDiagnostics } = require('../dist/daemon/diagnostics.cjs');
const { requestSchema } = require('../dist/contracts/index.cjs');
test('modos por capacidade nativa; sem flags conflitantes nem elevação implícita', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'eros-caps-'));
  const executable = path.join(dir, 'cli');
  fs.writeFileSync(
    executable,
    "#!/bin/sh\nprintf '%s' '--sandbox --ask-for-approval read-only workspace-write danger-full-access on-request never --approve-for-me'\n",
    { mode: 0o700 },
  );
  const dot = { adapter: 'codex', executable, args: [] };
  try {
    assert.ok(capabilities(dot).every((c) => c.status === 'available'));
    assert.throws(() => permissionArgs(dot, 'invalid', true), /indisponível/);
    assert.deepEqual(permissionArgs(dot, 'ask', false), [
      '--sandbox',
      'workspace-write',
      '--ask-for-approval',
      'on-request',
    ]);
    assert.deepEqual(permissionArgs(dot, 'auto', false), ['--approve-for-me']);
    assert.deepEqual(permissionArgs(dot, 'readOnly', false), [
      '--sandbox',
      'read-only',
      '--ask-for-approval',
      'never',
    ]);
    assert.throws(() => permissionArgs(dot, 'full', false), /confirmação/);
    assert.deepEqual(permissionArgs(dot, 'full', true), [
      '--sandbox',
      'danger-full-access',
      '--ask-for-approval',
      'never',
    ]);
    assert.throws(
      () =>
        permissionArgs(
          { ...dot, args: ['-c', 'sandbox_mode="danger-full-access"'] },
          'readOnly',
          false,
        ),
      /indisponível/,
    );
    fs.writeFileSync(
      executable,
      "#!/bin/sh\nprintf '%s' '--sandbox --ask-for-approval read-only workspace-write danger-full-access on-request never'\n",
    );
    assert.equal(capabilities(dot).find((c) => c.mode === 'auto').status, 'unavailable');
    assert.equal(capabilities(dot).find((c) => c.mode === 'ask').status, 'available');
    fs.writeFileSync(executable, '#!/bin/sh\necho incompatible\n');
    assert.ok(capabilities(dot).every((c) => c.status === 'unavailable'));
    const generic = { ...dot, adapter: 'generic', args: ['anything'] };
    assert.equal(capabilities(generic)[0].status, 'partial');
    for (const mode of ['auto', 'full', 'readOnly'])
      assert.throws(() => permissionArgs(generic, mode, true), /indisponível/);
    assert.deepEqual(permissionArgs(generic, 'ask', false), ['anything']);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});
test('notificações: deduplicação, preferência, serviço ausente e falhas assíncronas', () => {
  let count = 0,
    fail;
  const n = new NotificationCenter((_title, _click, onFail) => {
    count++;
    fail = onFail;
    return true;
  });
  n.notify('run:a', 'Execução concluída', () => {});
  n.notify('run:a', 'Execução concluída', () => {});
  assert.equal(count, 1);
  fail();
  assert.equal(n.history[0].status, 'failed');
  n.enabled = false;
  n.notify('run:b', 'Título', () => {});
  assert.equal(count, 1);
  assert.equal(n.history[1].status, 'disabled');
  const missing = new NotificationCenter(() => false);
  missing.notify('daemon:a', 'Título', () => {});
  assert.equal(missing.history[0].status, 'unavailable');
  const throws = new NotificationCenter(() => {
    throw Error('private');
  });
  throws.notify('rollback:a', 'Título', () => {});
  assert.equal(throws.history[0].status, 'failed');
});
test('relatório local não ingere conteúdo privado e sanitiza credenciais/caminhos/identificadores', () => {
  const privateText = `${os.homedir()}/repo ${os.userInfo().username} ${os.hostname()} /tmp/repo C:\\Users\\private\\repo Bearer abc123 token=secret password=abc sk-proj-abcdef ghp_abcd eyJabcd.abc.def someone@example.org https://private.invalid/repo`;
  const safe = sanitize(privateText);
  for (const value of [
    os.userInfo().username,
    os.hostname(),
    '/tmp/repo',
    'abc123',
    'secret',
    'sk-proj',
    'ghp_abcd',
    'eyJabcd',
    'someone@',
    'https://',
    'C:\\Users',
  ])
    assert.ok(!safe.includes(value), value);
  const report = issueReport([
    { category: 'Secrets', label: 'Terminal', status: 'error', value: 'PRIVATE_CHAT' },
    { category: 'Sistema', label: 'Kernel', status: 'available', value: privateText },
  ]);
  assert.ok(!report.includes('PRIVATE_CHAT'));
  assert.ok(!report.includes('someone@'));
  assert.match(report, /Nenhum envio automático/);
});
test('diagnóstico sem ferramentas não falha nem inventa disponibilidade', () => {
  const previous = process.env.PATH;
  process.env.PATH = '/nonexistent';
  try {
    const items = daemonDiagnostics([{ executable: '/missing' }]);
    assert.equal(items.find((i) => i.label === 'Git').status, 'unavailable');
    assert.equal(items.find((i) => i.label === 'CLIs configuradas').status, 'unavailable');
    assert.equal(items.find((i) => i.label === 'Keyring').status, 'unverified');
  } finally {
    process.env.PATH = previous;
  }
});
test('IPC novo estrito recusa stdout/políticas/caminhos e decisões inválidas', () => {
  for (const request of [
    { method: 'diagnostics', value: { env: true } },
    { method: 'approvals.decide', value: { approvalId: 'not-uuid', allow: true } },
    {
      method: 'approvals.decide',
      value: { approvalId: '123e4567-e89b-42d3-a456-426614174000', allow: true, runId: 'override' },
    },
    { method: 'runs.start', value: { dotId: 'a', projectId: 'p', permissionMode: 'shell' } },
    {
      method: 'runs.start',
      value: { dotId: 'a', projectId: 'p', permissionMode: 'full', executable: '/bin/sh' },
    },
    { method: 'terminal.output', value: 'approve all' },
  ])
    assert.equal(requestSchema.safeParse({ id: 1, ...request }).success, false);
});
