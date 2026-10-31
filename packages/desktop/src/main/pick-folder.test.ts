import assert from "node:assert/strict";
import test from "node:test";
import { validatePickFolderOptions } from "./pick-folder.ts";

test("valida opções do seletor nativo sem Electron", () => {
  assert.deepEqual(validatePickFolderOptions(undefined), { ok: true, options: {} });
  assert.deepEqual(validatePickFolderOptions({}), { ok: true, options: {} });
  assert.deepEqual(validatePickFolderOptions({ defaultPath: "/tmp/projeto" }), {
    ok: true,
    options: { defaultPath: "/tmp/projeto" },
  });
  for (const invalid of [
    null,
    { defaultPath: "relativo" },
    { defaultPath: `/${"x".repeat(4_096)}` },
    { defaultPath: "/tmp", extra: true },
    { defaultPath: "/tmp\u0000x" },
  ]) {
    assert.deepEqual(validatePickFolderOptions(invalid), { ok: false });
  }
});
