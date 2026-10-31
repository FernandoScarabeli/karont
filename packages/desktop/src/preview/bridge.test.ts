import assert from "node:assert/strict";
import { EventEmitter } from "node:events";
import { mkdtemp, rm } from "node:fs/promises";
import { createServer as createHttpServer, type Server } from "node:http";
import os from "node:os";
import path from "node:path";
import { test } from "node:test";
import { type AnyEvent, BridgeError, type MethodName } from "@karont/contract";
import {
  connectService,
  type ServiceClient,
  type ServicePaths,
  startService,
} from "@karont/service";
import { createPreviewBridge, type PreviewBridgeTimers } from "./bridge.ts";

const skipSocketTests = process.env.KARONT_SKIP_SOCKET_TESTS === "1";
const token = "session-token-for-test";

class FakeRequest extends EventEmitter {
  method: string;
  url: string;
  headers: Record<string, string>;
  resumed = false;
  paused = false;

  constructor({
    method = "POST",
    url = "/__karont/request",
    authorization = `Bearer ${token}`,
    host = "127.0.0.1:5173",
    origin = "http://127.0.0.1:5173",
    contentLength,
  }: {
    method?: string;
    url?: string;
    authorization?: string;
    host?: string;
    origin?: string;
    contentLength?: number;
  } = {}) {
    super();
    this.method = method;
    this.url = url;
    this.headers = { authorization, host, origin };
    if (contentLength !== undefined) this.headers["content-length"] = String(contentLength);
  }

  resume(): this {
    this.resumed = true;
    return this;
  }

  pause(): this {
    this.paused = true;
    return this;
  }

  send(body?: string | Buffer): void {
    if (body !== undefined) this.emit("data", Buffer.isBuffer(body) ? body : Buffer.from(body));
    this.emit("end");
  }
}

class FakeResponse extends EventEmitter {
  statusCode: number | undefined;
  headers: Record<string, string> = {};
  chunks: string[] = [];
  ended = false;
  writeResult: (chunk: string) => boolean = () => true;
  private resolveEnd!: (response: FakeResponse) => void;
  readonly finished = new Promise<FakeResponse>((resolve) => {
    this.resolveEnd = resolve;
  });

  writeHead(status: number, headers: Record<string, string> = {}): this {
    this.statusCode = status;
    Object.assign(this.headers, headers);
    return this;
  }

  setHeader(name: string, value: string): this {
    this.headers[name] = value;
    return this;
  }

  write(chunk: string): boolean {
    this.chunks.push(chunk);
    return this.writeResult(chunk);
  }

  end(chunk?: string): this {
    if (chunk !== undefined) this.chunks.push(chunk);
    this.ended = true;
    this.resolveEnd(this);
    return this;
  }
}

function fakeClient({
  request,
}: {
  request?: (method: MethodName, params: unknown) => Promise<unknown>;
} = {}): {
  client: ServiceClient;
  emit: (event: AnyEvent) => void;
  disconnect: () => void;
  closed: () => boolean;
} {
  const eventListeners = new Set<(event: AnyEvent) => void>();
  const closeListeners = new Set<() => void>();
  let isClosed = false;
  const client = {
    request: (method: MethodName, params: unknown) =>
      request
        ? request(method, params)
        : Promise.resolve({ pong: true, at: "2026-10-31T00:00:00.000Z" }),
    onEvent(listener: (event: AnyEvent) => void) {
      eventListeners.add(listener);
      return () => eventListeners.delete(listener);
    },
    onClose(listener: () => void) {
      if (isClosed) queueMicrotask(listener);
      else closeListeners.add(listener);
      return () => closeListeners.delete(listener);
    },
    close() {
      isClosed = true;
      for (const listener of closeListeners) listener();
      closeListeners.clear();
    },
  } as unknown as ServiceClient;
  return {
    client,
    emit: (event) => {
      for (const listener of eventListeners) listener(event);
    },
    disconnect: () => {
      isClosed = true;
      for (const listener of closeListeners) listener();
      closeListeners.clear();
    },
    closed: () => isClosed,
  };
}

function createBridge(
  client: ServiceClient,
  extras: Partial<Parameters<typeof createPreviewBridge>[0]> = {},
) {
  return createPreviewBridge({
    client,
    token,
    allowedHosts: new Set(["127.0.0.1:5173", "localhost:5173"]),
    allowedOrigins: new Set(["http://127.0.0.1:5173", "http://localhost:5173"]),
    ...extras,
  });
}

async function post(
  handler: (request: never, response: never) => void,
  request: FakeRequest,
  body?: string | Buffer,
): Promise<FakeResponse> {
  const response = new FakeResponse();
  handler(request as never, response as never);
  request.send(body);
  return response.finished;
}

