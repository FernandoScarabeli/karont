import assert from "node:assert/strict";
import { test } from "node:test";
import { BridgeError, CONTRACT_VERSION } from "./index.ts";

test("contract version is a positive integer", () => {
  assert.ok(Number.isInteger(CONTRACT_VERSION) && CONTRACT_VERSION > 0);
});

test("BridgeError preserves its code and message", () => {
  const error = new BridgeError("unavailable", "Serviço indisponível.");
  assert.equal(error instanceof Error, true);
  assert.equal(error.code, "unavailable");
  assert.equal(error.message, "Serviço indisponível.");
});
