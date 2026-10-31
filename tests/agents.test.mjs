import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import net from 'node:net';
import { spawn, execFileSync } from 'node:child_process';
import { once } from 'node:events';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const { AgentCatalog, resolveExecutable } = require('../dist/daemon/database.cjs');
const { Client } = require('../dist/local/client.cjs');
const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

async function canBindUnixSocket() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'karont-socket-probe-'));
  const server = net.createServer();
  return new Promise((resolve) => {
    const finish = (available) => {
      fs.rmSync(dir, { recursive: true, force: true });
      resolve(available);
    };
    server.once('error', (error) => finish(error.code !== 'EPERM'));
    try {
      server.listen(path.join(dir, 'probe.sock'), () => server.close(() => finish(true)));
    } catch (error) {
      finish(error.code !== 'EPERM');
    }
  });
}

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

function executable(file, contents = '#!/bin/sh\nexec /bin/sleep 5\n') {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, contents, { mode: 0o700 });
  fs.chmodSync(file, 0o700);
  return file;
}

function createProject(root) {
  fs.mkdirSync(root, { recursive: true });
  const git = (...args) => execFileSync('git', args, { cwd: root, stdio: 'ignore' });
  git('init', '--quiet');
  git('config', 'user.email', 'agents@local.invalid');
  git('config', 'user.name', 'Karont Agents Test');
  fs.writeFileSync(path.join(root, 'initial.txt'), 'fixture\n');
  git('add', '.');
  git('commit', '--quiet', '-m', 'fixture');
}

test('detecção procura PATH, pastas locais e a versão nvm mais nova; ignora executáveis inválidos', () => {
  const temp = fs.mkdtempSync(path.join(os.tmpdir(), 'karont-agents-resolve-'));
  const home = path.join(temp, 'home');
  const pathBin = path.join(temp, 'path-bin');
  try {
    const fromPath = executable(path.join(pathBin, 'claude'));
    const fromLocal = executable(path.join(home, '.local/bin/gemini'));
    fs.mkdirSync(pathBin, { recursive: true });
    fs.writeFileSync(path.join(pathBin, 'aider'), '#!/bin/sh\n');
    fs.chmodSync(path.join(pathBin, 'aider'), 0o600);
    fs.symlinkSync(path.join(pathBin, 'missing-target'), path.join(pathBin, 'codex'));
    executable(path.join(home, '.nvm/versions/node/v18.20.0/bin/goose'));
    const latest = executable(path.join(home, '.nvm/versions/node/v22.1.0/bin/goose'));

    assert.equal(
      resolveExecutable('claude', { home, pathValue: pathBin, systemDirs: [] }),
      fs.realpathSync(fromPath),
    );
    assert.equal(
      resolveExecutable('gemini', { home, pathValue: '', systemDirs: [] }),
      fs.realpathSync(fromLocal),
    );
    assert.equal(
      resolveExecutable('aider', { home, pathValue: pathBin, systemDirs: [] }),
      undefined,
    );
    assert.equal(
      resolveExecutable('codex', { home, pathValue: pathBin, systemDirs: [] }),
      undefined,
    );
    assert.equal(
      resolveExecutable('goose', { home, pathValue: '', systemDirs: [] }),
      fs.realpathSync(latest),
    );
  } finally {
    fs.rmSync(temp, { recursive: true, force: true });
  }
});

test('dots.json vence IDs repetidos no catálogo e na lista de Dots', () => {
  const temp = fs.mkdtempSync(path.join(os.tmpdir(), 'karont-agents-order-'));
  try {
    executable(path.join(temp, 'bin/claude'));
    executable(path.join(temp, 'bin/codex'));
    const catalog = new AgentCatalog(path.join(temp, 'agents.json'), {
      home: path.join(temp, 'home'),
      pathValue: path.join(temp, 'bin'),
      systemDirs: [],
    });
    const configured = {
      id: 'cli-claude',
      name: 'Claude configurado',
      role: 'Configuração anterior.',
      executable: '/bin/sh',
      args: [],
      adapter: 'generic',
      autoResume: false,
      projectIds: [],
      source: 'config',
    };

    assert.equal(catalog.list([configured]).agents[0].source, 'config');
    assert.equal(catalog.list([configured]).agents[0].name, 'Claude configurado');
    assert.equal(catalog.dots([configured])[0].name, 'Claude configurado');
    const detectedDots = catalog.dots([]);
    const claude = detectedDots.find((dot) => dot.id === 'cli-claude');
    const codex = detectedDots.find((dot) => dot.id === 'cli-codex');
    assert.equal(claude.role, 'Agente Claude Code de linha de comando.');
    assert.deepEqual(claude.args, []);
    assert.equal(claude.autoResume, false);
    assert.deepEqual(claude.projectIds, []);
    assert.equal(claude.adapter, 'generic');
    assert.equal(codex.adapter, 'codex');
    assert.equal(detectedDots.at(-1).id, 'terminal');
  } finally {
    fs.rmSync(temp, { recursive: true, force: true });
  }
});

