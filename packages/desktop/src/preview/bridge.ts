import { timingSafeEqual } from "node:crypto";
import type { IncomingMessage, ServerResponse } from "node:http";
import {
  type AnyEvent,
  BridgeError,
  MAX_FRAME_BYTES,
  type MethodName,
  parseEvent,
  parseRequest,
} from "@karont/contract";
import type { ServiceClient } from "@karont/service";

type PreviewRequest = IncomingMessage;
type PreviewResponse = ServerResponse;
type TimeoutHandle = ReturnType<typeof setTimeout>;

export type PreviewBridgeTimers = {
  setTimeout(callback: () => void, delayMs: number): TimeoutHandle;
  clearTimeout(timer: TimeoutHandle): void;
  setInterval(callback: () => void, delayMs: number): TimeoutHandle;
  clearInterval(timer: TimeoutHandle): void;
};

export type PreviewBridgeOptions = {
  client: ServiceClient;
  /** Factory used to restore the service connection after the current client closes. */
  connect?: () => Promise<ServiceClient>;
  token: string;
  allowedHosts: ReadonlySet<string>;
  allowedOrigins: ReadonlySet<string>;
  timers?: PreviewBridgeTimers;
  retryDelays?: readonly number[];
};

export type PreviewBridge = {
  handler(request: PreviewRequest, response: PreviewResponse): void;
  close(): void;
};

type Subscriber = {
  response: PreviewResponse;
  queue: string[];
  blocked: boolean;
  closed: boolean;
  onDrain: () => void;
  onClose: () => void;
};

const defaultTimers: PreviewBridgeTimers = {
  setTimeout: (callback, delayMs) => setTimeout(callback, delayMs),
  clearTimeout: (timer) => clearTimeout(timer),
  setInterval: (callback, delayMs) => setInterval(callback, delayMs),
  clearInterval: (timer) => clearInterval(timer),
};

const statusEvent = (state: "connected" | "disconnected"): AnyEvent => ({
  event: "bridge.status",
  payload: { state },
});

