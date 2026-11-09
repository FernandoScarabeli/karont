import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import {
  mkdir,
  mkdtemp,
  readFile,
  realpath,
  rename,
  rm,
  stat,
  symlink,
  writeFile,
} from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { test } from "node:test";
import {
  applyUndo,
  countRestoreChanges,
  listRestoreChanges,
  MAX_PATCH_BYTES,
  previewUndo,
  RestoreError,
  readRestorePatch,
  saveUndoSafety,
} from "./restore-diff.ts";
import { deleteRestoreRefs, restoreRefs, takeRestorePoint, undoRef } from "./restore-points.ts";

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

async function createRepo(): Promise<string> {
  const root = await tempDir("karont-diff-");
  git(root, "init", "-q", "-b", "main");
  git(root, "config", "user.name", "Teste");
  git(root, "config", "user.email", "teste@example.com");
  git(root, "config", "commit.gpgsign", "false");
  await writeFile(path.join(root, ".gitignore"), "ignorado.log\n");
  await writeFile(path.join(root, "mantido.txt"), "mantido\n");
  await writeFile(path.join(root, "apagado.txt"), "apagado\n");
  await writeFile(path.join(root, "renomeado.txt"), "conteudo para renomear, longo o bastante\n");
  await writeFile(path.join(root, "modificado.txt"), "original\n");
  await writeFile(path.join(root, "com espaço.txt"), "com espaço original\n");
  await writeFile(path.join(root, "açaí.txt"), "açaí original\n");
  await writeFile(path.join(root, "estrela*.txt"), "estrela original\n");
  await writeFile(path.join(root, "binario.bin"), Buffer.from([0, 1, 2, 3, 0, 255]));
  git(root, "add", "-A");
  git(root, "commit", "-q", "-m", "inicial");
  return root;
}

const signal = () => new AbortController().signal;
const ids = { conversationId: "conv-1", messageId: "msg-1" };

function observable(root: string) {
  return {
    stash: git(root, "stash", "list"),
    head: git(root, "rev-parse", "HEAD"),
    heads: git(root, "for-each-ref", "refs/heads"),
    index: git(root, "ls-files", "--stage"),
  };
}

type Point = typeof ids & { root: string; before: string; after: string };

async function snapshot(root: string, phase: "before" | "after"): Promise<string> {
  const result = await takeRestorePoint({
    phase,
    cwd: root,
    repoRoot: root,
    homeDir: "/nao-existe",
    ...ids,
    signal: signal(),
    timeoutMs: 20_000,
  });
  assert.ok("commit" in result, JSON.stringify(result));
  return result.commit;
}

async function turn(root: string, agent: () => Promise<void>): Promise<Point> {
  const before = await snapshot(root, "before");
  await agent();
  const after = await snapshot(root, "after");
  return { ...ids, root, before, after };
}

async function exists(file: string): Promise<boolean> {
  return stat(file).then(
    () => true,
    () => false,
  );
}

async function agentTurn(root: string): Promise<void> {
  const at = (name: string) => path.join(root, name);
  await rm(at("apagado.txt"));
  await rename(at("renomeado.txt"), at("novo nome.txt"));
  await writeFile(at("modificado.txt"), "alterado pelo agente\n");
  await writeFile(at("com espaço.txt"), "com espaço alterado\n");
  await writeFile(at("açaí.txt"), "açaí alterado\n");
  await writeFile(at("estrela*.txt"), "estrela alterada\n");
  await writeFile(at("criado.txt"), "criado\n");
  await writeFile(at("criado *.txt"), "criado com estrela\n");
  await mkdir(at("novo/fundo/mais"), { recursive: true });
  await writeFile(at("novo/fundo/mais/dentro.txt"), "dentro\n");
  await writeFile(at("novo/fundo/irmao.txt"), "irmão\n");
  await writeFile(at("binario.bin"), Buffer.from([9, 0, 8, 0, 7]));
  await writeFile(at("ignorado.log"), "ignorado\n");
}

