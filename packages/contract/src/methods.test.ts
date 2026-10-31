import assert from "node:assert/strict";
import { test } from "node:test";
import { jsonValueSchema, MAX_SETTING_BYTES, methods, settingKeySchema } from "./methods.ts";

test("todos os métodos aceitam parâmetros válidos", () => {
  assert.equal(methods["system.ping"].params.safeParse({}).success, true);
  assert.equal(methods["system.info"].params.safeParse({}).success, true);
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
