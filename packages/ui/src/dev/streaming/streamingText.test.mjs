import assert from "node:assert/strict";
import test from "node:test";
import { getSafeRevealLength, splitIntoWords } from "./streamingText.mjs";

test("divide palavras sem perder espaços nem posições", () => {
  assert.deepEqual(splitIntoWords("Olá, mundo!\n código"), [
    { value: "Olá,", start: 0, end: 4, kind: "word" },
    { value: " ", start: 4, end: 5, kind: "space" },
    { value: "mundo!", start: 5, end: 11, kind: "word" },
    { value: "\n ", start: 11, end: 13, kind: "space" },
    { value: "código", start: 13, end: 19, kind: "word" },
  ]);
});

test("segura um corte no meio da palavra e libera a palavra completa", () => {
  assert.equal(getSafeRevealLength("texto novo", 0, 8), 6);
  assert.equal(getSafeRevealLength("texto novo", 6, 9), 6);
  assert.equal(getSafeRevealLength("texto novo ", 6, 11), 11);
});

test("não mostra um par de markdown antes de seu fechamento", () => {
  assert.equal(getSafeRevealLength("Uma **palavra forte** aqui", 4, 17), 4);
  assert.equal(getSafeRevealLength("Uma **palavra forte** aqui", 4, 22), 22);
  assert.equal(getSafeRevealLength("Use `código inline` agora", 4, 14), 4);
  assert.equal(getSafeRevealLength("**forte", 0, 2), 0);
});

test("não corta cercas de código no meio do marcador e libera linhas", () => {
  const code = "```ts\nconst valor = 1;\n```\n";
  assert.equal(getSafeRevealLength(code, 0, 2), 0);
  assert.equal(getSafeRevealLength(code, 0, 3), 3);
  assert.ok(getSafeRevealLength(code, 3, 12) >= 3);
});

test("ao terminar, libera o restante mesmo sem fronteira de palavra", () => {
  assert.equal(getSafeRevealLength("última palavra", 7, 10, true), 14);
});
