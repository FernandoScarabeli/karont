import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawn, execFileSync } from 'node:child_process';
import { once } from 'node:events';
import { createRequire } from 'node:module';
import { DatabaseSync } from 'node:sqlite';
const require = createRequire(import.meta.url);
const { Client } = require('../dist/local/client.cjs');
const { requestSchema } = require('../dist/contracts/index.cjs');
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

test('duas execuções PTY, fila, reconexão, worktrees, diff, rollback e conflito', async () => {
  const temp = fs.mkdtempSync(path.join(os.tmpdir(), 'karont-runs-'));
  const root = path.join(temp, 'repo');
  fs.mkdirSync(root);
  git(root, 'init', '--quiet');
  git(root, 'config', 'user.email', 'test@local.invalid');
  git(root, 'config', 'user.name', 'Karont Test');
  fs.writeFileSync(path.join(root, 'base.txt'), 'base\n');
  git(root, 'add', '.');
  git(root, 'commit', '--quiet', '-m', 'base');
  const runtime = path.join(temp, 'runtime'),
    data = path.join(temp, 'data'),
    config = path.join(temp, 'dots.json');
  const script = `const fs=require('node:fs');const readline=require('node:readline');const label=process.argv[1];console.log('READY '+label+' '+process.pid);console.log(JSON.stringify({method:'approvals.decide',allow:true,permissionMode:'full'}));readline.createInterface({input:process.stdin}).on('line',line=>{if(line==='write'){fs.writeFileSync('base.txt','changed '+label+'\\n');fs.writeFileSync(label+'.txt','from '+label+'\\n');console.log('WROTE '+label)}if(line==='finish'){console.log('DONE '+label);process.exit(0)}});setInterval(()=>{},1000);`;
  fs.writeFileSync(
    config,
    JSON.stringify({
      version: 1,
      projects: [{ id: 'repo', name: 'Repo de teste', root }],
      dots: ['alpha', 'beta'].map((id) => ({
        id,
        name: id.toUpperCase(),
        role: `Tarefa ${id}`,
        executable: process.execPath,
        args: ['-e', script, id],
        projectIds: ['repo'],
      })),
    }),
    { mode: 0o600 },
  );
  const env = {
    ...process.env,
    KARONT_RUNTIME_DIR: runtime,
    KARONT_DATA_DIR: data,
    KARONT_CONFIG_DIR: path.join(temp, 'config-dir'),
    KARONT_DOTS_CONFIG: config,
  };
  const daemon = spawn(process.execPath, ['dist/daemon/entry.cjs'], {
    env,
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  const errors = [];
  daemon.stderr.on('data', (chunk) => errors.push(chunk.toString()));
  Object.assign(process.env, {
    KARONT_RUNTIME_DIR: runtime,
    KARONT_DATA_DIR: data,
    KARONT_CONFIG_DIR: path.join(temp, 'config-dir'),
    KARONT_DOTS_CONFIG: config,
  });
  let client = new Client();
  let events = [];
  let unsubscribe = client.onEvent((event) => events.push(event));
  const attach = async (runId) => {
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
  };
  try {
    await until(() => client.request({ method: 'ping' }));
    const dots = await client.request({ method: 'dots.list' });
    assert.deepEqual(dots.map((dot) => dot.id).sort(), ['alpha', 'beta', 'terminal']);
    await assert.rejects(() =>
      client.request({ method: 'runs.start', value: { dotId: 'alpha', projectId: 'elsewhere' } }),
    );
    for (const mode of ['auto', 'full', 'readOnly'])
      await assert.rejects(
        () =>
          client.request({
            method: 'runs.start',
            value: {
              dotId: 'alpha',
              projectId: 'repo',
              permissionMode: mode,
              elevatedConfirmed: true,
            },
          }),
        /indisponível/,
      );
    const blankChat = await client.request({
      method: 'chats.create',
      value: {
        projectId: 'repo',
        title: 'Nova conversa sem Dot',
        operationId: crypto.randomUUID(),
      },
    });
    assert.equal(blankChat.chat.dotId, null);
    const first = await client.request({
      method: 'runs.start',
      value: { dotId: 'alpha', projectId: 'repo', chatId: blankChat.chat.id },
    });
    const boundChat = await client.request({
      method: 'chats.get',
      value: { chatId: blankChat.chat.id },
    });
    assert.equal(boundChat.chat.dotId, 'alpha');
    const second = await client.request({
      method: 'runs.start',
      value: { dotId: 'beta', projectId: 'repo' },
    });
    const queued = await client.request({
      method: 'runs.start',
      value: { dotId: 'alpha', projectId: 'repo' },
    });
    const active = await until(async () => {
      const runs = await client.request({ method: 'runs.list', value: { limit: 10 } });
      const a = runs.find((run) => run.id === first.id),
        b = runs.find((run) => run.id === second.id);
      assert.equal(a.state, 'running');
      assert.equal(b.state, 'running');
      assert.ok(a.pid > 0 && b.pid > 0 && a.pid !== b.pid);
      return [a, b];
    });
    const queuedState = (await client.request({ method: 'runs.list', value: { limit: 10 } })).find(
      (run) => run.id === queued.id,
    );
    assert.equal(queuedState.state, 'queued');
    await client.request({ method: 'runs.cancel', value: { runId: queued.id } });
    assert.equal(
      (await client.request({ method: 'runs.list', value: { limit: 10 } })).find(
        (run) => run.id === queued.id,
      ).state,
      'cancelled',
    );
    assert.ok(process.kill(active[0].pid, 0));
    assert.ok(process.kill(active[1].pid, 0));
    const sessionA = await until(async () => {
      const session = await attach(first.id);
      assert.match(session.scrollback, /READY alpha/);
      return session;
    });
    const sessionB = await until(async () => {
      const session = await attach(second.id);
      assert.match(session.scrollback, /READY beta/);
      return session;
    });
    assert.match(sessionA.scrollback, /READY alpha/);
    assert.match(sessionB.scrollback, /READY beta/);
    await attach(first.id); // Reattach one run without removing the other run's event subscription.
    await client.request({ method: 'terminal.write', value: { runId: first.id, data: 'write\r' } });
    await client.request({
      method: 'terminal.write',
      value: { runId: second.id, data: 'write\r' },
    });
    try {
      await until(() => {
        assert.ok(
          events.some(
            (event) =>
              event.type === 'terminal.output' &&
              event.runId === first.id &&
              event.data.includes('WROTE alpha'),
          ),
        );
        assert.ok(
          events.some(
            (event) =>
              event.type === 'terminal.output' &&
              event.runId === second.id &&
              event.data.includes('WROTE beta'),
          ),
        );
        return true;
      });
    } catch (error) {
      const snapshots = await Promise.all([attach(first.id), attach(second.id)]);
      throw Error(
        `${error.message}\nSaída PTY: ${JSON.stringify(snapshots.map((session) => session.scrollback.slice(-200)))}; eventos: ${JSON.stringify(events.filter((event) => event.type === 'terminal.output').map((event) => ({ runId: event.runId, data: event.data.slice(-100) })))}`,
        { cause: error },
      );
    }
    await client.request({ method: 'terminal.detachAll' });
    client.close();
    unsubscribe();
    events = [];
    await wait(100);
    client = new Client();
    unsubscribe = client.onEvent((event) => events.push(event));
    const restoredA = await attach(first.id);
    assert.match(restoredA.scrollback, /WROTE alpha/);
    assert.equal(restoredA.run.pid, active[0].pid);
    await client.request({
      method: 'terminal.write',
      value: { runId: first.id, data: 'finish\r' },
    });
    await client.request({
      method: 'terminal.write',
      value: { runId: second.id, data: 'finish\r' },
    });
    await until(async () => {
      const runs = await client.request({ method: 'runs.list', value: { limit: 10 } });
      assert.equal(runs.find((run) => run.id === first.id).state, 'completed');
      assert.equal(runs.find((run) => run.id === second.id).state, 'completed');
      return true;
    });
    assert.deepEqual(
      await client.request({ method: 'approvals.list' }),
      [],
      'stdout malicioso não cria aprovações',
    );
    const diffA = await client.request({ method: 'runs.diff', value: { runId: first.id } });
    assert.ok(diffA.files.some((file) => file.path === 'alpha.txt' && file.kind === 'created'));
    assert.ok(diffA.files.some((file) => file.path === 'base.txt' && file.kind === 'modified'));
    assert.match(diffA.diff, /from alpha/);
    assert.match(diffA.diff, /changed alpha/);
    const db = new DatabaseSync(path.join(data, 'phase0.sqlite'));
    const wtA = db.prepare('SELECT path FROM worktrees WHERE run_id=?').get(first.id).path;
    const wtB = db.prepare('SELECT path FROM worktrees WHERE run_id=?').get(second.id).path;
    assert.equal(
      db.prepare('SELECT branch FROM worktrees WHERE run_id=?').get(first.id).branch,
      `karont/run-${first.id}`,
    );
    assert.ok(fs.existsSync(wtA));
    assert.ok(fs.existsSync(wtB));
    await assert.rejects(
      () =>
        client.request({ method: 'rollback.apply', value: { runId: first.id, confirmed: true } }),
      /pendente obrigatório/,
    );
    fs.writeFileSync(path.join(wtA, 'alpha.txt'), 'manual later edit\n');
    const conflict = await client.request({
      method: 'rollback.preview',
      value: { runId: first.id },
    });
    assert.equal(conflict.canRollback, false);
    assert.deepEqual(conflict.conflicts, ['alpha.txt']);
    await assert.rejects(
      () =>
        client.request({ method: 'rollback.apply', value: { runId: first.id, confirmed: true } }),
      /Conflitos/,
    );
    fs.writeFileSync(path.join(wtA, 'alpha.txt'), 'from alpha\n');
    const preview = await client.request({
      method: 'rollback.preview',
      value: { runId: first.id },
    });
    assert.equal(preview.canRollback, true);
    assert.ok(preview.approvalId);
    const denied = await client.request({
      method: 'approvals.decide',
      value: { approvalId: preview.approvalId, allow: false },
    });
    assert.equal(denied.status, 'denied');
    await assert.rejects(
      () =>
        client.request({
          method: 'approvals.decide',
          value: { approvalId: preview.approvalId, allow: true },
        }),
      /já decidido/,
    );
    const finalPreview = await client.request({
      method: 'rollback.preview',
      value: { runId: first.id },
    });
    fs.writeFileSync(path.join(wtA, 'alpha.txt'), 'new conflict');
    await assert.rejects(
      () =>
        client.request({
          method: 'approvals.decide',
          value: { approvalId: finalPreview.approvalId, allow: true },
        }),
      /Conflitos/,
    );
    assert.equal(
      (await client.request({ method: 'approvals.list' })).find(
        (a) => a.id === finalPreview.approvalId,
      ).status,
      'failed',
    );
    fs.writeFileSync(path.join(wtA, 'alpha.txt'), 'from alpha\n');
    await client.request({ method: 'rollback.preview', value: { runId: first.id } });
    await client.request({ method: 'rollback.apply', value: { runId: first.id, confirmed: true } });
    assert.ok(
      (await client.request({ method: 'approvals.list' })).some(
        (a) => a.runId === first.id && a.status === 'applied',
      ),
    );
    assert.equal(fs.existsSync(path.join(wtA, 'alpha.txt')), false);
    assert.equal(fs.readFileSync(path.join(wtA, 'base.txt'), 'utf8'), 'base\n');
    assert.ok(
      db
        .prepare("SELECT count(*) AS n FROM run_events WHERE run_id=? AND type='rollback.applied'")
        .get(first.id).n === 1,
    );
    await client.request({ method: 'worktree.remove', value: { runId: first.id } });
    assert.equal(fs.existsSync(wtA), false);
    assert.ok(fs.existsSync(wtB));
    const cancel = await client.request({
      method: 'runs.start',
      value: { dotId: 'alpha', projectId: 'repo' },
    });
    await until(async () => {
      const runs = await client.request({ method: 'runs.list', value: { limit: 10 } });
      assert.equal(runs.find((run) => run.id === cancel.id).state, 'running');
      return true;
    });
    await client.request({ method: 'runs.cancel', value: { runId: cancel.id } });
    await until(async () => {
      const runs = await client.request({ method: 'runs.list', value: { limit: 10 } });
      assert.equal(runs.find((run) => run.id === cancel.id).state, 'cancelled');
      return true;
    });
    db.close();
  } catch (error) {
    if (errors.length) error.message += `\nDaemon stderr: ${errors.join('')}`;
    throw error;
  } finally {
    unsubscribe();
    client.close();
    try {
      const stop = new Client();
      await stop.request({ method: 'shutdown' });
      stop.close();
    } catch {}
    if (daemon.exitCode === null && daemon.signalCode === null) {
      const exited = once(daemon, 'exit').catch(() => {});
      daemon.kill();
      await exited;
    }
    fs.rmSync(temp, { recursive: true, force: true });
  }
});

test('Run sem projeto usa HOME, entrega mensagens e recusa operações de worktree', async () => {
  const temp = fs.mkdtempSync(path.join(os.tmpdir(), 'karont-home-run-'));
  const home = path.join(temp, 'home');
  fs.mkdirSync(home);
  const runtime = path.join(temp, 'runtime');
  const data = path.join(temp, 'data');
  const config = path.join(temp, 'dots.json');
  const script = `const fs=require('node:fs');const path=require('node:path');const readline=require('node:readline');console.log('HOME_CWD '+process.cwd());readline.createInterface({input:process.stdin}).on('line',line=>fs.appendFileSync(path.join(process.cwd(),'delivered.txt'),line+'\\n'));setInterval(()=>{},1000);`;
  fs.writeFileSync(
    config,
    JSON.stringify({
      version: 1,
      projects: [],
      dots: [
        {
          id: 'alpha',
          name: 'Alpha',
          role: 'Teste de execução sem projeto',
          executable: process.execPath,
          args: ['-e', script],
          projectIds: [],
        },
      ],
    }),
    { mode: 0o600 },
  );
  const env = {
    ...process.env,
    HOME: home,
    KARONT_RUNTIME_DIR: runtime,
    KARONT_DATA_DIR: data,
    KARONT_CONFIG_DIR: path.join(temp, 'config-dir'),
    KARONT_DOTS_CONFIG: config,
  };
  const previousEnv = Object.fromEntries(
    [
      'HOME',
      'KARONT_RUNTIME_DIR',
      'KARONT_DATA_DIR',
      'KARONT_CONFIG_DIR',
      'KARONT_DOTS_CONFIG',
    ].map((key) => [key, process.env[key]]),
  );
  Object.assign(process.env, env);
  const daemon = spawn(process.execPath, ['dist/daemon/entry.cjs'], {
    env,
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  const errors = [];
  daemon.stdout.on('data', (chunk) => errors.push(chunk.toString()));
  daemon.stderr.on('data', (chunk) => errors.push(chunk.toString()));
  daemon.on('error', (error) => errors.push(error.message));
  const client = new Client();
  const expectNoWorktree = (request) =>
    assert.rejects(
      () => client.request(request),
      (error) => error.message.startsWith('Execução sem projeto'),
    );
  try {
    await until(() => client.request({ method: 'ping' }));
    const db = new DatabaseSync(path.join(data, 'phase0.sqlite'));
    const workspaceId = db
      .prepare("SELECT value FROM settings WHERE key='default_workspace_id'")
      .get().value;
    db.prepare(
      "INSERT INTO projects(id,name,root,git_root,created_at,workspace_id,origin,icon) VALUES('repo','Repo de teste',?,?,?,?,'ui','folder')",
    ).run(home, home, Date.now(), workspaceId);
    const projectChat = await client.request({
      method: 'chats.create',
      value: {
        projectId: 'repo',
        title: 'Conversa de projeto',
        operationId: crypto.randomUUID(),
      },
    });
    await assert.rejects(
      () =>
        client.request({
          method: 'runs.start',
          value: { dotId: 'alpha', chatId: projectChat.chat.id },
        }),
      /Conversa não corresponde/,
    );

    const freeChat = await client.request({
      method: 'chats.create',
      value: { title: 'Conversa sem projeto', operationId: crypto.randomUUID() },
    });
    const homeRun = await client.request({
      method: 'runs.start',
      value: { dotId: 'alpha', chatId: freeChat.chat.id },
    });
    assert.equal(homeRun.projectId, null);
    assert.equal(homeRun.location, 'home');
    assert.equal(homeRun.branch, null);
    const runningHome = await until(async () => {
      const run = (await client.request({ method: 'runs.list', value: { limit: 20 } })).find(
        (item) => item.id === homeRun.id,
      );
      assert.equal(run.state, 'running');
      return run;
    });
    assert.equal(runningHome.location, 'home');
    const attached = await client.request({
      method: 'terminal.attach',
      value: { runId: homeRun.id },
    });
    assert.equal(attached.run.projectId, null);
    await client.request({
      method: 'terminal.resize',
      value: { runId: homeRun.id, cols: 90, rows: 25 },
    });
    const boundChat = await client.request({
      method: 'chats.get',
      value: { chatId: freeChat.chat.id },
    });

    const saved = await client.request({
      method: 'messages.save',
      value: {
        chatId: freeChat.chat.id,
        body: 'mensagem na pasta pessoal',
        expectedRevision: boundChat.chat.revision,
        operationId: crypto.randomUUID(),
      },
    });
    const delivery = await client.request({
      method: 'messages.send',
      value: {
        chatId: freeChat.chat.id,
        messageId: saved.message.id,
        runId: homeRun.id,
        operationId: crypto.randomUUID(),
      },
    });
    assert.equal(delivery.status, 'sent');
    await until(async () => {
      assert.match(
        fs.readFileSync(path.join(home, 'delivered.txt'), 'utf8'),
        /mensagem na pasta pessoal/,
      );
      return true;
    });
    assert.equal(
      (await client.request({ method: 'chats.runs.list', value: { chatId: freeChat.chat.id } }))
        .items[0].location,
      'home',
    );
    assert.ok(
      (await client.request({ method: 'runs.list', value: { limit: 20 } })).some(
        (run) => run.id === homeRun.id,
      ),
    );

    const projectRunId = crypto.randomUUID();
    db.prepare(
      "INSERT INTO runs(id,dot_id,project_id,state,created_at,permission_mode,auto_resume,branch) VALUES(?,'alpha','repo','completed',?,'ask',1,?)",
    ).run(projectRunId, Date.now(), `karont/run-${projectRunId}`);
    const filtered = await client.request({
      method: 'runs.list',
      value: { limit: 20, projectId: 'repo' },
    });
    assert.ok(filtered.some((run) => run.id === projectRunId));
    assert.ok(filtered.every((run) => run.projectId === 'repo'));

    await expectNoWorktree({ method: 'runs.diff', value: { runId: homeRun.id } });
    await expectNoWorktree({ method: 'rollback.preview', value: { runId: homeRun.id } });
    await expectNoWorktree({
      method: 'rollback.apply',
      value: { runId: homeRun.id, confirmed: true },
    });
    await expectNoWorktree({ method: 'checkpoints.list', value: { runId: homeRun.id } });
    await expectNoWorktree({
      method: 'checkpoints.create',
      value: { runId: homeRun.id, operationId: crypto.randomUUID() },
    });
    await expectNoWorktree({ method: 'worktree.remove', value: { runId: homeRun.id } });
    await expectNoWorktree({ method: 'recovery.inspect', value: { runId: homeRun.id } });

    await client.request({ method: 'runs.cancel', value: { runId: homeRun.id } });
    await until(async () => {
      const listed = await client.request({ method: 'runs.list', value: { limit: 20 } });
      assert.equal(listed.find((run) => run.id === homeRun.id).state, 'cancelled');
      return true;
    });

    assert.equal(
      db.prepare('SELECT count(*) AS count FROM worktrees WHERE run_id=?').get(homeRun.id).count,
      0,
    );
    assert.equal(
      db.prepare('SELECT count(*) AS count FROM checkpoints WHERE run_id=?').get(homeRun.id).count,
      0,
    );
    assert.equal(db.prepare('SELECT branch FROM runs WHERE id=?').get(homeRun.id).branch, null);
    db.close();
  } catch (error) {
    error.message += `\nDaemon pid=${daemon.pid} exit=${daemon.exitCode} signal=${daemon.signalCode}; output: ${errors.join('')}`;
    throw error;
  } finally {
    client.close();
    try {
      const stop = new Client();
      await stop.request({ method: 'shutdown' });
      stop.close();
    } catch {}
    if (daemon.exitCode === null && daemon.signalCode === null) {
      const exited = once(daemon, 'exit').catch(() => {});
      daemon.kill();
      await exited;
    }
    for (const [key, value] of Object.entries(previousEnv)) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
    fs.rmSync(temp, { recursive: true, force: true });
  }
});

test('schemas de IPC recusam argumentos arbitrários e valores excessivos', () => {
  const base = { id: 1 };
  assert.equal(
    requestSchema.safeParse({
      ...base,
      method: 'runs.start',
      value: { dotId: '../repo', projectId: 'repo' },
    }).success,
    false,
  );
  assert.equal(
    requestSchema.safeParse({
      ...base,
      method: 'terminal.write',
      value: { runId: 'not-uuid', data: 'x' },
    }).success,
    false,
  );
  assert.equal(
    requestSchema.safeParse({
      ...base,
      method: 'terminal.write',
      value: { runId: '123e4567-e89b-42d3-a456-426614174000', data: 'x'.repeat(8193) },
    }).success,
    false,
  );
  assert.equal(
    requestSchema.safeParse({
      ...base,
      method: 'rollback.apply',
      value: { runId: '123e4567-e89b-42d3-a456-426614174000', confirmed: false },
    }).success,
    false,
  );
  assert.equal(
    requestSchema.safeParse({
      ...base,
      method: 'runs.start',
      value: { dotId: 'alpha', projectId: 'repo', executable: '/bin/sh', args: ['-c', 'id'] },
    }).success,
    false,
  );
});
