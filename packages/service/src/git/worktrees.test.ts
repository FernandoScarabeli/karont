import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdir, mkdtemp, realpath, rm, stat, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { test } from "node:test";
import {
  createConversation,
  createProject,
  createWorktreeRecord,
  getWorktree,
  listWorktrees,
  openDatabase,
} from "../db.ts";
import { ServiceError } from "../errors.ts";
import { createWorktree, removeWorktree, slugify, worktreeStatus } from "./worktrees.ts";

function git(cwd: string, ...args: string[]): string {
  const env = { ...process.env };
  for (const name of ["GIT_DIR", "GIT_WORK_TREE", "GIT_INDEX_FILE"]) delete env[name];
  return execFileSync("git", args, { cwd, env, encoding: "utf8" });
}

async function exists(target: string): Promise<boolean> {
  return stat(target).then(
    () => true,
    () => false,
  );
}

async function setup(context: { after: (fn: () => Promise<void> | void) => void }) {
  const root = await realpath(await mkdtemp(path.join(os.tmpdir(), "ks-wt-")));
  const repo = path.join(root, "meu-app");
  const dataDir = path.join(root, "data");
  await mkdir(repo);
  await mkdir(dataDir);
  git(repo, "init", "-q", "-b", "main");
  git(repo, "config", "user.name", "Teste");
  git(repo, "config", "user.email", "teste@example.com");
  await writeFile(path.join(repo, "a.txt"), "a\n");
  await writeFile(path.join(repo, ".gitignore"), "ignorado.log\n");
  git(repo, "add", "-A");
  git(repo, "commit", "-q", "-m", "inicial");
  const db = openDatabase(path.join(root, "karont.db"));
  const project = createProject(db, {
    name: "Meu App Ção",
    icon: "folder",
    path: repo,
    defaultAgent: null,
  });
  context.after(async () => {
    db.close();
    await rm(root, { recursive: true, force: true });
  });
  return { root, repo, dataDir, db, project, options: { dataDir, homeDir: root } };
}

test("slugify: só a-z, 0-9 e hífen, no máximo 40 caracteres", () => {
  assert.equal(slugify("Meu App Ção!"), "meu-app-cao");
  assert.equal(slugify("***"), "projeto");
  const long = slugify("a".repeat(100));
  assert.equal(long.length, 40);
  assert.match(slugify("x - y / z"), /^[a-z0-9-]+$/);
});

test("worktrees: criar deixa a cópia fora do projeto, na branch nova, sem mexer no principal", async (context) => {
  const { repo, dataDir, db, project, options } = await setup(context);
  const headBefore = git(repo, "rev-parse", "HEAD").trim();
  const branchBefore = git(repo, "branch", "--show-current").trim();
  const worktree = await createWorktree(db, project.id, options);

  assert.equal(worktree.projectId, project.id);
  assert.equal(worktree.repoRoot, repo);
  assert.equal(worktree.baseCommit, headBefore);
  assert.equal(worktree.mergedAt, null);
  assert.equal(path.dirname(worktree.path), path.join(dataDir, "worktrees"));
  assert.match(path.basename(worktree.path), /^meu-app-cao-[0-9a-f]{6}$/);
  assert.match(worktree.branch, /^karont\/meu-app-cao-[0-9a-f]{6}$/);
  assert.equal(path.relative(repo, worktree.path).startsWith(".."), true);
  assert.equal(await exists(path.join(worktree.path, "a.txt")), true);
  assert.equal(git(worktree.path, "branch", "--show-current").trim(), worktree.branch);
  assert.equal(git(worktree.path, "rev-parse", "HEAD").trim(), headBefore);

  assert.equal(git(repo, "rev-parse", "HEAD").trim(), headBefore);
  assert.equal(git(repo, "branch", "--show-current").trim(), branchBefore);
  assert.equal(git(repo, "status", "--porcelain").trim(), "");
  assert.match(git(repo, "worktree", "list", "--porcelain"), new RegExp(worktree.path));
  assert.deepEqual(listWorktrees(db, project.id), [worktree]);
  assert.deepEqual(getWorktree(db, worktree.id), worktree);
  const mode = (await stat(path.join(dataDir, "worktrees"))).mode & 0o777;
  assert.equal(mode, 0o700);

  const second = await createWorktree(db, project.id, options);
  assert.notEqual(second.path, worktree.path);
  assert.deepEqual(
    listWorktrees(db, project.id).map((entry) => entry.id),
    [second.id, worktree.id],
  );
});

