import assert from "node:assert/strict";
import { test } from "node:test";
import { parseAnsiOutput } from "./ansiOutput.ts";

test("interpreta cores ANSI básicas e estilos de destaque", () => {
  assert.deepEqual(parseAnsiOutput("\u001b[1;2;31;44mFalha\u001b[0m normal"), {
    segments: [
      {
        text: "Falha",
        foreground: 1,
        background: 4,
        bold: true,
        dim: true,
      },
      {
        text: " normal",
        foreground: null,
        background: null,
        bold: false,
        dim: false,
      },
    ],
    hasSgr: true,
  });
});

test("suporta as 16 cores e redefine cor sem remover o negrito", () => {
  const parsed = parseAnsiOutput("\u001b[97mClaro\u001b[39;1m negrito\u001b[22m normal");
  assert.deepEqual(
    parsed.segments.map(({ text, foreground, bold }) => ({ text, foreground, bold })),
    [
      { text: "Claro", foreground: 15, bold: false },
      { text: " negrito", foreground: null, bold: true },
      { text: " normal", foreground: null, bold: false },
    ],
  );
  assert.equal(parsed.hasSgr, true);
});

test("mapeia as 16 cores ANSI de texto e fundo", () => {
  const foregroundCodes = Array.from({ length: 16 }, (_, index) =>
    index < 8 ? 30 + index : 90 + index - 8,
  );
  const backgroundCodes = Array.from({ length: 16 }, (_, index) =>
    index < 8 ? 40 + index : 100 + index - 8,
  );
  const foreground = parseAnsiOutput(
    foregroundCodes.map((code, index) => `\u001b[${code}m${index}`).join(""),
  );
  const background = parseAnsiOutput(
    backgroundCodes.map((code, index) => `\u001b[${code}m${index}`).join(""),
  );

  assert.deepEqual(
    foreground.segments.map((segment) => segment.foreground),
    foregroundCodes.map((_, index) => index),
  );
  assert.deepEqual(
    background.segments.map((segment) => segment.background),
    backgroundCodes.map((_, index) => index),
  );
});

test("remove sequências de controle e normaliza quebras de linha", () => {
  const parsed = parseAnsiOutput(
    "A\u001b[2KB\u001b]0;título\u0007\r\nC\u001b[?25l\u0000\u009b2K D\u009d0;título\u009c",
  );
  assert.deepEqual(parsed.segments.map((segment) => segment.text).join(""), "AB\nC D");
  assert.equal(parsed.hasSgr, false);
});

test("agrupa saída sem SGR sem atribuir cor", () => {
  assert.deepEqual(parseAnsiOutput("✔ passou\n✗ falhou"), {
    segments: [
      {
        text: "✔ passou\n✗ falhou",
        foreground: null,
        background: null,
        bold: false,
        dim: false,
      },
    ],
    hasSgr: false,
  });
});
