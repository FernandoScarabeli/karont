import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdir, mkdtemp, realpath, symlink, unlink, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { test } from "node:test";
import {
  createSnapshot,
  deleteRestoreRefs,
  resolveRepository,
  restoreRef,
  takeRestorePoint,
  writeRestoreRef,
} from "./restore-points.ts";

const GIT_VARIABLES = [
  "GIT_DIR",
  "GIT_WORK_TREE",
  "GIT_INDEX_FILE",
  "GIT_PREFIX",
  "GIT_COMMON_DIR",
  "GIT_OBJECT_DIRECTORY",
];

function git(cwd: string, ...args: string[]): string {
  const env = { ...process.env };
  for (const name of GIT_VARIABLES) delete env[name];
  return execFileSync("git", args, { cwd, env, encoding: "utf8" });
}

async function tempDir(prefix: string): Promise<string> {
  return realpath(await mkdtemp(path.join(os.tmpdir(), prefix)));
}

async function createRepo(withCommit = true): Promise<string> {
  const root = await tempDir("karont-git-");
  git(root, "init", "-q", "-b", "main");
  git(root, "config", "user.name", "Teste");
  git(root, "config", "user.email", "teste@example.com");
  if (withCommit) {
    await writeFile(path.join(root, ".gitignore"), "ignorado.log\n");
    await writeFile(path.join(root, "mantido.txt"), "mantido\n");
    await writeFile(path.join(root, "apagado.txt"), "apagado\n");
    await writeFile(path.join(root, "renomeado.txt"), "conteudo para renomear\n");
    await writeFile(path.join(root, "modificado.txt"), "original\n");
    git(root, "add", "-A");
    git(root, "commit", "-q", "-m", "inicial");
  }
  return root;
}

const signal = () => new AbortController().signal;

function observable(root: string) {
  return {
    status: git(root, "status", "--porcelain"),
    stash: git(root, "stash", "list"),
    head: git(root, "rev-parse", "HEAD"),
    heads: git(root, "for-each-ref", "refs/heads"),
    index: git(root, "ls-files", "--stage"),
  };
}

test("foto tem o conteúdo certo e não mexe em status, stash, HEAD, branches nem index", async () => {
  const root = await createRepo();
  // Um stash anterior precisa continuar exatamente igual.
  await writeFile(path.join(root, "modificado.txt"), "guardado no stash\n");
  git(root, "stash", "push", "-q", "-m", "do usuário");

  await writeFile(path.join(root, "modificado.txt"), "alterado pelo agente\n");
  await unlink(path.join(root, "apagado.txt"));
  git(root, "mv", "renomeado.txt", "novo-nome.txt");
  await writeFile(path.join(root, "novo.txt"), "arquivo novo\n");
  await writeFile(path.join(root, "ignorado.log"), "não entra\n");
  await mkdir(path.join(root, "sub"));
  await writeFile(path.join(root, "sub", "fundo.txt"), "no fundo\n");

  const before = observable(root);
  const result = await createSnapshot(root, signal(), 10_000);
  assert.ok("commit" in result, JSON.stringify(result));
  assert.equal(result.head, before.head.trim());

  const files = git(root, "ls-tree", "-r", "--name-only", result.commit)
    .split("\n")
    .filter(Boolean);
  assert.deepEqual(files.sort(), [
    ".gitignore",
    "mantido.txt",
    "modificado.txt",
    "novo-nome.txt",
    "novo.txt",
    "sub/fundo.txt",
  ]);
  assert.equal(git(root, "show", `${result.commit}:modificado.txt`), "alterado pelo agente\n");
  assert.equal(git(root, "show", `${result.commit}:novo-nome.txt`), "conteudo para renomear\n");
  assert.equal(git(root, "rev-list", "--parents", "-n", "1", result.commit).trim(), result.commit);
  assert.equal(
    git(root, "log", "-1", "--format=%an <%ae>|%s", result.commit).trim(),
    "Karont <karont@localhost>|karont: ponto de restauração",
  );

  assert.deepEqual(observable(root), before);
});

test("repositório sem commits funciona e devolve head nulo", async () => {
  const root = await createRepo(false);
  await writeFile(path.join(root, "primeiro.txt"), "oi\n");
  const result = await createSnapshot(root, signal(), 10_000);
  assert.ok("commit" in result, JSON.stringify(result));
  assert.equal(result.head, null);
  assert.equal(git(root, "ls-tree", "-r", "--name-only", result.commit).trim(), "primeiro.txt");
  assert.equal(git(root, "status", "--porcelain").trim(), "?? primeiro.txt");
});

test("cwd numa subpasta fotografa a raiz inteira", async () => {
  const root = await createRepo();
  await mkdir(path.join(root, "a", "b"), { recursive: true });
  await writeFile(path.join(root, "fora.txt"), "na raiz\n");
  const resolved = await resolveRepository(path.join(root, "a", "b"), os.homedir());
  assert.deepEqual(resolved, { root });
  const snapshot = await createSnapshot(root, signal(), 10_000);
  assert.ok("commit" in snapshot);
  assert.match(git(root, "ls-tree", "-r", "--name-only", snapshot.commit), /fora\.txt/);
});

