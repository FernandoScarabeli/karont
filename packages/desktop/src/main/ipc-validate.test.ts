import assert from "node:assert/strict";
import test from "node:test";
import { MAX_FRAME_BYTES } from "@karont/contract";
import { validateIpcPayload } from "./ipc-validate.ts";

test("valida payload IPC pelo contrato", () => {
  assert.deepEqual(validateIpcPayload({ method: "system.ping", params: {} }), {
    ok: true,
    request: { type: "request", id: "ipc", method: "system.ping", params: {} },
  });
  assert.equal(validateIpcPayload({ method: "system.ping", params: {}, extra: true }).ok, false);
  assert.deepEqual(validateIpcPayload({ method: "method.unknown", params: {} }), {
    ok: false,
    error: { code: "unknown_method", message: "Método desconhecido." },
  });
  assert.equal(validateIpcPayload({ method: "settings.get", params: {} }).ok, false);
  assert.deepEqual(validateIpcPayload({ method: "settings.get", params: { key: "x" } }), {
    ok: true,
    request: { type: "request", id: "ipc", method: "settings.get", params: { key: "x" } },
  });
});

test("mede o tamanho serializado em bytes e recusa acima do limite", () => {
  const oversized = { method: "system.ping", params: {}, extra: "x".repeat(MAX_FRAME_BYTES) };
  assert.deepEqual(validateIpcPayload(oversized), {
    ok: false,
    error: { code: "too_large", message: "A requisição excede 1 MiB." },
  });
});
