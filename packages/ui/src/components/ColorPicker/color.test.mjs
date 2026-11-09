import assert from "node:assert/strict";
import test from "node:test";
import {
  contrastRatio,
  DEFAULT_COLOR,
  hexToHsv,
  hexToRgb,
  hsvToHex,
  hsvToRgb,
  normalizeHex,
  OUTLINE_MIN_CONTRAST,
  pickEyeColor,
  pickOutlineColor,
  relativeLuminance,
  rgbToHex,
  rgbToHsv,
  SWATCHES,
} from "./color.ts";

const IVORY = "#f3eee3";
const INK = "#141415";

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

test("pickOutlineColor: o grafite ganha uma borda perto de #3a3a3d", () => {
  const outline = pickOutlineColor(DEFAULT_COLOR);
  const { r, g, b } = hexToRgb(outline);
  /* cinza quase neutro, um pouco mais claro que o corpo e perto do que o dono gostou */
  assert.ok(r >= 0x38 && r <= 0x48, outline);
  assert.ok(Math.abs(r - g) <= 4 && Math.abs(b - r) <= 6, outline);
});

test("pickOutlineColor: pelo menos 1,5:1 contra o corpo, em qualquer cor", () => {
  const cores = [
    ...SWATCHES.map((s) => s.hex),
    "#000000",
    "#ffffff",
    "#808080",
    "#7f7f7f",
    "#5a5a5a",
    "#b0b0b0",
    "#0a0a3a",
    "#fff3a0",
  ];
  for (let v = 0; v <= 255; v += 15) cores.push(rgbToHex({ r: v, g: v, b: v }));
  for (let h = 0; h < 360; h += 20) {
    for (const s of [0.3, 0.7, 1]) {
      for (const v of [0.15, 0.4, 0.7, 1]) cores.push(hsvToHex({ h, s, v }));
    }
  }
  for (const body of cores) {
    const outline = pickOutlineColor(body);
    assert.match(outline, /^#[0-9a-f]{6}$/);
    assert.ok(contrastRatio(body, outline) >= OUTLINE_MIN_CONTRAST, `${body} -> ${outline}`);
  }
});

test("pickOutlineColor: em corpo escuro sobe, em corpo claro desce", () => {
  for (const body of [DEFAULT_COLOR, "#000000", "#0a0a3a", "#1a0f0f"]) {
    assert.ok(relativeLuminance(pickOutlineColor(body)) > relativeLuminance(body), body);
  }
  for (const body of ["#f3eee3", "#ffffff", "#c6f135", "#2dd4c4", "#808080", "#ff7a59"]) {
    assert.ok(relativeLuminance(pickOutlineColor(body)) < relativeLuminance(body), body);
  }
});

test("pickOutlineColor: mantém o matiz das cores com cor", () => {
  const hue = (hex) => hexToHsv(hex).h;
  for (const { hex } of SWATCHES.filter((s) => s.id !== "graphite")) {
    const d = Math.abs(hue(pickOutlineColor(hex)) - hue(hex));
    assert.ok(Math.min(d, 360 - d) < 8, `${hex} -> ${pickOutlineColor(hex)}`);
  }
});

test("pickOutlineColor: em corpo claro satura um pouco, em corpo escuro e cinza não inventa matiz", () => {
  assert.ok(hexToHsv(pickOutlineColor("#f3eee3")).s > hexToHsv("#f3eee3").s);
  const gray = hexToRgb(pickOutlineColor("#808080"));
  assert.ok(gray.r === gray.g && gray.g === gray.b);
  assert.equal(pickOutlineColor("não é cor"), pickOutlineColor(DEFAULT_COLOR));
});
