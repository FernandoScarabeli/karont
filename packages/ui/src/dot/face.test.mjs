import assert from "node:assert/strict";
import test from "node:test";
import { EYE, HALF_GAP, newEye, newLid, placeEye, placeLid } from "./face.ts";
import { VEIL_FACE_Y, veilPath } from "./veil.ts";

test("rosto em repouso: olhos simétricos e pálpebra invisível", () => {
  const left = placeEye(newEye(), 0, 0, 0, VEIL_FACE_Y, 0, 1, 1, 0, 1);
  const right = placeEye(newEye(), 1, 0, 0, VEIL_FACE_Y, 0, 1, 1, 0, 1);
  assert.equal(left.px, 50 - HALF_GAP);
  assert.equal(right.px, 50 + HALF_GAP);
  assert.equal(left.py, VEIL_FACE_Y);
  assert.equal(left.w, right.w);
  assert.equal(left.h, right.h);
  assert.ok(left.h > EYE.h * 0.98 && left.h <= EYE.h);
  assert.equal(placeLid(newLid(), left, 0, 0, 0).show, false);
});

test("olhar nos extremos: geometria finita, olhos dentro da cabeça e cantos válidos", () => {
  const eye = newEye();
  for (const x of [-1, -0.85, -0.4, 0, 0.4, 0.85, 1]) {
    for (const y of [-1, -0.85, 0, 0.85, 1]) {
      for (const side of [0, 1]) {
        for (const blink of [0.1, 1]) {
          placeEye(eye, side, x, y, VEIL_FACE_Y, 0, 1, 1, 0, blink);
          assert.ok(Object.values(eye).every(Number.isFinite));
          assert.ok(eye.px - eye.w / 2 > 14 && eye.px + eye.w / 2 < 86);
          assert.ok(eye.py - eye.h / 2 > 8 && eye.py + eye.h / 2 < 70);
          assert.ok(eye.rx >= 0 && eye.rx <= Math.min(eye.w, eye.h) / 2);
        }
      }
    }
  }
});

test("expressões: pálpebras cobrem o lado certo e espelham a inclinação", () => {
  const eye = placeEye(newEye(), 0, 0, 0, VEIL_FACE_Y, 0, 1.15, 1.1, 0, 1);
  for (const [coverage, angle] of [
    [0.6, 0],
    [-0.42, -20],
    [-0.5, 22],
  ]) {
    const left = placeLid(newLid(), eye, 0, coverage, angle);
    const right = placeLid(newLid(), eye, 1, coverage, angle);
    assert.equal(left.show, true);
    assert.equal(left.rot, -right.rot);
    assert.ok(left.w >= eye.w && left.h > 0);
    if (coverage > 0) assert.ok(left.y + left.h > eye.h / 2);
    else assert.ok(left.y < -eye.h / 2);
    assert.ok(
      Object.values(left)
        .filter((v) => typeof v === "number")
        .every(Number.isFinite),
    );
  }
});

test("pano nos limites de movimento mantém um contorno fechado sem valores inválidos", () => {
  for (const lean of [-12, 0, 12]) {
    for (const flare of [-2, 0, 8]) {
      for (const energy of [0.2, 1, 2]) {
        const path = veilPath(lean, Math.PI, flare, energy);
        assert.ok(path.startsWith("M14 46") && path.endsWith("Z"));
        assert.doesNotMatch(path, /NaN|Infinity/);
      }
    }
  }
});
