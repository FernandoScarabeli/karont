import assert from "node:assert/strict";
import type { ChildProcess, SpawnOptions } from "node:child_process";
import { EventEmitter } from "node:events";
import { readdirSync } from "node:fs";
import { PassThrough } from "node:stream";
import { test } from "node:test";
import { generateConversationTitle, type TitleGeneratorOptions } from "./title-generator.ts";

function createFakeTitleCli(output: string, hangs = false, exitCode = 0) {
  let invocation: { command: string; args: string[]; cwd: string; files: string[] } | undefined;
  const spawn = ((command: string | URL, args: readonly string[] = [], options?: SpawnOptions) => {
    const emitter = new EventEmitter();
    const stdout = new PassThrough();
    const stderr = new PassThrough();
    let keepAlive: ReturnType<typeof setInterval> | undefined;
    const child = Object.assign(emitter, {
      stdout,
      stderr,
      stdin: null,
      kill: (signal = "SIGKILL") => {
        if (keepAlive) clearInterval(keepAlive);
        queueMicrotask(() => emitter.emit("close", null, signal));
        return true;
      },
    }) as unknown as ChildProcess;
    const cwd = String(options?.cwd ?? "");
    invocation = { command: String(command), args: [...args], cwd, files: readdirSync(cwd) };
    if (hangs) {
      keepAlive = setInterval(() => undefined, 1_000);
    } else {
      queueMicrotask(() => {
        stdout.end(output);
        stderr.end();
        emitter.emit("close", exitCode, null);
      });
    }
    return child;
  }) as NonNullable<TitleGeneratorOptions["spawn"]>;
  return { spawn, getInvocation: () => invocation };
}

test("Claude gera título com Haiku, esforço baixo e nenhuma ferramenta via CLI falsa", async () => {
  const fake = createFakeTitleCli("Resume a conversa com clareza\n");
  const title = await generateConversationTitle(
    "claude",
    "Fale sobre o produto",
    "A resposta começa aqui",
    {
      env: { ...process.env, KARONT_CLAUDE_CLI: "/fake/claude" },
      spawn: fake.spawn,
    },
  );
  const invocation = fake.getInvocation();

  assert.equal(title, "Resume a conversa com clareza");
  assert.equal(invocation?.command, "/fake/claude");
  assert.ok(invocation?.args.includes("--model") && invocation.args.includes("haiku"));
  assert.ok(invocation?.args.includes("--effort") && invocation.args.includes("low"));
  assert.ok(invocation?.args.includes("--tools"));
  assert.equal(invocation?.args[invocation.args.indexOf("--tools") + 1], "");
  assert.ok(invocation?.args.at(-1)?.includes("Fale sobre o produto"));
  assert.ok(invocation?.args.at(-1)?.includes("A resposta começa aqui"));
  assert.deepEqual(invocation?.files, []);
});

test("Codex usa execução efêmera e somente leitura numa pasta temporária vazia", async () => {
  const fake = createFakeTitleCli("Resume a conversa com clareza\n");
  const title = await generateConversationTitle(
    "codex",
    "Fale sobre o produto",
    "A resposta começa aqui",
    {
      env: { ...process.env, KARONT_CODEX_CLI: "/fake/codex" },
      spawn: fake.spawn,
      codexModel: "codex-mini-available",
      codexEffort: "low",
    },
  );
  const invocation = fake.getInvocation();
  const args = invocation?.args ?? [];
  const sandboxIndex = args.indexOf("--sandbox");
  const modelIndex = args.indexOf("--model");
  const directoryIndex = args.indexOf("--cd");

  assert.equal(title, "Resume a conversa com clareza");
  assert.equal(invocation?.command, "/fake/codex");
  assert.ok(args.includes("--ephemeral"));
  assert.ok(args.includes("--ignore-user-config"));
  assert.equal(args[sandboxIndex + 1], "read-only");
  assert.equal(args[modelIndex + 1], "codex-mini-available");
  assert.equal(args[args.indexOf("--config") + 1], 'model_reasoning_effort="low"');
  assert.equal(args[directoryIndex + 1], invocation?.cwd);
  assert.deepEqual(invocation?.files, []);
});

test("Codex usa o modelo padrão quando a lista não oferece um modelo", async () => {
  const fake = createFakeTitleCli("Título válido\n");
  const title = await generateConversationTitle("codex", "Pedido", "Resposta", {
    env: { ...process.env, KARONT_CODEX_CLI: "/fake/codex" },
    spawn: fake.spawn,
  });
  const args = fake.getInvocation()?.args ?? [];

  assert.equal(title, "Título válido");
  assert.equal(args.includes("--model"), false);
});

test("normaliza prefixos e markdown, aceita respostas curtas e limita o título a seis palavras", () => {
  const wrapped = createFakeTitleCli('### **Título:** `"Karont: app desktop de chat"`');
  const short = createFakeTitleCli("Só");
  const long = createFakeTitleCli("um dois três quatro cinco seis sete oito nove dez");

  return Promise.all([
    generateConversationTitle("claude", "Pedido", "Resposta", {
      env: { ...process.env, KARONT_CLAUDE_CLI: "/fake/claude" },
      spawn: wrapped.spawn,
    }),
    generateConversationTitle("claude", "Pedido", "Resposta", {
      env: { ...process.env, KARONT_CLAUDE_CLI: "/fake/claude" },
      spawn: short.spawn,
    }),
    generateConversationTitle("claude", "Pedido", "Resposta", {
      env: { ...process.env, KARONT_CLAUDE_CLI: "/fake/claude" },
      spawn: long.spawn,
    }),
  ]).then(([normalized, acceptedShort, truncated]) => {
    assert.equal(normalized, "Karont: app desktop de chat");
    assert.equal(acceptedShort, "Só");
    assert.equal(truncated, "um dois três quatro cinco seis");
  });
});

test("timeout e falha de CLI são registrados sem conteúdo da conversa", async () => {
  const logs: string[] = [];
  const logger = { error: (message: string) => logs.push(message) };
  const hangingCli = createFakeTitleCli("", true);
  const timeout = await generateConversationTitle("claude", "Pedido", "Resposta", {
    env: { ...process.env, KARONT_CLAUDE_CLI: "/fake/claude" },
    spawn: hangingCli.spawn,
    timeoutMs: 20,
    logger,
  });
  assert.equal(timeout, null);
  assert.match(logs[0] ?? "", /timeout após 20 ms/u);

  const failedCli = createFakeTitleCli("conteúdo privado", false, 7);
  const failed = await generateConversationTitle("claude", "conteúdo privado", "resposta secreta", {
    env: { ...process.env, KARONT_CLAUDE_CLI: "/fake/claude" },
    spawn: failedCli.spawn,
    logger,
  });
  assert.equal(failed, null);
  assert.match(logs[1] ?? "", /código de saída 7/u);
  assert.equal(logs.join(" ").includes("conteúdo privado"), false);
  assert.equal(logs.join(" ").includes("resposta secreta"), false);
});
