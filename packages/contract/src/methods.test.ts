import assert from "node:assert/strict";
import { test } from "node:test";
import { conversationSendParamsSchema, messageSchema } from "./conversations.ts";
import { events } from "./events.ts";
import {
  jsonValueSchema,
  MAX_SETTING_BYTES,
  methods,
  settingKeySchema,
  terminalInfoSchema,
} from "./methods.ts";
import { isMethodName } from "./validate.ts";

test("todos os métodos aceitam parâmetros válidos", () => {
  assert.equal(methods["system.ping"].params.safeParse({}).success, true);
  assert.equal(methods["system.info"].params.safeParse({}).success, true);
  assert.equal(methods["system.userName"].params.safeParse({}).success, true);
  assert.equal(methods["system.userName"].result.safeParse({ name: null }).success, true);
  assert.equal(methods["settings.get"].params.safeParse({ key: "theme.dark" }).success, true);
  assert.equal(
    methods["settings.set"].params.safeParse({ key: "theme.dark", value: { enabled: true } })
      .success,
    true,
  );
  assert.equal(
    methods["dev.streamTest"].params.safeParse({ chunks: 1, chunkSize: 1 }).success,
    true,
  );
  assert.equal(methods["folders.gitInfo"].params.safeParse({ path: "/tmp" }).success, true);
  assert.equal(
    methods["conversation.rename"].params.safeParse({ id: "c1", title: "  Novo título  " }).success,
    true,
  );
  assert.equal(
    methods["conversation.branch"].params.safeParse({ id: "c1", messageId: "m1" }).success,
    true,
  );
  assert.equal(
    methods["conversation.branch"].params.safeParse({ id: "c1", messageId: "m1", extra: true })
      .success,
    false,
  );
  assert.equal(
    methods["folders.gitInfo"].result.safeParse({ branch: "feature/anexos", detached: false })
      .success,
    true,
  );
});

test("conversation.send aceita até 8 anexos e a mensagem expõe só metadados", () => {
  const attachment = {
    name: "notas.md",
    mimeType: "text/markdown",
    kind: "text",
    data: "conteúdo",
  } as const;
  const schema = methods["conversation.send"].params;
  assert.equal(schema, conversationSendParamsSchema);
  assert.equal(
    schema.safeParse({ id: "c1", text: "Leia", attachments: [attachment] }).success,
    true,
  );
  assert.equal(
    schema.safeParse({ id: "c1", text: "Leia", skills: [{ name: "project-helper" }] }).success,
    true,
  );
  assert.equal(
    schema.safeParse({
      id: "c1",
      text: "Leia",
      attachments: Array.from({ length: 8 }, () => attachment),
    }).success,
    true,
  );
  assert.equal(
    schema.safeParse({
      id: "c1",
      text: "Leia",
      attachments: Array.from({ length: 9 }, () => attachment),
    }).success,
    false,
  );
  const savedMessage = {
    id: "m1",
    conversationId: "c1",
    author: "user",
    status: "done",
    parts: [],
    attachments: [{ name: "notas.md", mimeType: "text/markdown", kind: "text", sizeBytes: 8 }],
    createdAt: "2026-10-31T10:00:00Z",
    updatedAt: "2026-10-31T10:00:00Z",
  };
  assert.equal(messageSchema.safeParse(savedMessage).success, true);
  assert.equal(
    messageSchema.safeParse({
      ...savedMessage,
      attachments: [{ ...savedMessage.attachments[0], data: "conteúdo" }],
    }).success,
    false,
  );
});

