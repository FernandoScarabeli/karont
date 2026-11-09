import assert from "node:assert/strict";
import test from "node:test";
import { avatarInitial, coverCrop, isSafeAvatar } from "./avatar.ts";

test("isSafeAvatar aceita só webp, jpeg e png em base64", () => {
  assert.equal(isSafeAvatar("data:image/webp;base64,AAAA"), true);
  assert.equal(isSafeAvatar("data:image/jpeg;base64,AAAA"), true);
  assert.equal(isSafeAvatar("data:image/png;base64,AAAA"), true);
});

test("isSafeAvatar recusa o resto", () => {
  assert.equal(isSafeAvatar("data:image/svg+xml;base64,AAAA"), false);
  assert.equal(isSafeAvatar("data:image/gif;base64,AAAA"), false);
  assert.equal(isSafeAvatar("data:image/png,AAAA"), false);
  assert.equal(isSafeAvatar("blob:http://x/1"), false);
  assert.equal(isSafeAvatar("https://exemplo.com/a.png"), false);
  assert.equal(isSafeAvatar(" data:image/png;base64,AAAA"), false);
  assert.equal(isSafeAvatar(""), false);
  assert.equal(isSafeAvatar(null), false);
  assert.equal(isSafeAvatar(undefined), false);
  assert.equal(isSafeAvatar(42), false);
  assert.equal(isSafeAvatar({}), false);
});

test("coverCrop de paisagem corta dos lados", () => {
  assert.deepEqual(coverCrop(400, 200), { sx: 100, sy: 0, size: 200 });
});

test("coverCrop de retrato corta em cima e embaixo", () => {
  assert.deepEqual(coverCrop(200, 500), { sx: 0, sy: 150, size: 200 });
});

test("coverCrop de quadrado não corta", () => {
  assert.deepEqual(coverCrop(300, 300), { sx: 0, sy: 0, size: 300 });
});

test("avatarInitial usa a primeira letra em maiúscula", () => {
  assert.equal(avatarInitial("fernando"), "F");
  assert.equal(avatarInitial("  ágata"), "Á");
});

test("avatarInitial não corta emoji", () => {
  assert.equal(avatarInitial("😀 ana"), "😀");
  assert.equal(avatarInitial("𝒜na"), "𝒜");
});

test("avatarInitial devolve vazio sem nome", () => {
  assert.equal(avatarInitial(""), "");
  assert.equal(avatarInitial("   "), "");
  assert.equal(avatarInitial(null), "");
  assert.equal(avatarInitial(undefined), "");
});
