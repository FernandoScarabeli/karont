import assert from "node:assert/strict";
import test from "node:test";
import { formatWorkDuration, splitFinalAnswer } from "./conversationDisplay.ts";

test("separa a sequência final de textos do histórico", () => {
  const intermediate = { id: "text-1", type: "text", markdown: "Progresso." };
  const action = {
    id: "action-1",
    type: "action",
    actionType: "read",
    title: "src/app.ts",
    input: "src/app.ts",
    output: "",
    truncated: false,
    state: "ok",
    durationMs: 12,
  };
  const finalFirst = { id: "text-2", type: "text", markdown: "Resultado." };
  const finalSecond = { id: "text-3", type: "text", markdown: "Detalhes." };

  assert.deepEqual(splitFinalAnswer([intermediate, action, finalFirst, finalSecond]), {
    history: [intermediate, action],
    finalAnswer: [finalFirst, finalSecond],
  });
});

test("não cria histórico quando a mensagem contém apenas texto", () => {
  const text = { id: "text-1", type: "text", markdown: "Resposta simples." };
  assert.deepEqual(splitFinalAnswer([text]), { history: [], finalAnswer: [text] });
  assert.deepEqual(splitFinalAnswer([]), { history: [], finalAnswer: [] });
});

test("formata duração em segundos, minutos e horas", () => {
  assert.equal(formatWorkDuration(12_000), "Trabalhou por 12s");
  assert.equal(formatWorkDuration(233_000), "Trabalhou por 3m 53s");
  assert.equal(formatWorkDuration(3_723_000), "Trabalhou por 1h 2m");
  assert.equal(formatWorkDuration(3_600_000), "Trabalhou por 1h");
  assert.equal(formatWorkDuration(0), "Trabalhou por 0s");
});

test("não inventa duração quando o valor está ausente ou inválido", () => {
  assert.equal(formatWorkDuration(undefined), "Trabalhou");
  assert.equal(formatWorkDuration(null), "Trabalhou");
  assert.equal(formatWorkDuration(Number.NaN), "Trabalhou");
  assert.equal(formatWorkDuration(-1), "Trabalhou");
});
