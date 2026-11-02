import assert from "node:assert/strict";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { test } from "node:test";
import { ComposerFileSearch } from "./composer-files.ts";

test("busca Git usa arquivos rastreados e não rastreados sem os ignorados", async () => {
  const cwd = await mkdtemp(path.join(os.tmpdir(), "karont-composer-git-"));
  try {
    const search = new ComposerFileSearch(Date.now, async (gitCwd) => {
      assert.equal(gitCwd, cwd);
      return [
        "README.md",
        ".tracked-hidden",
        ".gitignore",
        "src/alpha-file.ts",
        "src/ab-c.ts",
        "abc-folder/file.ts",
      ];
    });
    const results = await search.search(cwd, "alpha");
    assert.deepEqual(results, [{ path: "src/alpha-file.ts", name: "alpha-file.ts" }]);
    const all = await search.search(cwd, "");
    assert.ok(all.some((file) => file.path === ".tracked-hidden"));
    assert.ok(all.some((file) => file.path === "README.md"));
    assert.ok(!all.some((file) => file.path === "ignored.log"));
    assert.deepEqual(
      (await search.search(cwd, "abc")).slice(0, 2).map((file) => file.path),
      ["src/ab-c.ts", "abc-folder/file.ts"],
    );
    assert.deepEqual(await search.search(cwd, "saf"), [
      { path: "src/alpha-file.ts", name: "alpha-file.ts" },
    ]);
  } finally {
    await rm(cwd, { recursive: true, force: true });
  }
});

test("varredura sem Git ignora ocultos e diretórios excluídos e limita a 50 resultados", async () => {
  const cwd = await mkdtemp(path.join(os.tmpdir(), "karont-composer-files-"));
  try {
    await mkdir(path.join(cwd, "src"), { recursive: true });
    await mkdir(path.join(cwd, ".hidden-dir"), { recursive: true });
    await mkdir(path.join(cwd, "node_modules", "pkg"), { recursive: true });
    await mkdir(path.join(cwd, "dist"), { recursive: true });
    await mkdir(path.join(cwd, "build"), { recursive: true });
    await writeFile(path.join(cwd, "src", "alpha-file.ts"), "Conteúdo");
    await writeFile(path.join(cwd, ".secret"), "Oculto");
    await writeFile(path.join(cwd, ".hidden-dir", "secret.ts"), "Oculto");
    await writeFile(path.join(cwd, "node_modules", "pkg", "ignored.ts"), "Ignorado");
    await writeFile(path.join(cwd, "dist", "ignored.ts"), "Ignorado");
    await writeFile(path.join(cwd, "build", "ignored.ts"), "Ignorado");
    await Promise.all(
      Array.from({ length: 60 }, (_, index) =>
        writeFile(path.join(cwd, `report-${index}.txt`), "Relatório"),
      ),
    );

    const search = new ComposerFileSearch(Date.now, async () => null);
    const matches = await search.search(cwd, "alpha");
    assert.deepEqual(matches, [{ path: "src/alpha-file.ts", name: "alpha-file.ts" }]);
    const reports = await search.search(cwd, "report");
    assert.equal(reports.length, 50);
    const secrets = await search.search(cwd, "secret");
    assert.deepEqual(secrets, []);
    const ignored = await search.search(cwd, "ignored");
    assert.deepEqual(ignored, []);
  } finally {
    await rm(cwd, { recursive: true, force: true });
  }
});

test("cache do índice expira por idade sem polling", async () => {
  const cwd = await mkdtemp(path.join(os.tmpdir(), "karont-composer-cache-"));
  try {
    let now = 0;
    await writeFile(path.join(cwd, "antes.txt"), "antes");
    const search = new ComposerFileSearch(
      () => now,
      async () => null,
    );
    assert.deepEqual(await search.search(cwd, ""), [{ path: "antes.txt", name: "antes.txt" }]);
    await writeFile(path.join(cwd, "depois.txt"), "depois");
    assert.equal((await search.search(cwd, "")).length, 1);
    now = 10_001;
    assert.equal((await search.search(cwd, "")).length, 2);
  } finally {
    await rm(cwd, { recursive: true, force: true });
  }
});