export function createPreviewBridge(options: PreviewBridgeOptions): PreviewBridge {
  const timers = options.timers ?? defaultTimers;
  const retryDelays = options.retryDelays ?? [500, 1_000, 2_000, 4_000, 8_000, 10_000];
  const subscribers = new Set<Subscriber>();
  let currentClient: ServiceClient | null = options.client;
  let connected = true;
  let closed = false;
  let retryTimer: TimeoutHandle | undefined;
  let heartbeat: TimeoutHandle | undefined;
  let retryIndex = 0;
  let removeClientListeners: (() => void) | undefined;

  function publish(event: AnyEvent): void {
    const parsed = parseEvent({ type: "event", event: event.event, payload: event.payload });
    if (!parsed.ok) return;
    const line = `data: ${JSON.stringify({ event: parsed.event.event, payload: parsed.event.payload })}\n\n`;
    for (const subscriber of subscribers) enqueue(subscriber, line);
  }

  function enqueue(subscriber: Subscriber, line: string): void {
    if (subscriber.closed) return;
    subscriber.queue.push(line);
    pump(subscriber);
  }

  function pump(subscriber: Subscriber): void {
    if (subscriber.closed || subscriber.blocked) return;
    while (subscriber.queue.length > 0) {
      const line = subscriber.queue.shift();
      if (line === undefined) return;
      if (!subscriber.response.write(line)) {
        subscriber.blocked = true;
        return;
      }
    }
  }

  function removeSubscriber(subscriber: Subscriber): void {
    if (subscriber.closed) return;
    subscriber.closed = true;
    subscriber.queue.length = 0;
    subscriber.response.off("drain", subscriber.onDrain);
    subscriber.response.off("close", subscriber.onClose);
    subscribers.delete(subscriber);
    if (subscribers.size === 0 && heartbeat !== undefined) {
      timers.clearInterval(heartbeat);
      heartbeat = undefined;
    }
  }

  function addSubscriber(response: PreviewResponse): void {
    response.writeHead(200, {
      "Content-Type": "text/event-stream; charset=utf-8",
      "Cache-Control": "no-store",
      "X-Accel-Buffering": "no",
      Connection: "keep-alive",
    });
    const subscriber: Subscriber = {
      response,
      queue: [],
      blocked: false,
      closed: false,
      onDrain: () => {
        subscriber.blocked = false;
        pump(subscriber);
      },
      onClose: () => removeSubscriber(subscriber),
    };
    subscribers.add(subscriber);
    response.on("drain", subscriber.onDrain);
    response.on("close", subscriber.onClose);
    enqueue(
      subscriber,
      `data: ${JSON.stringify({ event: "bridge.status", payload: { state: connected ? "connected" : "disconnected" } })}\n\n`,
    );
    if (subscribers.size > 0) {
      heartbeat =
        heartbeat ??
        timers.setInterval(() => {
          for (const item of subscribers) enqueue(item, ": ping\n\n");
        }, 15_000);
    }
  }

  function detachClient(): void {
    removeClientListeners?.();
    removeClientListeners = undefined;
  }

  function attachClient(client: ServiceClient): void {
    currentClient = client;
    connected = true;
    retryIndex = 0;
    detachClient();
    const removeEventListener = client.onEvent((event) => publish(event));
    const removeCloseListener = client.onClose(() => handleClientClose(client));
    removeClientListeners = () => {
      removeEventListener();
      removeCloseListener();
    };
  }

  function retryDelay(): number {
    const delay = retryDelays[Math.min(retryIndex, retryDelays.length - 1)] ?? 10_000;
    retryIndex += 1;
    return delay;
  }

  function scheduleReconnect(): void {
    if (closed || !options.connect || retryTimer !== undefined) return;
    retryTimer = timers.setTimeout(() => {
      retryTimer = undefined;
      void reconnect();
    }, retryDelay());
  }

  async function reconnect(): Promise<void> {
    if (closed || !options.connect) return;
    try {
      const client = await options.connect();
      if (closed) {
        client.close();
        return;
      }
      attachClient(client);
      publish(statusEvent("connected"));
    } catch {
      scheduleReconnect();
    }
  }

  function handleClientClose(client: ServiceClient): void {
    if (closed || currentClient !== client) return;
    detachClient();
    currentClient = null;
    if (connected) {
      connected = false;
      publish(statusEvent("disconnected"));
    }
    scheduleReconnect();
  }

  attachClient(options.client);

  function handler(request: PreviewRequest, response: PreviewResponse): void {
    if (!hasValidToken(request, options.token)) {
      sendJson(response, 401, {
        ok: false,
        error: { code: "unauthorized", message: "Token inválido." },
      });
      return;
    }
    if (!options.allowedHosts.has(request.headers.host ?? "")) {
      sendJson(response, 403, {
        ok: false,
        error: { code: "unauthorized", message: "Host não permitido." },
      });
      return;
    }
    const origin = request.headers.origin;
    if (
      origin !== undefined &&
      (typeof origin !== "string" || !options.allowedOrigins.has(origin))
    ) {
      sendJson(response, 403, {
        ok: false,
        error: { code: "unauthorized", message: "Origin não permitido." },
      });
      return;
    }

    const pathname = new URL(request.url ?? "/", "http://karont.invalid").pathname;
    if (pathname === "/__karont/events") {
      if (request.method !== "GET") {
        response.setHeader("Allow", "GET");
        sendJson(response, 405, {
          ok: false,
          error: { code: "invalid_request", message: "Método não permitido." },
        });
        return;
      }
      addSubscriber(response);
      return;
    }
    if (pathname !== "/__karont/request") {
      sendJson(response, 404, {
        ok: false,
        error: { code: "invalid_request", message: "Caminho não encontrado." },
      });
      return;
    }
    if (request.method !== "POST") {
      response.setHeader("Allow", "POST");
      sendJson(response, 405, {
        ok: false,
        error: { code: "invalid_request", message: "Método não permitido." },
      });
      return;
    }
    readRequestBody(request, response);
  }

  function readRequestBody(request: PreviewRequest, response: PreviewResponse): void {
    const contentLength = Number(request.headers["content-length"]);
    if (Number.isFinite(contentLength) && contentLength > MAX_FRAME_BYTES) {
      rejectOversizedBody(request, response);
      return;
    }
    const chunks: Buffer[] = [];
    let byteLength = 0;
    let responded = false;
    request.on("data", (chunk: Buffer | string) => {
      if (responded) return;
      const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
      byteLength += buffer.byteLength;
      if (byteLength > MAX_FRAME_BYTES) {
        responded = true;
        chunks.length = 0;
        rejectOversizedBody(request, response);
        return;
      }
      chunks.push(buffer);
    });
    request.on("end", () => {
      if (responded) return;
      responded = true;
      let body: unknown;
      try {
        body = JSON.parse(Buffer.concat(chunks).toString("utf8"));
      } catch {
        sendJson(response, 400, {
          ok: false,
          error: { code: "invalid_request", message: "JSON inválido." },
        });
        return;
      }
      const envelope = isRecord(body) ? { ...body, type: "request", id: "preview" } : body;
      const parsed = parseRequest(envelope);
      if (!parsed.ok) {
        sendJson(response, 400, { ok: false, error: parsed.error });
        return;
      }
      if (!currentClient || !connected) {
        sendJson(response, 200, {
          ok: false,
          error: { code: "unavailable", message: "O serviço não está conectado." },
        });
        return;
      }
      void requestService(currentClient, parsed.request.method, parsed.request.params)
        .then((result) => sendJson(response, 200, { ok: true, result }))
        .catch((error: unknown) => {
          if (error instanceof BridgeError) {
            sendJson(response, 200, {
              ok: false,
              error: { code: error.code, message: error.message },
            });
          } else {
            sendJson(response, 200, {
              ok: false,
              error: { code: "internal", message: "O serviço encontrou um erro interno." },
            });
          }
        });
    });
    request.on("error", () => {
      if (responded) return;
      responded = true;
      sendJson(response, 400, {
        ok: false,
        error: { code: "invalid_request", message: "Corpo da requisição inválido." },
      });
    });
  }

  return {
    handler,
    close(): void {
      if (closed) return;
      closed = true;
      if (retryTimer !== undefined) timers.clearTimeout(retryTimer);
      if (heartbeat !== undefined) timers.clearInterval(heartbeat);
      retryTimer = undefined;
      heartbeat = undefined;
      detachClient();
      const client = currentClient;
      currentClient = null;
      client?.close();
      for (const subscriber of [...subscribers]) {
        removeSubscriber(subscriber);
        subscriber.response.end();
      }
    },
  };
}

function hasValidToken(request: PreviewRequest, token: string): boolean {
  const authorization = request.headers.authorization;
  if (typeof authorization !== "string" || !authorization.startsWith("Bearer ")) return false;
  const expected = Buffer.from(token);
  const candidate = Buffer.from(authorization.slice("Bearer ".length));
  if (expected.byteLength !== candidate.byteLength) return false;
  return timingSafeEqual(expected, candidate);
}

function sendTooLarge(response: PreviewResponse): void {
  sendJson(response, 413, {
    ok: false,
    error: { code: "too_large", message: "O corpo excede 64 MiB." },
  });
}

function rejectOversizedBody(request: PreviewRequest, response: PreviewResponse): void {
  request.pause();
  response.setHeader("Connection", "close");
  sendTooLarge(response);
}

function sendJson(response: PreviewResponse, status: number, value: unknown): void {
  response.writeHead(status, {
    "Content-Type": "application/json; charset=utf-8",
    "Cache-Control": "no-store",
  });
  response.end(JSON.stringify(value));
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function requestService(
  client: ServiceClient,
  method: MethodName,
  params: unknown,
): Promise<unknown> {
  return client.request(method, params as never);
}
