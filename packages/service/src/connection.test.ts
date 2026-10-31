import assert from "node:assert/strict";
import { EventEmitter } from "node:events";
import type { Writable } from "node:stream";
import { test } from "node:test";
import {
  ConnectionClosedError,
  FrameTooLargeError,
  FrameWriter,
  MAX_PENDING_FRAME_BYTES,
} from "./connection.ts";

class ControlledWritable extends EventEmitter {
  readonly frames: Buffer[] = [];
  destroyed = false;
  writableEnded = false;
  falseEveryWrite = true;

  write(frame: Buffer, callback?: (error?: Error | null) => void): boolean {
    this.frames.push(Buffer.from(frame));
    if (this.falseEveryWrite) {
      setTimeout(() => {
        callback?.();
        this.emit("drain");
      }, 0);
      return false;
    }
    queueMicrotask(() => callback?.());
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

test("FrameWriter mede bytes pendentes e avisa quando a fila fica ociosa", async () => {
  const writable = new ControlledWritable();
  writable.write = (frame: Buffer) => {
    writable.frames.push(Buffer.from(frame));
    return false;
  };
  const writer = new FrameWriter(writable as unknown as Writable);
  let idleCount = 0;
  writer.onIdle(() => {
    idleCount += 1;
  });
  await new Promise<void>((resolve) => queueMicrotask(resolve));
  assert.equal(idleCount, 1);

  const first = writer.send({ data: "x".repeat(32) });
  const second = writer.send({ data: "y".repeat(32) });
  assert.ok(writer.pendingBytes > 0);
  assert.equal(writer.canSendWithinBudget({ data: "z" }, MAX_PENDING_FRAME_BYTES), true);
  assert.equal(writer.canSendWithinBudget({ data: "z" }, 1), false);
  writable.emit("close");
  await assert.rejects(first, ConnectionClosedError);
  await assert.rejects(second, ConnectionClosedError);
  assert.equal(writer.pendingBytes, 0);
});
