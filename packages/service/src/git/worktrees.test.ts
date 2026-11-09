import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import {
  chmod,
  mkdir,
  mkdtemp,
  readFile,
  realpath,
  rm,
  stat,
  unlink,
  writeFile,
} from "node:fs/promises";
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
import {
  createWorktree,
  mergeWorktree,
  removeWorktree,
  slugify,
  worktreeMergePreview,
  worktreeStatus,
} from "./worktrees.ts";

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

async function setup(
  context: { after: (fn: () => Promise<void> | void) => void },
  repoName = "meu-app",
) {
  const root = await realpath(await mkdtemp(path.join(os.tmpdir(), "ks-wt-")));
  const repo = path.join(root, repoName);
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

// ---- Trazer a cópia de volta (M3-B4b) ----

async function commitInCopy(cwd: string, file: string, content: string, message = "na cópia") {
  await mkdir(path.dirname(path.join(cwd, file)), { recursive: true });
  await writeFile(path.join(cwd, file), content);
  git(cwd, "add", "-A");
  git(cwd, "commit", "-q", "-m", message);
}

/** Estado completo de uma pasta Git, lido sem renovar o index (nada para atrapalhar a comparação). */
async function fingerprint(cwd: string) {
  const env = { ...process.env, GIT_OPTIONAL_LOCKS: "0" };
  const run = (...args: string[]) => execFileSync("git", args, { cwd, env, encoding: "utf8" });
  const gitDir = run("rev-parse", "--absolute-git-dir").trim();
  return {
    indexBytes: (await readFile(path.join(gitDir, "index"))).toString("base64"),
    status: run("status", "--porcelain", "-z", "--untracked-files=all"),
    head: run("rev-parse", "HEAD"),
    branch: run("branch", "--show-current"),
    staged: run("ls-files", "-s"),
    stash: run("stash", "list"),
    refs: run("for-each-ref"),
  };
}

test("trazer: commits da cópia chegam na branch do usuário e gravam merged_at", async (context) => {
  const { repo, db, project, options } = await setup(context);
  const worktree = await createWorktree(db, project.id, options);
  await commitInCopy(worktree.path, "novo.txt", "novo\n");
  await commitInCopy(worktree.path, "pasta/b.txt", "b\n");

  const preview = await worktreeMergePreview(db, worktree.id);
  assert.deepEqual(preview, {
    targetBranch: "main",
    commits: 2,
    uncommittedFiles: 0,
    changedFiles: 2,
    conflicts: [],
    blocked: null,
    targetDirtyFiles: [],
  });

  const result = await mergeWorktree(db, worktree.id);
  assert.equal(result.targetBranch, "main");
  assert.equal(result.commit, git(repo, "rev-parse", "HEAD").trim());
  assert.equal(await readFile(path.join(repo, "novo.txt"), "utf8"), "novo\n");
  assert.equal(await readFile(path.join(repo, "pasta", "b.txt"), "utf8"), "b\n");
  assert.equal(git(repo, "status", "--porcelain").trim(), "");
  assert.equal(git(repo, "stash", "list").trim(), "");
  assert.equal(git(repo, "branch", "--show-current").trim(), "main");
  assert.notEqual(result.worktree.mergedAt, null);
  assert.equal(getWorktree(db, worktree.id)?.mergedAt, result.worktree.mergedAt);
  // Depois de trazido, não sobra nada novo.
  assert.equal((await worktreeMergePreview(db, worktree.id)).blocked, "nothing");
});

test("trazer: mudanças não commitadas (novo, editado e apagado) viram commit na branch da cópia", async (context) => {
  const { repo, db, project, options } = await setup(context);
  const worktree = await createWorktree(db, project.id, options);
  await commitInCopy(worktree.path, "velho.txt", "velho\n");
  const tipBefore = git(worktree.path, "rev-parse", "HEAD").trim();
  await writeFile(path.join(worktree.path, "a.txt"), "editado\n");
  await writeFile(path.join(worktree.path, "criado.txt"), "criado\n");
  await unlink(path.join(worktree.path, "velho.txt"));
  await writeFile(path.join(worktree.path, "ignorado.log"), "não vai\n");

  const preview = await worktreeMergePreview(db, worktree.id);
  assert.equal(preview.blocked, null);
  assert.equal(preview.uncommittedFiles, 3);
  assert.equal(preview.commits, 2);
  assert.equal(preview.changedFiles, 2);
  assert.deepEqual(preview.conflicts, []);

  await mergeWorktree(db, worktree.id);
  assert.equal(await readFile(path.join(repo, "a.txt"), "utf8"), "editado\n");
  assert.equal(await readFile(path.join(repo, "criado.txt"), "utf8"), "criado\n");
  assert.equal(await exists(path.join(repo, "velho.txt")), false);
  assert.equal(await exists(path.join(repo, "ignorado.log")), false);
  // A cópia ganhou exatamente um commit, com a mensagem do Karont, e ficou limpa.
  assert.equal(git(worktree.path, "rev-list", "--count", `${tipBefore}..HEAD`).trim(), "1");
  assert.equal(
    git(worktree.path, "log", "-1", "--format=%s").trim(),
    "karont: mudanças da cópia separada",
  );
  assert.equal(git(worktree.path, "status", "--porcelain").trim(), "");
  assert.equal(git(repo, "log", "-1", "--format=%an").trim(), "Teste");
  assert.equal(git(repo, "stash", "list").trim(), "");
});

test("trazer: a prévia não muda nada na pasta do usuário nem na cópia, mesmo com a cópia suja", async (context) => {
  const { repo, db, project, options } = await setup(context);
  const worktree = await createWorktree(db, project.id, options);
  await commitInCopy(worktree.path, "novo.txt", "novo\n");
  await writeFile(path.join(worktree.path, "a.txt"), "sujo\n");
  await writeFile(path.join(worktree.path, "solto.txt"), "solto\n");
  git(worktree.path, "add", "solto.txt"); // parte no index, parte fora
  await writeFile(path.join(worktree.path, "outro.txt"), "outro\n");
  // Um conflito também só lê.
  await writeFile(path.join(repo, "a.txt"), "do usuário\n");
  git(repo, "commit", "-q", "-am", "usuário mexe em a");

  const before = { repo: await fingerprint(repo), copy: await fingerprint(worktree.path) };
  const preview = await worktreeMergePreview(db, worktree.id);
  assert.equal(preview.blocked, null);
  assert.deepEqual(preview.conflicts, ["a.txt"]);
  assert.equal(preview.uncommittedFiles, 3);
  const after = { repo: await fingerprint(repo), copy: await fingerprint(worktree.path) };
  assert.deepEqual(after, before);
  assert.equal(git(repo, "stash", "list").trim(), "");
  assert.equal(git(worktree.path, "stash", "list").trim(), "");
});

test("trazer: conflito aparece na prévia, o merge recusa e nada muda", async (context) => {
  for (const dirty of [false, true]) {
    const { repo, db, project, options } = await setup(context);
    const worktree = await createWorktree(db, project.id, options);
    await commitInCopy(worktree.path, "b.txt", "b\n");
    if (dirty) await writeFile(path.join(worktree.path, "a.txt"), "da cópia\n");
    else await commitInCopy(worktree.path, "a.txt", "da cópia\n");
    await writeFile(path.join(repo, "a.txt"), "do usuário\n");
    git(repo, "commit", "-q", "-am", "usuário mexe em a");

    const preview = await worktreeMergePreview(db, worktree.id);
    assert.equal(preview.blocked, null);
    assert.deepEqual(preview.conflicts, ["a.txt"]);

    const before = { repo: await fingerprint(repo), copy: await fingerprint(worktree.path) };
    await assert.rejects(
      mergeWorktree(db, worktree.id),
      (error) =>
        error instanceof ServiceError &&
        error.code === "invalid_request" &&
        /conflito em 1 arquivo/.test(error.message) &&
        /a\.txt/.test(error.message) &&
        /não resolve conflitos sozinho/.test(error.message),
    );
    assert.deepEqual(
      { repo: await fingerprint(repo), copy: await fingerprint(worktree.path) },
      before,
    );
    assert.equal(await exists(path.join(repo, ".git", "MERGE_HEAD")), false);
    assert.equal(await readFile(path.join(repo, "a.txt"), "utf8"), "do usuário\n");
    assert.equal(getWorktree(db, worktree.id)?.mergedAt, null);
  }
});

test("trazer: cada bloqueio da prévia, sem criar stash", async (context) => {
  // missing
  {
    const { repo, db, project, options } = await setup(context);
    const worktree = await createWorktree(db, project.id, options);
    await rm(worktree.path, { recursive: true, force: true });
    const preview = await worktreeMergePreview(db, worktree.id);
    assert.equal(preview.blocked, "missing");
    await assert.rejects(mergeWorktree(db, worktree.id), ServiceError);
    assert.equal(git(repo, "stash", "list").trim(), "");
  }
  // busy e target-busy
  {
    const { repo, db, project, options } = await setup(context);
    const worktree = await createWorktree(db, project.id, options);
    await commitInCopy(worktree.path, "n.txt", "n\n");
    const busyCopy = createConversation(db, {
      agent: "claude",
      title: "c",
      cwd: worktree.path,
      mode: "edit",
      worktreeId: worktree.id,
    });
    db.prepare("UPDATE conversations SET state='working' WHERE id=?").run(busyCopy.id);
    assert.equal((await worktreeMergePreview(db, worktree.id)).blocked, "busy");
    db.prepare("UPDATE conversations SET state='idle' WHERE id=?").run(busyCopy.id);
    assert.equal((await worktreeMergePreview(db, worktree.id)).blocked, null);

    await mkdir(path.join(repo, "sub"));
    for (const cwd of [repo, path.join(repo, "sub")]) {
      for (const state of ["queued", "working", "waiting"]) {
        const other = createConversation(db, { agent: "claude", title: "o", cwd, mode: "edit" });
        db.prepare("UPDATE conversations SET state=? WHERE id=?").run(state, other.id);
        const preview = await worktreeMergePreview(db, worktree.id);
        assert.equal(preview.blocked, "target-busy", `${cwd} ${state}`);
        await assert.rejects(mergeWorktree(db, worktree.id), /conversa trabalhando/);
        db.prepare("DELETE FROM conversations WHERE id=?").run(other.id);
      }
    }
    assert.equal(git(repo, "stash", "list").trim(), "");
  }
  // detached
  {
    const { repo, db, project, options } = await setup(context);
    const worktree = await createWorktree(db, project.id, options);
    await commitInCopy(worktree.path, "n.txt", "n\n");
    git(repo, "checkout", "-q", "--detach");
    const preview = await worktreeMergePreview(db, worktree.id);
    assert.equal(preview.blocked, "detached");
    assert.equal(preview.targetBranch, null);
    await assert.rejects(mergeWorktree(db, worktree.id), /nenhuma branch/);
    assert.equal(git(repo, "stash", "list").trim(), "");
  }
  // target-dirty (com os arquivos); arquivo não rastreado não bloqueia
  {
    const { repo, db, project, options } = await setup(context);
    const worktree = await createWorktree(db, project.id, options);
    await commitInCopy(worktree.path, "n.txt", "n\n");
    await writeFile(path.join(repo, "solto.txt"), "solto\n");
    assert.equal((await worktreeMergePreview(db, worktree.id)).blocked, null);
    await writeFile(path.join(repo, "a.txt"), "mexido\n");
    const before = await fingerprint(repo);
    const preview = await worktreeMergePreview(db, worktree.id);
    assert.equal(preview.blocked, "target-dirty");
    assert.equal(preview.targetBranch, "main");
    assert.deepEqual(preview.targetDirtyFiles, ["a.txt"]);
    await assert.rejects(
      mergeWorktree(db, worktree.id),
      (error) =>
        error instanceof ServiceError &&
        error.code === "invalid_request" &&
        error.message.startsWith("A branch main tem alterações não salvas") &&
        /Salve ou descarte antes de trazer/.test(error.message),
    );
    assert.deepEqual(await fingerprint(repo), before);
  }
  // target-merging
  {
    const { repo, db, project, options } = await setup(context);
    const worktree = await createWorktree(db, project.id, options);
    await commitInCopy(worktree.path, "n.txt", "n\n");
    await writeFile(
      path.join(repo, ".git", "MERGE_HEAD"),
      `${git(repo, "rev-parse", "HEAD").trim()}\n`,
    );
    const preview = await worktreeMergePreview(db, worktree.id);
    assert.equal(preview.blocked, "target-merging");
    await assert.rejects(mergeWorktree(db, worktree.id), /meio de um merge/);
    assert.equal(git(repo, "stash", "list").trim(), "");
  }
  // nothing
  {
    const { repo, db, project, options } = await setup(context);
    const worktree = await createWorktree(db, project.id, options);
    const preview = await worktreeMergePreview(db, worktree.id);
    assert.equal(preview.blocked, "nothing");
    assert.equal(preview.commits, 0);
    await assert.rejects(mergeWorktree(db, worktree.id), /nada novo/);
    assert.equal(git(repo, "stash", "list").trim(), "");
    assert.equal(getWorktree(db, worktree.id)?.mergedAt, null);
  }
});

test("trazer: arquivo não rastreado no destino que seria sobrescrito faz o merge falhar sem sujar nada", async (context) => {
  const { repo, db, project, options } = await setup(context);
  const worktree = await createWorktree(db, project.id, options);
  await commitInCopy(worktree.path, "novo.txt", "da cópia\n");
  await writeFile(path.join(repo, "novo.txt"), "meu rascunho\n");
  const headBefore = git(repo, "rev-parse", "HEAD").trim();

  const preview = await worktreeMergePreview(db, worktree.id);
  assert.equal(preview.blocked, null);
  await assert.rejects(
    mergeWorktree(db, worktree.id),
    (error) =>
      error instanceof ServiceError &&
      error.code === "invalid_request" &&
      /sobrescritos/.test(error.message) &&
      /novo\.txt/.test(error.message),
  );
  assert.equal(git(repo, "rev-parse", "HEAD").trim(), headBefore);
  assert.equal(await exists(path.join(repo, ".git", "MERGE_HEAD")), false);
  assert.equal(await readFile(path.join(repo, "novo.txt"), "utf8"), "meu rascunho\n");
  assert.equal(git(repo, "status", "--porcelain").trim(), "?? novo.txt");
  assert.equal(git(repo, "stash", "list").trim(), "");
  assert.equal(getWorktree(db, worktree.id)?.mergedAt, null);
});

test("trazer: funciona sem user.name/user.email e com pre-commit que falha", async (context) => {
  const { repo, root, db, project, options } = await setup(context);
  const worktree = await createWorktree(db, project.id, options);
  // Os dois lados andam, para o merge precisar de commit próprio.
  await writeFile(path.join(repo, "do-usuario.txt"), "u\n");
  git(repo, "add", "-A");
  git(repo, "commit", "-q", "-m", "usuário anda");
  await commitInCopy(worktree.path, "na-copia.txt", "c\n");
  await writeFile(path.join(worktree.path, "suja.txt"), "suja\n");
  for (const hook of ["pre-commit", "commit-msg", "pre-merge-commit"]) {
    const file = path.join(repo, ".git", "hooks", hook);
    await mkdir(path.dirname(file), { recursive: true });
    await writeFile(file, "#!/bin/sh\nexit 1\n");
    await chmod(file, 0o755);
  }
  git(repo, "config", "--unset", "user.name");
  git(repo, "config", "--unset", "user.email");

  const emptyHome = await mkdtemp(path.join(root, "home-"));
  const saved = {
    HOME: process.env.HOME,
    XDG_CONFIG_HOME: process.env.XDG_CONFIG_HOME,
    GIT_CONFIG_NOSYSTEM: process.env.GIT_CONFIG_NOSYSTEM,
    GIT_CONFIG_GLOBAL: process.env.GIT_CONFIG_GLOBAL,
  };
  process.env.HOME = emptyHome;
  process.env.XDG_CONFIG_HOME = emptyHome;
  process.env.GIT_CONFIG_NOSYSTEM = "1";
  delete process.env.GIT_CONFIG_GLOBAL;
  assert.throws(() => git(repo, "config", "--get", "user.email"), "sem identidade configurada");
  try {
    await mergeWorktree(db, worktree.id);
    assert.equal(await readFile(path.join(repo, "na-copia.txt"), "utf8"), "c\n");
    assert.equal(await readFile(path.join(repo, "suja.txt"), "utf8"), "suja\n");
    assert.equal(git(repo, "log", "-1", "--format=%an <%ae>").trim(), "Karont <karont@localhost>");
    assert.equal(
      git(worktree.path, "log", "-1", "--format=%an <%ae> %s").trim(),
      "Karont <karont@localhost> karont: mudanças da cópia separada",
    );
  } finally {
    for (const [key, value] of Object.entries(saved)) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
  }
});

test("trazer: nomes com espaço e acento", async (context) => {
  const { repo, db, project, options } = await setup(context, "meu projeto ação");
  const worktree = await createWorktree(db, project.id, options);
  await commitInCopy(worktree.path, "pasta com espaço/ação nova.txt", "ç\n");
  await writeFile(path.join(worktree.path, "a.txt"), "editado ã\n");
  await writeFile(path.join(worktree.path, "outro ñ.txt"), "x\n");
  const preview = await worktreeMergePreview(db, worktree.id);
  assert.equal(preview.blocked, null);
  assert.equal(preview.uncommittedFiles, 2);
  assert.equal(preview.changedFiles, 3);
  await mergeWorktree(db, worktree.id);
  assert.equal(await readFile(path.join(repo, "pasta com espaço", "ação nova.txt"), "utf8"), "ç\n");
  assert.equal(await readFile(path.join(repo, "outro ñ.txt"), "utf8"), "x\n");

  // Conflito com nome acentuado vem inteiro, sem aspas nem escapes.
  const second = await createWorktree(db, project.id, options);
  await commitInCopy(second.path, "pasta com espaço/ação nova.txt", "da cópia\n");
  await writeFile(path.join(repo, "pasta com espaço", "ação nova.txt"), "do usuário\n");
  git(repo, "commit", "-q", "-am", "usuário");
  const conflict = await worktreeMergePreview(db, second.id);
  assert.deepEqual(conflict.conflicts, ["pasta com espaço/ação nova.txt"]);
});

test("trazer: dois pedidos simultâneos, só um passa", async (context) => {
  const { repo, db, project, options } = await setup(context);
  const first = await createWorktree(db, project.id, options);
  const second = await createWorktree(db, project.id, options);
  await commitInCopy(first.path, "um.txt", "1\n");
  await commitInCopy(second.path, "dois.txt", "2\n");
  const third = await createWorktree(db, project.id, options);
  await commitInCopy(third.path, "tres.txt", "3\n");

  for (const ids of [
    [first.id, first.id],
    [second.id, third.id],
  ]) {
    const results = await Promise.allSettled(ids.map((id) => mergeWorktree(db, id)));
    const ok = results.filter((result) => result.status === "fulfilled");
    const failed = results.filter((result) => result.status === "rejected");
    assert.equal(ok.length, 1, ids.join());
    assert.equal(failed.length, 1);
    assert.match(String((failed[0] as PromiseRejectedResult).reason.message), /sendo trazida/);
  }
  // A trava solta: quem sobrou agora passa.
  const left = getWorktree(db, third.id)?.mergedAt === null ? third.id : second.id;
  await mergeWorktree(db, left);
  for (const [file, content] of [
    ["um.txt", "1\n"],
    ["dois.txt", "2\n"],
    ["tres.txt", "3\n"],
  ] as const) {
    assert.equal(await readFile(path.join(repo, file), "utf8"), content);
  }
  assert.equal(git(repo, "status", "--porcelain").trim(), "");
  assert.equal(await exists(path.join(repo, ".git", "MERGE_HEAD")), false);
});
