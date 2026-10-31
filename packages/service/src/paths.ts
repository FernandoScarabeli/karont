import { chmod, lstat, mkdir } from "node:fs/promises";
import os from "node:os";
import path from "node:path";

export type ServicePaths = {
  runtimeDir: string;
  socketPath: string;
  secretPath: string;
  dataDir: string;
  dbPath: string;
};

export function resolvePaths(env: NodeJS.ProcessEnv = process.env): ServicePaths {
  const runtimeDir =
    env.KARONT_RUNTIME_DIR ||
    (env.XDG_RUNTIME_DIR ? path.join(env.XDG_RUNTIME_DIR, "karont") : undefined) ||
    path.join(os.tmpdir(), `karont-${process.getuid?.() ?? "user"}`);
  const dataDir =
    env.KARONT_DATA_DIR ||
    (env.XDG_DATA_HOME ? path.join(env.XDG_DATA_HOME, "karont") : undefined) ||
    path.join(os.homedir(), ".local", "share", "karont");

  return {
    runtimeDir,
    socketPath: path.join(runtimeDir, "service.sock"),
    secretPath: path.join(runtimeDir, "service.secret"),
    dataDir,
    dbPath: path.join(dataDir, "karont.db"),
  };
}

export async function ensurePrivateDir(dir: string): Promise<void> {
  await mkdir(dir, { recursive: true, mode: 0o700 });
  const info = await lstat(dir);
  if (info.isSymbolicLink() || !info.isDirectory()) {
    throw new Error(`O caminho ${dir} não é um diretório privado válido.`);
  }
  const uid = process.getuid?.();
  if (uid !== undefined && info.uid !== uid) {
    throw new Error(`O diretório ${dir} pertence a outro usuário.`);
  }
  await chmod(dir, 0o700);
}
