import assert from "node:assert/strict";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { test } from "node:test";
import { mapClaudeToolAction, mapCodexSpecialAction } from "./tool-actions.ts";

test("Claude 2.1.x nomeia o subagente como Agent e mostra o tipo antes do prompt", async () => {
  const agent = await mapClaudeToolAction("Agent", {
    subagent_type: "Explore",
    description: "Listar arquivos",
    prompt: "Liste os arquivos.",
  });
  assert.equal(agent.actionType, "subagent");
  assert.equal(agent.title, "Listar arquivos");
  assert.equal(agent.input, "Explore · Liste os arquivos.");
  assert.equal(agent.parentId, undefined);
});

test("Claude limita prompt e diff em bytes e mantém o JSON do diff válido", async () => {
  const task = await mapClaudeToolAction("Task", {
    description: "Revisar arquivos",
    prompt: "🙂".repeat(5_000),
  });
  assert.equal(Buffer.byteLength(task.input, "utf8") <= 8 * 1024, true);
  assert.equal(task.truncated, true);

  const edit = await mapClaudeToolAction(
    "Edit",
    {
      file_path: "src/modulo.ts",
      old_string: "linha antiga\n".repeat(12_000),
      new_string: "linha nova\n".repeat(12_000),
    },
    undefined,
    os.tmpdir(),
  );
  assert.equal(Buffer.byteLength(edit.output, "utf8") <= 64 * 1024, true);
  assert.equal(edit.truncated, true);
  assert.equal(JSON.parse(edit.output)[0]?.path, "src/modulo.ts");
});

test("Claude Edit usa números de linha reais e três linhas de contexto", async () => {
  await withTempDir(async (cwd) => {
    const original = Array.from({ length: 10 }, (_, index) => `linha ${index + 1}`).join("\n");
    await writeFile(path.join(cwd, "arquivo.txt"), original);
    const action = await mapClaudeToolAction(
      "Edit",
      { file_path: "arquivo.txt", old_string: "linha 5", new_string: "alterada" },
      undefined,
      cwd,
    );

    const diff = getFileChange(action.output).diff;
    assert.match(diff, /@@ -2,7 \+2,7 @@/);
    assert.match(
      diff,
      / linha 2\n linha 3\n linha 4\n-linha 5\n\+alterada\n linha 6\n linha 7\n linha 8/,
    );
    assert.doesNotMatch(diff, /@@ -1,/);
  });
});

test("Claude Edit com replace_all substitui todas as ocorrências", async () => {
  await withTempDir(async (cwd) => {
    await writeFile(path.join(cwd, "arquivo.txt"), "um\nmarcador\ntrês\nquatro\nmarcador\nseis");
    const action = await mapClaudeToolAction(
      "Edit",
      {
        file_path: "arquivo.txt",
        old_string: "marcador",
        new_string: "substituído",
        replace_all: true,
      },
      undefined,
      cwd,
    );

    const diff = getFileChange(action.output).diff;
    assert.match(diff, /@@ -1,6 \+1,6 @@/);
    assert.equal(diff.match(/-marcador/g)?.length, 2);
    assert.equal(diff.match(/\+substituído/g)?.length, 2);
  });
});

test("Claude MultiEdit aplica as edições na sequência em memória", async () => {
  await withTempDir(async (cwd) => {
    await writeFile(path.join(cwd, "arquivo.txt"), "um\nmeio\ntrês");
    const action = await mapClaudeToolAction(
      "MultiEdit",
      {
        file_path: "arquivo.txt",
        edits: [
          { old_string: "um", new_string: "dois" },
          { old_string: "dois", new_string: "DOIS" },
        ],
      },
      undefined,
      cwd,
    );

    const diff = getFileChange(action.output).diff;
    assert.match(diff, /@@ -1,3 \+1,3 @@/);
    assert.match(diff, /-um\n\+DOIS/);
    assert.doesNotMatch(diff, /\+dois/);
  });
});

test("Claude Write cria arquivo com kind add e todas as linhas", async () => {
  await withTempDir(async (cwd) => {
    const action = await mapClaudeToolAction(
      "Write",
      { file_path: "novo.txt", content: "primeira\nsegunda\n" },
      undefined,
      cwd,
    );

    const change = getFileChange(action.output);
    assert.deepEqual(change.kind, { type: "add" });
    assert.match(
      change.diff,
      /--- \/dev\/null\n\+\+\+ novo\.txt\n@@ -0,0 \+1,2 @@\n\+primeira\n\+segunda/,
    );
    await assert.rejects(readFile(path.join(cwd, "novo.txt")));
  });
});

test("Claude Write sobrescreve arquivo com diff real", async () => {
  await withTempDir(async (cwd) => {
    await writeFile(path.join(cwd, "existente.txt"), "antes\nigual\ndepois");
    const action = await mapClaudeToolAction(
      "Write",
      { file_path: "existente.txt", content: "antes\nnovo\ndepois" },
      undefined,
      cwd,
    );

    const change = getFileChange(action.output);
    assert.deepEqual(change.kind, { type: "update" });
    assert.match(change.diff, /@@ -1,3 \+1,3 @@\n antes\n-igual\n\+novo\n depois/);
  });
});

test("Claude Edit sem arquivo legível não inventa números de linha", async () => {
  await withTempDir(async (cwd) => {
    const action = await mapClaudeToolAction(
      "Edit",
      { file_path: "inexistente.txt", old_string: "antigo", new_string: "novo" },
      undefined,
      cwd,
    );
    const diff = getFileChange(action.output).diff;
    assert.doesNotMatch(diff, /@@/);
    assert.match(diff, /-antigo\n\+novo/);
  });
});

test("Claude Edit sem ocorrência de old_string não inventa números de linha", async () => {
  await withTempDir(async (cwd) => {
    await writeFile(path.join(cwd, "arquivo.txt"), "conteúdo presente");
    const action = await mapClaudeToolAction(
      "Edit",
      { file_path: "arquivo.txt", old_string: "ausente", new_string: "novo" },
      undefined,
      cwd,
    );
    const diff = getFileChange(action.output).diff;
    assert.doesNotMatch(diff, /@@/);
    assert.match(diff, /-ausente\n\+novo/);
  });
});

async function withTempDir<T>(run: (cwd: string) => Promise<T>): Promise<T> {
  const cwd = await mkdtemp(path.join(os.tmpdir(), "karont-diff-"));
  try {
    return await run(cwd);
  } finally {
    await rm(cwd, { recursive: true, force: true });
  }
}

function getFileChange(output: string): { kind: unknown; diff: string } {
  const changes = JSON.parse(output) as Array<{ kind: unknown; diff: string }>;
  assert.equal(changes.length, 1);
  const change = changes[0];
  if (!change) throw new Error("O resultado deve conter uma mudança de arquivo.");
  return change;
}

test("Codex limita parâmetros e resultado MCP em bytes", () => {
  const mcp = mapCodexSpecialAction({
    type: "mcpToolCall",
    server: "docs",
    tool: "lookup",
    arguments: { value: "🙂".repeat(5_000) },
    result: "resultado longo ".repeat(5_000),
  });
  assert.ok(mcp);
  assert.equal(Buffer.byteLength(mcp.input, "utf8") <= 8 * 1024, true);
  assert.equal(Buffer.byteLength(mcp.output, "utf8") <= 64 * 1024, true);
  assert.equal(mcp.truncated, true);
});