test("contratos do composer e compactação validam os formatos por agente", () => {
  assert.equal(
    methods["composer.files"].params.safeParse({ conversationId: "c1", query: "readme" }).success,
    true,
  );
  assert.equal(
    methods["composer.files"].params.safeParse({ cwd: "/tmp/projeto", query: "src/a" }).success,
    true,
  );
  assert.equal(
    methods["composer.files"].params.safeParse({ cwd: "/tmp/projeto", query: "x", extra: true })
      .success,
    false,
  );
  assert.equal(
    methods["composer.files"].result.safeParse({
      files: [{ path: "src/index.ts", name: "index.ts" }],
    }).success,
    true,
  );
  assert.equal(methods["composer.skills"].params.safeParse({ conversationId: "c1" }).success, true);
  assert.equal(
    methods["composer.skills"].params.safeParse({ agent: "codex", cwd: "/tmp/projeto" }).success,
    true,
  );
  assert.equal(
    methods["composer.skills"].params.safeParse({ agent: "teste", cwd: "/tmp/projeto" }).success,
    true,
  );
  assert.equal(
    methods["composer.skills"].result.safeParse({
      skills: [
        {
          name: "project-helper",
          description: "Executa uma tarefa de exemplo.",
          source: "agente-de-teste",
          path: "/tmp/projeto/.agents/skills/project-helper/SKILL.md",
        },
      ],
    }).success,
    true,
  );
  assert.equal(methods["conversation.compact"].params.safeParse({ id: "c1" }).success, true);
  assert.equal(methods["conversation.compact"].result.safeParse({ ok: true }).success, true);
  assert.equal(
    methods["agent.models"].params.safeParse({ agent: "agente-de-teste" }).success,
    true,
  );
  assert.equal(
    methods["agent.models"].result.safeParse({
      agent: "agente-de-teste",
      models: [],
      efforts: [],
    }).success,
    true,
  );
  assert.equal(
    methods["agent.capabilities"].params.safeParse({ agent: "agente-de-teste" }).success,
    true,
  );
  assert.equal(
    methods["agent.capabilities"].result.safeParse({
      capabilities: {
        skills: false,
        compact: false,
        contextUsage: false,
        fileMentions: true,
        fastMode: false,
        plan: false,
        fork: false,
      },
    }).success,
    true,
  );
});

test("parâmetros rejeitam chaves extras e tipos errados", () => {
  for (const method of ["system.ping", "system.info"] as const) {
    assert.equal(methods[method].params.safeParse({ extra: true }).success, false);
    assert.equal(methods[method].params.safeParse(null).success, false);
  }

  assert.equal(
    methods["settings.get"].params.safeParse({ key: "theme", extra: true }).success,
    false,
  );
  assert.equal(methods["settings.get"].params.safeParse({ key: 3 }).success, false);
  assert.equal(
    methods["settings.set"].params.safeParse({ key: "theme", value: "dark", extra: true }).success,
    false,
  );
  assert.equal(
    methods["settings.set"].params.safeParse({ key: "theme", value: undefined }).success,
    false,
  );
  assert.equal(
    methods["dev.streamTest"].params.safeParse({ chunks: "1", chunkSize: 1 }).success,
    false,
  );
  assert.equal(
    methods["dev.streamTest"].params.safeParse({ chunks: 1, chunkSize: 1, extra: true }).success,
    false,
  );
});

test("limites do teste de streaming são aplicados", () => {
  const schema = methods["dev.streamTest"].params;
  for (const chunks of [0, 10_001]) {
    assert.equal(schema.safeParse({ chunks, chunkSize: 1 }).success, false);
  }
  assert.equal(schema.safeParse({ chunks: 1, chunkSize: 65_537 }).success, false);
  assert.equal(schema.safeParse({ chunks: 10_000, chunkSize: 65_536 }).success, true);
});

test("métodos de agentes validam parâmetros", () => {
  assert.equal(methods["agents.list"].params.safeParse({}).success, true);
  assert.equal(methods["agents.detect"].params.safeParse({}).success, true);
  assert.equal(
    methods["agents.add"].params.safeParse({ name: "Local", command: "agent-cli" }).success,
    true,
  );
  assert.equal(
    methods["agents.add"].params.safeParse({ name: "Local", command: "/opt/My CLI/agent" }).success,
    true,
  );
  for (const command of ["", "./x", "agent cli", "agent\ncli", "agent\u0000cli"]) {
    assert.equal(methods["agents.add"].params.safeParse({ name: "Local", command }).success, false);
  }
  for (const name of ["", " Nome", "Nome ", "Nome\tAgente", "n".repeat(61)]) {
    assert.equal(
      methods["agents.add"].params.safeParse({ name, command: "agent-cli" }).success,
      false,
    );
  }
  assert.equal(methods["agents.remove"].params.safeParse({ id: "custom-id" }).success, true);
  assert.equal(methods["agents.remove"].params.safeParse({ id: "" }).success, false);
});