test("worktrees: erros de criação em português", async (context) => {
  const { root, repo, db, project, options } = await setup(context);
  const rejects = (promise: Promise<unknown>, message: RegExp) =>
    assert.rejects(
      promise,
      (error) =>
        error instanceof ServiceError &&
        error.code === "invalid_request" &&
        message.test(error.message),
    );

  await rejects(createWorktree(db, "nao-existe", options), /O projeto não existe/);

  const plain = path.join(root, "sem-git");
  await mkdir(plain);
  const noGit = createProject(db, {
    name: "Sem Git",
    icon: "folder",
    path: plain,
    defaultAgent: null,
  });
  await rejects(createWorktree(db, noGit.id, options), /não usa Git/);

  const empty = path.join(root, "vazio");
  await mkdir(empty);
  git(empty, "init", "-q", "-b", "main");
  const emptyProject = createProject(db, {
    name: "Vazio",
    icon: "folder",
    path: empty,
    defaultAgent: null,
  });
  await rejects(createWorktree(db, emptyProject.id, options), /pelo menos um commit/);

  // Pasta pessoal que é um repositório: nunca vale.
  await rejects(createWorktree(db, project.id, { ...options, homeDir: repo }), /não usa Git/);
  assert.equal(listWorktrees(db, project.id).length, 0);
  assert.equal(git(repo, "worktree", "list").trim().split("\n").length, 1);
});

test("worktrees: status conta novo, modificado e commit a mais; ignorado não conta; missing", async (context) => {
  const { db, project, options, repo } = await setup(context);
  const worktree = await createWorktree(db, project.id, options);
  assert.deepEqual(await worktreeStatus(db, worktree.id), {
    dirtyFiles: 0,
    unmergedCommits: 0,
    busyConversations: 0,
    missing: false,
  });

  await writeFile(path.join(worktree.path, "novo.txt"), "n\n");
  await writeFile(path.join(worktree.path, "a.txt"), "mudado\n");
  await writeFile(path.join(worktree.path, "ignorado.log"), "x\n");
  const dirty = await worktreeStatus(db, worktree.id);
  assert.equal(dirty.dirtyFiles, 2);

  git(worktree.path, "add", "-A");
  git(
    worktree.path,
    "-c",
    "user.name=T",
    "-c",
    "user.email=t@e.com",
    "commit",
    "-q",
    "-m",
    "mais um",
  );
  assert.deepEqual(await worktreeStatus(db, worktree.id), {
    dirtyFiles: 0,
    unmergedCommits: 1,
    busyConversations: 0,
    missing: false,
  });

  // Trazido para o principal: deixa de contar.
  git(repo, "merge", "-q", "--ff-only", worktree.branch);
  assert.equal((await worktreeStatus(db, worktree.id)).unmergedCommits, 0);

  const conversation = createConversation(db, {
    agent: "claude",
    title: "t",
    cwd: worktree.path,
    mode: "edit",
    worktreeId: worktree.id,
  });
  db.prepare("UPDATE conversations SET state='working' WHERE id=?").run(conversation.id);
  assert.equal((await worktreeStatus(db, worktree.id)).busyConversations, 1);

  await rm(worktree.path, { recursive: true, force: true });
  const missing = await worktreeStatus(db, worktree.id);
  assert.equal(missing.missing, true);
  assert.equal(missing.dirtyFiles, 0);

  await assert.rejects(
    worktreeStatus(db, "nada"),
    (error) => error instanceof ServiceError && error.code === "invalid_request",
  );
});

test("worktrees: remover limpa pasta e branch; sujo sem force não muda nada", async (context) => {
  const { db, project, options, repo } = await setup(context);
  const clean = await createWorktree(db, project.id, options);
  const result = await removeWorktree(db, clean.id, options);
  assert.equal(result.branchKept, false);
  assert.equal(await exists(clean.path), false);
  assert.equal(git(repo, "branch", "--list", clean.branch).trim(), "");
  assert.equal(getWorktree(db, clean.id), null);
  assert.equal(git(repo, "worktree", "list").trim().split("\n").length, 1);

  const dirty = await createWorktree(db, project.id, options);
  await writeFile(path.join(dirty.path, "novo.txt"), "n\n");
  await writeFile(path.join(dirty.path, "a.txt"), "mudado\n");
  await assert.rejects(
    removeWorktree(db, dirty.id, options),
    (error) =>
      error instanceof ServiceError &&
      error.code === "invalid_request" &&
      /2 arquivos com mudanças/.test(error.message),
  );
  assert.equal(await exists(path.join(dirty.path, "novo.txt")), true);
  assert.notEqual(git(repo, "branch", "--list", dirty.branch).trim(), "");
  assert.notEqual(getWorktree(db, dirty.id), null);

  const forced = await removeWorktree(db, dirty.id, { ...options, force: true });
  assert.equal(forced.branchKept, false);
  assert.equal(await exists(dirty.path), false);
});

