import assert from "node:assert/strict";
import test from "node:test";
import {
  contextUsagePercent,
  formatContextTokenCount,
  formatContextUsage,
  formatContextUsageDetail,
} from "./contextUsage.ts";

test("formata o tooltip e o detalhe em português do Brasil", () => {
  const usage = { usedTokens: 90_000, windowTokens: 200_000 };

  assert.equal(contextUsagePercent(usage), 45);
  assert.equal(formatContextUsage(usage), "Contexto: 45% · 90 mil de 200 mil tokens");
  assert.equal(formatContextUsageDetail(usage), "90 mil de 200 mil tokens usados");
});

test("formata contagens pequenas e milhões sem precisão desnecessária", () => {
  assert.equal(formatContextTokenCount(950), "950");
  assert.equal(formatContextTokenCount(1_000), "1 mil");
  assert.equal(formatContextTokenCount(1_250_000), "1,3 mi");
});
