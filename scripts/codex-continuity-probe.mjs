// Run in the disposable Linux VM. No credential import or model call.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFileSync, spawn } from 'node:child_process';
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url),
  pty = require('node-pty');
const executable = process.env.KARONT_REAL_CLI;
if (!executable || !path.isAbsolute(executable)) throw Error('CLI absoluta obrigatória');
const root = fs.mkdtempSync(path.join(os.tmpdir(), 'karont-codex-probe-'));
fs.chmodSync(root, 0o700);
fs.mkdirSync(path.join(root, 'codex'), { mode: 0o700 });
const env = {
  PATH: process.env.PATH,
  HOME: root,
  CODEX_HOME: path.join(root, 'codex'),
  TERM: 'xterm-256color',
  LANG: 'C.UTF-8',
};
const evidence = {
  timestamp: new Date().toISOString(),
  status: 'BLOQUEADO',
  environment: 'disposable Linux VM; empty HOME/CODEX_HOME; no credentials imported',
  version: '',
  checks: {},
  rpc: {},
  limitations: [],
};
const wait = (ms) => new Promise((r) => setTimeout(r, ms));
let tui,
  server,
  output = '';
try {
  evidence.version = execFileSync(executable, ['--version'], {
    env,
    encoding: 'utf8',
    timeout: 5000,
  }).trim();
  const schemaDir = path.join(root, 'schema');
  fs.mkdirSync(schemaDir);
  execFileSync(executable, ['app-server', 'generate-json-schema', '--out', schemaDir], {
    env,
    stdio: 'ignore',
    timeout: 20000,
  });
  const files = [];
  const walk = (dir) => {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      const p = path.join(dir, entry.name);
      if (entry.isDirectory()) walk(p);
      else if (entry.name.endsWith('.json')) files.push(p);
    }
  };
  walk(schemaDir);
  const schemas = files.map((p) => fs.readFileSync(p, 'utf8')).join('\n');
  evidence.checks.schemaGenerated = true;
  for (const term of [
    'thread/resume',
    'account/rateLimits/read',
    'resetsAt',
    'rateLimitReachedType',
    'usageLimitExceeded',
    'authRequired',
  ])
    evidence.checks[term] = schemas.includes(term);
  server = spawn(executable, ['app-server', '--listen', 'stdio://'], {
    env,
    stdio: ['pipe', 'pipe', 'ignore'],
  });
  let buffer = '';
  const pending = new Map();
  server.stdout.on('data', (chunk) => {
    buffer += chunk;
    let i;
    while ((i = buffer.indexOf('\n')) >= 0) {
      const line = buffer.slice(0, i);
      buffer = buffer.slice(i + 1);
      try {
        const value = JSON.parse(line);
        if (pending.has(value.id)) {
          pending.get(value.id)(value);
          pending.delete(value.id);
        }
      } catch {}
    }
  });
  const rpc = (id, method, params) =>
    new Promise((resolve) => {
      pending.set(id, resolve);
      server.stdin.write(JSON.stringify({ id, method, ...(params ? { params } : {}) }) + '\n');
      setTimeout(() => {
        if (pending.has(id)) {
          pending.delete(id);
          resolve({ timeout: true });
        }
      }, 5000);
    });
  server.stdin.on('error', () => {});
  const initialized = await rpc(1, 'initialize', {
    clientInfo: { name: 'karont_continuity_probe', version: '0.0.1' },
    capabilities: { experimentalApi: true },
  });
  evidence.rpc.initialize = !!initialized.result;
  server.stdin.write(JSON.stringify({ method: 'initialized' }) + '\n');
  for (const [id, method, params] of [
    [2, 'account/read', { refreshToken: false }],
    [3, 'account/rateLimits/read'],
    [4, 'thread/resume', { threadId: '00000000-0000-4000-8000-000000000000' }],
  ]) {
    const value = await rpc(id, method, params);
    evidence.rpc[method] = {
      success: !!value.result,
      errorCode: value.error?.code ?? null,
      timeout: !!value.timeout,
    };
    if (method === 'account/read') evidence.rpc[method].accountPresent = !!value.result?.account;
    if (method === 'account/rateLimits/read') evidence.rpc[method].verifiedReset = false;
  }
  const repo = path.join(root, 'repo');
  fs.mkdirSync(repo);
  execFileSync('git', ['init', '--quiet'], { cwd: repo, stdio: 'ignore' });
  tui = pty.spawn(
    executable,
    ['--sandbox', 'workspace-write', '--ask-for-approval', 'on-request'],
    { cwd: repo, env, cols: 100, rows: 30, name: env.TERM },
  );
  tui.onData((data) => {
    output = (output + data).slice(-100000);
  });
  await wait(1500);
  tui.write('\x1b[1;1R\x1b[?1;2c');
  await wait(1500);
  const plain = output.replace(/\x1b\[[0-?]*[ -/]*[@-~]/g, '');
  evidence.checks.ptyStarted = true;
  evidence.checks.nativeAuthScreen = /Sign in|Log in|API key|login|ChatGPT account/i.test(plain);
  evidence.limitations.push(
    'No account in isolated environment. Authentication requires the user inside the native CLI. No credentials copied or captured.',
  );
  evidence.limitations.push(
    'Controlled Git edit, real rollback, real Electron/session continuation and quota/reset/native Auto Resume remain BLOCKED. Protocol schema or unauthenticated RPC does not prove functional provider support.',
  );
} catch {
  evidence.limitations.push('Probe failed or timed out; private output discarded.');
} finally {
  try {
    tui?.kill();
  } catch {}
  server?.kill();
  output = '';
  fs.mkdirSync('benchmarks/spec004', { recursive: true });
  fs.writeFileSync('benchmarks/spec004/codex-probe.json', JSON.stringify(evidence, null, 2));
  console.log(JSON.stringify(evidence, null, 2));
  fs.rmSync(root, { recursive: true, force: true });
}
