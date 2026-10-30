import { randomBytes } from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

function env(name: string) {
  return process.env[`KARONT_${name}`] || process.env[`EROS_${name}`];
}

function lstatOrUndefined(dir: string) {
  try {
    return fs.lstatSync(dir);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return undefined;
    throw error;
  }
}

function migrateLegacyDir(oldDir: string, newDir: string, excludeWorktrees = false) {
  const newStat = lstatOrUndefined(newDir);
  if (newStat) return;
  const oldStat = lstatOrUndefined(oldDir);
  if (!oldStat?.isDirectory() || oldStat.isSymbolicLink()) return;

  const temporary = `${newDir}.migrando-${process.pid}-${randomBytes(8).toString('hex')}`;
  // A cópia vai para uma subpasta de uma pasta 0700: o cpSync exige destino inexistente.
  const copy = path.join(temporary, 'copia');
  fs.mkdirSync(temporary, { mode: 0o700 });
  try {
    fs.chmodSync(temporary, 0o700);
    fs.cpSync(oldDir, copy, {
      recursive: true,
      errorOnExist: true,
      force: false,
      verbatimSymlinks: true,
      filter: excludeWorktrees
        ? (source) => {
            const relative = path.relative(oldDir, source);
            return relative !== 'worktrees' && !relative.startsWith(`worktrees${path.sep}`);
          }
        : undefined,
    });
  } catch (error) {
    fs.rmSync(temporary, { recursive: true, force: true });
    throw error;
  }

  try {
    fs.chmodSync(copy, 0o700);
    fs.renameSync(copy, newDir);
    fs.rmSync(temporary, { recursive: true, force: true });
  } catch (error) {
    const current = lstatOrUndefined(newDir);
    fs.rmSync(temporary, { recursive: true, force: true });
    if (current?.isDirectory() && !current.isSymbolicLink()) return;
    throw error;
  }
}

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
  const runtimeOverride = env('RUNTIME_DIR');
  const dataOverride = env('DATA_DIR');
  const configOverride = env('CONFIG_DIR');
  const runtimeDir =
    runtimeOverride ||
    path.join(process.env.XDG_RUNTIME_DIR || os.tmpdir(), `karont-${process.getuid!()}`);
  const dataBase = process.env.XDG_DATA_HOME || path.join(os.homedir(), '.local/share');
  const dataDir = dataOverride || path.join(dataBase, 'karont');
  if (!dataOverride) migrateLegacyDir(path.join(dataBase, 'eros'), dataDir, true);
  const configBase = process.env.XDG_CONFIG_HOME || path.join(os.homedir(), '.config');
  const configDir = configOverride || path.join(configBase, 'karont');
  if (!configOverride) migrateLegacyDir(path.join(configBase, 'eros'), configDir);

  const runtime = privateDir(runtimeDir);
  const data = privateDir(dataDir);
  const config = privateDir(configDir);

  return {
    runtime,
    data,
    config,
    socket: path.join(runtime, 'daemon.sock'),
    lock: path.join(runtime, 'daemon.lock'),
    session: path.join(runtime, 'session.json'),
    db: path.join(data, 'phase0.sqlite'),
    dots: env('DOTS_CONFIG') || path.join(config, 'dots.json'),
    worktrees: path.join(data, 'worktrees'),
  };
}

export function privateFile(file: string) {
  const s = fs.lstatSync(file);
  if (!s.isFile() || s.isSymbolicLink() || s.uid !== process.getuid!() || (s.mode & 0o077) !== 0)
    throw Error('Arquivo privado inválido');
}
