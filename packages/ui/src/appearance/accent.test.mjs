import assert from "node:assert/strict";
import test from "node:test";
import { ACCENTS, normalizeAccent } from "./accent.ts";

const ON_PRIMARY = "#141415";

function luminance(hex) {
  const channels = [1, 3, 5].map((start) => {
    const value = Number.parseInt(hex.slice(start, start + 2), 16) / 255;
    return value <= 0.03928 ? value / 12.92 : ((value + 0.055) / 1.055) ** 2.4;
  });
  return 0.2126 * channels[0] + 0.7152 * channels[1] + 0.0722 * channels[2];
}

function contrast(a, b) {
  const [light, dark] = [luminance(a), luminance(b)].sort((x, y) => y - x);
  return (light + 0.05) / (dark + 0.05);
}

test("a lista de cores é fixa e começa no marfim", () => {
  assert.deepEqual(
    ACCENTS.map((accent) => accent.id),
    ["ivory", "magenta", "turquoise", "lime", "blue", "coral"],
  );
  assert.equal(ACCENTS[0].color, "#F3EEE3");
});

test("normalizeAccent aceita id válido", () => {
  for (const accent of ACCENTS) assert.equal(normalizeAccent(accent.id), accent.id);
});

test("normalizeAccent cai no marfim para o resto", () => {
  assert.equal(normalizeAccent("roxo"), "ivory");
  assert.equal(normalizeAccent(""), "ivory");
  assert.equal(normalizeAccent("Magenta"), "ivory");
  assert.equal(normalizeAccent(null), "ivory");
  assert.equal(normalizeAccent(undefined), "ivory");
  assert.equal(normalizeAccent(3), "ivory");
  assert.equal(normalizeAccent({ id: "lime" }), "ivory");
  assert.equal(normalizeAccent(["lime"]), "ivory");
});

test("cada cor tem contraste WCAG de pelo menos 4,5:1 com o texto sobre ela", () => {
  for (const accent of ACCENTS) {
    const ratio = contrast(accent.color, ON_PRIMARY);
    assert.ok(ratio >= 4.5, `${accent.id}: ${ratio.toFixed(2)}`);
  }
});
