import assert from "node:assert/strict";
import { test } from "node:test";
import { conversationSendParamsSchema, messageSchema } from "./conversations.ts";
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
