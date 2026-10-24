import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
const { Client } = require('../dist/local/client.cjs');
const c = new Client();
try {
  const state = await c.request({ method: process.argv.includes('--stop') ? 'shutdown' : 'ping' });
  console.log(
    JSON.stringify(
      {
        status: process.argv.includes('--stop') ? 'stopping' : 'running',
        pid: state.pid,
        heartbeat: state.heartbeat,
        uptime: state.uptime,
        rssMiB: state.rss / 1048576,
      },
      null,
      2,
    ),
  );
} catch (e) {
  console.error(e.message);
  process.exitCode = 1;
} finally {
  c.close();
}
