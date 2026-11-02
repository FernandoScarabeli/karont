import assert from "node:assert/strict";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { test } from "node:test";
import { gitInfo } from "./folders.ts";

async function tempDirectory(t: {
  after(callback: () => void | Promise<void>): void;
}): Promise<string> {
  const directory = await mkdtemp(path.join(os.tmpdir(), "karont-git-info-"));
  t.after(() => rm(directory, { recursive: true, force: true }));
  return directory;
}

test("folders.gitInfo encontra a branch no repositório ancestral", async (t) => {
  const root = await tempDirectory(t);
  const project = path.join(root, "projeto", "src");
  await mkdir(path.join(root, "projeto", ".git"), { recursive: true });
  await mkdir(project, { recursive: true });
  await writeFile(path.join(root, "projeto", ".git", "HEAD"), "ref: refs/heads/feature/anexos\n");

  assert.deepEqual(await gitInfo(project), { branch: "feature/anexos", detached: false });
});

test("folders.gitInfo reconhece HEAD destacado", async (t) => {
  const root = await tempDirectory(t);
  const project = path.join(root, "projeto");
  await mkdir(path.join(project, ".git"), { recursive: true });
  await writeFile(path.join(project, ".git", "HEAD"), `${"a".repeat(40)}\n`);

  assert.deepEqual(await gitInfo(project), { branch: null, detached: true });
});

test("folders.gitInfo lê gitdir em arquivo de worktree e retorna null fora do Git", async (t) => {
  const root = await tempDirectory(t);
  const project = path.join(root, "worktree");
  const gitDirectory = path.join(root, "common", "worktrees", "one");
  await mkdir(project, { recursive: true });
  await mkdir(gitDirectory, { recursive: true });
  await writeFile(path.join(project, ".git"), `gitdir: ${path.relative(project, gitDirectory)}\n`);
  await writeFile(path.join(gitDirectory, "HEAD"), "ref: refs/heads/worktree-branch\n");

  assert.deepEqual(await gitInfo(project), { branch: "worktree-branch", detached: false });
  assert.deepEqual(await gitInfo(root), { branch: null, detached: false });
});
