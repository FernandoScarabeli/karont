import assert from "node:assert/strict";
import { chmod, mkdir, mkdtemp, readlink, stat, symlink } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { test } from "node:test";
import { ensurePrivateDir, resolvePaths } from "./paths.ts";

test("resolvePaths usa overrides e defaults XDG", () => {
  const paths = resolvePaths({
    KARONT_RUNTIME_DIR: "/tmp/karont-runtime",
    KARONT_DATA_DIR: "/tmp/karont-data",
  });
  assert.equal(paths.runtimeDir, "/tmp/karont-runtime");
  assert.equal(paths.socketPath, "/tmp/karont-runtime/service.sock");
  assert.equal(paths.secretPath, "/tmp/karont-runtime/service.secret");
  assert.equal(paths.dataDir, "/tmp/karont-data");
  assert.equal(paths.dbPath, "/tmp/karont-data/karont.db");

  const xdg = resolvePaths({ XDG_RUNTIME_DIR: "/tmp/run", XDG_DATA_HOME: "/tmp/data" });
  assert.equal(xdg.runtimeDir, "/tmp/run/karont");
  assert.equal(xdg.dataDir, "/tmp/data/karont");
});

test("ensurePrivateDir cria e corrige permissões para 0700", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "ks-"));
  const directory = path.join(root, "private");
  await ensurePrivateDir(directory);
  assert.equal((await stat(directory)).mode & 0o777, 0o700);
  await chmod(directory, 0o755);
  await ensurePrivateDir(directory);
  assert.equal((await stat(directory)).mode & 0o777, 0o700);
});

test("ensurePrivateDir recusa symlink", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "ks-"));
  const realDirectory = path.join(root, "real");
  const linkedDirectory = path.join(root, "linked");
  await mkdir(realDirectory);
  await symlink(realDirectory, linkedDirectory);
  await assert.rejects(ensurePrivateDir(linkedDirectory), /diretório privado válido/);
  assert.equal(await readlink(linkedDirectory), realDirectory);
});
