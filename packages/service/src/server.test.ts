import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { lstat, mkdtemp } from "node:fs/promises";
import net, { type Socket } from "node:net";
import os from "node:os";
import path from "node:path";
import { test } from "node:test";
import { BridgeError, MAX_FRAME_BYTES } from "@karont/contract";
import { computeMac, readSecret } from "./auth.ts";
import { connectService } from "./client.ts";
import type { ServicePaths } from "./paths.ts";
import { ServiceAlreadyRunningError, startService } from "./server.ts";
import type { TerminalPty } from "./terminals/manager.ts";
import { encodeFrame, FrameDecoder } from "./wire.ts";

const skip = process.env.KARONT_SKIP_SOCKET_TESTS === "1";

async function testPaths(): Promise<ServicePaths> {
  const root = await mkdtemp(path.join(os.tmpdir(), "k-"));
  const runtimeDir = path.join(root, "r");
  const dataDir = path.join(root, "d");
  return {
    runtimeDir,
    socketPath: path.join(runtimeDir, "service.sock"),
    secretPath: path.join(runtimeDir, "service.secret"),
    dataDir,
    dbPath: path.join(dataDir, "karont.db"),
  };
}

type RawClient = {
  socket: Socket;
  nextFrame(): Promise<unknown>;
};

type RawResponse = { type: "response"; id: string; ok: boolean; result?: unknown };

async function rawClient(paths: ServicePaths): Promise<RawClient> {
  const socket = net.createConnection(paths.socketPath);
  const decoder = new FrameDecoder();
  const frames: unknown[] = [];
  const waiters: Array<{ resolve: (frame: unknown) => void; reject: (error: Error) => void }> = [];
  let closed = false;
  socket.on("error", () => undefined);
  socket.on("close", () => {
    closed = true;
    for (const waiter of waiters.splice(0)) waiter.reject(new Error("Socket fechado."));
  });
  socket.on("data", (chunk) => {
    for (const item of decoder.push(chunk)) {
      if (item.kind === "frame") {
        const waiter = waiters.shift();
        if (waiter) waiter.resolve(item.value);
        else frames.push(item.value);
      }
    }
  });
  const client: RawClient = {
    socket,
    nextFrame: () => {
      const frame = frames.shift();
      if (frame !== undefined) return Promise.resolve(frame);
      if (closed) return Promise.reject(new Error("Socket fechado."));
      return new Promise((resolve, reject) => waiters.push({ resolve, reject }));
    },
  };

  const hello = (await client.nextFrame()) as { type: string; nonce: string };
  assert.equal(hello.type, "hello");
  const secret = await readSecret(paths.secretPath);
  socket.write(encodeFrame({ type: "auth", mac: computeMac(secret, hello.nonce) }));
  const ready = await client.nextFrame();
  assert.deepEqual(ready, { type: "ready" });
  return client;
}

async function waitForClose(socket: Socket): Promise<void> {
  if (socket.destroyed) return;
  await new Promise<void>((resolve) => socket.once("close", () => resolve()));
}

function responseFrame(value: unknown): value is { type: "response"; id: string; ok: boolean } {
  return (
    typeof value === "object" && value !== null && "type" in value && value.type === "response"
  );
}

test("handshake autenticado, ping e settings via client", { skip }, async () => {
  const paths = await testPaths();
  const service = await startService({ paths, dev: false });
  try {
    const client = await connectService({ paths, timeoutMs: 3_000 });
    const ping = await client.request("system.ping", {});
    assert.equal(ping.pong, true);
    assert.equal(Number.isNaN(Date.parse(ping.at)), false);
    assert.deepEqual(await client.request("settings.set", { key: "test.value", value: "ok" }), {
      key: "test.value",
      value: "ok",
    });
    assert.deepEqual(await client.request("settings.get", { key: "test.value" }), {
      key: "test.value",
      value: "ok",
    });
    client.close();
  } finally {
    await service.close();
  }
});