test("métodos de terminal validam caminhos, dimensões e bytes UTF-8", () => {
  assert.equal(methods["terminals.list"].params.safeParse({}).success, true);
  assert.equal(methods["terminals.open"].params.safeParse({ cols: 80, rows: 24 }).success, true);
  assert.equal(
    methods["terminals.open"].params.safeParse({
      cols: 80,
      rows: 24,
      command: "echo uma linha\necho outra linha",
    }).success,
    true,
  );
  assert.equal(
    methods["terminals.open"].params.safeParse({ cols: 80, rows: 24, command: "é".repeat(2_048) })
      .success,
    true,
  );
  for (const command of ["", "cmd\u0000arg", "x".repeat(4_097), "é".repeat(2_049)]) {
    assert.equal(
      methods["terminals.open"].params.safeParse({ cols: 80, rows: 24, command }).success,
      false,
    );
  }
  assert.equal(
    methods["terminals.open"].params.safeParse({ cwd: "/tmp", cols: 2, rows: 500 }).success,
    true,
  );
  assert.equal(
    methods["terminals.open"].params.safeParse({ cwd: "relative", cols: 80, rows: 24 }).success,
    false,
  );
  assert.equal(methods["terminals.open"].params.safeParse({ cols: 1, rows: 24 }).success, false);
  assert.equal(methods["terminals.open"].params.safeParse({ cols: 80, rows: 501 }).success, false);
  assert.equal(
    methods["terminals.write"].params.safeParse({ id: "t1", data: "é".repeat(32_768) }).success,
    true,
  );
  assert.equal(
    methods["terminals.write"].params.safeParse({ id: "t1", data: "é".repeat(32_769) }).success,
    false,
  );
  for (const method of ["terminals.attach", "terminals.close"] as const) {
    assert.equal(methods[method].params.safeParse({ id: "t1" }).success, true);
  }
  assert.equal(
    methods["terminals.resize"].params.safeParse({ id: "t1", cols: 80, rows: 24 }).success,
    true,
  );
  assert.equal(methods["service.shutdown"].params.safeParse({}).success, true);
  assert.equal(
    terminalInfoSchema.safeParse({
      id: "t1",
      title: "bash · ~",
      cwd: "/tmp",
      workspaceId: "w1",
      shell: "/bin/bash",
      cols: 80,
      rows: 24,
      startedAt: "2026-10-31T00:00:00.000Z",
      exited: false,
    }).success,
    true,
  );
});

test("folders.* valida caminhos e pickFolder não é método de requisição", () => {
  assert.equal(isMethodName("folders.recent"), true);
  assert.equal(isMethodName("folders.validate"), true);
  assert.equal(isMethodName("folders.gitInfo"), true);
  assert.equal(isMethodName("pickFolder"), false);
  assert.equal(methods["folders.recent"].params.safeParse({}).success, true);
  assert.equal(methods["folders.validate"].params.safeParse({ path: "./projeto" }).success, true);
  assert.equal(methods["folders.gitInfo"].params.safeParse({ path: "./projeto" }).success, true);
  assert.equal(methods["folders.validate"].params.safeParse({ path: "" }).success, false);
  assert.equal(
    methods["folders.validate"].params.safeParse({ path: "x".repeat(4_097) }).success,
    false,
  );
  assert.equal(
    methods["folders.validate"].params.safeParse({ path: "/tmp\u0000x" }).success,
    false,
  );
});

