import { createConnection, type Socket } from "node:net";
import {
  type AnyEvent,
  BridgeError,
  CONTRACT_VERSION,
  helloFrameSchema,
  type MethodName,
  type ParamsOf,
  parseEvent,
  parseResult,
  type ResultOf,
  readyFrameSchema,
  responseEnvelopeSchema,
} from "@karont/contract";
import { computeMac, readSecret } from "./auth.ts";
import { ConnectionClosedError, FrameWriter } from "./connection.ts";
import type { ServicePaths } from "./paths.ts";
import { FrameDecoder } from "./wire.ts";

export type ServiceClient = {
  request<M extends MethodName>(method: M, params: ParamsOf<M>): Promise<ResultOf<M>>;
  onEvent(listener: (event: AnyEvent) => void): () => void;
  onClose(listener: () => void): () => void;
  close(): void;
};

type PendingRequest = {
  method: MethodName;
  timer: ReturnType<typeof setTimeout>;
  resolve: (result: unknown) => void;
  reject: (error: BridgeError) => void;
};

export async function connectService({
  paths,
  timeoutMs = 30_000,
}: {
  paths: ServicePaths;
  timeoutMs?: number;
}): Promise<ServiceClient> {
  let secret: Buffer;
  try {
    secret = await readSecret(paths.secretPath);
  } catch {
    throw new BridgeError("unavailable", "Não foi possível ler o segredo do serviço local.");
  }
  const socket: Socket = createConnection(paths.socketPath);
  const writer = new FrameWriter(socket);
  const decoder = new FrameDecoder();
  const pending = new Map<string, PendingRequest>();
  const eventListeners = new Set<(event: AnyEvent) => void>();
  const closeListeners = new Set<() => void>();
  let idCounter = 0;
  let handshakeState: "hello" | "auth" | "ready" = "hello";
  let closed = false;
  let connected = false;
  let handshakeTimer: ReturnType<typeof setTimeout> | undefined;
  let resolveClient!: (client: ServiceClient) => void;
  let rejectClient!: (error: BridgeError) => void;

  const clientPromise = new Promise<ServiceClient>((resolve, reject) => {
    resolveClient = resolve;
    rejectClient = reject;
  });

  const rejectPending = (error: BridgeError): void => {
    for (const [id, request] of pending) {
      clearTimeout(request.timer);
      pending.delete(id);
      request.reject(error);
    }
  };

  const notifyClose = (): void => {
    for (const listener of closeListeners) {
      try {
        listener();
      } catch {
        // Listener errors must not affect other connections or listeners.
      }
    }
  };

  const markClosed = (
    error = new BridgeError("unavailable", "A conexão com o serviço foi encerrada."),
  ): void => {
    if (closed) return;
    closed = true;
    if (handshakeTimer !== undefined) clearTimeout(handshakeTimer);
    rejectPending(error);
    if (!connected) rejectClient(error);
    notifyClose();
  };

  const failHandshake = (message: string): void => {
    const error = new BridgeError("unavailable", message);
    markClosed(error);
    socket.destroy();
  };

  const serviceClient: ServiceClient = {
    request<M extends MethodName>(method: M, params: ParamsOf<M>): Promise<ResultOf<M>> {
      if (closed || !connected) {
        return Promise.reject(new BridgeError("unavailable", "O serviço não está conectado."));
      }
      const id = String(++idCounter);
      return new Promise<ResultOf<M>>((resolve, reject) => {
        const timer = setTimeout(() => {
          pending.delete(id);
          reject(new BridgeError("unavailable", "O serviço não respondeu a tempo."));
        }, timeoutMs);
        pending.set(id, {
          method,
          timer,
          resolve: (result) => resolve(result as ResultOf<M>),
          reject,
        });
        void writer.send({ type: "request", id, method, params }).catch((error: unknown) => {
          const request = pending.get(id);
          if (!request) return;
          pending.delete(id);
          clearTimeout(request.timer);
          reject(
            new BridgeError(
              "unavailable",
              error instanceof ConnectionClosedError
                ? error.message
                : "Não foi possível enviar a requisição ao serviço.",
            ),
          );
        });
      });
    },
    onEvent(listener): () => void {
      eventListeners.add(listener);
      return () => eventListeners.delete(listener);
    },
    onClose(listener): () => void {
      if (closed) {
        queueMicrotask(listener);
        return () => undefined;
      }
      closeListeners.add(listener);
      return () => closeListeners.delete(listener);
    },
    close(): void {
      markClosed(
        new BridgeError("unavailable", "A conexão com o serviço foi fechada pelo cliente."),
      );
      socket.destroy();
    },
  };

  handshakeTimer = setTimeout(
    () => failHandshake("Tempo esgotado ao conectar ao serviço."),
    timeoutMs,
  );
  socket.on("error", () => {
    markClosed(new BridgeError("unavailable", "Não foi possível conectar ao serviço local."));
  });
  socket.on("close", () => markClosed());
  socket.on("connect", () => {
    // The first service frame is hello; no client data is sent before it.
  });
  socket.on("data", (chunk: Buffer) => {
    for (const item of decoder.push(chunk)) {
      if (item.kind !== "frame") {
        failHandshake("O serviço enviou uma mensagem inválida.");
        return;
      }
      if (handshakeState === "hello") {
        const hello = helloFrameSchema.safeParse(item.value);
        if (!hello.success || hello.data.contractVersion !== CONTRACT_VERSION) {
          failHandshake("A versão do contrato do serviço é incompatível.");
          return;
        }
        handshakeState = "auth";
        void writer.send({ type: "auth", mac: computeMac(secret, hello.data.nonce) }).catch(() => {
          failHandshake("Não foi possível autenticar no serviço.");
        });
        continue;
      }
      if (handshakeState === "auth") {
        if (!readyFrameSchema.safeParse(item.value).success) {
          failHandshake("O serviço encerrou o handshake sem enviar ready.");
          return;
        }
        handshakeState = "ready";
        connected = true;
        if (handshakeTimer !== undefined) clearTimeout(handshakeTimer);
        resolveClient(serviceClient);
        continue;
      }

      handleServerFrame(item.value);
    }
  });

  function handleServerFrame(value: unknown): void {
    if (typeof value !== "object" || value === null || !("type" in value)) {
      failHandshake("O serviço enviou um quadro inválido.");
      return;
    }
    const frame = value as { type?: unknown; id?: unknown; result?: unknown; error?: unknown };
    if (frame.type === "event") {
      const parsed = parseEvent(value);
      if (!parsed.ok) {
        failHandshake("O serviço enviou um evento inválido.");
        return;
      }
      for (const listener of eventListeners) {
        try {
          listener(parsed.event);
        } catch {
          // Listener errors must not interfere with the socket protocol.
        }
      }
      return;
    }

    const response = responseEnvelopeSchema.safeParse(value);
    if (!response.success) {
      failHandshake("O serviço enviou uma resposta inválida.");
      return;
    }
    const request = pending.get(response.data.id);
    if (!request) return;
    pending.delete(response.data.id);
    clearTimeout(request.timer);
    if (!response.data.ok) {
      request.reject(new BridgeError(response.data.error.code, response.data.error.message));
      return;
    }
    const result = parseResult(request.method, response.data.result);
    if (!result.ok) {
      request.reject(new BridgeError(result.error.code, result.error.message));
      return;
    }
    request.resolve(result.result);
  }

  return clientPromise;
}