test("MAC errado e ausência de auth fecham a conexão", { skip }, async () => {
  const paths = await testPaths();
  const service = await startService({ paths, dev: false, authTimeoutMs: 75 });
  try {
    const wrong = net.createConnection(paths.socketPath);
    wrong.on("error", () => undefined);
    const decoder = new FrameDecoder();
    const hello = await new Promise<{ nonce: string }>((resolve, reject) => {
      wrong.on("data", (chunk) => {
        const frame = decoder.push(chunk).find((item) => item.kind === "frame");
        if (frame?.kind === "frame") resolve(frame.value as { nonce: string });
      });
      wrong.once("error", reject);
    });
    wrong.write(encodeFrame({ type: "auth", mac: "0".repeat(64) }));
    await waitForClose(wrong);
    assert.equal(typeof hello.nonce, "string");

    const silent = net.createConnection(paths.socketPath);
    silent.on("error", () => undefined);
    const silentDecoder = new FrameDecoder();
    await new Promise<void>((resolve, reject) => {
      const timeout = setTimeout(() => reject(new Error("hello não recebido")), 1_000);
      silent.on("data", (chunk) => {
        if (silentDecoder.push(chunk).some((item) => item.kind === "frame")) {
          clearTimeout(timeout);
          resolve();
        }
      });
    });
    await waitForClose(silent);
  } finally {
    await service.close();
  }
});

test("streaming de 10 MB sobrevive à pausa de leitura e preserva todo o texto", {
  skip,
}, async () => {
  const paths = await testPaths();
  const service = await startService({ paths, dev: true });
  let client: RawClient | undefined;
  try {
    client = await rawClient(paths);
    client.socket.write(
      encodeFrame({
        type: "request",
        id: "stream",
        method: "dev.streamTest",
        params: { chunks: 10_000, chunkSize: 1_000 },
      }),
    );

    const first = await client.nextFrame();
    assert.equal(responseFrame(first), true);
    const response = first as { result: { streamId: string } };
    let text = "";
    let seq = 0;
    let totalBytes = 0;
    let paused = false;
    let done: { totalChunks: number; totalBytes: number } | undefined;
    while (!done) {
      const frame = (await client.nextFrame()) as {
        type: string;
        event?: string;
        payload?: Record<string, unknown>;
      };
      assert.ok(encodeFrame(frame).byteLength <= MAX_FRAME_BYTES);
      if (frame.type !== "event" || !frame.payload) continue;
      if (frame.event === "dev.streamTest.delta") {
        assert.equal(frame.payload.streamId, response.result.streamId);
        assert.equal(frame.payload.seq, seq++);
        text += frame.payload.text as string;
        totalBytes += Buffer.byteLength(frame.payload.text as string, "utf8");
        if (!paused && totalBytes >= 5_000_000) {
          paused = true;
          client.socket.pause();
          setTimeout(() => client?.socket.resume(), 500);
        }
      } else if (frame.event === "dev.streamTest.done") {
        done = frame.payload as { totalChunks: number; totalBytes: number };
      }
    }

    const expected = Array.from({ length: 10_000 }, (_, index) =>
      String(index % 10).repeat(1_000),
    ).join("");
    assert.equal(text, expected);
    assert.equal(totalBytes, 10_000_000);
    assert.deepEqual(done, {
      streamId: response.result.streamId,
      totalChunks: 10_000,
      totalBytes: 10_000_000,
    });
  } finally {
    client?.socket.destroy();
    await service.close();
  }
});

test("requisição acima de 1 MiB não impede a próxima no mesmo socket", { skip }, async () => {
  const paths = await testPaths();
  const service = await startService({ paths, dev: false });
  let client: RawClient | undefined;
  try {
    client = await rawClient(paths);
    const oversized = Buffer.concat([
      Buffer.from('{"type":"request","id":"large","method":"system.ping","params":{},"extra":"'),
      Buffer.alloc(MAX_FRAME_BYTES + 1, 0x78),
      Buffer.from('"}\n'),
      encodeFrame({ type: "request", id: "next", method: "system.ping", params: {} }),
    ]);
    client.socket.write(oversized);
    const response = await client.nextFrame();
    assert.equal(responseFrame(response), true);
    assert.equal((response as { id: string }).id, "next");
  } finally {
    client?.socket.destroy();
    await service.close();
  }
});