test("SettingKey aceita apenas o formato previsto", () => {
  assert.equal(settingKeySchema.safeParse("a").success, true);
  assert.equal(settingKeySchema.safeParse("a1.B2").success, true);
  assert.equal(settingKeySchema.safeParse("Akey").success, false);
  assert.equal(settingKeySchema.safeParse("1key").success, false);
  assert.equal(settingKeySchema.safeParse("key-name").success, false);
  assert.equal(settingKeySchema.safeParse(`a${"b".repeat(64)}`).success, false);
});

test("JsonValue limita o JSON serializado em bytes UTF-8", () => {
  const maxString = "é".repeat((MAX_SETTING_BYTES - 2) / 2);
  const overLimitString = `${maxString}é`;
  assert.equal(new TextEncoder().encode(JSON.stringify(maxString)).byteLength, MAX_SETTING_BYTES);
  assert.equal(jsonValueSchema.safeParse(maxString).success, true);
  assert.equal(jsonValueSchema.safeParse(overLimitString).success, false);
  assert.equal(jsonValueSchema.safeParse({ ok: [1, "two", null] }).success, true);
});

test("métodos restore.* validam parâmetros e resultados", () => {
  const target = { conversationId: "c1", messageId: "m1" };
  assert.equal(methods["restore.list"].params.safeParse({ conversationId: "c1" }).success, true);
  assert.equal(methods["restore.list"].params.safeParse({}).success, false);
  assert.equal(methods["restore.changes"].params.safeParse(target).success, true);
  assert.equal(
    methods["restore.diff"].params.safeParse({ ...target, path: "a b.txt" }).success,
    true,
  );
  assert.equal(methods["restore.diff"].params.safeParse({ ...target, path: "" }).success, false);
  assert.equal(methods["restore.undo"].params.safeParse({ ...target, extra: 1 }).success, false);
  const point = {
    messageId: "m1",
    state: "unavailable",
    reason: "no-git",
    changedFiles: 0,
    concurrent: false,
    headMoved: false,
  };
  assert.equal(methods["restore.list"].result.safeParse({ points: [point] }).success, true);
  assert.equal(
    methods["restore.list"].result.safeParse({ points: [{ ...point, state: "outro" }] }).success,
    false,
  );
  assert.equal(
    methods["restore.changes"].result.safeParse({
      files: [{ path: "a", status: "added", additions: null, deletions: null, binary: true }],
      truncated: false,
    }).success,
    true,
  );
  assert.equal(methods["restore.undo"].result.safeParse({ restored: 1, removed: 2 }).success, true);
  assert.equal(isMethodName("restore.undoPreview"), true);
});

test("workspaces.*: pedidos, resultados e evento seguem o contrato", () => {
  const workspace = {
    id: "w1",
    name: "Pessoal",
    icon: "house",
    position: 0,
    createdAt: "2026-11-09T10:00:00.000Z",
    updatedAt: "2026-11-09T10:00:00.000Z",
  };
  assert.equal(methods["workspaces.list"].params.safeParse({}).success, true);
  assert.equal(methods["workspaces.create"].params.safeParse({ name: "Trabalho" }).success, true);
  assert.equal(
    methods["workspaces.create"].params.safeParse({ name: "Trabalho", icon: "briefcase" }).success,
    true,
  );
  assert.equal(methods["workspaces.create"].params.safeParse({ name: "   " }).success, false);
  assert.equal(
    methods["workspaces.create"].params.safeParse({ name: "x".repeat(81) }).success,
    false,
  );
  assert.equal(
    methods["workspaces.update"].params.safeParse({ id: "w1", name: "Casa" }).success,
    true,
  );
  assert.equal(
    methods["workspaces.update"].params.safeParse({ id: "", name: "Casa" }).success,
    false,
  );
  assert.equal(methods["workspaces.remove"].params.safeParse({ id: "w1" }).success, true);
  assert.equal(methods["workspaces.reorder"].params.safeParse({ ids: ["a", "b"] }).success, true);
  assert.equal(methods["workspaces.reorder"].params.safeParse({ ids: [] }).success, false);
  assert.equal(
    methods["workspaces.list"].result.safeParse({ workspaces: [workspace] }).success,
    true,
  );
  assert.equal(events["workspaces.changed"].safeParse({ workspaces: [workspace] }).success, true);
  assert.equal(
    events["workspaces.changed"].safeParse({ workspaces: [{ id: "w1" }] }).success,
    false,
  );
  assert.equal(
    methods["projects.update"].params.safeParse({ id: "p1", workspaceId: "w2" }).success,
    true,
  );
  assert.equal(
    methods["terminals.open"].params.safeParse({
      cols: 80,
      rows: 24,
      projectId: "p1",
      workspaceId: "w1",
    }).success,
    true,
  );
});