test('adicionar valida comando, nome e ID duplicados; remover aceita só personalizados', () => {
  const temp = fs.mkdtempSync(path.join(os.tmpdir(), 'karont-agents-custom-'));
  const bin = path.join(temp, 'bin');
  const firstExecutable = executable(path.join(bin, 'local-agent'), '#!/bin/sh\nexit 0\n');
  const absoluteExecutable = executable(path.join(temp, 'absolute-agent'), '#!/bin/sh\nexit 0\n');
  const configFile = path.join(temp, 'karont/agents.json');
  const catalog = new AgentCatalog(configFile, {
    home: path.join(temp, 'home'),
    pathValue: bin,
    systemDirs: [],
  });
  try {
    const first = catalog.add(
      { name: 'Local Agent', command: 'local-agent', args: ['--fast'] },
      [],
    );
    assert.equal(first.id, 'custom-local-agent');
    assert.equal(first.source, 'custom');
    assert.equal(first.executable, fs.realpathSync(firstExecutable));
    assert.equal(fs.statSync(configFile).mode & 0o777, 0o600);
    assert.throws(
      () => catalog.add({ name: 'Local Agent', command: 'local-agent' }, []),
      /Agente: o nome "Local Agent" já está cadastrado/,
    );
    assert.throws(
      () => catalog.add({ name: 'Local-Agent', command: 'local-agent' }, []),
      /Agente: o ID "custom-local-agent" já está em uso/,
    );
    assert.throws(
      () => catalog.add({ name: 'Missing CLI', command: 'missing-cli' }, []),
      /Agente: executável ausente ou sem permissão/,
    );
    assert.throws(
      () =>
        catalog.add({ name: 'Long Args', command: 'local-agent', args: Array(33).fill('x') }, []),
      /Agente: nome, comando ou argumentos inválidos/,
    );
    assert.throws(() => catalog.remove('cli-claude', []), /Agente: somente agentes personalizados/);

    const second = catalog.add({ name: 'Absolute Agent', command: absoluteExecutable }, []);
    assert.equal(second.id, 'custom-absolute-agent');
    assert.equal(second.executable, fs.realpathSync(absoluteExecutable));
    const agents = catalog.list([]).agents;
    assert.equal(agents.find((agent) => agent.id === second.id).available, true);
    assert.equal(catalog.dots([]).at(-1).id, 'terminal');
    assert.deepEqual(catalog.remove(first.id, []), { ok: true });
  } finally {
    fs.rmSync(temp, { recursive: true, force: true });
  }
});

async function withDaemon(run) {
  const temp = fs.mkdtempSync(path.join(os.tmpdir(), 'karont-agents-daemon-'));
  const home = path.join(temp, 'home');
  const bin = path.join(temp, 'path-bin');
  const projectRoot = path.join(temp, 'repo');
  fs.mkdirSync(home, { recursive: true, mode: 0o700 });
  fs.mkdirSync(bin, { recursive: true, mode: 0o700 });
  executable(path.join(home, '.local/bin/claude'));
  executable(path.join(bin, 'named-agent'));
  executable(path.join(temp, 'absolute-agent'));
  fs.symlinkSync('/usr/bin/git', path.join(bin, 'git'));
  createProject(projectRoot);
  const dotsFile = path.join(temp, 'dots.json');
  fs.writeFileSync(
    dotsFile,
    JSON.stringify({
      version: 1,
      projects: [{ id: 'test-repo', name: 'Repo de teste', root: projectRoot }],
      dots: [],
    }),
    { mode: 0o600 },
  );
  const configDir = path.join(temp, 'config');
  const dataDir = path.join(temp, 'data');
  const env = {
    ...process.env,
    HOME: home,
    PATH: bin,
    SHELL: '/bin/bash',
    KARONT_RUNTIME_DIR: path.join(temp, 'runtime'),
    KARONT_DATA_DIR: dataDir,
    KARONT_CONFIG_DIR: configDir,
    KARONT_DOTS_CONFIG: dotsFile,
  };
  const keys = Object.keys(env).filter(
    (key) =>
      key === 'HOME' ||
      key === 'PATH' ||
      key === 'SHELL' ||
      key.startsWith('KARONT_') ||
      key.startsWith('EROS_'),
  );
  const previous = Object.fromEntries(keys.map((key) => [key, process.env[key]]));
  Object.assign(process.env, Object.fromEntries(keys.map((key) => [key, env[key]])));
  const daemon = spawn(process.execPath, ['dist/daemon/entry.cjs'], {
    env,
    stdio: ['ignore', 'ignore', 'pipe'],
  });
  const daemonExit = once(daemon, 'exit');
  let stderr = '';
  daemon.on('error', (error) => (stderr += `Falha ao iniciar daemon: ${error.message}\n`));
  daemon.stderr.on('data', (chunk) => (stderr += chunk.toString()));
  const client = new Client();
  try {
    await until(() => client.request({ method: 'ping' }));
    await run({ client, temp, home, bin, configDir, dataDir, projectRoot });
  } catch (error) {
    throw Error(`${error.message}\nDaemon: ${stderr}`, { cause: error });
  } finally {
    client.close();
    if (daemon.exitCode === null && daemon.signalCode === null) daemon.kill('SIGTERM');
    await daemonExit;
    for (const [key, value] of Object.entries(previous)) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
    fs.rmSync(temp, { recursive: true, force: true });
  }
}