test("worktree Git funciona, mesmo com GIT_DIR e GIT_INDEX_FILE herdados", async () => {
  const root = await createRepo();
  const worktree = path.join(await tempDir("karont-wt-"), "wt");
  git(root, "worktree", "add", "-q", "-b", "outra", worktree);
  await writeFile(path.join(worktree, "so-na-worktree.txt"), "wt\n");
  const saved = {
    GIT_DIR: process.env.GIT_DIR,
    GIT_INDEX_FILE: process.env.GIT_INDEX_FILE,
    GIT_WORK_TREE: process.env.GIT_WORK_TREE,
  };
  process.env.GIT_DIR = path.join(root, "nao-existe", ".git");
  process.env.GIT_INDEX_FILE = path.join(root, "index-invalido");
  process.env.GIT_WORK_TREE = root;
  try {
    const resolved = await resolveRepository(worktree, os.homedir());
    assert.deepEqual(resolved, { root: await realpath(worktree) });
    const snapshot = await createSnapshot(await realpath(worktree), signal(), 10_000);
    assert.ok("commit" in snapshot, JSON.stringify(snapshot));
    const files = git(worktree, "ls-tree", "-r", "--name-only", snapshot.commit);
    assert.match(files, /so-na-worktree\.txt/);
    assert.match(files, /mantido\.txt/);
  } finally {
    for (const [name, value] of Object.entries(saved)) {
      if (value === undefined) delete process.env[name];
      else process.env[name] = value;
    }
  }
});

test("resolveRepository: sem Git é no-git; raiz na pasta pessoal é home, até por link simbólico", async () => {
  const empty = await tempDir("karont-nogit-");
  assert.deepEqual(await resolveRepository(empty, os.homedir()), { unavailable: "no-git" });
  assert.deepEqual(await resolveRepository(path.join(empty, "nao-existe"), os.homedir()), {
    unavailable: "no-git",
  });

  const root = await createRepo();
  assert.deepEqual(await resolveRepository(root, root), { unavailable: "home" });
  const link = path.join(await tempDir("karont-link-"), "casa");
  await symlink(root, link);
  assert.deepEqual(await resolveRepository(root, link), { unavailable: "home" });
  assert.deepEqual(await resolveRepository(root, await tempDir("karont-outra-")), { root });
});

test("createSnapshot: sinal já abortado e prazo curto viram unavailable, sem exceção", async () => {
  const root = await createRepo();
  const controller = new AbortController();
  controller.abort();
  assert.deepEqual(await createSnapshot(root, controller.signal, 10_000), {
    unavailable: "failed",
  });
  assert.deepEqual(await createSnapshot(root, signal(), 1), { unavailable: "timeout" });
  assert.deepEqual(await createSnapshot(path.join(root, "nao-existe"), signal(), 5_000), {
    unavailable: "failed",
  });
});

test("writeRestoreRef e deleteRestoreRefs: grava, apaga várias de uma vez e ignora as que não existem", async () => {
  const root = await createRepo();
  const snapshot = await createSnapshot(root, signal(), 10_000);
  assert.ok("commit" in snapshot);
  const refs = ["c1", "c2"].flatMap((conversation) =>
    (["before", "after"] as const).map((phase) => restoreRef(conversation, "m1", phase)),
  );
  for (const ref of refs)
    assert.deepEqual(await writeRestoreRef(root, ref, snapshot.commit, signal()), { ok: true });
  assert.equal(git(root, "for-each-ref", "refs/karont").split("\n").filter(Boolean).length, 4);
  assert.deepEqual(await writeRestoreRef(root, "refs/heads/main", snapshot.commit, signal()), {
    unavailable: "failed",
  });

  assert.equal(
    await deleteRestoreRefs(root, [...refs.slice(0, 2), restoreRef("c9", "inexistente", "before")]),
    true,
  );
  const left = git(root, "for-each-ref", "--format=%(refname)", "refs/karont")
    .split("\n")
    .filter(Boolean);
  assert.deepEqual(left, refs.slice(2).sort());
  assert.equal(await deleteRestoreRefs(path.join(root, "apagada"), refs), false);
});

test("takeRestorePoint: foto completa grava a ref e devolve raiz, commit e head", async () => {
  const root = await createRepo();
  await writeFile(path.join(root, "novo.txt"), "x\n");
  const outcome = await takeRestorePoint({
    phase: "before",
    cwd: root,
    repoRoot: null,
    homeDir: os.homedir(),
    conversationId: "conv",
    messageId: "msg",
    signal: signal(),
    timeoutMs: 10_000,
  });
  assert.ok("commit" in outcome, JSON.stringify(outcome));
  assert.equal(outcome.repoRoot, root);
  assert.equal(git(root, "rev-parse", restoreRef("conv", "msg", "before")).trim(), outcome.commit);
});