test("lista, patch, prévia e desfazer em repositório real com nomes difíceis", async () => {
  const root = await createRepo();
  await writeFile(path.join(root, "modificado.txt"), "guardado no stash\n");
  git(root, "stash", "push", "-q", "-m", "do usuário");
  // Uma mudança do usuário que já estava no index e outra fora dele antes do turno.
  await writeFile(path.join(root, "mantido.txt"), "mantido, staged\n");
  git(root, "add", "mantido.txt");
  await writeFile(path.join(root, "solto-do-usuario.txt"), "solto\n");

  const originals = new Map<string, Buffer>();
  for (const name of [
    "apagado.txt",
    "renomeado.txt",
    "modificado.txt",
    "com espaço.txt",
    "açaí.txt",
    "estrela*.txt",
    "binario.bin",
    "mantido.txt",
    "solto-do-usuario.txt",
  ]) {
    originals.set(name, await readFile(path.join(root, name)));
  }
  const statusBefore = git(root, "status", "--porcelain");

  const point = await turn(root, () => agentTurn(root));

  const changes = await listRestoreChanges(root, point, signal());
  assert.equal(changes.truncated, false);
  const byPath = new Map(changes.files.map((file) => [file.path, file]));
  assert.deepEqual([...byPath.keys()].sort(), [
    "apagado.txt",
    "açaí.txt",
    "binario.bin",
    "com espaço.txt",
    "criado *.txt",
    "criado.txt",
    "estrela*.txt",
    "modificado.txt",
    "novo nome.txt",
    "novo/fundo/irmao.txt",
    "novo/fundo/mais/dentro.txt",
  ]);
  assert.equal(byPath.get("apagado.txt")?.status, "deleted");
  assert.equal(byPath.get("criado.txt")?.status, "added");
  assert.equal(byPath.get("modificado.txt")?.status, "modified");
  assert.deepEqual(
    { ...byPath.get("novo nome.txt") },
    {
      path: "novo nome.txt",
      oldPath: "renomeado.txt",
      status: "renamed",
      additions: 0,
      deletions: 0,
      binary: false,
    },
  );
  assert.deepEqual(
    { ...byPath.get("modificado.txt") },
    {
      path: "modificado.txt",
      status: "modified",
      additions: 1,
      deletions: 1,
      binary: false,
    },
  );
  const binary = byPath.get("binario.bin");
  assert.equal(binary?.binary, true);
  assert.equal(binary?.additions, null);
  assert.equal(binary?.deletions, null);
  assert.equal(byPath.has("ignorado.log"), false);
  assert.equal(await countRestoreChanges(root, point.before, point.after, signal()), 11);

  const patch = await readRestorePatch(root, point, "açaí.txt", signal());
  assert.equal(patch.binary, false);
  assert.equal(patch.truncated, false);
  assert.match(patch.patch, /^diff --git a\/açaí\.txt b\/açaí\.txt/m);
  assert.match(patch.patch, /^-açaí original$/m);
  assert.match(patch.patch, /^\+açaí alterado$/m);
  const star = await readRestorePatch(root, point, "estrela*.txt", signal());
  assert.match(star.patch, /^\+estrela alterada$/m);
  assert.doesNotMatch(star.patch, /mantido/);
  const renamed = await readRestorePatch(root, point, "novo nome.txt", signal());
  assert.match(renamed.patch, /rename from renomeado\.txt/);
  assert.equal((await readRestorePatch(root, point, "binario.bin", signal())).binary, true);
  await assert.rejects(
    readRestorePatch(root, point, "mantido.txt", signal()),
    (error: unknown) => error instanceof RestoreError && error.kind === "not-in-list",
  );
  await assert.rejects(
    readRestorePatch(root, point, "*.txt", signal()),
    (error: unknown) => error instanceof RestoreError && error.kind === "not-in-list",
  );

  const afterTurn = observable(root);
  const preview = await previewUndo(root, point, signal());
  assert.equal(preview.files, 11 + 1); // o renomeado conta como remoção do novo e volta do antigo
  assert.deepEqual(preview.userChanged, []);
  assert.deepEqual(preview.submodulesSkipped, []);
  assert.deepEqual(observable(root), afterTurn);

  const safety = await saveUndoSafety(root, point, signal());
  assert.equal(git(root, "rev-parse", undoRef(ids.conversationId, ids.messageId)).trim(), safety);
  const outcome = await applyUndo(root, point, signal());
  assert.equal(outcome.removed, 5);
  assert.equal(outcome.restored, 7);

  for (const [name, content] of originals) {
    assert.deepEqual(await readFile(path.join(root, name)), content, name);
  }
  assert.equal(await exists(path.join(root, "criado.txt")), false);
  assert.equal(await exists(path.join(root, "criado *.txt")), false);
  assert.equal(await exists(path.join(root, "novo nome.txt")), false);
  assert.equal(await exists(path.join(root, "novo")), false);
  assert.equal(await exists(path.join(root, ".git")), true);
  assert.deepEqual(observable(root), afterTurn);
  // O ignorado.log fica como o agente deixou: o Karont não promete mexer nele.
  assert.equal(git(root, "status", "--porcelain"), statusBefore);
  assert.equal(git(root, "stash", "list").includes("do usuário"), true);
});

