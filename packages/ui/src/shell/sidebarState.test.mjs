import assert from "node:assert/strict";
import test from "node:test";
import { parseSidebarSetting, sameSidebarSetting } from "./sidebarState.ts";

const limits = { min: 200, max: 400, defaultWidth: 232 };
const fallback = { width: 232, collapsed: false };

test("valor salvo válido é mantido", () => {
  assert.deepEqual(parseSidebarSetting({ width: 300, collapsed: true }, limits), {
    width: 300,
    collapsed: true,
  });
});

test("largura fora dos limites é ajustada", () => {
  assert.equal(parseSidebarSetting({ width: 50, collapsed: false }, limits).width, 200);
  assert.equal(parseSidebarSetting({ width: 9000, collapsed: false }, limits).width, 400);
});

test("valores inválidos caem no padrão", () => {
  for (const value of [
    null,
    undefined,
    "300",
    42,
    [],
    {},
    { width: "300", collapsed: false },
    { width: Number.NaN, collapsed: false },
    { width: Number.POSITIVE_INFINITY, collapsed: false },
    { width: 300 },
    { width: 300, collapsed: "sim" },
  ]) {
    assert.deepEqual(parseSidebarSetting(value, limits), fallback);
  }
});

test("compara larguras e estados", () => {
  assert.equal(
    sameSidebarSetting({ width: 232, collapsed: false }, { width: 232, collapsed: false }),
    true,
  );
  assert.equal(
    sameSidebarSetting({ width: 232, collapsed: false }, { width: 232, collapsed: true }),
    false,
  );
});
