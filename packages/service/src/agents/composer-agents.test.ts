import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import os from "node:os";
import { test } from "node:test";
import { fileURLToPath } from "node:url";
import type { Conversation } from "@karont/contract";
import { ClaudeAdapter, createClaudeSkillLoader } from "./claude-adapter.ts";
import { CodexAdapter, createCodexSkillLoader } from "./codex-adapter.ts";
import { createFakeClaudeSpawn } from "./testing/fake-claude-process.ts";
import { createFakeCodexSpawn } from "./testing/fake-codex-process.ts";

const claudeFixtures = new URL("./fixtures/claude/", import.meta.url);
const codexFixtures = new URL("./fixtures/codex/", import.meta.url);
const claudeCommands = JSON.parse(
  readFileSync(fileURLToPath(new URL("comandos.json", claudeFixtures)), "utf8"),
) as Record<string, unknown>[];
const testSkillPath = "/tmp/projeto/.agents/skills/project-helper/SKILL.md";

function conversation(agent: Conversation["agent"]): Conversation {
  const now = new Date().toISOString();
  return {
    workspaceId: "ws-test",
    id: `conversation-${agent}`,
    agent,
    title: "Conversa de teste",
    cwd: os.tmpdir(),
    mode: "read-only",
    fast: false,
    pinnedAt: null,
    archivedAt: null,
    unreadAt: null,
    state: "idle",
    createdAt: now,
    updatedAt: now,
  };
}

test("loader Claude mapeia commands do initialize e omite os internos", async () => {
  const fake = createFakeClaudeSpawn(fileURLToPath(new URL("texto.jsonl", claudeFixtures)), {
    initializeCommands: claudeCommands,
  });
  const loadSkills = createClaudeSkillLoader({
    env: { ...process.env, KARONT_CLAUDE_CLI: "claude" },
    spawn: fake,
  });

  assert.deepEqual(await loadSkills(os.tmpdir()), [
    {
      name: "project-helper",
      description: "Executa uma tarefa de exemplo no Projeto.",
      argumentHint: "[arquivo]",
      source: "claude",
    },
  ]);
});

test("Claude prefixa a skill na mensagem e compacta com /compact", async () => {
  const fixturePath = fileURLToPath(new URL("texto.jsonl", claudeFixtures));
  const fake = createFakeClaudeSpawn(fixturePath);
  const adapter = new ClaudeAdapter(() => undefined, {
    env: { ...process.env, KARONT_CLAUDE_CLI: "claude" },
    spawn: fake,
  });
  try {
    await adapter.start(conversation("claude"), "claude-session-test", false);
    await adapter.send("Resuma este arquivo.", false, [], [{ name: "project-helper" }]);
    const userMessage = fake.messages.find((message) => message.type === "user");
    assert.equal(
      (userMessage?.message as { content?: unknown } | undefined)?.content,
      "/project-helper Resuma este arquivo.",
    );
  } finally {
    await adapter.dispose();
  }

  const compactFake = createFakeClaudeSpawn(fixturePath);
  const compactAdapter = new ClaudeAdapter(() => undefined, {
    env: { ...process.env, KARONT_CLAUDE_CLI: "claude" },
    spawn: compactFake,
  });
  try {
    await compactAdapter.start(conversation("claude"), "claude-compact-session-test", false);
    await compactAdapter.compact();
    const compactMessage = compactFake.messages.find((message) => message.type === "user");
    assert.equal(
      (compactMessage?.message as { content?: unknown } | undefined)?.content,
      "/compact",
    );
  } finally {
    await compactAdapter.dispose();
  }
});

test("Claude remove a menção exata da skill antes de prefixar o prompt", async () => {
  const fake = createFakeClaudeSpawn(fileURLToPath(new URL("texto.jsonl", claudeFixtures)));
  const adapter = new ClaudeAdapter(() => undefined, {
    env: { ...process.env, KARONT_CLAUDE_CLI: "claude" },
    spawn: fake,
  });
  try {
    await adapter.start(conversation("claude"), "claude-skill-mention-test", false);
    await adapter.send(
      "$project-helper veja auth.ts; preserve $project-helper-extra e literal$project-helper.",
      false,
      [],
      [{ name: "project-helper" }],
    );
    const userMessage = fake.messages.find((message) => message.type === "user");
    assert.equal(
      (userMessage?.message as { content?: unknown } | undefined)?.content,
      "/project-helper veja auth.ts; preserve $project-helper-extra e literal$project-helper.",
    );
  } finally {
    await adapter.dispose();
  }
});

test("loader Codex mapeia skills/list do app-server e omite skills desativadas", async () => {
  const fake = createFakeCodexSpawn(fileURLToPath(new URL("skills.jsonl", codexFixtures)), {
    cwdOverride: "/tmp",
  });
  const loadSkills = createCodexSkillLoader({
    env: { ...process.env, KARONT_CODEX_CLI: "codex" },
    spawn: fake,
  });

  assert.deepEqual(await loadSkills("/tmp"), [
    {
      name: "project-helper",
      description: "Executa uma tarefa de exemplo no Projeto.",
      source: "codex",
      path: testSkillPath,
    },
  ]);
  assert.deepEqual(fake.messages[0]?.find((message) => message.method === "skills/list")?.params, {
    cwds: ["/tmp"],
    forceReload: true,
  });
});

test("Codex envia o item skill e compacta via app-server", async () => {
  const skillFake = createFakeCodexSpawn(
    fileURLToPath(new URL("skill-envio.jsonl", codexFixtures)),
    { cwdOverride: "/tmp" },
  );
  const skillAdapter = new CodexAdapter(() => undefined, {
    env: { ...process.env, KARONT_CODEX_CLI: "codex" },
    spawn: skillFake,
  });
  try {
    await skillAdapter.start(conversation("codex"), "codex-session-test", false);
    await skillAdapter.send(
      "$project-helper Faça a revisão.",
      false,
      [],
      [{ name: "project-helper", path: testSkillPath }],
    );
    const turnStart = skillFake.messages[0]?.find((message) => message.method === "turn/start");
    assert.deepEqual((turnStart?.params as { input?: unknown[] } | undefined)?.input, [
      { type: "skill", name: "project-helper", path: testSkillPath },
      { type: "text", text: "Faça a revisão." },
    ]);
  } finally {
    await skillAdapter.dispose();
  }

  const compactFake = createFakeCodexSpawn(
    fileURLToPath(new URL("compactar.jsonl", codexFixtures)),
    { cwdOverride: "/tmp" },
  );
  const compactAdapter = new CodexAdapter(() => undefined, {
    env: { ...process.env, KARONT_CODEX_CLI: "codex" },
    spawn: compactFake,
  });
  try {
    await compactAdapter.start(conversation("codex"), "codex-session-test", false);
    await compactAdapter.compact();
    assert.deepEqual(
      compactFake.messages[0]?.find((message) => message.method === "thread/compact/start")?.params,
      { threadId: "thread-compact-test" },
    );
  } finally {
    await compactAdapter.dispose();
  }
});