test("recusa segundo serviço e substitui socket sem dono", { skip }, async () => {
  const paths = await testPaths();
  const service = await startService({ paths, dev: false });
  await assert.rejects(startService({ paths, dev: false }), ServiceAlreadyRunningError);
  await service.close();

  const script =
    "const net=require('node:net');const s=net.createServer();s.listen(process.argv[1],()=>{process.stdout.write('ready');setInterval(()=>{},1000)});";
  const child = spawn(process.execPath, ["-e", script, paths.socketPath], {
    stdio: ["ignore", "pipe", "ignore"],
  });
  await new Promise<void>((resolve, reject) => {
    const timeout = setTimeout(() => reject(new Error("socket fixture não iniciou")), 2_000);
    child.stdout?.on("data", (chunk: Buffer) => {
      if (chunk.toString().includes("ready")) {
        clearTimeout(timeout);
        resolve();
      }
    });
    child.once("error", reject);
  });
  child.kill("SIGKILL");
  await new Promise<void>((resolve) => child.once("close", () => resolve()));
  assert.equal((await lstat(paths.socketPath)).isSocket(), true);

  const replacement = await startService({ paths, dev: false });
  try {
    const client = await connectService({ paths, timeoutMs: 3_000 });
    assert.equal((await client.request("system.ping", {})).pong, true);
    client.close();
  } finally {
    await replacement.close();
  }
});

test("erro remoto vira BridgeError", { skip }, async () => {
  const paths = await testPaths();
  const service = await startService({ paths, dev: false });
  try {
    const client = await connectService({ paths, timeoutMs: 3_000 });
    await assert.rejects(
      client.request("dev.streamTest", { chunks: 1, chunkSize: 1 }),
      (error: unknown) => error instanceof BridgeError && error.code === "unavailable",
    );
    client.close();
  } finally {
    await service.close();
  }
});

test("dois clientes recebem toda a saída do terminal apesar de um pausar a leitura", {
  skip,
}, async () => {
  const paths = await testPaths();
  const root = path.dirname(paths.runtimeDir);
  const service = await startService({
    paths,
    dev: false,
    homeDir: root,
    env: { ...process.env, SHELL: "/bin/sh" },
  });
  let fast: RawClient | undefined;
  let slow: RawClient | undefined;
  try {
    fast = await rawClient(paths);
    slow = await rawClient(paths);
    const open = await requestRaw(fast, "open", "terminals.open", {
      cwd: root,
      cols: 80,
      rows: 24,
    });
    const terminal = (open.result as { terminal: { id: string } }).terminal;
    const fastFrames = [...open.frames];
    const slowFrames = await waitForEvent(slow, "terminals.changed");
    slow.socket.pause();

    const write = await requestRaw(fast, "write", "terminals.write", {
      id: terminal.id,
      data: "seq 1 200000\n",
    });
    assert.equal(write.ok, true);

    const expected = `${Array.from({ length: 200_000 }, (_, index) => String(index + 1)).join("\r\n")}\r\n`;
    fastFrames.push(...write.frames);
    let fastText = outputText(fastFrames, terminal.id);
    const partialLimit = 256 * 1024;
    while (Buffer.byteLength(fastText, "utf8") < partialLimit) {
      fastFrames.push(await fast.nextFrame());
      fastText = outputText(fastFrames, terminal.id);
    }
    assert.ok(fastText.length > 0, "o cliente ativo recebe saída enquanto o outro está pausado");
    slow.socket.resume();

    while (!fastText.includes(expected)) {
      fastFrames.push(await fast.nextFrame());
      fastText = outputText(fastFrames, terminal.id);
    }
    let slowText = "";
    while (!slowText.includes(expected)) {
      slowFrames.push(await slow.nextFrame());
      slowText = outputText(slowFrames, terminal.id);
    }
    assert.ok(fastText.includes(expected));
    assert.ok(slowText.includes(expected));
    assert.deepEqual(
      outputSequences(fastFrames, terminal.id),
      outputSequences(slowFrames, terminal.id),
    );
    assert.deepEqual(
      outputSequences(fastFrames, terminal.id),
      outputSequences(fastFrames, terminal.id).map((_, index) => index + 1),
    );

    await requestRaw(fast, "close", "terminals.close", { id: terminal.id });
  } finally {
    fast?.socket.destroy();
    slow?.socket.destroy();
    await service.close();
  }
});