test("autentica token, Host e Origin antes de aceitar requisições", async () => {
  const fake = fakeClient();
  const bridge = createBridge(fake.client);
  try {
    const missingToken = await post(
      bridge.handler as never,
      new FakeRequest({ authorization: "" }),
      "{}",
    );
    assert.equal(missingToken.statusCode, 401);
    const wrongToken = await post(
      bridge.handler as never,
      new FakeRequest({ authorization: "Bearer wrong-token" }),
      "{}",
    );
    assert.equal(wrongToken.statusCode, 401);
    const wrongHost = await post(
      bridge.handler as never,
      new FakeRequest({ host: "attacker.test:5173" }),
      "{}",
    );
    assert.equal(wrongHost.statusCode, 403);
    const wrongOrigin = await post(
      bridge.handler as never,
      new FakeRequest({ origin: "http://attacker.test:5173" }),
      "{}",
    );
    assert.equal(wrongOrigin.statusCode, 403);
    const accepted = await post(
      bridge.handler as never,
      new FakeRequest(),
      JSON.stringify({ method: "system.ping", params: {} }),
    );
    assert.equal(accepted.statusCode, 200);
    assert.deepEqual(JSON.parse(accepted.chunks.join("")), {
      ok: true,
      result: { pong: true, at: "2026-10-31T00:00:00.000Z" },
    });
  } finally {
    bridge.close();
  }
});

test("limita o corpo, rejeita JSON inválido e valida o método pelo contrato", async () => {
  const fake = fakeClient();
  const bridge = createBridge(fake.client);
  try {
    const largeRequest = new FakeRequest();
    const large = await post(bridge.handler as never, largeRequest, Buffer.alloc(1_048_577, 0x78));
    assert.equal(large.statusCode, 413);
    assert.equal(JSON.parse(large.chunks.join("")).error.code, "too_large");
    assert.equal(largeRequest.paused, true);
    assert.equal(largeRequest.resumed, false);

    const invalidJson = await post(bridge.handler as never, new FakeRequest(), "{");
    assert.equal(invalidJson.statusCode, 400);
    assert.equal(JSON.parse(invalidJson.chunks.join("")).error.code, "invalid_request");

    const unknownMethod = await post(
      bridge.handler as never,
      new FakeRequest(),
      JSON.stringify({ method: "method.unknown", params: {} }),
    );
    assert.equal(unknownMethod.statusCode, 400);
    assert.equal(JSON.parse(unknownMethod.chunks.join("")).error.code, "unknown_method");
  } finally {
    bridge.close();
  }
});

test("converte BridgeError do cliente em uma resposta da ponte", async () => {
  const fake = fakeClient({
    request: async () => {
      throw new BridgeError("unavailable", "Serviço caiu.");
    },
  });
  const bridge = createBridge(fake.client);
  try {
    const response = await post(
      bridge.handler as never,
      new FakeRequest(),
      JSON.stringify({ method: "system.ping", params: {} }),
    );
    assert.equal(response.statusCode, 200);
    assert.deepEqual(JSON.parse(response.chunks.join("")), {
      ok: false,
      error: { code: "unavailable", message: "Serviço caiu." },
    });
  } finally {
    bridge.close();
  }
});

test("responde 404 para caminhos desconhecidos e 405 para métodos incompatíveis", async () => {
  const fake = fakeClient();
  const bridge = createBridge(fake.client);
  try {
    const missingPath = await post(
      bridge.handler as never,
      new FakeRequest({ url: "/__karont/missing" }),
    );
    assert.equal(missingPath.statusCode, 404);

    const wrongRequestMethod = await post(
      bridge.handler as never,
      new FakeRequest({ method: "GET" }),
    );
    assert.equal(wrongRequestMethod.statusCode, 405);

    const wrongEventMethod = await post(
      bridge.handler as never,
      new FakeRequest({ method: "POST", url: "/__karont/events" }),
    );
    assert.equal(wrongEventMethod.statusCode, 405);
  } finally {
    bridge.close();
  }
});

test("SSE preserva a ordem sob backpressure e limpa a fila ao fechar", () => {
  const fake = fakeClient();
  const bridge = createBridge(fake.client);
  try {
    const request = new FakeRequest({ method: "GET", url: "/__karont/events" });
    const response = new FakeResponse();
    let shouldBlock = true;
    response.writeResult = () => {
      if (!shouldBlock) return true;
      shouldBlock = false;
      return false;
    };
    bridge.handler(request as never, response as never);
    fake.emit({
      event: "dev.streamTest.delta",
      payload: { streamId: "s", seq: 1, text: "um" },
    });
    fake.emit({
      event: "dev.streamTest.delta",
      payload: { streamId: "s", seq: 2, text: "dois" },
    });
    assert.equal(response.chunks.length, 1);
    response.emit("drain");
    assert.equal(response.chunks.length, 3);
    const events = response.chunks.map((chunk) => JSON.parse(chunk.slice(6).trim()));
    assert.deepEqual(
      events.map((event) => event.payload.seq ?? event.payload.state),
      ["connected", 1, 2],
    );

    const slowRequest = new FakeRequest({ method: "GET", url: "/__karont/events" });
    const slowResponse = new FakeResponse();
    slowResponse.writeResult = () => false;
    bridge.handler(slowRequest as never, slowResponse as never);
    fake.emit({
      event: "dev.streamTest.done",
      payload: { streamId: "s", totalChunks: 1, totalBytes: 2 },
    });
    assert.equal(slowResponse.chunks.length, 1);
    slowResponse.emit("close");
    slowResponse.emit("drain");
    assert.equal(slowResponse.chunks.length, 1);
  } finally {
    bridge.close();
  }
});

