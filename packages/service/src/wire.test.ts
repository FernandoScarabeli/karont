import assert from "node:assert/strict";
import { test } from "node:test";
import { MAX_FRAME_BYTES } from "@karont/contract";
import { encodeFrame, FrameDecoder, FrameTooLargeError } from "./wire.ts";

test("FrameDecoder lida com múltiplas mensagens e fragmentos", () => {
  const decoder = new FrameDecoder();
  assert.deepEqual(decoder.push(Buffer.concat([encodeFrame({ n: 1 }), encodeFrame({ n: 2 })])), [
    { kind: "frame", value: { n: 1 } },
    { kind: "frame", value: { n: 2 } },
  ]);
  assert.deepEqual(decoder.push(Buffer.from('{"text":"par', "utf8")), []);
  assert.deepEqual(decoder.push(Buffer.from('cial"}\n', "utf8")), [
    { kind: "frame", value: { text: "parcial" } },
  ]);
});

test("UTF-8 partido entre chunks é preservado", () => {
  const decoder = new FrameDecoder();
  const frame = encodeFrame({ text: "ação 🧪" });
  const split = frame.indexOf(Buffer.from("ç")) + 1;
  assert.deepEqual(decoder.push(frame.subarray(0, split)), []);
  assert.deepEqual(decoder.push(frame.subarray(split)), [
    { kind: "frame", value: { text: "ação 🧪" } },
  ]);
});

test("linhas vazias são ignoradas e JSON inválido é informado", () => {
  const decoder = new FrameDecoder();
  assert.deepEqual(decoder.push(Buffer.from("\n{nope}\n")), [{ kind: "invalid_json" }]);
});

test("linha grande é descartada até a próxima quebra sem perder a seguinte", () => {
  const decoder = new FrameDecoder();
  const oversized = Buffer.concat([
    Buffer.alloc(MAX_FRAME_BYTES + 1, 0x61),
    Buffer.from("\n"),
    encodeFrame({ recovered: true }),
  ]);
  assert.deepEqual(decoder.push(oversized), [
    { kind: "too_large" },
    { kind: "frame", value: { recovered: true } },
  ]);
});

test("encodeFrame rejeita quadros acima do limite incluindo newline", () => {
  assert.throws(() => encodeFrame("x".repeat(MAX_FRAME_BYTES)), FrameTooLargeError);
});
