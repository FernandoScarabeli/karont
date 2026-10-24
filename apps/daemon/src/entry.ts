import fs from 'node:fs';
import path from 'node:path';
import { paths, privateFile } from '../../../packages/local/src/paths';
process.umask(0o077);
const p = paths();
const fd = fs.openSync(
  p.lock,
  fs.constants.O_CREAT | fs.constants.O_RDWR | fs.constants.O_NOFOLLOW,
  0o600,
);
fs.closeSync(fd);
privateFile(p.lock);
// Replace the launcher twice, preserving a single PID and the flock descriptor.
// No idle Node launcher or supervisor process remains in memory.
if (!process.execve) throw Error('Node >=24 com process.execve é obrigatório no Linux');
process.execve(
  '/usr/bin/flock',
  [
    'flock',
    '--no-fork',
    '--exclusive',
    '--nonblock',
    '--conflict-exit-code',
    '73',
    p.lock,
    process.execPath,
    path.join(__dirname, 'server.cjs'),
  ],
  Object.fromEntries(
    Object.entries(process.env).filter(
      (entry): entry is [string, string] => entry[1] !== undefined,
    ),
  ),
);