class FakeTimers implements PreviewBridgeTimers {
  readonly timeouts: Array<{ callback: () => void; delay: number; cancelled: boolean }> = [];
  readonly intervals: Array<{ callback: () => void; delay: number; cancelled: boolean }> = [];

  setTimeout(callback: () => void, delay: number): ReturnType<typeof setTimeout> {
    const item = { callback, delay, cancelled: false };
    this.timeouts.push(item);
    return item as unknown as ReturnType<typeof setTimeout>;
  }

  clearTimeout(timer: ReturnType<typeof setTimeout>): void {
    const item = timer as unknown as { cancelled: boolean };
    item.cancelled = true;
  }

  setInterval(callback: () => void, delay: number): ReturnType<typeof setTimeout> {
    const item = { callback, delay, cancelled: false };
    this.intervals.push(item);
    return item as unknown as ReturnType<typeof setTimeout>;
  }

  clearInterval(timer: ReturnType<typeof setTimeout>): void {
    const item = timer as unknown as { cancelled: boolean };
    item.cancelled = true;
  }

  runNextTimeout(): void {
    const item = this.timeouts.find((candidate) => !candidate.cancelled);
    assert.ok(item);
    item.cancelled = true;
    item.callback();
  }
}

test("emite status de queda e reconecta com espera crescente", async () => {
  const initial = fakeClient();
  const reconnected = fakeClient();
  const timers = new FakeTimers();
  let attempts = 0;
  const bridge = createBridge(initial.client, {
    timers,
    retryDelays: [500, 1_000],
    connect: async () => {
      attempts += 1;
      if (attempts === 1) throw new Error("Ainda indisponível.");
      return reconnected.client;
    },
  });
  const response = new FakeResponse();
  bridge.handler(
    new FakeRequest({ method: "GET", url: "/__karont/events" }) as never,
    response as never,
  );
  try {
    initial.disconnect();
    assert.match(response.chunks[1] ?? "", /"state":"disconnected"/);
    assert.equal(timers.timeouts.find((timer) => !timer.cancelled)?.delay, 500);
    timers.runNextTimeout();
    await new Promise<void>((resolve) => setImmediate(resolve));
    assert.equal(timers.timeouts.find((timer) => !timer.cancelled)?.delay, 1_000);
    timers.runNextTimeout();
    await new Promise<void>((resolve) => setImmediate(resolve));
    assert.match(response.chunks.at(-1) ?? "", /"state":"connected"/);
    assert.equal(attempts, 2);
  } finally {
    bridge.close();
  }
});

async function temporaryPaths(): Promise<ServicePaths> {
  const root = await mkdtemp(path.join(os.tmpdir(), "karont-preview-"));
  const runtimeDir = path.join(root, "runtime");
  const dataDir = path.join(root, "data");
  return {
    runtimeDir,
    socketPath: path.join(runtimeDir, "service.sock"),
    secretPath: path.join(runtimeDir, "service.secret"),
    dataDir,
    dbPath: path.join(dataDir, "karont.db"),
  };
}

test("integra HTTP local com o serviço real", { skip: skipSocketTests }, async () => {
  const paths = await temporaryPaths();
  const service = await startService({ paths, dev: false });
  const client = await connectService({ paths, timeoutMs: 3_000 });
  const allowedHosts = new Set<string>();
  const allowedOrigins = new Set<string>();
  const bridge = createPreviewBridge({ client, token, allowedHosts, allowedOrigins });
  const server: Server = createHttpServer(bridge.handler);
  try {
    await new Promise<void>((resolve, reject) => {
      server.once("error", reject);
      server.listen(0, "127.0.0.1", () => resolve());
    });
    const address = server.address();
    assert.ok(address && typeof address !== "string");
    const host = `127.0.0.1:${address.port}`;
    allowedHosts.add(host);
    allowedOrigins.add(`http://${host}`);
    const response = await fetch(`http://${host}/__karont/request`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${token}`,
        Origin: `http://${host}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ method: "system.ping", params: {} }),
    });
    assert.equal(response.status, 200);
    const body = (await response.json()) as { ok: boolean; result?: { pong: boolean } };
    assert.equal(body.ok, true);
    assert.equal(body.result?.pong, true);
  } finally {
    bridge.close();
    if (server.listening) await new Promise<void>((resolve) => server.close(() => resolve()));
    await service.close();
    const root = path.dirname(paths.runtimeDir);
    await rm(root, { recursive: true, force: true });
  }
});
