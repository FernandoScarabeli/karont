import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';
import { spawnSync } from 'node:child_process';
const require = createRequire(import.meta.url);
const read = (file) => {
  try {
    return fs.readFileSync(file, 'utf8').trim();
  } catch (e) {
    return { unavailable: e.code };
  }
};
const binary = require('electron');
function inspect(file) {
  try {
    const resolved = fs.realpathSync(file);
    const s = fs.statSync(resolved);
    return {
      path: file,
      resolved,
      uid: s.uid,
      gid: s.gid,
      mode: (s.mode & 0o7777).toString(8),
      rootSetuidHelper:
        s.isFile() && s.uid === 0 && (s.mode & 0o4000) !== 0 && (s.mode & 0o022) === 0,
    };
  } catch (e) {
    return { path: file, unavailable: e.code };
  }
}
const probe = spawnSync('unshare', ['--user', '--map-root-user', '--', 'true'], {
  encoding: 'utf8',
  timeout: 3000,
});
const result = {
  date: new Date().toISOString(),
  validation: 'diagnostic-only; not desktop acceptance',
  uid: process.getuid(),
  electron: require('electron/package.json').version,
  playwright: require('playwright/package.json').version,
  binary: inspect(binary),
  helpers: [
    inspect(path.join(path.dirname(binary), 'chrome-sandbox')),
    ...(process.env.CHROME_DEVEL_SANDBOX ? [inspect(process.env.CHROME_DEVEL_SANDBOX)] : []),
    inspect('/opt/google/chrome/chrome-sandbox'),
  ],
  securityContext: read('/proc/self/attr/current'),
  sysctls: Object.fromEntries(
    [
      'apparmor_restrict_unprivileged_userns',
      'apparmor_restrict_unprivileged_unconfined',
      'unprivileged_userns_clone',
    ].map((name) => [name, read('/proc/sys/kernel/' + name)]),
  ),
  userNamespaceProbe: {
    command: ['unshare', '--user', '--map-root-user', '--', 'true'],
    status: probe.status,
    signal: probe.signal,
    error: probe.error?.message,
    stderr: probe.stderr?.trim(),
    note: 'unshare and Electron may have different AppArmor profiles; only an actual desktop run establishes compatibility.',
  },
  changesApplied: false,
};
fs.mkdirSync('benchmarks', { recursive: true });
fs.writeFileSync('benchmarks/sandbox-diagnostic.json', JSON.stringify(result, null, 2));
console.log(JSON.stringify(result, null, 2));
