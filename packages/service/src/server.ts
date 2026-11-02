import type { Stats } from "node:fs";
import { chmod, lstat, unlink } from "node:fs/promises";
import { createConnection, createServer, type Server, type Socket } from "node:net";
import { type AnyEvent, authFrameSchema, CONTRACT_VERSION, parseRequest } from "@karont/contract";
import type { AdapterFactory } from "./agents/adapter.ts";
import { createNonce, createSecret, verifyMac } from "./auth.ts";
import { ConnectionClosedError, FrameWriter } from "./connection.ts";
import { openDatabase } from "./db.ts";
import { createHandlers, type HandlerConnection, ServiceError } from "./handlers.ts";
import { ensurePrivateDir, type ServicePaths } from "./paths.ts";
import { TerminalOutputFlow } from "./terminal-output.ts";
import type { TerminalPtyFactory } from "./terminals/manager.ts";
import { FrameDecoder } from "./wire.ts";

export class ServiceAlreadyRunningError extends Error {
  constructor() {
    super("O serviço Karont já está em execução neste usuário.");
    this.name = "ServiceAlreadyRunningError";
  }
}

export type StartServiceOptions = {
  paths: ServicePaths;
  dev: boolean;
  log?: (message: string, error?: unknown) => void;
  authTimeoutMs?: number;
  env?: NodeJS.ProcessEnv;
  homeDir?: string;
  ptyFactory?: TerminalPtyFactory;
  adapterFactory?: AdapterFactory;
  exitProcess?: (code: number) => void;
};

type ConnectionState = {
  socket: Socket;
  writer: FrameWriter;
  decoder: FrameDecoder;
  authenticated: boolean;
  authTimer: ReturnType<typeof setTimeout>;
  readyPromise: Promise<void>;
  outputFlow: TerminalOutputFlow;
};

