import fs from 'node:fs';
import { environment, daemon, sample, host, wait } from './harness.mjs';
const ctx = environment();
let d;
const result = { host: host(), metrics: {} };
try {
  d = await daemon(ctx.env);
  result.metrics.startupMs = d.startupMs;
  result.metrics.idle = await sample(d.pid, 5000);
  await d.client.request({ method: 'stream', value: true });
  result.metrics.streaming = await sample(d.pid, 5000);
  const timings = [];
  for (let i = 0; i < 200; i++) {
    const t = performance.now();
    await d.client.request({ method: 'ping' });
    timings.push(performance.now() - t);
    await wait(12);
  }
  timings.sort((a, b) => a - b);
  result.metrics.roundtrip = {
    samples: timings.length,
    p50Ms: timings[100],
    p95Ms: timings[190],
    maxMs: timings.at(-1),
  };
} finally {
  if (d) {
    d.client.close();
    d.child.kill('SIGTERM');
  }
  await wait(200);
  fs.rmSync(ctx.root, { recursive: true, force: true });
}
fs.mkdirSync('benchmarks', { recursive: true });
const runDir = 'benchmarks/runs/' + new Date().toISOString().replace(/[:.]/g, '-');
fs.mkdirSync(runDir, { recursive: true });
fs.writeFileSync(runDir + '/daemon.json', JSON.stringify(result, null, 2));
fs.writeFileSync('benchmarks/daemon-latest.json', JSON.stringify(result, null, 2));
console.log(JSON.stringify(result, null, 2));