test("conversations.workspaceMoved exige exatamente um entre fromWorkspaceId e projectId", () => {
  const schema = events["conversations.workspaceMoved"];
  assert.equal(schema.safeParse({ workspaceId: "w1", fromWorkspaceId: "w0" }).success, true);
  assert.equal(schema.safeParse({ workspaceId: "w1", projectId: "p1" }).success, true);
  assert.equal(schema.safeParse({ workspaceId: "w1" }).success, false);
  assert.equal(
    schema.safeParse({ workspaceId: "w1", fromWorkspaceId: "w0", projectId: "p1" }).success,
    false,
  );
});

test("system.diagnostics aceita parâmetros vazios e recusa resultado inválido", () => {
  const valid = {
    serviceVersion: "0.0.0",
    contractVersion: 1,
    nodeVersion: "24.0.0",
    platform: "linux",
    pid: 1,
    startedAt: "2026-11-01T10:00:00.000Z",
    paths: {
      homeDir: "/home/u",
      dataDir: "/home/u/.local/share/karont",
      dbPath: "/home/u/.local/share/karont/karont.db",
      runtimeDir: "/run/user/1000/karont",
      socketPath: "/run/user/1000/karont/service.sock",
    },
    agents: [],
    detectedAt: "2026-11-01T10:00:00.000Z",
  };
  assert.equal(methods["system.diagnostics"].params.safeParse({}).success, true);
  assert.equal(methods["system.diagnostics"].params.safeParse({ x: 1 }).success, false);
  assert.equal(methods["system.diagnostics"].result.safeParse(valid).success, true);
  assert.equal(
    methods["system.diagnostics"].result.safeParse({ ...valid, pid: "1" }).success,
    false,
  );
  assert.equal(
    methods["system.diagnostics"].result.safeParse({
      ...valid,
      paths: { ...valid.paths, secretPath: "/x" },
    }).success,
    false,
  );
  const { agents: _agents, ...semAgentes } = valid;
  assert.equal(methods["system.diagnostics"].result.safeParse(semAgentes).success, false);
});

test("usage.list valida resultado e usage.updated valida o evento", () => {
  const usage = {
    agent: "codex",
    windows: [{ id: "five_hour", usedPercent: 20, resetsAt: "2026-11-09T12:00:00.000Z" }],
    observedAt: "2026-11-09T10:00:00.000Z",
  };
  assert.equal(methods["usage.list"].params.safeParse({}).success, true);
  assert.equal(methods["usage.list"].params.safeParse({ x: 1 }).success, false);
  assert.equal(methods["usage.list"].result.safeParse({ usage: [usage] }).success, true);
  assert.equal(methods["usage.list"].result.safeParse({ usage: [] }).success, true);
  const badWindow = { ...usage, windows: [{ id: "daily", usedPercent: 20, resetsAt: null }] };
  assert.equal(methods["usage.list"].result.safeParse({ usage: [badWindow] }).success, false);
  const over = { ...usage, windows: [{ id: "weekly", usedPercent: 101, resetsAt: null }] };
  assert.equal(methods["usage.list"].result.safeParse({ usage: [over] }).success, false);
  assert.equal(events["usage.updated"].safeParse(usage).success, true);
  assert.equal(events["usage.updated"].safeParse({ ...usage, observedAt: "ontem" }).success, false);
  assert.equal(isMethodName("usage.list"), true);
});
