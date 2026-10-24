import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
export function privateDir(dir: string) {
  fs.mkdirSync(dir, { recursive: true, mode: 0o700 });
  const s = fs.lstatSync(dir);
  if (
    !s.isDirectory() ||
    s.isSymbolicLink() ||
    s.uid !== process.getuid!() ||
    (s.mode & 0o077) !== 0
  )
    throw Error('Diretório deve pertencer ao usuário e ter modo 0700: ' + dir);
  return dir;
}
export function paths() {
  const runtime = privateDir(
    process.env.EROS_RUNTIME_DIR ||
      path.join(process.env.XDG_RUNTIME_DIR || os.tmpdir(), `eros-${process.getuid!()}`),
  );
  const data = privateDir(
    process.env.EROS_DATA_DIR ||
      path.join(process.env.XDG_DATA_HOME || path.join(os.homedir(), '.local/share'), 'eros'),
  );
  const config = privateDir(
    process.env.EROS_CONFIG_DIR ||
      path.join(process.env.XDG_CONFIG_HOME || path.join(os.homedir(), '.config'), 'eros'),
  );
  return {
    runtime,
    data,
    config,
    socket: path.join(runtime, 'daemon.sock'),
    lock: path.join(runtime, 'daemon.lock'),
    session: path.join(runtime, 'session.json'),
    db: path.join(data, 'phase0.sqlite'),
    dots: process.env.EROS_DOTS_CONFIG || path.join(config, 'dots.json'),
    worktrees: path.join(data, 'worktrees'),
  };
}
export function privateFile(file: string) {
  const s = fs.lstatSync(file);
  if (!s.isFile() || s.isSymbolicLink() || s.uid !== process.getuid!() || (s.mode & 0o077) !== 0)
    throw Error('Arquivo privado inválido');
}
