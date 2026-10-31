import assert from "node:assert/strict";
import { test } from "node:test";
import {
  authFrameSchema,
  helloFrameSchema,
  isEventName,
  isMethodName,
  methods,
  parseEvent,
  parseRequest,
  parseResult,
  readyFrameSchema,
} from "./index.ts";

test("parseRequest discrimina método desconhecido e envelope inválido", () => {
  assert.deepEqual(
    parseRequest({ type: "request", id: "1", method: "missing.method", params: {} }),
    {
      ok: false,
      error: { code: "unknown_method", message: "Método desconhecido." },
    },
  );
  assert.equal(
    parseRequest({ type: "request", id: "", method: "system.ping", params: {} }).ok,
    false,
  );
  assert.equal(parseRequest({ type: "request", id: "1", method: "system.ping" }).ok, false);
  assert.equal(
    parseRequest({ type: "request", id: "1", method: "system.ping", params: {}, extra: 1 }).ok,
    false,
  );
  assert.deepEqual(parseRequest({ type: "request", id: "1", method: "system.ping", params: {} }), {
    ok: true,
    request: { type: "request", id: "1", method: "system.ping", params: {} },
  });
});

test("erros de validação não ecoam valores grandes", () => {
  const giantValue = "é".repeat(40_000);
  const result = parseRequest({
    type: "request",
    id: "1",
    method: "settings.set",
    params: { key: "test", value: giantValue },
  });
  assert.equal(result.ok, false);
  if (!result.ok) assert.equal(result.error.message.includes(giantValue), false);
});

test("parseResult valida o schema do método", () => {
  assert.deepEqual(parseResult("system.ping", { pong: true, at: "2026-10-31T10:00:00Z" }), {
    ok: true,
    result: { pong: true, at: "2026-10-31T10:00:00Z" },
  });
  assert.equal(parseResult("system.ping", { pong: false, at: "not-a-date" }).ok, false);
  assert.equal(methods["system.info"].result.safeParse({}).success, false);
});

test("parseEvent valida envelope e payload", () => {
  assert.deepEqual(
    parseEvent({
      type: "event",
      event: "dev.streamTest.delta",
      payload: { streamId: "s1", seq: 0, text: "chunk" },
    }),
    {
      ok: true,
      event: { event: "dev.streamTest.delta", payload: { streamId: "s1", seq: 0, text: "chunk" } },
    },
  );
  assert.equal(
    parseEvent({ type: "event", event: "bridge.status", payload: { state: "waiting" } }).ok,
    false,
  );
  assert.equal(
    parseEvent({
      type: "event",
      event: "dev.streamTest.done",
      payload: { streamId: "s1", totalChunks: -1, totalBytes: 0 },
    }).ok,
    false,
  );
  assert.equal(parseEvent({ type: "event", event: "dev.streamTest.done" }).ok, false);
});

test("frames de handshake validam discriminador e hexadecimal de 64 caracteres", () => {
  const hex = "aB".repeat(32);
  assert.equal(
    helloFrameSchema.safeParse({ type: "hello", contractVersion: 1, nonce: hex }).success,
    true,
  );
  assert.equal(
    helloFrameSchema.safeParse({ type: "hello", contractVersion: 1, nonce: "a".repeat(63) })
      .success,
    false,
  );
  assert.equal(
    helloFrameSchema.safeParse({ type: "hello", contractVersion: 1, nonce: `${"a".repeat(63)}g` })
      .success,
    false,
  );
  assert.equal(authFrameSchema.safeParse({ type: "auth", mac: hex }).success, true);
  assert.equal(authFrameSchema.safeParse({ type: "auth", mac: "a".repeat(63) }).success, false);
  assert.equal(
    authFrameSchema.safeParse({ type: "auth", mac: `${"a".repeat(63)}g` }).success,
    false,
  );
  assert.equal(readyFrameSchema.safeParse({ type: "ready" }).success, true);
  assert.equal(readyFrameSchema.safeParse({ type: "ready", extra: true }).success, false);
});

test("type guards reconhecem apenas os nomes registrados", () => {
  assert.equal(isMethodName("settings.get"), true);
  assert.equal(isMethodName("missing.method"), false);
  assert.equal(isMethodName(null), false);
  assert.equal(isEventName("bridge.status"), true);
  assert.equal(isEventName("missing.event"), false);
  assert.equal(isEventName(undefined), false);
});
