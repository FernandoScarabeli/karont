import assert from "node:assert/strict";
import test from "node:test";
import {
  contrastRatio,
  DEFAULT_COLOR,
  hexToHsv,
  hexToRgb,
  hsvToHex,
  hsvToRgb,
  needsOutline,
  normalizeHex,
  pickEyeColor,
  relativeLuminance,
  rgbToHex,
  rgbToHsv,
  SWATCHES,
} from "./color.ts";

const IVORY = "#f3eee3";
const INK = "#141415";
const APP_BG = "#0f0f10";

test("normalizeHex: aceita #rgb e #rrggbb, com ou sem #, e devolve minúsculas", () => {
  assert.equal(normalizeHex("#FFF"), "#ffffff");
  assert.equal(normalizeHex("abc"), "#aabbcc");
  assert.equal(normalizeHex("#232325"), "#232325");
  assert.equal(normalizeHex("  #FF4F8B "), "#ff4f8b");
});

test("normalizeHex: valor inválido vira null", () => {
  for (const bad of ["", "#", "#12", "#1234", "#12345", "#1234567", "#ggg", "rgb(1,2,3)", "red"]) {
    assert.equal(normalizeHex(bad), null, bad);
  }
});

test("hex <-> rgb", () => {
  assert.deepEqual(hexToRgb("#ff4f8b"), { r: 255, g: 79, b: 139 });
  assert.equal(rgbToHex({ r: 255, g: 79, b: 139 }), "#ff4f8b");
  assert.equal(hexToRgb("nada"), null);
  assert.equal(rgbToHex({ r: 300, g: -5, b: 0.4 }), "#ff0000");
});

test("hsv <-> rgb: cores de referência", () => {
  assert.deepEqual(rgbToHsv({ r: 255, g: 0, b: 0 }), { h: 0, s: 1, v: 1 });
  assert.deepEqual(rgbToHsv({ r: 0, g: 255, b: 0 }), { h: 120, s: 1, v: 1 });
  assert.deepEqual(rgbToHsv({ r: 0, g: 0, b: 255 }), { h: 240, s: 1, v: 1 });
  assert.deepEqual(rgbToHsv({ r: 0, g: 0, b: 0 }), { h: 0, s: 0, v: 0 });
  assert.deepEqual(rgbToHsv({ r: 255, g: 255, b: 255 }), { h: 0, s: 0, v: 1 });
  assert.equal(hsvToHex({ h: 60, s: 1, v: 1 }), "#ffff00");
  assert.equal(hsvToHex({ h: 360, s: 1, v: 1 }), "#ff0000");
  assert.equal(hsvToHex({ h: 300, s: 0.5, v: 0.5 }), "#804080");
  assert.deepEqual(hsvToRgb({ h: -120, s: 1, v: 1 }), { r: 0, g: 0, b: 255 });
});

test("hex -> hsv -> hex volta ao mesmo valor", () => {
  for (const { hex } of SWATCHES) {
    const hsv = hexToHsv(hex);
    assert.ok(hsv);
    assert.equal(hsvToHex(hsv), hex);
  }
  for (let r = 0; r < 256; r += 51) {
    for (let g = 0; g < 256; g += 51) {
      for (let b = 0; b < 256; b += 51) {
        const hex = rgbToHex({ r, g, b });
        const hsv = hexToHsv(hex);
        assert.ok(hsv);
        assert.equal(hsvToHex(hsv), hex);
      }
    }
  }
});

test("amostras: grafite primeiro, depois as seis cores da decisão 8", () => {
  assert.equal(SWATCHES[0].hex, DEFAULT_COLOR);
  assert.equal(DEFAULT_COLOR, "#232325");
  assert.deepEqual(
    SWATCHES.slice(1).map((s) => s.hex),
    ["#f3eee3", "#ff4f8b", "#2dd4c4", "#c6f135", "#5b8cff", "#ff7a59"],
  );
});

test("luminância e contraste", () => {
  assert.equal(relativeLuminance("#000000"), 0);
  assert.equal(relativeLuminance("#ffffff"), 1);
  assert.ok(Math.abs(contrastRatio("#000000", "#ffffff") - 21) < 1e-9);
  assert.ok(Math.abs(contrastRatio("#ffffff", "#ffffff") - 1) < 1e-9);
  assert.equal(contrastRatio("#232325", "#f3eee3"), contrastRatio("#f3eee3", "#232325"));
});

test("pickEyeColor: corpo escuro leva olhos claros, corpo claro leva olhos escuros", () => {
  assert.equal(pickEyeColor(DEFAULT_COLOR, IVORY, INK).color, IVORY);
  assert.equal(pickEyeColor("#f3eee3", IVORY, INK).color, INK);
  assert.equal(pickEyeColor("#c6f135", IVORY, INK).color, INK);
  assert.equal(pickEyeColor("#ffffff", IVORY, INK).color, INK);
  assert.equal(pickEyeColor("#000000", IVORY, INK).color, IVORY);
});

test("pickEyeColor: sempre 4,5:1 ou mais, em todos os cinzas e nas amostras", () => {
  for (let v = 0; v <= 255; v += 5) {
    const body = rgbToHex({ r: v, g: v, b: v });
    const { color, ratio } = pickEyeColor(body, IVORY, INK);
    assert.ok(ratio >= 4.5, `${body} -> ${color} ${ratio}`);
    assert.ok(Math.abs(ratio - contrastRatio(body, color)) < 1e-9);
  }
  for (const { hex } of SWATCHES) {
    assert.ok(pickEyeColor(hex, IVORY, INK).ratio >= 4.5, hex);
  }
});

test("pickEyeColor: se as duas candidatas falham, cai para branco ou preto puro", () => {
  /* um cinza médio com candidatas parecidas com ele */
  const body = "#808080";
  const { color, ratio } = pickEyeColor(body, "#909090", "#707070");
  assert.ok(ratio >= 4.5);
  assert.ok(color === "#ffffff" || color === "#000000");
});

test("needsOutline: o grafite some no fundo escuro, o azul elétrico não", () => {
  assert.equal(needsOutline(DEFAULT_COLOR, APP_BG), true);
  assert.equal(needsOutline("#000000", APP_BG), true);
  assert.equal(needsOutline("#5b8cff", APP_BG), false);
  assert.equal(needsOutline("#f3eee3", APP_BG), false);
  /* no tema claro é o contrário: o marfim some no fundo claro */
  assert.equal(needsOutline("#f3eee3", "#f4f4f2"), true);
  assert.equal(needsOutline(DEFAULT_COLOR, "#f4f4f2"), false);
});
