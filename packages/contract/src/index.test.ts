import assert from "node:assert/strict";
import { test } from "node:test";
import { CONTRACT_VERSION } from "./index.ts";

test("contract version is a positive integer", () => {
  assert.ok(Number.isInteger(CONTRACT_VERSION) && CONTRACT_VERSION > 0);
});