test('agentes podem ser adicionados, removidos e executados; mudanças notificam e preservam permissões', async (t) => {
  if (!(await canBindUnixSocket())) {
    t.skip('O sandbox não permite escutar em socket Unix (EPERM)');
    return;
  }
  await withDaemon(async ({ client, bin, configDir, dataDir }) => {
    const initial = await client.request({ method: 'agents.list' });
    const claude = initial.agents.find((agent) => agent.id === 'cli-claude');
    assert.equal(claude.source, 'detected');
    assert.equal(claude.available, true);

    const eventPromise = new Promise((resolve) => {
      const unsubscribe = client.onEvent((event) => {
        if (event.type !== 'agents.updated') return;
        unsubscribe();
        resolve(event);
      });
    });
    const byName = await client.request({
      method: 'agents.add',
      value: { name: 'Local Agent', command: 'named-agent', args: ['--fast'] },
    });
    assert.equal(byName.id, 'custom-local-agent');
    assert.equal(byName.source, 'custom');
    assert.equal(byName.available, true);
    assert.deepEqual(await eventPromise, { type: 'agents.updated' });

    const byPath = await client.request({
      method: 'agents.add',
      value: { name: 'Absolute Agent', command: path.join(path.dirname(bin), 'absolute-agent') },
    });
    assert.equal(byPath.source, 'custom');
    assert.equal(byPath.available, true);
    await assert.rejects(
      () =>
        client.request({
          method: 'agents.add',
          value: { name: 'Local Agent', command: 'named-agent' },
        }),
      /Agente: o nome "Local Agent" já está cadastrado/,
    );
    await assert.rejects(
      () =>
        client.request({
          method: 'agents.add',
          value: { name: 'Local-Agent', command: 'named-agent' },
        }),
      /Agente: o ID "custom-local-agent" já está em uso/,
    );

    const agentsFile = path.join(configDir, 'agents.json');
    assert.equal(fs.statSync(agentsFile).mode & 0o777, 0o600);
    assert.equal(JSON.parse(fs.readFileSync(agentsFile, 'utf8')).version, 1);
    await assert.rejects(
      () => client.request({ method: 'agents.remove', value: { id: 'cli-claude' } }),
      /Agente: somente agentes personalizados podem ser removidos/,
    );
    assert.deepEqual(await client.request({ method: 'agents.remove', value: { id: byName.id } }), {
      ok: true,
    });

    const dots = await client.request({ method: 'dots.list' });
    const detectedIds = dots.filter((dot) => dot.id.startsWith('cli-')).map((dot) => dot.id);
    assert.ok(
      dots.findIndex((dot) => dot.id === 'terminal') >
        Math.max(...detectedIds.map((id) => dots.findIndex((dot) => dot.id === id))),
    );
    assert.equal(
      dots.some((dot) => dot.id === byPath.id),
      true,
    );
    const diagnostic = (await client.request({ method: 'diagnostics' })).find(
      (item) => item.label === 'CLIs configuradas',
    );
    assert.match(diagnostic.value, new RegExp(`^\\d+/${dots.length - 1} executáveis acessíveis`));

    const { DatabaseSync } = require('node:sqlite');
    const db = new DatabaseSync(path.join(dataDir, 'phase0.sqlite'));
    const workspaceId = db
      .prepare("SELECT value FROM settings WHERE key='default_workspace_id'")
      .get().value;
    db.close();
    const projectPage = await client.request({
      method: 'projects.list',
      value: { workspaceId },
    });
    assert.deepEqual(projectPage.items[0].dotIds, []);

    const projectRun = await client.request({
      method: 'runs.start',
      value: { dotId: 'cli-claude', projectId: 'test-repo' },
    });
    assert.equal(projectRun.projectId, 'test-repo');
    const homeRun = await client.request({ method: 'runs.start', value: { dotId: 'cli-claude' } });
    assert.equal(homeRun.projectId, null);

    const refreshEvent = new Promise((resolve) => {
      const unsubscribe = client.onEvent((event) => {
        if (event.type !== 'agents.updated') return;
        unsubscribe();
        resolve(event);
      });
    });
    executable(path.join(bin, 'codex'));
    const refreshed = await client.request({ method: 'agents.refresh' });
    assert.equal(refreshed.agents.find((agent) => agent.id === 'cli-codex').available, true);
    assert.deepEqual(await refreshEvent, { type: 'agents.updated' });
  });
});
