import assert from "node:assert/strict";
import { test } from "node:test";
import { describeAgentError } from "./agentErrors.ts";
import { messagePartSchema } from "./conversations.ts";

const codexSafetyError =
  '{"type":"error","error":{"message":"regurg plugin blocked the output stream.","type":"invalid_request_error","param":null,"code":"safety_violation"},"status":400,"sequence_number":53}';

test("normaliza o erro gravado pelo Codex e conserva o texto cru", () => {
  assert.deepEqual(describeAgentError(codexSafetyError, "codex"), {
    message:
      "O Codex interrompeu a resposta: o filtro de conteúdo do provedor bloqueou o texto. Tente reformular o pedido.",
    details: codexSafetyError,
  });
});

test("encontra JSON de erro dentro de texto de log e usa os campos internos", () => {
  const raw = 'Evento da CLI: {"message":"Muitas requisições","status":429} fim';
  assert.deepEqual(describeAgentError(raw, "claude"), {
    message: "O Claude Code atingiu o limite de uso. Tente de novo mais tarde.",
    details: raw,
  });
});

test("procura o erro dentro de um envelope JSON", () => {
  const raw = '{"type":"response","data":{"error":{"message":"Falha específica"}}}';
  assert.deepEqual(describeAgentError(raw, "claude"), {
    message: "Falha específica",
    details: raw,
  });
});

test("mapeia limite, sobrecarga, conversa longa, login e conexão", () => {
  const cases = [
    [
      '{"error":{"code":"rate_limit"}}',
      "O Codex atingiu o limite de uso. Tente de novo mais tarde.",
    ],
    ['{"status":503}', "O serviço do Codex está sobrecarregado agora. Tente de novo em instantes."],
    [
      '{"error":{"code":"context_length_exceeded"}}',
      "Esta conversa ficou longa demais para o Codex. Comece uma conversa nova.",
    ],
    [
      "prompt is too long",
      "Esta conversa ficou longa demais para o Codex. Comece uma conversa nova.",
    ],
    ["429", "O Codex atingiu o limite de uso. Tente de novo mais tarde."],
    ["529 overloaded", "O serviço do Codex está sobrecarregado agora. Tente de novo em instantes."],
    ["401", "Codex não está conectado. Faça login na CLI e tente novamente."],
    ["not logged in", "Codex não está conectado. Faça login na CLI e tente novamente."],
    ["ECONNRESET", "A conexão com o Codex caiu. Tente de novo."],
    ["ETIMEDOUT", "A conexão com o Codex caiu. Tente de novo."],
  ] as const;

  for (const [raw, message] of cases)
    assert.equal(describeAgentError(raw, "codex").message, message);
});

test("mantém erro desconhecido em uma linha e corta a mensagem longa", () => {
  const raw = '{"error":{"message":"Erro interno\\nlinha de detalhes"}}';
  assert.deepEqual(describeAgentError(raw), {
    message: "Erro interno",
    details: raw,
  });
  const longRaw = `x${"a".repeat(300)}`;
  assert.equal(describeAgentError(longRaw).message.length, 240);
  assert.equal(describeAgentError("Falha desconhecida").details, undefined);
});

test("limita detalhes a 8 kB sem quebrar caracteres", () => {
  const result = describeAgentError(`Falha ${"🧩".repeat(3_000)}`);
  assert.ok(result.details);
  assert.ok(Buffer.byteLength(result.details ?? "", "utf8") <= 8 * 1024);
  assert.match(result.details ?? "", /detalhes cortados após 8 kB\]$/u);
});

test("contrato aceita detalhes opcionais e aplica o limite no campo", () => {
  const part = {
    id: "e1",
    type: "error",
    errorType: "failed",
    text: "Falha",
    retryable: true,
  } as const;
  assert.equal(messagePartSchema.safeParse(part).success, true);
  assert.equal(messagePartSchema.safeParse({ ...part, details: "texto cru" }).success, true);
  assert.equal(messagePartSchema.safeParse({ ...part, details: "x".repeat(8_193) }).success, false);
});
