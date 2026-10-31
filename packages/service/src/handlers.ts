import { randomUUID } from "node:crypto";
import type { DatabaseSync } from "node:sqlite";
import {
  type AnyEvent,
  CONTRACT_VERSION,
  type ErrorCode,
  type JsonValue,
  type ParsedRequest,
} from "@karont/contract";
import { DeltaCoalescer } from "./coalescer.ts";
import { getSetting, setSetting } from "./db.ts";

export const SERVICE_VERSION = "0.0.0";

export class ServiceError extends Error {
  readonly code: ErrorCode;

  constructor(code: ErrorCode, message: string) {
    super(message);
    this.name = "ServiceError";
    this.code = code;
  }
}

export type HandlerConnection = {
  emit(event: AnyEvent): Promise<void>;
  afterResponse(task: () => void): void;
  isOpen(): boolean;
};

export type HandlerOptions = {
  db: DatabaseSync;
  startedAt: string;
  dev: boolean;
  emit: (event: AnyEvent, conn: HandlerConnection) => Promise<void>;
};

export function createHandlers({ db, startedAt, dev, emit }: HandlerOptions) {
  const handle = async (request: ParsedRequest, conn: HandlerConnection): Promise<unknown> => {
    switch (request.method) {
      case "system.ping":
        return { pong: true, at: new Date().toISOString() };
      case "system.info":
        return {
          serviceVersion: SERVICE_VERSION,
          contractVersion: CONTRACT_VERSION,
          pid: process.pid,
          startedAt,
          nodeVersion: process.versions.node,
          platform: process.platform,
        };
      case "settings.get":
        return { key: request.params.key, value: getSetting(db, request.params.key) };
      case "settings.set":
        setSetting(db, request.params.key, request.params.value as JsonValue);
        return { key: request.params.key, value: request.params.value };
      case "dev.streamTest": {
        if (!dev)
          throw new ServiceError(
            "unavailable",
            "O teste de streaming só está disponível em desenvolvimento.",
          );
        const streamId = randomUUID();
        const { chunks, chunkSize } = request.params;
        conn.afterResponse(() => {
          void produceStream(streamId, chunks, chunkSize, conn, emit).catch(() => undefined);
        });
        return { streamId };
      }
      default:
        return assertNever(request);
    }
  };

  return { handle };
}

async function produceStream(
  streamId: string,
  chunks: number,
  chunkSize: number,
  conn: HandlerConnection,
  emit: HandlerOptions["emit"],
): Promise<void> {
  let eventSequence = 0;
  let totalBytes = 0;
  const coalescer = new DeltaCoalescer(async (text) => {
    if (!conn.isOpen()) throw new Error("A conexão foi fechada durante o streaming.");
    await emit(
      { event: "dev.streamTest.delta", payload: { streamId, seq: eventSequence++, text } },
      conn,
    );
  });

  for (let chunkIndex = 0; chunkIndex < chunks; chunkIndex += 1) {
    if (!conn.isOpen()) return;
    const text = String(chunkIndex % 10).repeat(chunkSize);
    totalBytes += Buffer.byteLength(text, "utf8");
    await coalescer.add(text);
  }
  await coalescer.end();
  if (!conn.isOpen()) return;
  await emit(
    {
      event: "dev.streamTest.done",
      payload: { streamId, totalChunks: chunks, totalBytes },
    },
    conn,
  );
}

function assertNever(value: never): never {
  throw new Error(`Método sem handler: ${JSON.stringify(value)}`);
}
