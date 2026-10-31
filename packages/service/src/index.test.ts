import assert from "node:assert/strict";
import { test } from "node:test";
import { CONTRACT_VERSION } from "@karont/contract";
import { serviceContractVersion } from "./index.ts";

test("service uses the shared contract", () => {
  assert.equal(serviceContractVersion, CONTRACT_VERSION);
});
