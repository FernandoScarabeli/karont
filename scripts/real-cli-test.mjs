// Opt-in only: user chooses an existing CLI. Never saves terminal output/auth data.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawn, execFileSync } from 'node:child_process';
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url),
  { Client } = require('../dist/local/client.cjs');
if (!process.env.EROS_REAL_CLI) throw Error('Escolha explícita da CLI é obrigatória');
const root = fs.mkdtempSync(path.join(os.tmpdir(), 'eros-real-'));
fs.chmodSync(root, 0o700);
const repo = path.join(root, 'repo');
fs.mkdirSync(repo);
for (const args of [
  ['init', '--quiet'],
  ['config', 'user.name', 'eros-test'],
  ['config', 'user.email', 'test@local.invalid'],
])
  execFileSync('git', args, { cwd: repo, stdio: 'ignore' });
fs.writeFileSync(path.join(repo, 'probe.txt'), 'before\n');
execFileSync('git', ['add', '.'], { cwd: repo, stdio: 'ignore' });
execFileSync('git', ['commit', '--quiet', '-m', 'fixture'], { cwd: repo, stdio: 'ignore' });
const config = path.join(root, 'dots.json');
fs.writeFileSync(
  config,
  JSON.stringify({
    version: 1,
    projects: [{ id: 'fixture', name: 'Fixture', root: repo }],
    dots: [
      {
        id: 'codex',
        name: 'Codex',
        role: 'Teste controlado',
        executable: process.env.EROS_REAL_CLI,
        adapter: 'codex',
        args: [],
        projectIds: ['fixture'],
      },
    ],
  }),
  { mode: 0o600 },
);
Object.assign(process.env, {
  EROS_RUNTIME_DIR: path.join(root, 'run'),
  EROS_DATA_DIR: path.join(root, 'data'),
  EROS_DOTS_CONFIG: config,
});
const daemon = spawn(process.execPath, ['dist/daemon/entry.cjs'], {
  env: process.env,
  stdio: 'ignore',
});
const client = new Client();
const wait = (ms) => new Promise((r) => setTimeout(r, ms));
let run,
  buffer = '';
const evidence = {
  cli: 'codex',
  status: 'BLOQUEADO',
  checks: [],
  limitations: [],
  timestamp: new Date().toISOString(),
};
client.onEvent((event) => {
  if (['terminal.output', 'terminal.snapshot'].includes(event.type))
    buffer = (buffer + event.data).slice(-100000);
});
const clean = () => buffer.replace(/\x1b\[[0-?]*[ -/]*[@-~]/g, '');
try {
  for (let n = 0; n < 50; n++) {
    try {
      await client.request({ method: 'ping' });
      break;
    } catch {
      await wait(100);
    }
  }
  const dots = await client.request({ method: 'dots.list' });
  evidence.capabilities = dots[0].capabilities;
  run = await client.request({
    method: 'runs.start',
    value: { dotId: 'codex', projectId: 'fixture', permissionMode: 'ask' },
  });
  await client.request({ method: 'terminal.attach', value: { runId: run.id } });
  await wait(4000);
  // Native TUI terminal-query replies, never interpreted as policy authorizations.
  await client.request({
    method: 'terminal.write',
    value: { runId: run.id, data: '\x1b[1;1R\x1b[?1;2c' },
  });
  await wait(2000);
  if (/trust|confia|trusted|untrusted/i.test(clean())) {
    await client.request({ method: 'terminal.write', value: { runId: run.id, data: '\r' } });
    await wait(3000);
  }
  const text = clean();
  evidence.checks.push('Codex iniciado pelo daemon em PTY gerenciado e worktree temporária');
  evidence.nativeAuthRequested = /Sign in|device code|Log in|login with|Entrar com/i.test(text);
  evidence.tuiReady = /OpenAI Codex|codex-|approval|context left|workspace-write/i.test(text);
  if (evidence.nativeAuthRequested) {
    evidence.limitations.push(
      'Autenticação precisa de interação do usuário na própria CLI; nenhum token coletado.',
    );
  } else {
    buffer = '';
    await client.request({
      method: 'terminal.write',
      value: {
        runId: run.id,
        data: 'Altere apenas probe.txt para conter a linha after. Não execute outros comandos além do necessário para essa alteração. Ao terminar responda EROS_PROBE_DONE.\r',
      },
    });
    for (let n = 0; n < 45; n++) {
      await wait(1000);
      const output = clean();
      if (/Yes, proceed|Allow once|Approve|Allow this/i.test(output))
        evidence.nativeApprovalSeen = true;
      if (/EROS_PROBE_DONE/.test(output) && n > 8) break;
    }
    await client.request({ method: 'runs.cancel', value: { runId: run.id } });
    await wait(1500);
    const diff = await client.request({ method: 'runs.diff', value: { runId: run.id } });
    evidence.controlledDiff =
      diff.files.some((file) => file.path === 'probe.txt') && diff.diff.includes('+after');
    if (evidence.controlledDiff) {
      const preview = await client.request({
        method: 'rollback.preview',
        value: { runId: run.id },
      });
      await client.request({
        method: 'approvals.decide',
        value: { approvalId: preview.approvalId, allow: true },
      });
      evidence.rollback = true;
    } else
      evidence.limitations.push(
        'A tarefa não produziu o diff controlado dentro do prazo; saída privada não registrada.',
      );
  }
  evidence.limitations.push(
    'Fechar/reabrir Electron com esta CLI real ainda não validado; teste completo não aprovado por execução isolada do PTY.',
  );
} catch {
  evidence.limitations.push('Falha no teste real; detalhes privados de CLI descartados.');
} finally {
  if (run)
    try {
      await client.request({ method: 'runs.cancel', value: { runId: run.id } });
    } catch {}
  try {
    await client.request({ method: 'shutdown' });
  } catch {}
  client.close();
  daemon.kill();
  buffer = '';
  fs.writeFileSync('benchmarks/spec003/real-cli.json', JSON.stringify(evidence, null, 2));
  console.log(JSON.stringify(evidence, null, 2));
  fs.rmSync(root, { recursive: true, force: true });
}
