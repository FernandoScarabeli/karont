import { randomUUID } from "node:crypto";
import os from "node:os";
import type { DatabaseSync } from "node:sqlite";
import {
  type AnyEvent,
  CONTRACT_VERSION,
  type JsonValue,
  type ParsedRequest,
} from "@karont/contract";
import type { AdapterFactory } from "./agents/adapter.ts";
import { ConversationManager } from "./agents/conversation-manager.ts";
import type { AgentDetectionFs } from "./agents/detect.ts";
import { AgentRegistry } from "./agents/registry.ts";
import { DeltaCoalescer } from "./coalescer.ts";
import { getSetting, recordRecentFolder, setSetting } from "./db.ts";
import { ServiceError } from "./errors.ts";
import { gitInfo, listRecentFolders, validateFolder } from "./folders.ts";
import { TerminalManager, type TerminalPtyFactory } from "./terminals/manager.ts";
import { getSystemUserName } from "./user-name.ts";

export { ServiceError } from "./errors.ts";

export const SERVICE_VERSION = "0.0.0";

export type HandlerConnection = {
  emit(event: AnyEvent): Promise<void>;
  afterResponse(task: () => void | Promise<void>): void;
  isOpen(): boolean;
};

export type HandlerOptions = {
  db: DatabaseSync;
  startedAt: string;
  dev: boolean;
  emit: (event: AnyEvent, conn: HandlerConnection) => Promise<void>;
  env?: NodeJS.ProcessEnv;
  homeDir?: string;
  platform?: NodeJS.Platform;
  agentFs?: AgentDetectionFs;
  broadcast?: (event: AnyEvent) => Promise<void>;
  ptyFactory?: TerminalPtyFactory;
  shutdown?: () => Promise<void>;
  adapterFactory?: AdapterFactory;
};

export function createHandlers({
  db,
  startedAt,
  dev,
  emit,
  env = process.env,
  homeDir = os.homedir(),
  platform = process.platform,
  agentFs,
  broadcast = async () => undefined,
  ptyFactory,
  shutdown,
  adapterFactory,
}: HandlerOptions) {
  const agentRegistry = new AgentRegistry(db, {
    env,
    homeDir,
    platform,
    ...(agentFs ? { fs: agentFs } : {}),
  });
  const terminalManager = new TerminalManager({
    broadcast,
    env,
    homeDir,
    ...(ptyFactory ? { ptyFactory } : {}),
  });
  const conversationManager = new ConversationManager({
    db,
    broadcast,
    env,
    ...(adapterFactory ? { adapterFactory } : {}),
  });
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
          homeDir,
        };
      case "system.userName":
        return { name: await getSystemUserName({ platform }) };
      case "settings.get":
        return { key: request.params.key, value: getSetting(db, request.params.key) };
      case "settings.set":
        setSetting(db, request.params.key, request.params.value as JsonValue);
        return { key: request.params.key, value: request.params.value };
      case "agents.list":
        return agentRegistry.list();
      case "agents.detect":
        return agentRegistry.detect();
      case "agents.add":
        return agentRegistry.add(request.params);
      case "agents.remove":
        return agentRegistry.remove(request.params.id);
      case "conversation.create":
        return {
          conversation: conversationManager.create({
            ...request.params,
            title: request.params.title ?? "Nova conversa",
          }),
        };
      case "conversation.list":
        return { conversations: conversationManager.list(request.params) };
      case "conversation.count":
        return { count: conversationManager.count() };
      case "conversation.get": {
        const result = conversationManager.get(request.params.id);
        if (!result) throw new ServiceError("unavailable", "Conversa não encontrada.");
        return result;
      }
      case "conversation.markSeen":
        return conversationManager
          .markSeen(request.params.id)
          .then((conversation) => ({ conversation }))
          .catch((error: unknown) => {
            throw conversationError(error);
          });
      case "conversation.send":
        return conversationManager
          .send(
            request.params.id,
            request.params.text,
            request.params.plan,
            request.params.attachments,
          )
          .catch((error: unknown) => {
            throw conversationError(error);
          });
      case "conversation.stop":
        return conversationManager
          .stop(request.params.id)
          .then((stopped) => ({ stopped }))
          .catch((error: unknown) => {
            throw conversationError(error);
          });
      case "conversation.respond": {
        const { id, partId, ...response } = request.params;
        return conversationManager
          .respond(id, partId, response)
          .then(() => ({ ok: true as const }))
          .catch((error: unknown) => {
            throw conversationError(error);
          });
      }
      case "conversation.retry":
        return conversationManager
          .retry(request.params.id, request.params.messageId)
          .then((agentMessage) => ({ agentMessage }))
          .catch((error: unknown) => {
            throw conversationError(error);
          });
      case "conversation.branch":
        return conversationManager
          .branch(request.params.id, request.params.messageId)
          .then((conversation) => ({ conversation }))
          .catch((error: unknown) => {
            throw conversationError(error);
          });
      case "conversation.delete":
        return conversationManager
          .remove(request.params.id)
          .then((deleted) => ({ deleted }))
          .catch((error: unknown) => {
            throw conversationError(error);
          });
      case "conversation.deleteAll":
        return conversationManager
          .deleteAll()
          .then((deleted) => ({ deleted }))
          .catch((error: unknown) => {
            throw conversationError(error);
          });
      case "conversation.rename":
        return conversationManager
          .rename(request.params.id, request.params.title)
          .then((conversation) => ({ conversation }))
          .catch((error: unknown) => {
            throw conversationError(error);
          });
      case "conversation.setPinned":
        return conversationManager
          .setPinned(request.params.id, request.params.pinned)
          .then((conversation) => ({ conversation }))
          .catch((error: unknown) => {
            throw conversationError(error);
          });
      case "conversation.setArchived":
        return conversationManager
          .setArchived(request.params.id, request.params.archived)
          .then((conversation) => ({ conversation }))
          .catch((error: unknown) => {
            throw conversationError(error);
          });
      case "conversation.setOptions":
        return conversationManager
          .setOptions(request.params.id, request.params.options)
          .then((conversation) => ({ conversation }))
          .catch((error: unknown) => {
            throw conversationError(error);
          });
      case "agent.models":
        return conversationManager.models(request.params.agent);
      case "folders.recent":
        return listRecentFolders(db, homeDir);
      case "folders.validate":
        return validateFolder(request.params.path);
      case "folders.gitInfo":
        return gitInfo(request.params.path);
      case "terminals.list":
        return terminalManager.list();
      case "terminals.open": {
        const result = await terminalManager.open(request.params);
        conn.afterResponse(async () => {
          recordRecentFolder(db, {
            path: result.terminal.cwd,
            usedAt: new Date().toISOString(),
          });
          await broadcast({
            event: "folders.changed",
            payload: await listRecentFolders(db, homeDir),
          });
        });
        return result;
      }
      case "terminals.attach":
        return terminalManager.attach(request.params.id);
      case "terminals.write":
        return terminalManager.write(request.params.id, request.params.data);
      case "terminals.resize":
        return terminalManager.resize(request.params.id, request.params.cols, request.params.rows);
      case "terminals.close":
        return terminalManager.close(request.params.id);
      case "service.shutdown":
        conn.afterResponse(async () => {
          await shutdown?.();
        });
        return { ok: true };
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

  return {
    handle,
    closeTerminals: () => terminalManager.closeAll(),
    closeAgents: () => conversationManager.close(),
  };
}

function conversationError(error: unknown): ServiceError {
  return error instanceof ServiceError
    ? error
    : new ServiceError(
        "unavailable",
        error instanceof Error ? error.message : "A operação da conversa falhou.",
      );
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
