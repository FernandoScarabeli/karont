import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawn, execFileSync } from 'node:child_process';
import { once } from 'node:events';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const { Client } = require('../dist/local/client.cjs');
const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

async function until(fn, attempts = 120) {
  let last;
  for (let n = 0; n < attempts; n++) {
    try {
      return await fn();
    } catch (error) {
      last = error;
      await wait(50);
    }
  }
  throw last ?? Error('Timeout');
}

function git(cwd, ...args) {
  execFileSync('git', args, { cwd, stdio: 'ignore' });
}

function createProject(root) {
  fs.mkdirSync(root);
  git(root, 'init', '--quiet');
  git(root, 'config', 'user.email', 'test@local.invalid');
  git(root, 'config', 'user.name', 'Karont Test');
  fs.writeFileSync(path.join(root, 'base.txt'), 'base\n');
  git(root, 'add', '.');
  git(root, 'commit', '--quiet', '-m', 'base');
}

async function withDaemon(config, run) {
  const temp = fs.mkdtempSync(path.join(os.tmpdir(), 'karont-builtin-dots-'));
  const root = path.join(temp, 'repo');
  createProject(root);
  const configFile = path.join(temp, 'dots.json');
  fs.writeFileSync(
    configFile,
    JSON.stringify({
      version: 1,
      projects: [{ id: 'repo', name: 'Repo de teste', root }],
      dots: config.dots,
    }),
    { mode: 0o600 },
  );
  const envPaths = {
    KARONT_RUNTIME_DIR: path.join(temp, 'runtime'),
    KARONT_DATA_DIR: path.join(temp, 'data'),
    KARONT_CONFIG_DIR: path.join(temp, 'config-dir'),
    KARONT_DOTS_CONFIG: configFile,
  };
  const previousEnv = Object.fromEntries(
    Object.keys(envPaths).map((key) => [key, process.env[key]]),
  );
  Object.assign(process.env, envPaths);
  const daemon = spawn(process.execPath, ['dist/daemon/entry.cjs'], {
    env: { ...process.env, ...envPaths },
    stdio: ['ignore', 'ignore', 'pipe'],
  });
  const daemonExit = once(daemon, 'exit');
  let stderr = '';
  daemon.stderr.on('data', (chunk) => (stderr += chunk.toString()));
  const client = new Client();
  try {
    await until(() => client.request({ method: 'ping' }));
    await run(client);
  } catch (error) {
    throw Error(`${error.message}\nDaemon: ${stderr}`, { cause: error });
  } finally {
    client.close();
    if (daemon.exitCode === null && daemon.signalCode === null) daemon.kill('SIGTERM');
    await daemonExit;
    for (const [key, value] of Object.entries(previousEnv)) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
    fs.rmSync(temp, { recursive: true, force: true });
  }
}

test('Terminal embutido aparece sem concessão e inicia Run em projeto de config', async () => {
  await withDaemon(
    {
      dots: [
        {
          id: 'alpha',
          name: 'Alpha',
          role: 'Dot sem autorização',
          executable: process.execPath,
          args: [],
          projectIds: [],
        },
      ],
    },
    async (client) => {
      const dots = await client.request({ method: 'dots.list' });
      const terminal = dots.find((dot) => dot.id === 'terminal');
      assert.ok(terminal);
      assert.equal(terminal.name, 'Terminal');
      assert.deepEqual(terminal.projectIds, ['repo']);

      const run = await client.request({
        method: 'runs.start',
        value: { dotId: 'terminal', projectId: 'repo' },
      });
      assert.equal(run.dotId, 'terminal');

      await assert.rejects(
        () =>
          client.request({ method: 'runs.start', value: { dotId: 'alpha', projectId: 'repo' } }),
        /Dot não autorizado para este projeto/,
      );
    },
  );
});

test('Dot terminal configurado substitui o Dot embutido', async () => {
  await withDaemon(
    {
      dots: [
        {
          id: 'terminal',
          name: 'Terminal personalizado',
          role: 'Terminal definido pelo usuário.',
          executable: process.execPath,
          args: [],
          autoResume: false,
          projectIds: [],
        },
      ],
    },
    async (client) => {
      const dots = await client.request({ method: 'dots.list' });
      assert.equal(dots.filter((dot) => dot.id === 'terminal').length, 1);
      assert.equal(dots.find((dot) => dot.id === 'terminal').name, 'Terminal personalizado');
    },
  );
});
