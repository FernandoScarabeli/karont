import assert from "node:assert/strict";
import test from "node:test";
import { claudeContextUsage, codexContextUsage } from "./context-usage.ts";

test("Codex usa inputTokens da última chamada sem somar o campo de cache novamente", () => {
  assert.deepEqual(
    codexContextUsage({
      last: { inputTokens: 90_000, cachedInputTokens: 52_000 },
      total: { inputTokens: 340_000, cachedInputTokens: 190_000 },
      modelContextWindow: 200_000,
    }),
    { usedTokens: 90_000, windowTokens: 200_000 },
  );
});

test("Codex não publica uso sem janela de contexto disponível", () => {
  assert.equal(
    codexContextUsage({ last: { inputTokens: 90_000 }, modelContextWindow: null }),
    undefined,
  );
});

test("Claude soma os tokens da última mensagem assistant e lê a janela do modelo", () => {
  assert.deepEqual(
    claudeContextUsage(
      {
        input_tokens: 4_000,
        cache_read_input_tokens: 76_000,
        cache_creation_input_tokens: 10_000,
      },
      { "claude-sonnet-5-5": { contextWindow: 200_000 } },
      "claude-sonnet-5-5",
    ),
    { usedTokens: 90_000, windowTokens: 200_000 },
  );
});

test("Claude não publica valores quando a janela do modelo não está disponível", () => {
  assert.equal(
    claudeContextUsage(
      { input_tokens: 4_000, cache_read_input_tokens: 0, cache_creation_input_tokens: 0 },
      {},
      "claude-sonnet-5-5",
    ),
    undefined,
  );
});
