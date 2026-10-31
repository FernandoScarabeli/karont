import assert from "node:assert/strict";
import { test } from "node:test";
import {
  clientFrameSchema,
  eventEnvelopeSchema,
  requestEnvelopeSchema,
  responseEnvelopeSchema,
  serverFrameSchema,
} from "./envelopes.ts";

test("envelopes exigem campos e rejeitam chaves extras", () => {
  assert.equal(
    requestEnvelopeSchema.safeParse({ type: "request", id: "1", method: "system.ping", params: {} })
      .success,
    true,
  );
  assert.equal(
    requestEnvelopeSchema.safeParse({ type: "request", id: "1", method: "system.ping" }).success,
    false,
  );
  assert.equal(
    requestEnvelopeSchema.safeParse({
      type: "request",
      id: "1",
      method: "system.ping",
      params: {},
      extra: true,
    }).success,
    false,
  );
  assert.equal(
    eventEnvelopeSchema.safeParse({ type: "event", event: "bridge.status", payload: {} }).success,
    true,
  );
  assert.equal(
    eventEnvelopeSchema.safeParse({ type: "event", event: "bridge.status" }).success,
    false,
  );
  assert.equal(
    responseEnvelopeSchema.safeParse({ type: "response", id: "1", ok: true, result: null }).success,
    true,
  );
  assert.equal(
    responseEnvelopeSchema.safeParse({ type: "response", id: "1", ok: true }).success,
    false,
  );
  assert.equal(
    responseEnvelopeSchema.safeParse({
      type: "response",
      id: "1",
      ok: false,
      error: { code: "internal", message: "Falha." },
    }).success,
    true,
  );
  assert.equal(
    responseEnvelopeSchema.safeParse({
      type: "response",
      id: "1",
      ok: false,
      error: { code: "internal", message: "x".repeat(2_001) },
    }).success,
    false,
  );
});

test("frames cliente e servidor são discriminados pelo tipo", () => {
  assert.equal(clientFrameSchema.safeParse({ type: "auth", mac: "0".repeat(64) }).success, true);
  assert.equal(
    clientFrameSchema.safeParse({ type: "request", id: "1", method: "system.ping", params: {} })
      .success,
    true,
  );
  assert.equal(serverFrameSchema.safeParse({ type: "ready" }).success, true);
  assert.equal(
    serverFrameSchema.safeParse({ type: "response", id: "1", ok: true, result: {} }).success,
    true,
  );
  assert.equal(serverFrameSchema.safeParse({ type: "bogus" }).success, false);
});