test("o que o usuário mexeu depois aparece em userChanged e fica na ref de segurança", async () => {
  const root = await createRepo();
  const point = await turn(root, async () => {
    await writeFile(path.join(root, "modificado.txt"), "do agente\n");
    await writeFile(path.join(root, "mantido.txt"), "também do agente\n");
    await writeFile(path.join(root, "criado.txt"), "criado\n");
  });
  await writeFile(path.join(root, "modificado.txt"), "do usuário depois\n");
  await rm(path.join(root, "criado.txt"));
  await writeFile(path.join(root, "outro.txt"), "nada a ver\n");

  const preview = await previewUndo(root, point, signal());
  assert.deepEqual(preview.userChanged.sort(), ["criado.txt", "modificado.txt"]);
  assert.equal(preview.files, 3);

  await saveUndoSafety(root, point, signal());
  await applyUndo(root, point, signal());
  assert.equal(await readFile(path.join(root, "modificado.txt"), "utf8"), "original\n");
  assert.equal(await readFile(path.join(root, "mantido.txt"), "utf8"), "mantido\n");
  assert.equal(await readFile(path.join(root, "outro.txt"), "utf8"), "nada a ver\n");
  const ref = undoRef(ids.conversationId, ids.messageId);
  assert.equal(git(root, "show", `${ref}:modificado.txt`), "do usuário depois\n");
  assert.equal(git(root, "show", `${ref}:outro.txt`), "nada a ver\n");
});

test("agente que fez commit: arquivos voltam e o commit continua na branch", async () => {
  const root = await createRepo();
  const point = await turn(root, async () => {
    await writeFile(path.join(root, "modificado.txt"), "commitado pelo agente\n");
    await writeFile(path.join(root, "novo.txt"), "novo\n");
    git(root, "add", "-A");
    git(root, "commit", "-q", "-m", "do agente");
  });
  const head = git(root, "rev-parse", "HEAD");
  await saveUndoSafety(root, point, signal());
  await applyUndo(root, point, signal());
  assert.equal(await readFile(path.join(root, "modificado.txt"), "utf8"), "original\n");
  assert.equal(await exists(path.join(root, "novo.txt")), false);
  assert.equal(git(root, "rev-parse", "HEAD"), head);
  assert.match(git(root, "log", "--format=%s", "main"), /do agente/);
  assert.equal(git(root, "ls-files", "novo.txt").trim(), "novo.txt");
});

test("link simbólico no caminho nunca leva a apagar fora da raiz", async () => {
  const root = await createRepo();
  const outside = await tempDir("karont-fora-");
  await writeFile(path.join(outside, "f.txt"), "de fora\n");
  await writeFile(path.join(outside, "alvo.txt"), "alvo do link\n");
  const point = await turn(root, async () => {
    await mkdir(path.join(root, "sub"));
    await writeFile(path.join(root, "sub", "f.txt"), "do agente\n");
    await symlink(path.join(outside, "alvo.txt"), path.join(root, "atalho.txt"));
  });
  // O usuário trocou a pasta por um link para fora da raiz.
  await rm(path.join(root, "sub"), { recursive: true });
  await symlink(outside, path.join(root, "sub"));

  await saveUndoSafety(root, point, signal());
  const outcome = await applyUndo(root, point, signal());
  assert.equal(await readFile(path.join(outside, "f.txt"), "utf8"), "de fora\n");
  assert.equal(await readFile(path.join(outside, "alvo.txt"), "utf8"), "alvo do link\n");
  assert.equal(await exists(path.join(root, "atalho.txt")), false);
  assert.equal(outcome.removed, 1);
});

