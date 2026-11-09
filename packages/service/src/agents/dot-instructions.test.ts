import assert from "node:assert/strict";
import { test } from "node:test";
import type { Dot } from "@karont/contract";
import { dotInstructions } from "./dot-instructions.ts";

function makeDot(overrides: Partial<Dot> = {}, axes: Partial<Dot["personality"]> = {}): Dot {
  return {
    id: "default",
    name: "Caronte",
    color: "#232325",
    enabled: true,
    personality: { explanation: 50, playfulness: 50, boldness: 50, ...axes },
    createdAt: "2026-11-09T00:00:00.000Z",
    updatedAt: "2026-11-09T00:00:00.000Z",
    ...overrides,
  };
}

test("Dot desligado não gera instrução", () => {
  assert.equal(dotInstructions(makeDot({ enabled: false })), undefined);
});

test("a instrução contém o nome e as regras fixas", () => {
  const text = dotInstructions(makeDot());
  assert.ok(text?.includes("Caronte"));
  assert.match(text ?? "", /só o tom/);
  assert.match(text ?? "", /a verdade/);
});

test("faixa do meio não acrescenta jeito de falar", () => {
  assert.doesNotMatch(dotInstructions(makeDot()) ?? "", /Jeito de falar/);
});

test("faixas extremas viram frases diferentes", () => {
  const low = dotInstructions(makeDot({}, { explanation: 0, playfulness: 33, boldness: 0 }));
  const high = dotInstructions(makeDot({}, { explanation: 100, playfulness: 67, boldness: 100 }));
  assert.match(low ?? "", /direto/);
  assert.match(low ?? "", /sério/);
  assert.match(low ?? "", /cauteloso/);
  assert.match(high ?? "", /explicativo/);
  assert.match(high ?? "", /brincalhão/);
  assert.match(high ?? "", /ousado/);
  assert.notEqual(low, high);
});

test("os limites 33/34 e 66/67 mudam de faixa", () => {
  assert.match(dotInstructions(makeDot({}, { boldness: 33 })) ?? "", /cauteloso/);
  assert.doesNotMatch(dotInstructions(makeDot({}, { boldness: 34 })) ?? "", /Jeito de falar/);
  assert.doesNotMatch(dotInstructions(makeDot({}, { boldness: 66 })) ?? "", /Jeito de falar/);
  assert.match(dotInstructions(makeDot({}, { boldness: 67 })) ?? "", /ousado/);
});
