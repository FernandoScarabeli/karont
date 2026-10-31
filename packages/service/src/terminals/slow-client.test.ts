import assert from "node:assert/strict";
import { EventEmitter } from "node:events";
import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import type { Writable } from "node:stream";
import { test } from "node:test";
import { FrameWriter } from "../connection.ts";
import { TerminalOutputFlow } from "../terminal-output.ts";
import type { TerminalEvent, TerminalPty } from "./manager.ts";
import { TerminalManager } from "./manager.ts";

class ControlledWritable extends EventEmitter {
  readonly frames: Buffer[] = [];
  destroyed = false;
  writableEnded = false;
  #readBlocked = true;
  #blockedCallback: ((error?: Error | null) => void) | undefined;

  write(frame: Buffer, callback?: (error?: Error | null) => void): boolean {
    this.frames.push(Buffer.from(frame));
    if (this.#readBlocked) {
      this.#blockedCallback = callback;
      return false;
    }
    queueMicrotask(() => callback?.());
    return true;
  }

  resumeReading(): void {
    this.#readBlocked = false;
    const callback = this.#blockedCallback;
    this.#blockedCallback = undefined;
    callback?.();
    this.emit("drain");
  }
}

class FakePty implements TerminalPty {
  readonly #dataListeners: Array<(data: string) => void> = [];
  readonly #exitListeners: Array<(event: { exitCode: number; signal?: number }) => void> = [];
  pauseCount = 0;
  resumeCount = 0;

  onData(listener: (data: string) => void): { dispose(): void } {
    this.#dataListeners.push(listener);
    return { dispose: () => undefined };
  }

  onExit(listener: (event: { exitCode: number; signal?: number }) => void): { dispose(): void } {
    this.#exitListeners.push(listener);
    return { dispose: () => undefined };
  }

  write(): void {}
  resize(): void {}
  pause(): void {
    this.pauseCount += 1;
  }
  resume(): void {
    this.resumeCount += 1;
  }
  kill(): void {
    for (const listener of this.#exitListeners) listener({ exitCode: 0 });
  }
  emitData(data: string): void {
    for (const listener of this.#dataListeners) listener(data);
  }
}

test("cliente lento não segura a saída e recebe resync com replay ao voltar a ler", async (context) => {
  const root = await mkdtemp(path.join(os.tmpdir(), "karont-terminal-slow-"));
  context.after(() => rm(root, { recursive: true, force: true }));

  const fastWritable = new ControlledWritable();
  fastWritable.resumeReading();
  const slowWritable = new ControlledWritable();
  const fastFlow = new TerminalOutputFlow(new FrameWriter(fastWritable as unknown as Writable), {
    isOpen: () => true,
    onError: (_error, message) => assert.fail(message),
    maxPendingBytes: 150 * 1024,
  });
  const slowWriter = new FrameWriter(slowWritable as unknown as Writable);
  const slowFlow = new TerminalOutputFlow(slowWriter, {
    isOpen: () => true,
    onError: (_error, message) => assert.fail(message),
    maxPendingBytes: 150 * 1024,
  });
  const pty = new FakePty();
  const manager = new TerminalManager({
    broadcast: async (event: TerminalEvent) => {
      if (event.event !== "terminals.output") return;
      fastFlow.send(event);
      slowFlow.send(event);
    },
    ptyFactory: () => pty,
    env: { SHELL: "/bin/bash" },
    homeDir: root,
    isExecutable: async () => true,
  });

  const { terminal } = await manager.open({ cwd: root, cols: 80, rows: 24 });
  const firstChunk = "a".repeat(100 * 1024);
  const skippedChunk = "b".repeat(100 * 1024);
  pty.emitData(firstChunk);
  await waitUntil(() => terminalOutputs(fastWritable).length === 1);
  pty.emitData(skippedChunk);
  await waitUntil(() => terminalOutputs(fastWritable).length === 2);

  assert.deepEqual(
    terminalOutputs(fastWritable).map((event) => event.payload.seq),
    [1, 2],
  );
  assert.deepEqual(
    terminalOutputs(fastWritable)
      .map((event) => event.payload.data)
      .join(""),
    firstChunk + skippedChunk,
  );
  assert.equal(pty.pauseCount, 2);
  assert.equal(pty.resumeCount, 2);
  assert.equal(terminalOutputs(slowWritable).length, 1);

  slowWritable.resumeReading();
  await waitUntil(() => frames(slowWritable).some((frame) => frame.event === "terminals.resync"));
  const slowFrames = frames(slowWritable);
  assert.deepEqual(
    slowFrames.filter((frame) => frame.event === "terminals.resync").map((frame) => frame.payload),
    [{ id: terminal.id }],
  );

  const generation = slowFlow.captureAttachGeneration(terminal.id);
  const attached = manager.attach(terminal.id);
  slowFlow.completeAttach(terminal.id, generation);
  assert.equal(attached.seq, 2);
  assert.equal(attached.replay, firstChunk + skippedChunk);

  pty.emitData("c");
  await waitUntil(() => terminalOutputs(slowWritable).length === 2);
  assert.equal(terminalOutputs(slowWritable)[1]?.payload.data, "c");
  await manager.close(terminal.id);
  fastFlow.close();
  slowFlow.close();
});

function frames(writable: ControlledWritable): Array<{ event?: string; payload?: unknown }> {
  return writable.frames.map(
    (frame) =>
      JSON.parse(frame.toString("utf8")) as {
        event?: string;
        payload?: unknown;
      },
  );
}

function terminalOutputs(writable: ControlledWritable): Array<{
  event: "terminals.output";
  payload: { id: string; seq: number; data: string };
}> {
  return frames(writable).filter(
    (
      frame,
    ): frame is {
      event: "terminals.output";
      payload: { id: string; seq: number; data: string };
    } => frame.event === "terminals.output",
  );
}

async function waitUntil(condition: () => boolean): Promise<void> {
  const deadline = Date.now() + 3_000;
  while (!condition() && Date.now() < deadline) {
    await new Promise<void>((resolve) => setTimeout(resolve, 5));
  }
  assert.equal(condition(), true);
}