test("submódulo vai para submodulesSkipped e fica fora do desfazer", async () => {
  const root = await createRepo();
  const point = await turn(root, async () => {
    const nested = path.join(root, "vendor", "lib");
    await mkdir(nested, { recursive: true });
    git(nested, "init", "-q", "-b", "main");
    git(nested, "config", "user.name", "Teste");
    git(nested, "config", "user.email", "teste@example.com");
    await writeFile(path.join(nested, "a.txt"), "a\n");
    git(nested, "add", "-A");
    git(nested, "commit", "-q", "-m", "lib");
    await writeFile(path.join(root, "modificado.txt"), "do agente\n");
  });
  const preview = await previewUndo(root, point, signal());
  assert.deepEqual(preview.submodulesSkipped, ["vendor/lib"]);
  assert.equal(preview.files, 1);
  await saveUndoSafety(root, point, signal());
  const outcome = await applyUndo(root, point, signal());
  assert.deepEqual(outcome, { restored: 1, removed: 0 });
  assert.equal(await exists(path.join(root, "vendor", "lib", "a.txt")), true);
});

test("patch grande é cortado em 256 KiB e muitos arquivos são truncados em 2000", async () => {
  const root = await createRepo();
  const big = Array.from({ length: 40_000 }, (_, index) => `linha ${index}`).join("\n");
  const point = await turn(root, async () => {
    await writeFile(path.join(root, "grande.txt"), big);
    await mkdir(path.join(root, "muitos"));
    await Promise.all(
      Array.from({ length: 2_005 }, (_, index) =>
        writeFile(path.join(root, "muitos", `f${index}.txt`), `${index}\n`),
      ),
    );
  });
  const patch = await readRestorePatch(root, point, "grande.txt", signal());
  assert.equal(patch.truncated, true);
  assert.ok(Buffer.byteLength(patch.patch) <= MAX_PATCH_BYTES);
  assert.ok(patch.patch.length > 1_000);
  const changes = await listRestoreChanges(root, point, signal());
  assert.equal(changes.files.length, 2_000);
  assert.equal(changes.truncated, true);
  assert.equal(await countRestoreChanges(root, point.before, point.after, signal()), 2_006);
});

test("ponto sem mudança tem lista vazia e ponto apagado vira 'não está mais disponível'", async () => {
  const root = await createRepo();
  const point = await turn(root, async () => undefined);
  assert.deepEqual(await listRestoreChanges(root, point, signal()), {
    files: [],
    truncated: false,
  });
  assert.equal(await countRestoreChanges(root, point.before, point.after, signal()), 0);

  assert.equal(await deleteRestoreRefs(root, restoreRefs(ids.conversationId, ids.messageId)), true);
  for (const call of [
    () => listRestoreChanges(root, point, signal()),
    () => readRestorePatch(root, point, "mantido.txt", signal()),
    () => previewUndo(root, point, signal()),
    () => saveUndoSafety(root, point, signal()),
    () => applyUndo(root, point, signal()),
  ]) {
    await assert.rejects(
      call(),
      (error: unknown) =>
        error instanceof RestoreError &&
        error.kind === "gone" &&
        error.message === "Este ponto de restauração não está mais disponível.",
    );
  }
});

test("sinal abortado interrompe a leitura", async () => {
  const root = await createRepo();
  const point = await turn(root, async () => undefined);
  const controller = new AbortController();
  controller.abort();
  await assert.rejects(
    listRestoreChanges(root, point, controller.signal),
    (error: unknown) => error instanceof RestoreError && error.kind === "aborted",
  );
});
