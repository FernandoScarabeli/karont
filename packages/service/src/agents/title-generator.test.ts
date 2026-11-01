import assert from "node:assert/strict";
import type { ChildProcess, SpawnOptions } from "node:child_process";
import { EventEmitter } from "node:events";
import { readdirSync } from "node:fs";
import { PassThrough } from "node:stream";
import { test } from "node:test";
import { generateConversationTitle, type TitleGeneratorOptions } from "./title-generator.ts";

function createFakeTitleCli(output: string, hangs = false) {
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
        emitter.emit("close", 0, null);
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
  assert.equal(args[modelIndex + 1], "gpt-5.1-codex-mini");
  assert.equal(args[args.indexOf("--config") + 1], 'model_reasoning_effort="low"');
  assert.equal(args[directoryIndex + 1], invocation?.cwd);
  assert.deepEqual(invocation?.files, []);
});

test("timeout e saída fora do formato mantêm o título atual sem propagar erro", async () => {
  const hangingCli = createFakeTitleCli("", true);
  const timeout = await generateConversationTitle("claude", "Pedido", "Resposta", {
    env: { ...process.env, KARONT_CLAUDE_CLI: "/fake/claude" },
    spawn: hangingCli.spawn,
    timeoutMs: 20,
  });
  assert.equal(timeout, null);

  const invalidCli = createFakeTitleCli("Título curto\n");
  const invalid = await generateConversationTitle("claude", "Pedido", "Resposta", {
    env: { ...process.env, KARONT_CLAUDE_CLI: "/fake/claude" },
    spawn: invalidCli.spawn,
  });
  assert.equal(invalid, null);
});
