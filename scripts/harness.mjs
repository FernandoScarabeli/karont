import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawn, execFileSync } from 'node:child_process';
import { createRequire } from 'node:module';
export const require = createRequire(import.meta.url);
export const { Client } = require('../dist/local/client.cjs');
export const wait = (ms) => new Promise((r) => setTimeout(r, ms));
export async function openDiagnostics(page) {
  // A engrenagem do rodapé abre um menu; o item de mesmo nome leva à página. Logo após abrir o
  // app, o rodapé pode ser recriado enquanto os dados chegam e o menu some (DIVIDAS #27):
  // tenta de novo algumas vezes.
  for (let attempt = 1; ; attempt++) {
    try {
      await page.getByRole('button', { name: 'Configurações e ferramentas', exact: true }).click();
      await page
        .getByRole('menuitem', { name: 'Configurações e ferramentas', exact: true })
        .click({ timeout: 3000 });
      break;
    } catch (error) {
      if (attempt >= 3) throw error;
    }
  }
  await page.getByText('Daemon conectado', { exact: true }).waitFor();
  await page.getByRole('button', { name: 'Diagnóstico e laboratório', exact: true }).click();
}
export async function openConversation(page, title, origin) {
  // Com um <dialog> modal aberto, o fill na busca não falha, mas o texto não chega ao campo
  // (DIVIDAS #15). Espera não haver modal e confere o valor digitado.
  await page.locator('dialog[open]').first().waitFor({ state: 'detached' });
  const search = page.getByRole('textbox', { name: 'Buscar projetos e conversas', exact: true });
  await search.fill(title);
  assert.equal(await search.inputValue(), title, 'o texto da busca não chegou ao campo');
  // O resultado acessível inclui o título e a origem, mesmo fora do workspace atual.
  const name = origin ? `${title} ${origin}` : new RegExp(`^${RegExp.escape(title)} .+ / .+$`);
  await page.getByRole('button', { name, exact: true }).click();
  await page.getByRole('heading', { name: title, exact: true }).waitFor();
}
export async function chooseProjectFolder(dialog) {
  await dialog.locator('button', { hasText: 'Escolher…' }).click();
}
export async function until(fn) {
  let last;
  for (let n = 0; n < 100; n++) {
    try {
      return await fn();
    } catch (e) {
      last = e;
      await wait(50);
    }
  }
  throw last;
}
export function environment() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'karont-bench-'));
  const env = {
    ...process.env,
    KARONT_DETECT_AGENTS: '0',
    KARONT_RUNTIME_DIR: path.join(root, 'run'),
    KARONT_DATA_DIR: path.join(root, 'data'),
    KARONT_DESKTOP_DATA: path.join(root, 'desktop'),
  };
  if (!env.XDG_RUNTIME_DIR && process.getuid) env.XDG_RUNTIME_DIR = `/run/user/${process.getuid()}`;
  if (!env.XAUTHORITY && env.DISPLAY && env.XDG_RUNTIME_DIR && fs.existsSync(env.XDG_RUNTIME_DIR)) {
    const xauthority = fs
      .readdirSync(env.XDG_RUNTIME_DIR)
      .find((name) => name.startsWith('.mutter-Xwaylandauth.'));
    if (xauthority) env.XAUTHORITY = path.join(env.XDG_RUNTIME_DIR, xauthority);
  }
  return {
    root,
    env,
  };
}
export async function daemon(env) {
  const start = performance.now();
  const child = spawn(process.execPath, ['dist/daemon/entry.cjs'], {
    env,
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  const errors = [];
  child.stderr.on('data', (v) => errors.push(v.toString()));
  Object.assign(process.env, {
    KARONT_DETECT_AGENTS: '0',
    KARONT_RUNTIME_DIR: env.KARONT_RUNTIME_DIR,
    KARONT_DATA_DIR: env.KARONT_DATA_DIR,
  });
  const client = new Client();
  const state = await until(() => client.request({ method: 'snapshot' })).catch((e) => {
    child.kill();
    throw Error(e.message + errors.join(''));
  });
  if (state.pid !== child.pid) {
    client.close();
    child.kill();
    throw Error('PID do daemon não corresponde ao processo iniciado pelo harness');
  }
  return { client, child, pid: state.pid, startupMs: performance.now() - start };
}
const ticks = Number(execFileSync('getconf', ['CLK_TCK'], { encoding: 'utf8' }).trim());
export function processes(rootPid) {
  const all = [];
  for (const name of fs.readdirSync('/proc')) {
    if (!/^\d+$/.test(name)) continue;
    try {
      const stat = fs.readFileSync(`/proc/${name}/stat`, 'utf8');
      const fields = stat.slice(stat.lastIndexOf(')') + 2).split(' ');
      all.push({
        pid: Number(name),
        ppid: Number(fields[1]),
        startTicks: fields[19],
        cpuSeconds: (Number(fields[11]) + Number(fields[12])) / ticks,
      });
    } catch {}
  }
  const ids = new Set([rootPid]);
  let changed = true;
  while (changed) {
    changed = false;
    for (const p of all)
      if (ids.has(p.ppid) && !ids.has(p.pid)) {
        ids.add(p.pid);
        changed = true;
      }
  }
  // Reading smaps for unrelated desktop processes was both costly and irrelevant.
  const result = [];
  for (const p of all.filter((p) => ids.has(p.pid))) {
    try {
      const status = fs.readFileSync(`/proc/${p.pid}/status`, 'utf8');
      let pssBytes = null;
      try {
        pssBytes =
          Number(
            fs.readFileSync(`/proc/${p.pid}/smaps_rollup`, 'utf8').match(/^Pss:\s+(\d+)/m)[1],
          ) * 1024;
      } catch {}
      result.push({
        ...p,
        rssBytes: Number(status.match(/^VmRSS:\s+(\d+)/m)?.[1] ?? 0) * 1024,
        pssBytes,
      });
    } catch {}
  }
  return result;
}
export async function sample(rootPid, ms = 3000) {
  const before = processes(rootPid);
  const root = before.find((p) => p.pid === rootPid);
  if (!root) throw Error(`Processo não encontrado antes da amostra: ${rootPid}`);
  const start = performance.now();
  await wait(ms);
  const after = processes(rootPid);
  const endRoot = after.find((p) => p.pid === rootPid);
  if (!endRoot || endRoot.startTicks !== root.startTicks)
    throw Error(`Processo encerrou ou PID foi reutilizado durante a amostra: ${rootPid}`);
  const durationMs = performance.now() - start;
  let delta = 0;
  for (const p of after) {
    const old = before.find((v) => v.pid === p.pid && v.startTicks === p.startTicks);
    if (old) delta += p.cpuSeconds - old.cpuSeconds;
  }
  return {
    durationMs,
    processes: after,
    rssMiB: after.reduce((n, p) => n + p.rssBytes, 0) / 1048576,
    pssMiB: after.every((p) => p.pssBytes !== null)
      ? after.reduce((n, p) => n + p.pssBytes, 0) / 1048576
      : null,
    cpuPercentOneCore: (delta / (durationMs / 1000)) * 100,
  };
}
export function rendererSandbox(pid) {
  const status = fs.readFileSync(`/proc/${pid}/status`, 'utf8');
  const field = (name) => status.match(new RegExp(`^${name}:\\s+(.*)$`, 'm'))?.[1].trim();
  return {
    pid,
    noNewPrivs: Number(field('NoNewPrivs')),
    seccomp: Number(field('Seccomp')),
    seccompFilters: field('Seccomp_filters') ? Number(field('Seccomp_filters')) : null,
  };
}
export function host() {
  return {
    date: new Date().toISOString(),
    platform: os.platform(),
    release: os.release(),
    arch: os.arch(),
    cpu: os.cpus()[0]?.model,
    logicalCPUs: os.cpus().length,
    ramGiB: os.totalmem() / 1073741824,
    node: process.version,
    electron: require('electron/package.json').version,
    testEnvironment:
      process.env.KARONT_TEST_ENVIRONMENT ?? 'local desktop; uncontrolled concurrent load',
    display: process.env.WAYLAND_DISPLAY ? 'Wayland' : process.env.DISPLAY ? 'X11' : 'none',
    distribution: fs.readFileSync('/etc/os-release', 'utf8'),
    notes:
      'Single local run; other desktop workloads active. CPU=100% per logical core; RSS sum double counts shared pages; PSS apportions shared pages. No CLIs/models.',
  };
}
