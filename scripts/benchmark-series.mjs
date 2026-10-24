import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { desktopValid, distribution } from './desktop-proof.mjs';

export function summarize(runs) {
  if (runs.length < 5 || runs.some((r) => !desktopValid(r)))
    throw Error('Exigidas pelo menos cinco rodadas desktop aprovadas com prova de sandbox');
  const reference = runs[0].host;
  for (const r of runs) {
    for (const key of [
      'release',
      'cpu',
      'logicalCPUs',
      'ramGiB',
      'node',
      'electron',
      'display',
      'distribution',
      'testEnvironment',
    ])
      if (r.host[key] !== reference[key]) throw Error(`Ambientes não comparáveis: ${key}`);
    if (r.suspendResume?.passed !== true) throw Error('Retomada não validada');
  }
  const metrics = {};
  for (const key of ['coldStartMs', 'electronStartupMs', 'reopenMs'])
    metrics[key] = distribution(runs.map((r) => r.metrics[key]));
  for (const scenario of ['idle', 'streaming', 'editor', 'noWindow']) {
    metrics[scenario] = {};
    for (const scope of ['electron', 'daemon', 'total']) {
      metrics[scenario][scope] = {};
      for (const key of ['rssMiB', 'pssMiB', 'cpuPercentOneCore'])
        metrics[scenario][scope][key] = distribution(
          runs.map((r) => r.metrics[scenario][scope][key]),
        );
    }
  }
  metrics.frameGapP95Ms = distribution(runs.map((r) => r.metrics.responsiveness.frameGapP95Ms));
  metrics.focusToPaintMs = distribution(runs.flatMap((r) => r.metrics.focusToPaintMs));
  return {
    passed: true,
    rounds: runs.length,
    host: reference,
    metrics,
    notes:
      'p95 nearest-rank; with five rounds p95 is max. Process-cold start, OS caches retained. Focus-to-rAF is a proxy, not physical display latency. Performance budget and IPC need explicit review.',
  };
}

if (path.resolve(process.argv[1] ?? '') === fileURLToPath(import.meta.url)) {
  const rounds = Number(process.env.EROS_BENCH_ROUNDS ?? 5);
  if (!Number.isInteger(rounds) || rounds < 5 || rounds > 30)
    throw Error('EROS_BENCH_ROUNDS: inteiro de 5 a 30');
  const id = new Date().toISOString().replace(/[:.]/g, '-');
  const dir = path.join('benchmarks', 'series', id);
  fs.mkdirSync(dir, { recursive: true });
  const manifest = { id, passed: false, requestedRounds: rounds, desktop: [], daemon: [] };
  try {
    for (let n = 0; n < rounds; n++) {
      console.log(`Rodada ${n + 1}/${rounds}`);
      for (const kind of ['desktop', 'daemon']) {
        const script = kind === 'desktop' ? 'scripts/desktop-test.mjs' : 'scripts/benchmark.mjs';
        const log = fs.openSync(path.join(dir, `${n + 1}-${kind}.log`), 'w');
        let run;
        try {
          run = spawnSync(process.execPath, [script], {
            stdio: ['ignore', log, log],
            timeout: 180000,
          });
        } finally {
          fs.closeSync(log);
        }
        if (run.status !== 0)
          throw Error(
            `${kind} rodada ${n + 1} falhou: ${run.error?.message ?? run.status ?? run.signal}; consulte log e runs/`,
          );
        const data = JSON.parse(fs.readFileSync(`benchmarks/${kind}-latest.json`, 'utf8'));
        fs.writeFileSync(path.join(dir, `${n + 1}-${kind}.json`), JSON.stringify(data, null, 2));
        manifest[kind].push(data);
      }
      fs.writeFileSync(path.join(dir, 'manifest.json'), JSON.stringify(manifest, null, 2));
    }
    manifest.summary = summarize(manifest.desktop);
    manifest.passed = true;
  } catch (e) {
    manifest.error = e.message;
    process.exitCode = 1;
    console.error(e);
  } finally {
    fs.writeFileSync(path.join(dir, 'manifest.json'), JSON.stringify(manifest, null, 2));
    fs.writeFileSync(
      'benchmarks/series-latest.json',
      JSON.stringify({ ...manifest, directory: dir }, null, 2),
    );
  }
}
