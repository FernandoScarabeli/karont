import assert from "node:assert/strict";
import { EventEmitter } from "node:events";
import type { Writable } from "node:stream";
import { test } from "node:test";
import { ConnectionClosedError, FrameTooLargeError, FrameWriter } from "./connection.ts";

class ControlledWritable extends EventEmitter {
  readonly frames: Buffer[] = [];
  destroyed = false;
  writableEnded = false;
  falseEveryWrite = true;

  write(frame: Buffer): boolean {
    this.frames.push(Buffer.from(frame));
    if (this.falseEveryWrite) {
      setTimeout(() => this.emit("drain"), 0);
      return false;
    }
    return true;
  }
}

test("FrameWriter preserva ordem e espera drain", async () => {
  const writable = new ControlledWritable();
  const writer = new FrameWriter(writable as unknown as Writable);
  let firstResolved = false;
  const first = writer.send({ n: 1 }).then(() => {
    firstResolved = true;
  });
  assert.equal(firstResolved, false);
  const second = writer.send({ n: 2 });
  await Promise.all([first, second]);
  assert.equal(firstResolved, true);
  assert.deepEqual(
    writable.frames.map((frame) => JSON.parse(frame.toString("utf8"))),
    [{ n: 1 }, { n: 2 }],
  );
});

test("fechar durante backpressure rejeita fila e novos envios", async () => {
  const writable = new ControlledWritable();
  writable.write = (frame: Buffer): boolean => {
    writable.frames.push(Buffer.from(frame));
    return false;
  };
  const writer = new FrameWriter(writable as unknown as Writable);
  const first = writer.send({ n: 1 });
  const second = writer.send({ n: 2 });
  writable.emit("close");
  await assert.rejects(first, ConnectionClosedError);
  await assert.rejects(second, ConnectionClosedError);
  await assert.rejects(writer.send({ n: 3 }), ConnectionClosedError);
});

test("quadro grande rejeita sem fechar a conexão", async () => {
  const writable = new ControlledWritable();
  writable.falseEveryWrite = false;
  const writer = new FrameWriter(writable as unknown as Writable);
  await assert.rejects(writer.send("x".repeat(1_048_576)), FrameTooLargeError);
  await writer.send({ stillOpen: true });
  assert.equal(writable.frames.length, 1);
});
