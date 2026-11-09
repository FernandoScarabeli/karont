import { randomUUID } from "node:crypto";
import os from "node:os";
import type { DatabaseSync } from "node:sqlite";
import {
  type AnyEvent,
  CONTRACT_VERSION,
  type JsonValue,
  MAX_CONCURRENT_AGENTS_SETTING,
  type ParsedRequest,
} from "@karont/contract";
import type { AdapterFactory, AgentAdapterRegistration } from "./agents/adapter.ts";
import { ConversationManager } from "./agents/conversation-manager.ts";
import type { AgentDetectionFs } from "./agents/detect.ts";
import { AgentRegistry } from "./agents/registry.ts";
import { DeltaCoalescer } from "./coalescer.ts";
import {
  createProject,
  getProject,
  getProjectByPath,
  getSetting,
  getWorktree,
  listProjects,
  listWorkspaces,
  listWorktrees,
  recordRecentFolder,
  removeProject,
  setSetting,
  updateProject,
} from "./db.ts";
import { ServiceError } from "./errors.ts";
import { gitInfo, listRecentFolders, validateFolder } from "./folders.ts";
import {
  createWorktree,
  mergeWorktree,
  removeWorktree,
  worktreeMergePreview,
  worktreeStatus,
} from "./git/worktrees.ts";
import { getOverview } from "./overview.ts";
import { resolvePaths } from "./paths.ts";
import { TerminalManager, type TerminalPtyFactory } from "./terminals/manager.ts";
import { getSystemUserName } from "./user-name.ts";
import {
  createWorkspaceChecked,
  removeWorkspaceChecked,
  reorderWorkspacesChecked,
  resolveWorkspaceId,
  updateWorkspaceChecked,
} from "./workspaces.ts";

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
  /** Pasta de dados do Karont; as cópias separadas ficam em `<dataDir>/worktrees`. */
  dataDir?: string;
  homeDir?: string;
  platform?: NodeJS.Platform;
  agentFs?: AgentDetectionFs;
  broadcast?: (event: AnyEvent) => Promise<void>;
  ptyFactory?: TerminalPtyFactory;
  shutdown?: () => Promise<void>;
  adapterFactory?: AdapterFactory;
  agentRegistrations?: Readonly<Record<string, AgentAdapterRegistration>>;
};