test("worktrees: ignorados não impedem remover sem force", async (context) => {
  const { db, project, options } = await setup(context);
  const worktree = await createWorktree(db, project.id, options);
  await writeFile(path.join(worktree.path, "ignorado.log"), "x\n");
  const result = await removeWorktree(db, worktree.id, options);
  assert.equal(result.branchKept, false);
  assert.equal(await exists(worktree.path), false);
});

test("worktrees: commit não trazido bloqueia sem force e, com force, a branch fica", async (context) => {
  const { db, project, options, repo } = await setup(context);
  const worktree = await createWorktree(db, project.id, options);
  await writeFile(path.join(worktree.path, "b.txt"), "b\n");
  git(worktree.path, "add", "-A");
  git(
    worktree.path,
    "-c",
    "user.name=T",
    "-c",
    "user.email=t@e.com",
    "commit",
    "-q",
    "-m",
    "trabalho",
  );

  await assert.rejects(
    removeWorktree(db, worktree.id, options),
    (error) => error instanceof ServiceError && /1 commit não trazido/.test(error.message),
  );
  assert.equal(await exists(worktree.path), true);

  const result = await removeWorktree(db, worktree.id, { ...options, force: true });
  assert.equal(result.branchKept, true);
  assert.equal(await exists(worktree.path), false);
  assert.notEqual(git(repo, "branch", "--list", worktree.branch).trim(), "");
  assert.equal(getWorktree(db, worktree.id), null);
});

test("worktrees: pasta que já sumiu é limpa com prune", async (context) => {
  const { db, project, options, repo } = await setup(context);
  const worktree = await createWorktree(db, project.id, options);
  await rm(worktree.path, { recursive: true, force: true });
  const result = await removeWorktree(db, worktree.id, options);
  assert.equal(result.branchKept, false);
  assert.equal(git(repo, "worktree", "list").trim().split("\n").length, 1);
  assert.equal(git(repo, "branch", "--list", worktree.branch).trim(), "");
});

test("worktrees: conversa ocupada bloqueia a remoção mesmo com force", async (context) => {
  const { db, project, options } = await setup(context);
  const worktree = await createWorktree(db, project.id, options);
  const conversation = createConversation(db, {
    agent: "claude",
    title: "t",
    cwd: worktree.path,
    mode: "edit",
    worktreeId: worktree.id,
  });
  for (const state of ["queued", "working", "waiting"]) {
    db.prepare("UPDATE conversations SET state=? WHERE id=?").run(state, conversation.id);
    for (const force of [false, true]) {
      await assert.rejects(
        removeWorktree(db, worktree.id, { ...options, force }),
        (error) =>
          error instanceof ServiceError &&
          error.code === "invalid_request" &&
          /trabalhando/.test(error.message),
      );
    }
  }
  assert.equal(await exists(worktree.path), true);
  assert.notEqual(getWorktree(db, worktree.id), null);
});

test("worktrees: recusa path fora de <dataDir>/worktrees", async (context) => {
  const { root, db, project, options, repo } = await setup(context);
  const outside = path.join(root, "fora");
  await mkdir(outside);
  await writeFile(path.join(outside, "importante.txt"), "x");
  for (const target of [
    outside,
    repo,
    path.join(options.dataDir, "worktrees"),
    path.join(options.dataDir, "worktrees", "..", "fora"),
  ]) {
    const row = createWorktreeRecord(db, {
      projectId: project.id,
      repoRoot: repo,
      path: target,
      branch: "karont/fake",
      baseCommit: "abc",
    });
    await assert.rejects(
      removeWorktree(db, row.id, { ...options, force: true }),
      (error) =>
        error instanceof ServiceError &&
        error.code === "invalid_request" &&
        /fora da pasta do Karont/.test(error.message),
    );
    assert.notEqual(getWorktree(db, row.id), null);
    db.prepare("DELETE FROM worktrees WHERE id=?").run(row.id);
  }
  assert.equal(await exists(path.join(outside, "importante.txt")), true);
  assert.equal(await exists(path.join(repo, "a.txt")), true);
});