test("service.shutdown responde, fecha os terminais e injeta a saída do processo", {
  skip,
}, async () => {
  const paths = await testPaths();
  const root = path.dirname(paths.runtimeDir);
  const terminal = new ShutdownFakePty();
  const exitCodes: number[] = [];
  const service = await startService({
    paths,
    dev: false,
    homeDir: root,
    env: { ...process.env, SHELL: "/bin/sh" },
    ptyFactory: () => terminal,
    exitProcess: (code) => exitCodes.push(code),
  });
  let client: RawClient | undefined;
  try {
    client = await rawClient(paths);
    const open = await requestRaw(client, "open", "terminals.open", {
      cwd: root,
      cols: 80,
      rows: 24,
    });
    assert.equal(open.ok, true);
    const shutdown = await requestRaw(client, "shutdown", "service.shutdown", {});
    assert.deepEqual(shutdown.result, { ok: true });
    await waitUntil(() => exitCodes.length === 1);
    assert.deepEqual(exitCodes, [0]);
    assert.deepEqual(terminal.signals, ["SIGHUP"]);
  } finally {
    client?.socket.destroy();
    await service.close();
  }
});

async function requestRaw(
  client: RawClient,
  id: string,
  method: string,
  params: unknown,
): Promise<RawResponse & { frames: unknown[] }> {
  client.socket.write(encodeFrame({ type: "request", id, method, params }));
  const frames: unknown[] = [];
  while (true) {
    const frame = await client.nextFrame();
    frames.push(frame);
    if (responseFrame(frame) && (frame as RawResponse).id === id) {
      return { ...(frame as RawResponse), frames };
    }
  }
}

async function waitForEvent(client: RawClient, event: string): Promise<unknown[]> {
  const frames: unknown[] = [];
  while (true) {
    const frame = await client.nextFrame();
    frames.push(frame);
    if (typeof frame === "object" && frame !== null && "event" in frame && frame.event === event) {
      return frames;
    }
  }
}

function outputText(frames: unknown[], terminalId: string): string {
  return frames
    .filter(
      (frame): frame is { event: string; payload: { id: string; data: string } } =>
        typeof frame === "object" &&
        frame !== null &&
        "event" in frame &&
        frame.event === "terminals.output" &&
        "payload" in frame &&
        typeof frame.payload === "object" &&
        frame.payload !== null &&
        "id" in frame.payload &&
        frame.payload.id === terminalId &&
        "data" in frame.payload &&
        typeof frame.payload.data === "string",
    )
    .map((frame) => frame.payload.data)
    .join("");
}

function outputSequences(frames: unknown[], terminalId: string): number[] {
  return frames
    .filter(
      (frame): frame is { event: string; payload: { id: string; seq: number } } =>
        typeof frame === "object" &&
        frame !== null &&
        "event" in frame &&
        frame.event === "terminals.output" &&
        "payload" in frame &&
        typeof frame.payload === "object" &&
        frame.payload !== null &&
        "id" in frame.payload &&
        frame.payload.id === terminalId &&
        "seq" in frame.payload &&
        typeof frame.payload.seq === "number",
    )
    .map((frame) => frame.payload.seq);
}

class ShutdownFakePty implements TerminalPty {
  readonly signals: string[] = [];
  #exitListener: ((event: { exitCode: number; signal?: number }) => void) | undefined;

  onData(): { dispose(): void } {
    return { dispose: () => undefined };
  }

  onExit(listener: (event: { exitCode: number; signal?: number }) => void): { dispose(): void } {
    this.#exitListener = listener;
    return { dispose: () => undefined };
  }

  write(): void {}
  resize(): void {}
  pause(): void {}
  resume(): void {}

  kill(signal = "SIGHUP"): void {
    this.signals.push(signal);
    if (signal === "SIGHUP") this.#exitListener?.({ exitCode: 0, signal: 1 });
  }
}

async function waitUntil(condition: () => boolean): Promise<void> {
  const deadline = Date.now() + 3_000;
  while (!condition() && Date.now() < deadline) {
    await new Promise<void>((resolve) => setTimeout(resolve, 5));
  }
  assert.equal(condition(), true);
}