export function createHandlers({
  db,
  startedAt,
  dev,
  emit,
  env = process.env,
  dataDir = resolvePaths(env).dataDir,
  homeDir = os.homedir(),
  platform = process.platform,
  agentFs,
  broadcast = async () => undefined,
  ptyFactory,
  shutdown,
  adapterFactory,
  agentRegistrations,
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
    ...(agentRegistrations ? { agentRegistrations } : {}),
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
        if (request.params.key === MAX_CONCURRENT_AGENTS_SETTING)
          conversationManager.applyConcurrencyLimit();
        return { key: request.params.key, value: request.params.value };
      case "queue.status":
        return conversationManager.queueStatus();
      case "agents.list":
        return agentRegistry.list();
      case "agents.detect":
        return agentRegistry.detect();
      case "agents.add":
        return agentRegistry.add(request.params);
      case "agents.remove":
        return agentRegistry.remove(request.params.id);
      case "conversation.create": {
        const folder = await validateFolder(request.params.cwd);
        if (!folder.exists) {
          throw new ServiceError(
            "invalid_request",
            `A pasta do projeto não existe: ${folder.path}`,
          );
        }
        if (!folder.isDirectory) {
          throw new ServiceError(
            "invalid_request",
            `O caminho do projeto não é uma pasta: ${folder.path}`,
          );
        }
        const workspaceId = resolveWorkspaceId(db, request.params);
        if (request.params.worktreeId) {
          const worktree = getWorktree(db, request.params.worktreeId);
          if (!worktree) throw new ServiceError("invalid_request", "A cópia separada não existe.");
          if (folder.path !== worktree.path) {
            throw new ServiceError(
              "invalid_request",
              "A conversa precisa usar a pasta da cópia separada.",
            );
          }
        }
        return {
          conversation: await conversationManager.createAnnounced({
            ...request.params,
            workspaceId,
            cwd: folder.path,
            title: request.params.title ?? "Nova conversa",
          }),
        };
      }
      case "conversation.list":
        return { conversations: conversationManager.list(request.params) };
      case "conversation.count":
        return { count: conversationManager.count() };
      case "conversation.get": {
        const result = conversationManager.get(request.params.id, {
          limit: request.params.limit ?? 40,
          before: request.params.before,
        });
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
            request.params.skills,
          )
          .catch((error: unknown) => {
            throw conversationError(error);
          });
      case "conversation.compact":
        return conversationManager.compact(request.params.id).catch((error: unknown) => {
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
      case "restore.list":
        return conversationManager.restoreList(request.params.conversationId);
      case "restore.changes":
        return conversationManager.restoreChanges(
          request.params.conversationId,
          request.params.messageId,
        );
      case "restore.diff":
        return conversationManager.restoreDiff(
          request.params.conversationId,
          request.params.messageId,
          request.params.path,
        );
      case "restore.undoPreview":
        return conversationManager.undoPreview(
          request.params.conversationId,
          request.params.messageId,
        );
      case "restore.undo":
        return conversationManager.undo(request.params.conversationId, request.params.messageId);
      case "agent.models":
        return conversationManager.models(request.params.agent);
      case "agent.capabilities":
        return conversationManager.capabilities(request.params.agent);
      case "composer.files":
        return conversationManager.files(request.params);
      case "composer.skills":
        return conversationManager.skills(request.params);
      case "folders.recent":
        return listRecentFolders(db, homeDir);
      case "folders.validate":
        return validateFolder(request.params.path);
      case "folders.gitInfo":
        return gitInfo(request.params.path);
      case "projects.list":
        return { projects: listProjects(db) };
      case "projects.create": {
        const folder = await validateFolder(request.params.path);
        if (!folder.exists) {
          throw new ServiceError(
            "invalid_request",
            `A pasta do projeto não existe: ${folder.path}`,
          );
        }
        if (!folder.isDirectory) {
          throw new ServiceError(
            "invalid_request",
            `O caminho do projeto não é uma pasta: ${folder.path}`,
          );
        }
        if (getProjectByPath(db, folder.path)) {
          throw new ServiceError("invalid_request", "Esta pasta já pertence a outro projeto.");
        }
        const workspaceId = resolveWorkspaceId(db, { workspaceId: request.params.workspaceId });
        let project: ReturnType<typeof createProject>;
        try {
          project = createProject(db, {
            name: request.params.name,
            icon: request.params.icon,
            path: folder.path,
            defaultAgent: request.params.defaultAgent ?? null,
            workspaceId,
          });
        } catch (error) {
          if (getProjectByPath(db, folder.path)) {
            throw new ServiceError("invalid_request", "Esta pasta já pertence a outro projeto.");
          }
          throw error;
        }
        await broadcast({ event: "projects.changed", payload: { projects: listProjects(db) } });
        return { project };
      }
      case "projects.update": {
        const { id, ...changes } = request.params;
        if (changes.workspaceId !== undefined) resolveWorkspaceId(db, changes);
        const before = getProject(db, id);
        const project = updateProject(db, id, changes);
        if (!project) throw new ServiceError("invalid_request", "O projeto não existe.");
        if (before && before.workspaceId !== project.workspaceId) {
          await terminalManager.reassign({ projectId: id, toWorkspaceId: project.workspaceId });
          await broadcast({
            event: "conversations.workspaceMoved",
            payload: { workspaceId: project.workspaceId, projectId: id },
          });
        }
        await broadcast({ event: "projects.changed", payload: { projects: listProjects(db) } });
        return { project };
      }
      case "projects.remove": {
        if (!removeProject(db, request.params.id)) {
          throw new ServiceError("invalid_request", "O projeto não existe.");
        }
        await terminalManager.reassign({ removedProjectId: request.params.id });
        await broadcast({ event: "projects.changed", payload: { projects: listProjects(db) } });
        return { removed: true };
      }
      case "overview.get":
        return getOverview(db, request.params.since);
      case "workspaces.list":
        return { workspaces: listWorkspaces(db) };
      case "workspaces.create": {
        const workspace = createWorkspaceChecked(db, request.params);
        await broadcast({
          event: "workspaces.changed",
          payload: { workspaces: listWorkspaces(db) },
        });
        return { workspace };
      }
      case "workspaces.update": {
        const workspace = updateWorkspaceChecked(db, request.params);
        await broadcast({
          event: "workspaces.changed",
          payload: { workspaces: listWorkspaces(db) },
        });
        return { workspace };
      }
      case "workspaces.remove": {
        const moved = removeWorkspaceChecked(db, request.params.id);
        await terminalManager.reassign({
          fromWorkspaceId: request.params.id,
          toWorkspaceId: moved,
        });
        await broadcast({
          event: "conversations.workspaceMoved",
          payload: { workspaceId: moved, fromWorkspaceId: request.params.id },
        });
        // O conteúdo do workspace apagado mudou de lugar: avisa as listas de projetos também.
        await broadcast({
          event: "workspaces.changed",
          payload: { workspaces: listWorkspaces(db) },
        });
        await broadcast({ event: "projects.changed", payload: { projects: listProjects(db) } });
        return { removed: true };
      }
      case "workspaces.reorder": {
        const workspaces = reorderWorkspacesChecked(db, request.params.ids);
        await broadcast({ event: "workspaces.changed", payload: { workspaces } });
        return { workspaces };
      }
      case "worktrees.list":
        return { worktrees: listWorktrees(db, request.params.projectId) };
      case "worktrees.create": {
        const worktree = await createWorktree(db, request.params.projectId, { dataDir, homeDir });
        await broadcast({
          event: "worktrees.changed",
          payload: {
            projectId: request.params.projectId,
            worktrees: listWorktrees(db, request.params.projectId),
          },
        });
        return { worktree };
      }
      case "worktrees.status":
        return worktreeStatus(db, request.params.id);
      case "worktrees.mergePreview":
        return worktreeMergePreview(db, request.params.id);
      case "worktrees.merge": {
        const { worktree, commit, targetBranch } = await mergeWorktree(db, request.params.id);
        if (worktree.projectId) {
          await broadcast({
            event: "worktrees.changed",
            payload: {
              projectId: worktree.projectId,
              worktrees: listWorktrees(db, worktree.projectId),
            },
          });
        }
        return { merged: true, commit, targetBranch };
      }
      case "worktrees.remove": {
        const { worktree, branchKept } = await removeWorktree(db, request.params.id, {
          dataDir,
          homeDir,
          force: request.params.force === true,
        });
        if (worktree.projectId) {
          await broadcast({
            event: "worktrees.changed",
            payload: {
              projectId: worktree.projectId,
              worktrees: listWorktrees(db, worktree.projectId),
            },
          });
        }
        return { removed: true, branchKept };
      }
      case "terminals.list":
        return terminalManager.list();
      case "terminals.open": {
        const { projectId, workspaceId: requestedWorkspaceId, ...openParams } = request.params;
        const workspaceId = resolveWorkspaceId(db, {
          projectId,
          workspaceId: requestedWorkspaceId,
        });
        const result = await terminalManager.open({
          ...openParams,
          workspaceId,
          ...(projectId ? { projectId } : {}),
        });
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