export async function startService({
  paths,
  dev,
  log = (message, error) => {
    if (error === undefined) console.error(message);
    else console.error(message, error);
  },
  authTimeoutMs = 5_000,
  env = process.env,
  homeDir,
  ptyFactory,
  adapterFactory,
  exitProcess = (code) => process.exit(code),
}: StartServiceOptions): Promise<{ close(): Promise<void> }> {
  await ensurePrivateDir(paths.runtimeDir);
  await ensurePrivateDir(paths.dataDir);
  await removeStaleSocket(paths.socketPath);

  const db = openDatabase(paths.dbPath);
  let secret: Buffer;
  try {
    secret = await createSecret(paths.secretPath);
  } catch (error) {
    db.close();
    throw error;
  }
  const startedAt = new Date().toISOString();
  const sockets = new Set<ConnectionState>();
  let closing = false;
  let closePromise: Promise<void> | undefined;
  const handlers = createHandlers({
    db,
    startedAt,
    dev,
    env,
    ...(homeDir ? { homeDir } : {}),
    ...(ptyFactory ? { ptyFactory } : {}),
    ...(adapterFactory ? { adapterFactory } : {}),
    emit: async (event: AnyEvent, conn) => {
      await conn.emit(event);
    },
    broadcast,
    shutdown: async () => {
      await closeService();
      exitProcess(0);
    },
  });
  const server: Server = createServer((socket) => {
    if (closing) {
      socket.destroy();
      return;
    }
    acceptConnection(socket);
  });
  server.on("error", (error) => log("Erro no servidor do socket local.", error));

  function acceptConnection(socket: Socket): void {
    const writer = new FrameWriter(socket);
    const decoder = new FrameDecoder();
    const nonce = createNonce();
    const state: ConnectionState = {
      socket,
      writer,
      decoder,
      authenticated: false,
      authTimer: setTimeout(() => socket.destroy(), authTimeoutMs),
      readyPromise: Promise.resolve(),
      outputFlow: undefined as unknown as TerminalOutputFlow,
    };
    state.outputFlow = new TerminalOutputFlow(writer, {
      isOpen: () => state.authenticated && !socket.destroyed && !closing,
      onError: (error, message) => {
        if (error instanceof ConnectionClosedError) return;
        log(message, error);
        socket.destroy();
      },
    });
    sockets.add(state);
    socket.on("error", (error) => log("Erro no socket do serviço.", error));
    socket.on("close", () => {
      clearTimeout(state.authTimer);
      state.outputFlow.close();
      sockets.delete(state);
    });
    socket.on("data", (chunk: Buffer) => {
      for (const item of decoder.push(chunk)) {
        if (!state.authenticated) {
          if (item.kind !== "frame") {
            socket.destroy();
            return;
          }
          const auth = authFrameSchema.safeParse(item.value);
          if (!auth.success || !verifyMac(secret, nonce, auth.data.mac)) {
            socket.destroy();
            return;
          }
          state.authenticated = true;
          clearTimeout(state.authTimer);
          state.readyPromise = writer.send({ type: "ready" }).catch((error: unknown) => {
            if (!(error instanceof ConnectionClosedError))
              log("Não foi possível enviar ready.", error);
            socket.destroy();
          });
          continue;
        }

        if (item.kind === "invalid_json") {
          log("Mensagem JSON inválida recebida pelo serviço.");
          continue;
        }
        if (item.kind === "too_large") {
          log("Mensagem acima do limite recebida pelo serviço.");
          continue;
        }

        void state.readyPromise
          .then(() => handleAuthorizedFrame(state, item.value))
          .catch((error: unknown) => {
            if (!(error instanceof ConnectionClosedError))
              log("Falha ao processar mensagem do cliente.", error);
          });
      }
    });

    void writer
      .send({ type: "hello", contractVersion: CONTRACT_VERSION, nonce })
      .catch((error: unknown) => {
        if (!(error instanceof ConnectionClosedError)) log("Não foi possível enviar hello.", error);
        socket.destroy();
      });
  }

  async function broadcast(event: AnyEvent): Promise<void> {
    const recipients = [...sockets].filter(
      (state) => state.authenticated && !state.socket.destroyed,
    );
    await Promise.all(recipients.map((state) => sendBroadcastEvent(state, event)));
  }

  async function sendBroadcastEvent(state: ConnectionState, event: AnyEvent): Promise<void> {
    if (event.event === "terminals.output") {
      state.outputFlow.send(event);
      return;
    }

    try {
      await state.writer.send({ type: "event", event: event.event, payload: event.payload });
    } catch (error) {
      handleSendError(state, error, "Falha ao enviar evento; a conexão será encerrada.");
    }
  }

  function handleSendError(state: ConnectionState, error: unknown, message: string): void {
    if (error instanceof ConnectionClosedError) return;
    log(message, error);
    state.socket.destroy();
  }

  function closeService(): Promise<void> {
    if (closePromise) return closePromise;
    closing = true;
    closePromise = (async () => {
      const serverClosed = server.listening
        ? new Promise<void>((resolve) => server.close(() => resolve()))
        : Promise.resolve();
      for (const state of sockets) {
        clearTimeout(state.authTimer);
        state.outputFlow.close();
        state.socket.destroy();
      }
      await handlers.closeTerminals();
      await handlers.closeAgents();
      await serverClosed;
      db.close();
      await Promise.all([
        unlink(paths.socketPath).catch(() => undefined),
        unlink(paths.secretPath).catch(() => undefined),
      ]);
    })();
    return closePromise;
  }

  async function handleAuthorizedFrame(state: ConnectionState, value: unknown): Promise<void> {
    const parsed = parseRequest(value);
    if (!parsed.ok) {
      const id = extractValidId(value);
      if (!id) {
        log(`Requisição inválida ignorada: ${parsed.error.code}.`);
        return;
      }
      await state.writer.send({
        type: "response",
        id,
        ok: false,
        error: parsed.error,
      });
      return;
    }

    const terminalAttach =
      parsed.request.method === "terminals.attach"
        ? {
            id: parsed.request.params.id,
            generation: state.outputFlow.captureAttachGeneration(parsed.request.params.id),
          }
        : undefined;

    const afterResponse: Array<() => void> = [];
    const conn: HandlerConnection = {
      emit: async (event) => {
        if (state.socket.destroyed) throw new ConnectionClosedError();
        await state.writer.send({ type: "event", event: event.event, payload: event.payload });
      },
      afterResponse: (task) => afterResponse.push(task),
      isOpen: () => !state.socket.destroyed && !closing,
    };

    let response: Record<string, unknown>;
    let succeeded = false;
    try {
      const result = await handlers.handle(parsed.request, conn);
      response = { type: "response", id: parsed.request.id, ok: true, result };
      succeeded = true;
    } catch (error) {
      if (error instanceof ServiceError) {
        response = {
          type: "response",
          id: parsed.request.id,
          ok: false,
          error: { code: error.code, message: error.message },
        };
      } else {
        log(`Erro interno no método ${parsed.request.method}.`, error);
        response = {
          type: "response",
          id: parsed.request.id,
          ok: false,
          error: { code: "internal", message: "O serviço encontrou um erro interno." },
        };
      }
    }

    try {
      await state.writer.send(response);
    } catch (error) {
      if (!(error instanceof ConnectionClosedError))
        log("Não foi possível enviar a resposta.", error);
      return;
    }
    if (succeeded && conn.isOpen()) {
      if (terminalAttach) {
        state.outputFlow.completeAttach(terminalAttach.id, terminalAttach.generation);
      }
      for (const task of afterResponse) {
        try {
          void Promise.resolve(task()).catch((error: unknown) => {
            log("Falha numa tarefa iniciada após a resposta.", error);
          });
        } catch (error) {
          log("Falha ao iniciar uma tarefa após a resposta.", error);
        }
      }
    }
  }

  try {
    await new Promise<void>((resolve, reject) => {
      const onError = (error: Error): void => reject(error);
      server.once("error", onError);
      server.listen(paths.socketPath, () => {
        server.off("error", onError);
        resolve();
      });
    });
    await chmod(paths.socketPath, 0o600);
  } catch (error) {
    closing = true;
    if (server.listening) {
      await new Promise<void>((resolve) => server.close(() => resolve()));
    }
    db.close();
    await unlink(paths.socketPath).catch(() => undefined);
    await unlink(paths.secretPath).catch(() => undefined);
    throw error;
  }

  return {
    close: closeService,
  };
}

async function removeStaleSocket(socketPath: string): Promise<void> {
  let info: Stats;
  try {
    info = await lstat(socketPath);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return;
    throw error;
  }
  if (info.isSymbolicLink() || !info.isSocket()) {
    throw new Error(`O caminho ${socketPath} existe e não é um socket Unix.`);
  }

  const active = await probeSocket(socketPath);
  if (active) throw new ServiceAlreadyRunningError();
  await unlink(socketPath);
}

function probeSocket(socketPath: string): Promise<boolean> {
  return new Promise((resolve) => {
    const socket = createConnection(socketPath);
    let settled = false;
    const finish = (active: boolean): void => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      socket.destroy();
      resolve(active);
    };
    const timer = setTimeout(() => finish(false), 250);
    socket.once("connect", () => finish(true));
    socket.once("error", () => finish(false));
  });
}

function extractValidId(value: unknown): string | undefined {
  if (typeof value !== "object" || value === null || !("id" in value)) return undefined;
  const id = (value as { id?: unknown }).id;
  return typeof id === "string" && id.length >= 1 && id.length <= 64 ? id : undefined;
}
