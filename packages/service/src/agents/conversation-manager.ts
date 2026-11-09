import { randomUUID } from "node:crypto";
import os from "node:os";
import type { DatabaseSync } from "node:sqlite";
import {
  type AgentCapabilities,
  type AnyEvent,
  agentModelsSchema,
  type ComposerSkill,
  type Conversation,
  type ConversationAttachment,
  type ConversationContextUsage,
  type ConversationMessage,
  DEFAULT_MAX_CONCURRENT_AGENTS,
  describeAgentError,
  MAX_CONCURRENT_AGENTS_LIMIT,
  MAX_CONCURRENT_AGENTS_SETTING,
  type MessagePart,
  type MessageSource,
  type PayloadOf,
  type RestorePointSummary,
  type ResultOf,
  reasoningEffortSchema,
  restoreUnavailableReasonSchema,
} from "@karont/contract";
import { validateAttachments } from "../attachments.ts";
import { DeltaCoalescer } from "../coalescer.ts";
import { ComposerFileSearch } from "../composer-files.ts";
import {
  addMessage,
  completeBranchContext,
  completeBranchFork,
  countConversations,
  createConversation,
  createRestorePoint,
  deleteAllConversations,
  deleteConversation,
  deleteRestorePoints,
  getAgentSession,
  getBranchContextPending,
  getConversation,
  getRestorePoint,
  getSetting,
  isBranchForkPending,
  listConversationContextUsage,
  listConversationStates,
  listConversations,
  listExcessRestorePoints,
  listMessages,
  listMessagesPage,
  listRestorePoints,
  listSlotConversationStates,
  markConversationSeen,
  markRestorePointsConcurrent,
  type NewConversation,
  type RestorePointRecord,
  saveMessage,
  setAgentSession,
  setBranchContextPending,
  setBranchSession,
  setConversationContextUsage,
  setConversationTitle,
  setMessageAgentTurnId,
  setRestorePointAfter,
  setRestorePointUndoCommit,
  setRestorePointUndone,
  setSetting,
  updateConversation,
} from "../db.ts";
import { ServiceError } from "../errors.ts";
import {
  applyUndo,
  countRestoreChanges,
  listRestoreChanges,
  previewUndo,
  RestoreError,
  readRestorePatch,
  saveUndoSafety,
} from "../git/restore-diff.ts";
import {
  DEFAULT_RESTORE_TIMEOUT_MS,
  deleteRestoreRefs,
  type RestoreSnapshotOutcome,
  type RestoreSnapshotRequest,
  restoreRef,
  restoreRefs,
  takeRestorePoint,
  undoRef,
} from "../git/restore-points.ts";
import type {
  AdapterEvent,
  AdapterFactory,
  AdapterModelList,
  AdapterResponse,
  AgentAdapter,
  AgentAdapterRegistration,
} from "./adapter.ts";
import {
  AgentCliError,
  createClaudeAdapterRegistration,
  createClaudeModelLoader,
} from "./claude-adapter.ts";
import { createCodexAdapterRegistration, createCodexModelLoader } from "./codex-adapter.ts";
import { generateConversationTitle, type TitleGeneratorOptions } from "./title-generator.ts";

const CODEX_MODELS_SETTING = "agent.codex.models";
const SKILL_CACHE_TTL_MS = 5 * 60_000;
const BRANCH_CONTEXT_LIMIT = 24_000;
const MAX_ATTACHMENT_CACHE_CONVERSATIONS = 3;
const MAX_ATTACHMENT_CACHE_BYTES = 25 * 1024 * 1024;
const MAX_RESTORE_POINTS_PER_CONVERSATION = 50;
const INTERRUPTED_BY_USER_TEXT = "Resposta interrompida pelo usuário.";

type PendingRestoreSnapshot = {
  controller: AbortController;
  message: ConversationMessage;
  stopped: boolean;
};

type ActiveConversation = {
  adapter: AgentAdapter;
  agent: Conversation["agent"];
  sessionId: string;
  startPromise: Promise<void>;
  idleTimer?: ReturnType<typeof setTimeout>;
  messageSaveTimer?: ReturnType<typeof setTimeout>;
  disposePromise?: Promise<void>;
  messageToSave?: ConversationMessage;
  currentMessage?: ConversationMessage;
  stopRequested: boolean;
  removed: boolean;
  turnStarted: boolean;
  coalescers: Map<string, DeltaCoalescer>;
  deltaTimes: Map<string, { startedAt: number; endedAt: number }>;
  sources: MessageSource[];
  sourcePartId?: string;
  pendingPartIds: Set<string>;
  eventQueue: Promise<void>;
};

type QueuedTurn = {
  conversationId: string;
  message: ConversationMessage;
  text: string;
  plan: boolean | undefined;
  attachments: ConversationAttachment[];
  skills: Array<Pick<ComposerSkill, "name" | "path">>;
  operation: "send" | "compact";
};

function isBusyState(state: Conversation["state"]): boolean {
  return state === "queued" || state === "working" || state === "waiting";
}

type RestoreCommits = {
  root: string;
  conversationId: string;
  messageId: string;
  before: string;
  after: string;
};

function summarizeRestorePoint(row: RestorePointRecord): RestorePointSummary {
  const state: RestorePointSummary["state"] = !row.beforeCommit
    ? "unavailable"
    : row.undoneAt
      ? "undone"
      : !row.afterCommit
        ? "incomplete"
        : "ready";
  const reason = restoreUnavailableReasonSchema.safeParse(row.unavailableReason);
  return {
    messageId: row.messageId,
    state,
    ...(state === "unavailable" ? { reason: reason.success ? reason.data : "failed" } : {}),
    changedFiles: row.changedFiles,
    concurrent: row.concurrent,
    headMoved: row.afterCommit !== null && row.headBefore !== row.headAfter,
  };
}

function restoreServiceError(error: unknown): Error {
  if (error instanceof ServiceError) return error;
  if (error instanceof RestoreError) {
    return new ServiceError(
      error.kind === "not-in-list" ? "invalid_request" : "unavailable",
      error.message,
    );
  }
  return error instanceof Error ? error : new Error("A operação de restauração falhou.");
}

export type ConversationManagerOptions = {
  db: DatabaseSync;
  broadcast: (event: AnyEvent) => Promise<void>;
  env?: NodeJS.ProcessEnv;
  adapterFactory?: AdapterFactory;
  agentRegistrations?: Readonly<Record<string, AgentAdapterRegistration>>;
  codexModelLoader?: (cwd: string) => Promise<AdapterModelList>;
  claudeModelLoader?: (cwd: string) => Promise<AdapterModelList>;
  codexSkillLoader?: (cwd: string) => Promise<ComposerSkill[]>;
  claudeSkillLoader?: (cwd: string) => Promise<ComposerSkill[]>;
  now?: () => string;
  /** Pasta pessoal: nunca recebe ponto de restauração. Padrão: `os.homedir()`. */
  homeDir?: string;
  /** Substitui o módulo Git (testes simulam foto lenta ou com falha). */
  restoreSnapshot?: (request: RestoreSnapshotRequest) => Promise<RestoreSnapshotOutcome>;
  titleGenerator?: (
    agent: Conversation["agent"],
    userMessage: string,
    agentResponse: string,
    options?: Pick<TitleGeneratorOptions, "codexModel" | "codexEffort">,
  ) => Promise<string | null>;
};

export class ConversationManager {
  readonly #db: DatabaseSync;
  readonly #broadcast: ConversationManagerOptions["broadcast"];
  readonly #env: NodeJS.ProcessEnv;
  readonly #adapterFactoryOverride: AdapterFactory | undefined;
  readonly #agentRegistrations: Map<string, AgentAdapterRegistration>;
  readonly #codexModelLoader: (cwd: string) => Promise<AdapterModelList>;
  readonly #claudeModelLoader: (cwd: string) => Promise<AdapterModelList>;
  readonly #fileSearch = new ComposerFileSearch();
  readonly #now: () => string;
  readonly #titleGenerator: NonNullable<ConversationManagerOptions["titleGenerator"]>;
  readonly #active = new Map<string, ActiveConversation>();
  readonly #contextUsage = new Map<string, ConversationContextUsage>();
  readonly #latestUserAttachments = new Map<
    string,
    { messageId: string; attachments: ConversationAttachment[]; sizeBytes: number }
  >();
  readonly #removedConversationIds = new Set<string>();
  readonly #homeDir: string;
  readonly #restoreSnapshot: (request: RestoreSnapshotRequest) => Promise<RestoreSnapshotOutcome>;
  // Fotos em andamento (antes e depois), por controlador, para remove/deleteAll/close abortarem.
  readonly #restoreOps = new Map<AbortController, string>();
  readonly #pendingRestoreSnapshots = new Map<string, PendingRestoreSnapshot>();
  readonly #restoreChains = new Map<string, Promise<void>>();
  readonly #afterSnapshotsInFlight = new Set<string>();
  readonly #repoTurns = new Map<string, Set<string>>();
  readonly #undoing = new Set<string>();
  readonly #repoByMessage = new Map<string, string>();
  readonly #pendingParts = new Map<string, { conversationId: string; messageId: string }>();
  readonly #titleRequests = new Map<string, { userMessage: string; attempted: boolean }>();
  #codexModelList: AdapterModelList = {
    models: [],
    efforts: [...reasoningEffortSchema.options],
  };
  #codexModelFetchedAt: string | undefined;
  #codexModelLoadPromise: Promise<void> | undefined;
  #claudeModelList = legacyClaudeModelList();
  #claudeModelFetchedAt: string | undefined;
  #claudeModelLoadPromise: Promise<void> | undefined;
  #claudeModelLoadAttempted = false;
  #closing = false;
  #deletingAll = false;
  readonly #agentOperations = new Set<Promise<unknown>>();
  #queue: QueuedTurn[] = [];
  #lastQueueStatus = "";
  readonly #skillCache = new Map<string, { cachedAt: number; skills: ComposerSkill[] }>();
  readonly #skillLoads = new Map<string, Promise<ComposerSkill[]>>();

  constructor(options: ConversationManagerOptions) {
    this.#db = options.db;
    for (const [conversationId, usage] of listConversationContextUsage(this.#db))
      this.#contextUsage.set(conversationId, usage);
    this.#broadcast = options.broadcast;
    this.#env = options.env ?? process.env;
    const claudeRegistration = createClaudeAdapterRegistration({ env: this.#env });
    const codexRegistration = createCodexAdapterRegistration({ env: this.#env });
    this.#codexModelLoader = options.codexModelLoader ?? createCodexModelLoader({ env: this.#env });
    this.#claudeModelLoader =
      options.claudeModelLoader ?? createClaudeModelLoader({ env: this.#env });
    if (options.codexSkillLoader) codexRegistration.loadSkills = options.codexSkillLoader;
    if (options.claudeSkillLoader) claudeRegistration.loadSkills = options.claudeSkillLoader;
    this.#agentRegistrations = new Map([
      ["claude", claudeRegistration],
      ["codex", codexRegistration],
      ...Object.entries(options.agentRegistrations ?? {}),
    ]);
    this.#adapterFactoryOverride = options.adapterFactory;
    this.#now = options.now ?? (() => new Date().toISOString());
    this.#homeDir = options.homeDir ?? os.homedir();
    this.#restoreSnapshot = options.restoreSnapshot ?? takeRestorePoint;
    this.#titleGenerator =
      options.titleGenerator ??
      ((agent, userMessage, agentResponse, titleOptions) =>
        generateConversationTitle(agent, userMessage, agentResponse, {
          env: this.#env,
          ...titleOptions,
        }));
    this.#lastQueueStatus = JSON.stringify(this.queueStatus());
    const cached = readCodexModelCache(getSetting(this.#db, CODEX_MODELS_SETTING));
    if (cached) {
      this.#codexModelList = cached.modelList;
      this.#codexModelFetchedAt = cached.fetchedAt;
    }
  }

  create(input: NewConversation): Conversation {
    this.#assertNotDeletingAll();
    if (input.fast && !modelSupportsFast(this.#codexModelList, input.agent, input.model)) {
      console.warn("Modo rápido ignorado: o agente ou modelo selecionado não anuncia suporte.", {
        agent: input.agent,
        model: input.model ?? null,
      });
      return createConversation(this.#db, { ...input, fast: false });
    }
    return createConversation(this.#db, input);
  }

  count(): number {
    return countConversations(this.#db);
  }

  async rename(id: string, title: string): Promise<Conversation> {
    const updated = setConversationTitle(this.#db, id, title.trim(), this.#now(), true);
    if (!updated) throw new Error("Conversa não encontrada.");
    const conversation = this.#ignoreClaudeFast(updated);
    this.#titleRequests.delete(id);
    await this.#stateEvent(conversation);
    return conversation;
  }

  list(filters: {
    agent?: string;
    cwd?: string;
    archived?: boolean;
    limit: number;
  }): Conversation[] {
    return listConversations(this.#db, filters).map((conversation) =>
      this.#ignoreClaudeFast(conversation),
    );
  }

  async setPinned(id: string, pinned: boolean): Promise<Conversation> {
    const conversation = this.#requireConversation(id);
    if (pinned && conversation.archivedAt) {
      throw new Error("Não é possível fixar uma conversa arquivada.");
    }
    const now = this.#now();
    conversation.pinnedAt = pinned ? now : null;
    updateConversation(this.#db, conversation);
    await this.#stateEvent(conversation);
    return conversation;
  }

  async setArchived(id: string, archived: boolean): Promise<Conversation> {
    const conversation = this.#requireConversation(id);
    const now = this.#now();
    conversation.archivedAt = archived ? now : null;
    conversation.pinnedAt = null;
    updateConversation(this.#db, conversation);
    await this.#stateEvent(conversation);
    return conversation;
  }

  get(
    id: string,
    options: { limit?: number; before?: string } = {},
  ): {
    conversation: Conversation;
    messages: ConversationMessage[];
    hasOlderMessages: boolean;
    contextUsage?: ConversationContextUsage;
  } | null {
    const conversation = getConversation(this.#db, id);
    if (!conversation) return null;
    const page =
      options.limit === undefined && options.before === undefined
        ? { messages: listMessages(this.#db, id), hasOlderMessages: false }
        : listMessagesPage(this.#db, id, {
            limit: options.limit ?? 40,
            before: options.before,
          });
    const { messages } = page;
    const currentMessage = this.#active.get(id)?.currentMessage;
    if (currentMessage) {
      const index = messages.findIndex((message) => message.id === currentMessage.id);
      if (index >= 0) messages[index] = structuredClone(currentMessage);
    }
    return {
      conversation: this.#ignoreClaudeFast(conversation),
      messages,
      hasOlderMessages: page.hasOlderMessages,
      ...(this.#contextUsage.has(id) ? { contextUsage: this.#contextUsage.get(id) } : {}),
    };
  }

  async files(input: { conversationId: string; query: string } | { cwd: string; query: string }) {
    const cwd =
      "conversationId" in input ? this.#requireConversation(input.conversationId).cwd : input.cwd;
    return { files: await this.#fileSearch.search(cwd, input.query) };
  }

  async skills(
    input: { conversationId: string } | { agent: string; cwd: string },
  ): Promise<{ skills: ComposerSkill[] }> {
    const conversation =
      "conversationId" in input ? this.#requireConversation(input.conversationId) : undefined;
    const agent = "agent" in input ? input.agent : conversation?.agent;
    const cwd = "cwd" in input ? input.cwd : conversation?.cwd;
    if (!agent || !cwd) return { skills: [] };
    const registration = this.#requireAgentRegistration(agent);
    if (!registration.capabilities.skills) return { skills: [] };
    const active = conversation
      ? this.#active.get(conversation.id)
      : [...this.#active.entries()].find(([id, entry]) => {
          const existing = getConversation(this.#db, id);
          return entry.agent === agent && existing?.cwd === cwd;
        })?.[1];

    if (active?.adapter.getSkills) {
      try {
        await active.startPromise;
        const skills = await active.adapter.getSkills();
        this.#cacheSkills(agent, cwd, skills);
        return { skills: cloneSkills(skills) };
      } catch {
        // A CLI ausente deixa o catálogo vazio, como no fallback de modelos.
      }
    }

    const key = skillCacheKey(agent, cwd);
    const cached = this.#skillCache.get(key);
    if (cached && Date.now() - cached.cachedAt < SKILL_CACHE_TTL_MS)
      return { skills: cloneSkills(cached.skills) };
    if (cached) this.#skillCache.delete(key);

    const pending = this.#skillLoads.get(key);
    if (pending) return { skills: cloneSkills(await pending) };

    const load = Promise.resolve().then(async () => {
      try {
        const skills = registration.loadSkills ? await registration.loadSkills(cwd) : [];
        this.#cacheSkills(agent, cwd, skills);
        return skills;
      } catch {
        const skills: ComposerSkill[] = [];
        this.#cacheSkills(agent, cwd, skills);
        return skills;
      }
    });
    this.#skillLoads.set(key, load);
    try {
      return { skills: cloneSkills(await load) };
    } finally {
      if (this.#skillLoads.get(key) === load) this.#skillLoads.delete(key);
    }
  }

  async branch(id: string, messageId: string): Promise<Conversation> {
    this.#assertNotDeletingAll();
    return this.#trackAgentOperation(this.#branch(id, messageId));
  }

  async #branch(id: string, messageId: string): Promise<Conversation> {
    const source = this.#requireConversation(id);
    if (isBusyState(source.state))
      throw new Error("Espere o agente terminar antes de ramificar a conversa.");

    const messages = listMessages(this.#db, id);
    const messageIndex = messages.findIndex((message) => message.id === messageId);
    const selected = messages[messageIndex];
    if (selected?.author !== "agent" || selected.status !== "done")
      throw new Error("A resposta selecionada não está disponível para ramificação.");

    const lastAgentMessage = [...messages].reverse().find((message) => message.author === "agent");
    const isLatestResponse = lastAgentMessage?.id === selected.id;
    const sourceSessionId = getAgentSession(this.#db, id);
    let branchSessionId: string | null = null;
    let forkPending = false;

    if (source.agent === "claude" && isLatestResponse && sourceSessionId) {
      branchSessionId = sourceSessionId;
      forkPending = true;
    } else if (source.agent === "codex" && sourceSessionId) {
      const agentMessages = messages.filter((message) => message.author === "agent");
      const turnIndex = agentMessages.findIndex((message) => message.id === selected.id);
      const adapter = this.#createAdapter(source, () => undefined);
      try {
        branchSessionId =
          (await adapter.forkThread?.(
            source,
            sourceSessionId,
            selected.agentTurnId
              ? { lastTurnId: selected.agentTurnId }
              : { turnIndex, expectedTurnCount: agentMessages.length },
          )) ?? null;
      } catch {
        branchSessionId = null;
      } finally {
        await adapter.dispose().catch(() => undefined);
      }
    }

    const copiedMessages = messages.slice(0, messageIndex + 1);
    const branchContext = branchSessionId ? null : buildBranchContext(copiedMessages);
    const titleSuffix = " · ramo";
    const branchTitle = `${source.title.slice(0, 240 - titleSuffix.length).trimEnd()}${titleSuffix}`;
    const conversation = createConversation(this.#db, {
      agent: source.agent,
      title: branchTitle,
      cwd: source.cwd,
      ...(source.projectId ? { projectId: source.projectId } : {}),
      mode: source.mode,
      ...(source.model ? { model: source.model } : {}),
      ...(source.effort ? { effort: source.effort } : {}),
      plan: source.plan,
      fast: source.fast,
      branchedFromId: source.id,
      branchedFromMessageId: selected.id,
      ...(branchContext ? { branchContext: true } : {}),
    });
    if (branchSessionId) setBranchSession(this.#db, conversation.id, branchSessionId, forkPending);
    if (branchContext) setBranchContextPending(this.#db, conversation.id, branchContext);
    for (const copiedMessage of copiedMessages)
      addMessage(this.#db, cloneMessageForBranch(copiedMessage, conversation.id));
    await this.#stateEvent(conversation);
    return conversation;
  }

  async markSeen(id: string): Promise<Conversation> {
    const result = markConversationSeen(this.#db, id);
    if (!result.conversation) throw new Error("Conversa não encontrada.");
    const conversation = this.#ignoreClaudeFast(result.conversation);
    if (result.changed) await this.#stateEvent(conversation);
    return conversation;
  }

  async send(
    id: string,
    text: string,
    plan?: boolean,
    attachments?: ConversationAttachment[],
    skills: Array<Pick<ComposerSkill, "name" | "path">> = [],
  ): Promise<{ userMessage: ConversationMessage; agentMessage: ConversationMessage }> {
    this.#assertNotDeletingAll();
    return this.#trackAgentOperation(this.#send(id, text, plan, attachments, skills));
  }

  async compact(id: string): Promise<{ ok: true }> {
    this.#assertNotDeletingAll();
    const conversation = this.#requireConversation(id);
    if (!this.#requireAgentRegistration(conversation.agent).capabilities.compact)
      throw new Error("Este agente não oferece compactação.");
    if (!getAgentSession(this.#db, id))
      throw new Error("Envie uma mensagem antes de compactar esta conversa.");
    await this.#trackAgentOperation(
      this.#send(id, "/compactar", undefined, undefined, [], "compact"),
    );
    return { ok: true };
  }

  async #send(
    id: string,
    text: string,
    plan?: boolean,
    attachments?: ConversationAttachment[],
    skills: Array<Pick<ComposerSkill, "name" | "path">> = [],
    operation: "send" | "compact" = "send",
  ): Promise<{ userMessage: ConversationMessage; agentMessage: ConversationMessage }> {
    const validatedAttachments = validateAttachments(attachments);
    const conversation = this.#requireConversation(id);
    if (this.#undoing.has(id)) throw new Error("Espere o desfazer terminar.");
    if (isBusyState(conversation.state)) throw new Error("A conversa já está em andamento.");
    const now = this.#now();
    if (
      operation === "send" &&
      !listMessages(this.#db, id).some((message) => message.author === "user") &&
      conversation.title === "Nova conversa"
    ) {
      this.#titleRequests.set(id, { userMessage: text.slice(0, 1_000), attempted: false });
    }
    const userMessage: ConversationMessage = {
      id: randomUUID(),
      conversationId: id,
      author: "user",
      status: "done",
      parts: [
        {
          id: randomUUID(),
          type: "text",
          markdown: text,
          ...(operation === "compact" ? { operation: "compact" as const } : {}),
          ...(skills.length
            ? { skills: skills.map(({ name, path }) => ({ name, ...(path ? { path } : {}) })) }
            : {}),
        },
      ],
      ...(validatedAttachments.metadata.length
        ? { attachments: validatedAttachments.metadata }
        : {}),
      createdAt: now,
      updatedAt: now,
    };
    addMessage(this.#db, userMessage);
    if (validatedAttachments.data.length) {
      this.#cacheLatestUserAttachments(id, userMessage.id, validatedAttachments.data);
    } else {
      this.#latestUserAttachments.delete(id);
    }
    conversation.state = "working";
    conversation.updatedAt = this.#now();
    updateConversation(this.#db, conversation);
    try {
      await this.#emit({
        event: "conversation.messageCreated",
        payload: { conversationId: id, message: userMessage },
      });
    } catch (error) {
      const currentConversation = this.#requireConversation(id);
      currentConversation.state = "idle";
      currentConversation.updatedAt = this.#now();
      updateConversation(this.#db, currentConversation);
      this.#drainQueue();
      throw error;
    }
    const agentMessage = this.#newAgentMessage(id);
    // O desligado mantém a inferência textual já usada pelo adaptador Codex.
    const requestedPlan =
      operation === "compact" ? undefined : (plan ?? (conversation.plan ? true : undefined));
    const branchContext = operation === "compact" ? null : getBranchContextPending(this.#db, id);
    await this.#startTurn(
      conversation,
      agentMessage,
      withBranchContext(text, branchContext),
      requestedPlan,
      validatedAttachments.data,
      skills,
      operation,
    );
    return { userMessage, agentMessage };
  }

  async retry(id: string, messageId?: string): Promise<ConversationMessage> {
    this.#assertNotDeletingAll();
    return this.#trackAgentOperation(this.#retry(id, messageId));
  }

  async #retry(id: string, messageId?: string): Promise<ConversationMessage> {
    const conversation = this.#requireConversation(id);
    if (this.#undoing.has(id)) throw new Error("Espere o desfazer terminar.");
    if (isBusyState(conversation.state)) throw new Error("A conversa já está em andamento.");
    const messages = listMessages(this.#db, id);
    const failed = messageId
      ? messages.find((message) => message.id === messageId)
      : [...messages]
          .reverse()
          .find(
            (message) =>
              message.author === "agent" &&
              (message.status === "error" || message.status === "interrupted"),
          );
    if (
      failed?.author !== "agent" ||
      (failed.status !== "done" && failed.status !== "error" && failed.status !== "interrupted") ||
      [...messages].reverse().find((message) => message.author === "agent")?.id !== failed.id
    )
      throw new Error("A última resposta não pode ser tentada novamente.");
    const failedIndex = messages.findIndex((message) => message.id === failed.id);
    const user = messages
      .slice(0, failedIndex)
      .reverse()
      .find((message) => message.author === "user");
    const textPart = user?.parts.find((part) => part.type === "text");
    const text = textPart?.type === "text" ? textPart.markdown : "";
    const operation =
      textPart?.type === "text" && textPart.operation === "compact" ? "compact" : "send";
    const skills = textPart?.type === "text" ? (textPart.skills ?? []) : [];
    if (!user || !text)
      throw new Error("A mensagem original não está disponível para nova tentativa.");
    let attachments: ConversationAttachment[] = [];
    if (user.attachments?.length) {
      const cachedAttachments = this.#latestUserAttachments.get(id);
      if (cachedAttachments?.messageId !== user.id) {
        throw new Error(
          "Os bytes dos anexos não estão mais disponíveis. Anexe os arquivos novamente e envie uma nova mensagem.",
        );
      }
      attachments = cachedAttachments.attachments;
    }
    const agentMessage = this.#newAgentMessage(id);
    await this.#startTurn(
      conversation,
      agentMessage,
      operation === "compact"
        ? text
        : withBranchContext(text, getBranchContextPending(this.#db, id)),
      undefined,
      attachments,
      skills,
      operation,
    );
    return agentMessage;
  }

  async stop(id: string): Promise<boolean> {
    const queuedItem = this.#dequeue(id);
    if (queuedItem) {
      const conversation = getConversation(this.#db, id);
      if (conversation) {
        await this.#finishWithError(
          conversation,
          queuedItem.message,
          "interrupted",
          "Mensagem removida da fila.",
        );
      }
      this.#drainQueue();
      return true;
    }
    const pendingSnapshot = this.#pendingRestoreSnapshots.get(id);
    if (pendingSnapshot && !pendingSnapshot.stopped) {
      pendingSnapshot.stopped = true;
      pendingSnapshot.controller.abort();
      const conversation = getConversation(this.#db, id);
      if (conversation) {
        await this.#finishWithError(
          conversation,
          pendingSnapshot.message,
          "interrupted",
          INTERRUPTED_BY_USER_TEXT,
        );
      }
      this.#drainQueue();
      return true;
    }
    const active = this.#active.get(id);
    if (!active?.currentMessage) return false;
    if (!active.turnStarted) {
      active.stopRequested = true;
      const pendingPlan = active.currentMessage.parts.find(
        (part) => part.type === "plan" && part.state === "pending",
      );
      if (pendingPlan?.type === "plan") {
        await this.#handleAdapterEvent(id, {
          kind: "part",
          part: { ...pendingPlan, state: "rejected" },
        });
      }
      await this.#flushCoalescers(active);
      this.#flushMessageSave(active);
      await this.#handleAdapterEvent(id, {
        kind: "turn-end",
        status: "interrupted",
        error: { type: "interrupted", text: INTERRUPTED_BY_USER_TEXT },
      });
      if (active.idleTimer) clearTimeout(active.idleTimer);
      await this.#disposeAdapter(active);
      if (this.#active.get(id) === active) this.#active.delete(id);
      return true;
    }
    await this.#flushCoalescers(active);
    this.#flushMessageSave(active);
    await active.adapter.interrupt();
    return true;
  }

  async respond(id: string, partId: string, response: AdapterResponse): Promise<void> {
    this.#assertNotDeletingAll();
    const pending = this.#pendingParts.get(partId);
    if (!pending || pending.conversationId !== id)
      throw new Error("A parte não está aguardando resposta nesta conversa.");
    const active = this.#active.get(id);
    if (!active) throw new Error("O agente não está ativo para receber esta resposta.");
    await active.adapter.respond(partId, response);
  }

  async setOptions(
    id: string,
    options: {
      mode?: Conversation["mode"];
      model?: string | null;
      effort?: NonNullable<Conversation["effort"]> | null;
      plan?: boolean;
      fast?: boolean;
    },
  ): Promise<Conversation> {
    let conversation = this.#requireConversation(id);
    if (isBusyState(conversation.state))
      throw new Error("As opções só podem ser alteradas quando a conversa está parada.");
    const mustCheckFast = options.fast === true || (conversation.fast && "model" in options);
    if (mustCheckFast && conversation.agent === "codex") await this.#loadCodexModelsIfNeeded();
    conversation = this.#requireConversation(id);
    if (isBusyState(conversation.state))
      throw new Error("As opções só podem ser alteradas quando a conversa está parada.");
    const selectedModelId = "model" in options ? options.model : conversation.model;
    const supportsFast = modelSupportsFast(
      this.#codexModelList,
      conversation.agent,
      selectedModelId,
    );
    let nextFast = conversation.fast;
    if (options.fast === true) {
      if (supportsFast) nextFast = true;
      else {
        nextFast = false;
        console.warn("Modo rápido ignorado: o agente ou modelo selecionado não anuncia suporte.", {
          agent: conversation.agent,
          model: selectedModelId ?? null,
        });
      }
    } else if (options.fast === false) {
      nextFast = false;
    } else if ("model" in options && conversation.fast && !supportsFast) {
      nextFast = false;
      console.warn("Modo rápido desligado após selecionar um modelo sem suporte.", {
        agent: conversation.agent,
        model: selectedModelId ?? null,
      });
    }
    const nextModel =
      "model" in options
        ? options.model === null
          ? undefined
          : (options.model ?? conversation.model)
        : conversation.model;
    const nextEffort =
      "effort" in options
        ? options.effort === null
          ? undefined
          : (options.effort ?? conversation.effort)
        : conversation.effort;
    const nextMode = options.mode ?? conversation.mode;
    const nextPlan = options.plan ?? conversation.plan;
    if (
      nextMode === conversation.mode &&
      nextModel === conversation.model &&
      nextEffort === conversation.effort &&
      nextPlan === conversation.plan &&
      nextFast === conversation.fast
    )
      return conversation;
    const active = this.#active.get(id);
    if (active) {
      if (active.idleTimer) clearTimeout(active.idleTimer);
      await this.#disposeAdapter(active);
      this.#active.delete(id);
      conversation = this.#requireConversation(id);
      if (isBusyState(conversation.state))
        throw new Error("As opções só podem ser alteradas quando a conversa está parada.");
    }
    conversation.mode = nextMode;
    if ("model" in options) {
      if (options.model === null) delete conversation.model;
      else if (options.model !== undefined) conversation.model = options.model;
    }
    if (nextEffort === undefined) delete conversation.effort;
    else conversation.effort = nextEffort;
    if (nextPlan === undefined) delete conversation.plan;
    else conversation.plan = nextPlan;
    conversation.fast = nextFast;
    conversation.updatedAt = this.#now();
    updateConversation(this.#db, conversation);
    await this.#stateEvent(conversation);
    return conversation;
  }

  async remove(id: string): Promise<boolean> {
    this.#assertNotDeletingAll();
    this.#removedConversationIds.add(id);
    this.#dequeue(id);
    this.#abortRestoreOperations(id);
    try {
      const active = this.#active.get(id);
      if (active) {
        this.#markRemoved(id, active);
        await this.#flushCoalescers(active);
        await this.#disposeAdapter(active);
        await active.eventQueue;
        if (this.#active.get(id) === active) this.#active.delete(id);
      } else {
        this.#titleRequests.delete(id);
        this.#latestUserAttachments.delete(id);
      }
      // As linhas somem em cascata: lê antes para apagar as refs depois.
      const restorePoints = listRestorePoints(this.#db, id);
      const deleted = deleteConversation(this.#db, id);
      this.#restoreChains.delete(id);
      if (deleted) {
        this.#discardRestorePoints(restorePoints);
        this.#contextUsage.delete(id);
        await this.#broadcast({ event: "conversation.removed", payload: { id } }).catch(
          () => undefined,
        );
      }
      return deleted;
    } finally {
      this.#removedConversationIds.delete(id);
      this.#drainQueue();
    }
  }

  async deleteAll(): Promise<number> {
    this.#assertNotDeletingAll();
    this.#deletingAll = true;
    this.#queue = [];
    this.#abortRestoreOperations();
    try {
      const activeBeforeDeleteAll = [...this.#active.entries()];
      for (const { id } of listConversationStates(this.#db)) {
        const active = this.#active.get(id);
        if (active) this.#markRemoved(id, active, true);
      }
      await Promise.all(activeBeforeDeleteAll.map(([, session]) => this.#flushCoalescers(session)));
      await Promise.all(
        [...this.#agentOperations].map((operation) => operation.catch(() => undefined)),
      );

      const conversations = listConversationStates(this.#db);
      await Promise.all(
        conversations
          .filter(({ state }) => state === "working" || state === "waiting")
          .map(({ id }) => this.stop(id)),
      );

      const active = [...this.#active.entries()];
      for (const [id, session] of active) {
        this.#markRemoved(id, session);
      }
      this.#pendingParts.clear();
      await Promise.all(
        active.map(async ([, session]) => {
          await this.#flushCoalescers(session);
          await this.#disposeAdapter(session);
        }),
      );
      await Promise.all(active.map(([, session]) => session.eventQueue));
      for (const [id] of active) this.#active.delete(id);

      const restorePoints = conversations.flatMap(({ id }) => listRestorePoints(this.#db, id));
      const deleted = deleteAllConversations(this.#db);
      this.#restoreChains.clear();
      this.#discardRestorePoints(restorePoints);
      const deletedIds = new Set(conversations.map(({ id }) => id));
      for (const id of deletedIds) {
        this.#contextUsage.delete(id);
        this.#titleRequests.delete(id);
        this.#latestUserAttachments.delete(id);
      }
      if (deleted > 0) {
        await this.#broadcast({ event: "conversation.deletedAll", payload: { deleted } }).catch(
          () => undefined,
        );
      }
      return deleted;
    } finally {
      this.#deletingAll = false;
      this.#drainQueue();
    }
  }

  async models(agent: string): Promise<{
    agent: string;
    models: {
      id: string;
      name: string;
      aliases?: string[];
      isDefault?: boolean;
      efforts?: NonNullable<Conversation["effort"]>[];
      defaultEffort?: NonNullable<Conversation["effort"]>;
      supportsFast: boolean;
    }[];
    efforts: NonNullable<Conversation["effort"]>[];
    fetchedAt?: string;
  }> {
    const registration = this.#requireAgentRegistration(agent);
    if (agent === "codex") {
      await this.#loadCodexModelsIfNeeded();
      return {
        agent,
        models: this.#codexModelList.models.map(
          ({ id, name, efforts, defaultEffort, supportsFast }) => ({
            id,
            name,
            efforts: [...efforts],
            defaultEffort,
            supportsFast,
          }),
        ),
        efforts: [...this.#codexModelList.efforts],
        ...(this.#codexModelFetchedAt ? { fetchedAt: this.#codexModelFetchedAt } : {}),
      };
    }
    if (agent !== "claude") return this.#loadGenericModels(agent, registration);
    await this.#loadClaudeModelsIfNeeded();
    return {
      agent,
      models: this.#claudeModelList.models.map(
        ({ id, name, aliases, isDefault, efforts, defaultEffort }) => ({
          id,
          name,
          ...(aliases ? { aliases: [...aliases] } : {}),
          ...(isDefault ? { isDefault: true } : {}),
          efforts: [...efforts],
          ...(defaultEffort ? { defaultEffort } : {}),
          supportsFast: false,
        }),
      ),
      efforts: [...this.#claudeModelList.efforts],
      ...(this.#claudeModelFetchedAt ? { fetchedAt: this.#claudeModelFetchedAt } : {}),
    };
  }

  async capabilities(agent: string): Promise<{ capabilities: AgentCapabilities }> {
    const { capabilities } = this.#requireAgentRegistration(agent);
    return { capabilities: { ...capabilities } };
  }

  async #loadGenericModels(
    agent: string,
    registration: AgentAdapterRegistration,
  ): Promise<{
    agent: string;
    models: {
      id: string;
      name: string;
      aliases?: string[];
      isDefault?: boolean;
      efforts?: NonNullable<Conversation["effort"]>[];
      defaultEffort?: NonNullable<Conversation["effort"]>;
      supportsFast: boolean;
    }[];
    efforts: NonNullable<Conversation["effort"]>[];
  }> {
    const active = [...this.#active.values()].find((entry) => entry.agent === agent);
    let modelList: AdapterModelList | undefined;
    try {
      if (active) {
        await active.startPromise;
        modelList = await active.adapter.getModels?.();
      }
      if (!modelList?.models.length && registration.loadModels)
        modelList = await registration.loadModels(os.homedir());
    } catch {
      // A lista vazia representa um agente registrado sem catálogo disponível.
    }
    return {
      agent,
      models:
        modelList?.models.map((model) => ({
          id: model.id,
          name: model.name,
          ...(model.aliases ? { aliases: [...model.aliases] } : {}),
          ...(model.isDefault ? { isDefault: true } : {}),
          efforts: [...model.efforts],
          ...(model.defaultEffort ? { defaultEffort: model.defaultEffort } : {}),
          supportsFast: model.supportsFast,
        })) ?? [],
      efforts: [...(modelList?.efforts ?? reasoningEffortSchema.options)],
    };
  }

  async #loadClaudeModelsIfNeeded(): Promise<void> {
    if (this.#claudeModelLoadAttempted) return;
    if (this.#claudeModelLoadPromise) return this.#claudeModelLoadPromise;
    const loading = (async () => {
      try {
        const active = [...this.#active.values()].find((entry) => entry.agent === "claude");
        let modelList: AdapterModelList | undefined;
        if (active) {
          await active.startPromise;
          modelList = await active.adapter.getModels?.();
        } else {
          modelList = await this.#claudeModelLoader(os.homedir());
        }
        if (modelList?.models.length) {
          this.#cacheClaudeModelList(modelList);
        }
      } catch {
        // Keep the legacy list if Claude is unavailable or initialization fails.
      } finally {
        this.#claudeModelLoadAttempted = true;
      }
    })();
    this.#claudeModelLoadPromise = loading;
    try {
      await loading;
    } finally {
      if (this.#claudeModelLoadPromise === loading) this.#claudeModelLoadPromise = undefined;
    }
  }

  #cacheClaudeModelList(modelList: AdapterModelList): void {
    this.#claudeModelList = modelList;
    this.#claudeModelFetchedAt = this.#now();
    this.#claudeModelLoadAttempted = true;
  }

  async #loadCodexModelsIfNeeded(): Promise<void> {
    if (this.#codexModelFetchedAt) return;
    if (this.#codexModelLoadPromise) return this.#codexModelLoadPromise;
    const loading = (async () => {
      const active = [...this.#active.values()].find((entry) => entry.agent === "codex");
      try {
        let modelList: AdapterModelList | undefined;
        if (active) {
          await active.startPromise;
          modelList = await active.adapter.getModels?.();
        }
        if (!modelList?.models.length) modelList = await this.#codexModelLoader(os.homedir());
        this.#cacheCodexModelList(modelList);
      } catch {
        // Keep returning the most recent list if Codex is unavailable.
      }
    })();
    this.#codexModelLoadPromise = loading;
    try {
      await loading;
    } finally {
      if (this.#codexModelLoadPromise === loading) this.#codexModelLoadPromise = undefined;
    }
  }

  #cacheCodexModelList(modelList: AdapterModelList): void {
    this.#codexModelList = modelList;
    this.#codexModelFetchedAt = this.#now();
    try {
      setSetting(this.#db, CODEX_MODELS_SETTING, {
        agent: "codex",
        models: modelList.models.map(({ id, name, efforts, defaultEffort, supportsFast }) => ({
          id,
          name,
          efforts,
          ...(defaultEffort ? { defaultEffort } : {}),
          supportsFast,
        })),
        efforts: modelList.efforts,
        fetchedAt: this.#codexModelFetchedAt,
      });
    } catch {
      // Keep the in-memory catalog available for this service run if persistence fails.
    }
  }

  #cacheSkills(agent: string, cwd: string, skills: ComposerSkill[]): void {
    this.#skillCache.set(skillCacheKey(agent, cwd), {
      cachedAt: Date.now(),
      skills: cloneSkills(skills),
    });
    while (this.#skillCache.size > 32) {
      const oldest = this.#skillCache.keys().next().value as string | undefined;
      if (oldest === undefined) break;
      this.#skillCache.delete(oldest);
    }
  }

  #requireAgentRegistration(agent: string): AgentAdapterRegistration {
    const registration = this.#agentRegistrations.get(agent);
    if (!registration)
      throw new ServiceError("invalid_request", "Esse agente não está registrado para atalhos.");
    return registration;
  }

  #createAdapter(conversation: Conversation, emit: (event: AdapterEvent) => void): AgentAdapter {
    const registration = this.#requireAgentRegistration(conversation.agent);
    return (this.#adapterFactoryOverride ?? registration.factory)(conversation, emit);
  }

  async close(): Promise<void> {
    this.#closing = true;
    this.#queue = [];
    this.#abortRestoreOperations();
    await Promise.all(
      [...this.#restoreChains.values()].map((chain) => chain.catch(() => undefined)),
    );
    const adapters = [...this.#active.values()];
    await Promise.all(
      adapters.map(async (active) => {
        if (active.idleTimer) clearTimeout(active.idleTimer);
        await this.#disposeAdapter(active);
      }),
    );
    await Promise.all(adapters.map((active) => active.eventQueue));
    await Promise.all(
      adapters.map(async (active) => {
        await this.#flushCoalescers(active);
        this.#flushMessageSave(active);
      }),
    );
    this.#active.clear();
    this.#latestUserAttachments.clear();
  }

  queueStatus(): PayloadOf<"queue.changed"> {
    return {
      limit: this.#concurrencyLimit(),
      running: this.#runningCount(),
      queuedConversationIds: this.#queue.map((item) => item.conversationId),
    };
  }

  applyConcurrencyLimit(): void {
    this.#drainQueue();
  }

  #concurrencyLimit(): number {
    const value = getSetting(this.#db, MAX_CONCURRENT_AGENTS_SETTING);
    return typeof value === "number" &&
      Number.isInteger(value) &&
      value >= 1 &&
      value <= MAX_CONCURRENT_AGENTS_LIMIT
      ? value
      : DEFAULT_MAX_CONCURRENT_AGENTS;
  }

  // Vaga é turno em andamento, derivado do estado: plano aguardando aprovação não ocupa.
  #runningCount(excludeId?: string): number {
    return listSlotConversationStates(this.#db).filter(
      ({ id, state }) =>
        id !== excludeId &&
        !(state === "waiting" && this.#active.get(id)?.currentMessage?.status === "done"),
    ).length;
  }

  #publishQueueStatus(): void {
    const status = this.queueStatus();
    const serialized = JSON.stringify(status);
    if (serialized === this.#lastQueueStatus) return;
    this.#lastQueueStatus = serialized;
    void this.#broadcast({ event: "queue.changed", payload: status }).catch(() => undefined);
  }

  #drainQueue(): void {
    if (this.#closing || this.#deletingAll) return;
    while (this.#queue.length > 0 && this.#runningCount() < this.#concurrencyLimit()) {
      const item = this.#queue.shift() as QueuedTurn;
      const stored = getConversation(this.#db, item.conversationId);
      if (stored?.state !== "queued") continue;
      const conversation = this.#ignoreClaudeFast(stored);
      conversation.state = "working";
      conversation.updatedAt = this.#now();
      updateConversation(this.#db, conversation);
      // O tempo de "trabalhando" não conta a espera na fila.
      item.message.startedAt = this.#epochNow();
      saveMessage(this.#db, item.message);
      void this.#trackAgentOperation(
        (async () => {
          await this.#stateEvent(conversation, item.message).catch(() => undefined);
          if (this.#deletingAll || !getConversation(this.#db, conversation.id)) return;
          await this.#runTurn(
            conversation,
            item.message,
            item.text,
            item.plan,
            item.attachments,
            item.skills,
            item.operation,
          );
        })().catch(async (error: unknown) => {
          if (this.#closing) return;
          await this.#finishWithError(
            conversation,
            item.message,
            error instanceof AgentCliError ? error.errorType : "failed",
            error instanceof Error ? error.message : String(error),
          ).catch(() => undefined);
        }),
      );
    }
    this.#publishQueueStatus();
  }

  #dequeue(conversationId: string): QueuedTurn | undefined {
    const index = this.#queue.findIndex((item) => item.conversationId === conversationId);
    if (index === -1) return undefined;
    return this.#queue.splice(index, 1)[0];
  }

  async #startTurn(
    conversation: Conversation,
    message: ConversationMessage,
    text: string,
    plan?: boolean,
    attachments: ConversationAttachment[] = [],
    skills: Array<Pick<ComposerSkill, "name" | "path">> = [],
    operation: "send" | "compact" = "send",
  ): Promise<void> {
    conversation = this.#requireConversation(conversation.id);
    addMessage(this.#db, message);
    // Decisão síncrona: nenhum await entre contar as vagas e mudar o estado.
    const queued =
      this.#queue.length > 0 || this.#runningCount(conversation.id) >= this.#concurrencyLimit();
    conversation.state = queued ? "queued" : "working";
    conversation.updatedAt = this.#now();
    updateConversation(this.#db, conversation);
    if (queued) {
      this.#queue.push({
        conversationId: conversation.id,
        message,
        text,
        plan,
        attachments,
        skills,
        operation,
      });
    }
    await this.#emit({
      event: "conversation.messageCreated",
      payload: { conversationId: conversation.id, message },
    });
    if (queued) {
      // O item pode ter saído da fila durante o await acima: informa o estado atual.
      const current = getConversation(this.#db, conversation.id);
      if (current) await this.#stateEvent(current);
      this.#drainQueue();
      return;
    }
    await this.#stateEvent(conversation);
    if (this.#deletingAll || !getConversation(this.#db, conversation.id)) return;
    await this.#runTurn(conversation, message, text, plan, attachments, skills, operation);
  }

  async #runTurn(
    conversation: Conversation,
    message: ConversationMessage,
    text: string,
    plan: boolean | undefined,
    attachments: ConversationAttachment[],
    skills: Array<Pick<ComposerSkill, "name" | "path">>,
    operation: "send" | "compact",
  ): Promise<void> {
    if (!(await this.#prepareRestorePoint(conversation, message, operation))) return;
    let active = this.#active.get(conversation.id);
    if (!active) {
      const previousSession = getAgentSession(this.#db, conversation.id);
      const sessionId = previousSession ?? randomUUID();
      let activeRef: ActiveConversation;
      const adapter = this.#createAdapter(conversation, (event) => {
        if (activeRef.removed || this.#deletingAll) return;
        activeRef.eventQueue = activeRef.eventQueue
          .then(() => this.#handleAdapterEvent(conversation.id, event))
          .catch(() => undefined);
      });
      activeRef = {
        adapter,
        agent: conversation.agent,
        sessionId,
        startPromise: Promise.resolve(),
        coalescers: new Map(),
        deltaTimes: new Map(),
        sources: [],
        pendingPartIds: new Set(),
        currentMessage: message,
        eventQueue: Promise.resolve(),
        stopRequested: false,
        removed: false,
        turnStarted: false,
      };
      active = activeRef;
      this.#active.set(conversation.id, activeRef);
      activeRef.startPromise = adapter
        .start(conversation, sessionId, previousSession !== null, plan, {
          forkSession: isBranchForkPending(this.#db, conversation.id),
        })
        .then(async () => {
          await activeRef.eventQueue;
          if (activeRef.removed || this.#deletingAll) return;
          if (conversation.agent === "claude") {
            const modelList = await adapter.getModels?.();
            if (modelList?.models.length) this.#cacheClaudeModelList(modelList);
            return;
          }
          if (conversation.agent !== "codex") return;
          const modelList = await adapter.getModels?.();
          if (modelList?.models.length) this.#cacheCodexModelList(modelList);
        })
        .catch(async (error: unknown) => {
          if (!this.#closing && !activeRef.stopRequested && !activeRef.removed) {
            const kind = error instanceof AgentCliError ? error.errorType : "failed";
            const detail = error instanceof Error ? error.message : String(error);
            await this.#finishWithError(conversation, message, kind, detail);
          }
          if (!activeRef.stopRequested) await this.#disposeAdapter(activeRef);
          if (this.#active.get(conversation.id) === activeRef) this.#active.delete(conversation.id);
          throw error;
        });
    } else {
      if (active.idleTimer) clearTimeout(active.idleTimer);
      active.idleTimer = undefined;
      active.sources = [];
      active.sourcePartId = undefined;
      active.currentMessage = message;
      await active.startPromise;
    }
    active.currentMessage = message;
    try {
      await active.startPromise;
      if (active.stopRequested || active.removed) return;
      active.turnStarted = true;
      if (operation === "compact") {
        if (!active.adapter.compact) throw new Error("Este agente não oferece compactação.");
        await active.adapter.compact();
      } else {
        await active.adapter.send(text, plan, attachments, skills);
      }
    } catch (error) {
      if (message.status === "streaming" && !this.#closing && !active.removed) {
        const kind = error instanceof AgentCliError ? error.errorType : "failed";
        await this.#finishWithError(
          conversation,
          message,
          kind,
          error instanceof Error ? error.message : String(error),
        );
      }
    }
  }

  async #handleAdapterEvent(conversationId: string, event: AdapterEvent): Promise<void> {
    const active = this.#active.get(conversationId);
    const message = active?.currentMessage;
    if (!active || active.removed || this.#deletingAll || !message) return;
    if (event.kind === "session") {
      active.sessionId = event.sessionId;
      setAgentSession(this.#db, conversationId, event.sessionId);
      completeBranchFork(this.#db, conversationId);
      return;
    }
    if (event.kind === "turn-id") {
      message.agentTurnId = event.turnId;
      setMessageAgentTurnId(this.#db, message.id, event.turnId);
      return;
    }
    if (event.kind === "context-usage") {
      if (!this.#requireAgentRegistration(active.agent).capabilities.contextUsage) return;
      const usage: ConversationContextUsage = {
        usedTokens: event.usedTokens,
        windowTokens: event.windowTokens,
      };
      this.#contextUsage.set(conversationId, usage);
      setConversationContextUsage(this.#db, conversationId, usage);
      await this.#emit({
        event: "conversation.contextUsage",
        payload: { conversationId, ...usage },
      });
      return;
    }
    if (event.kind === "context-usage-unknown") {
      if (!this.#requireAgentRegistration(active.agent).capabilities.contextUsage) return;
      this.#contextUsage.delete(conversationId);
      this.#db
        .prepare("DELETE FROM conversation_context_usage WHERE conversation_id=?")
        .run(conversationId);
      return;
    }
    if (event.kind === "sources") {
      active.sources = event.sources;
      const textPart = active.sourcePartId
        ? message.parts.find(
            (part): part is Extract<MessagePart, { type: "text" }> =>
              part.type === "text" && part.id === active.sourcePartId,
          )
        : [...message.parts]
            .reverse()
            .find((part): part is Extract<MessagePart, { type: "text" }> => part.type === "text");
      if (textPart) {
        active.sourcePartId = textPart.id;
        textPart.sources = event.sources;
        message.updatedAt = this.#now();
        this.#flushMessageSave(active, message);
        await this.#emit({
          event: "conversation.partUpdated",
          payload: { conversationId, messageId: message.id, kind: "upsert", part: textPart },
        });
      }
      return;
    }
    if (event.kind === "fast-tier-not-applied") {
      const conversation = this.#requireConversation(conversationId);
      if (conversation.agent === "codex" && conversation.fast) {
        conversation.fast = false;
        conversation.updatedAt = this.#now();
        updateConversation(this.#db, conversation);
        setSetting(this.#db, `composer.${conversation.agent}.fast`, false);
        active.adapter.setFastEnabled?.(false);
        await this.#stateEvent(conversation, message);
      }
      return;
    }
    if (event.kind === "state") {
      const conversation = this.#requireConversation(conversationId);
      if (event.state === "working") active.turnStarted = true;
      if (event.state === "working" && message.status !== "streaming") {
        message.status = "streaming";
        message.updatedAt = this.#now();
        saveMessage(this.#db, message);
        this.#resumeRepoTurn(message.id);
      }
      conversation.state = event.state;
      conversation.updatedAt = this.#now();
      updateConversation(this.#db, conversation);
      await this.#stateEvent(conversation, message);
      return;
    }
    if (event.kind === "part") {
      await this.#flushCoalescers(active);
      const part = this.#timestampPart(message, event.part);
      this.#upsertPart(message, part);
      if (part.type === "permission" || part.type === "question" || part.type === "plan") {
        if (part.state === "pending") {
          this.#pendingParts.set(part.id, { conversationId, messageId: message.id });
          active.pendingPartIds.add(part.id);
        } else {
          this.#pendingParts.delete(part.id);
          active.pendingPartIds.delete(part.id);
        }
      }
      message.updatedAt = this.#now();
      this.#flushMessageSave(active, message);
      await this.#emit({
        event: "conversation.partUpdated",
        payload: { conversationId, messageId: message.id, kind: "upsert", part },
      });
      return;
    }
    if (event.kind === "text-delta") {
      const observedAt = this.#epochNow();
      const existingPart = message.parts.find((item) => item.id === event.partId);
      const timing = active.deltaTimes.get(event.partId);
      active.deltaTimes.set(event.partId, {
        startedAt: timing?.startedAt ?? existingPart?.startedAt ?? observedAt,
        endedAt: observedAt,
      });
      let coalescer = active.coalescers.get(event.partId);
      if (!coalescer) {
        coalescer = new DeltaCoalescer(
          async (delta) => {
            if (active.removed) return;
            let part = message.parts.find((item) => item.id === event.partId);
            if (!part) {
              const times = active.deltaTimes.get(event.partId);
              part =
                event.partType === "text"
                  ? {
                      id: event.partId,
                      type: "text",
                      markdown: "",
                      ...(active.sources.length > 0 && !active.sourcePartId
                        ? { sources: active.sources }
                        : {}),
                      startedAt: times?.startedAt,
                      endedAt: times?.endedAt,
                    }
                  : {
                      id: event.partId,
                      type: "thinking",
                      text: "",
                      startedAt: times?.startedAt,
                      endedAt: times?.endedAt,
                    };
              message.parts.push(part);
              if (part.type === "text" && part.sources?.length) active.sourcePartId = part.id;
              await this.#emit({
                event: "conversation.partUpdated",
                payload: { conversationId, messageId: message.id, kind: "upsert", part },
              });
            } else {
              const times = active.deltaTimes.get(event.partId);
              if (times) {
                part.startedAt ??= times.startedAt;
                part.endedAt = times.endedAt;
              }
            }
            if (part.type === "text") part.markdown += delta;
            else if (part.type === "thinking") part.text += delta;
            message.updatedAt = this.#now();
            this.#scheduleMessageSave(active, message);
            const startOffset =
              part.type === "text"
                ? part.markdown.length - delta.length
                : part.type === "thinking"
                  ? part.text.length - delta.length
                  : 0;
            await this.#emit({
              event: "conversation.partUpdated",
              payload: {
                conversationId,
                messageId: message.id,
                kind: "delta",
                partId: event.partId,
                startOffset,
                delta,
                startedAt: part.startedAt,
                endedAt: part.endedAt,
              },
            });
          },
          { intervalMs: 50 },
        );
        active.coalescers.set(event.partId, coalescer);
      }
      await coalescer.add(event.delta);
      return;
    }
    if (event.kind === "turn-end") {
      await this.#flushCoalescers(active);
      active.deltaTimes.clear();
      active.turnStarted = false;
      if (event.status === "done") completeBranchContext(this.#db, conversationId);
      const endedAt = this.#epochNow();
      const completedAt = this.#now();
      message.endedAt = endedAt;
      if (event.error) {
        const description = describeAgentError(event.error.text, active.agent);
        const errorPart: MessagePart = {
          id: randomUUID(),
          type: "error",
          errorType: event.error.type,
          text: description.message,
          ...(description.details ? { details: description.details } : {}),
          retryable: event.status !== "done",
          startedAt: endedAt,
          endedAt,
        };
        this.#upsertPart(message, errorPart);
        await this.#emit({
          event: "conversation.partUpdated",
          payload: { conversationId, messageId: message.id, kind: "upsert", part: errorPart },
        });
      }
      message.status = event.status;
      message.updatedAt = completedAt;
      this.#flushMessageSave(active, message);
      const pendingPlan =
        event.status === "done" &&
        message.parts.some((part) => part.type === "plan" && part.state === "pending");
      this.#scheduleAfterSnapshot(conversationId, message.id, !pendingPlan);
      if (!pendingPlan) {
        active.currentMessage = undefined;
        for (const partId of active.pendingPartIds) this.#pendingParts.delete(partId);
        active.pendingPartIds.clear();
      }
      const conversation = this.#requireConversation(conversationId);
      conversation.state = event.status === "error" ? "error" : pendingPlan ? "waiting" : "idle";
      conversation.updatedAt = completedAt;
      if (event.status === "done" || event.status === "error") {
        conversation.unreadAt = completedAt;
      }
      updateConversation(this.#db, conversation);
      await this.#stateEvent(conversation, message);
      if (event.status === "done") this.#scheduleConversationTitle(conversation, message);
      if (!pendingPlan) this.#scheduleIdleDispose(conversationId, active);
    }
  }

  #scheduleIdleDispose(conversationId: string, active: ActiveConversation): void {
    const configured = Number(this.#env.KARONT_AGENT_IDLE_MS ?? 10 * 60 * 1_000);
    const idleMs =
      Number.isFinite(configured) && configured >= 0
        ? Math.min(configured, 24 * 60 * 60 * 1_000)
        : 10 * 60 * 1_000;
    active.idleTimer = setTimeout(() => {
      if (active.removed || this.#active.get(conversationId) !== active || active.currentMessage)
        return;
      this.#active.delete(conversationId);
      void active.adapter.dispose();
    }, idleMs);
    active.idleTimer.unref?.();
  }

  #scheduleConversationTitle(conversation: Conversation, message: ConversationMessage): void {
    const request = this.#titleRequests.get(conversation.id);
    if (!request || request.attempted || conversation.title !== "Nova conversa") return;
    const response = message.parts
      .flatMap((part) =>
        part.type === "text" ? [part.markdown] : part.type === "plan" ? [part.markdown] : [],
      )
      .join("\n")
      .slice(0, 1_200);
    if (!response.trim()) return;

    request.attempted = true;
    const { userMessage } = request;
    this.#titleRequests.delete(conversation.id);
    const titleOptions =
      conversation.agent === "codex"
        ? codexTitleOptions(conversation, this.#codexModelList)
        : undefined;
    void this.#titleGenerator(conversation.agent, userMessage, response, titleOptions)
      .then(async (title) => {
        if (
          !title ||
          this.#deletingAll ||
          this.#active.get(conversation.id)?.removed ||
          !getConversation(this.#db, conversation.id)
        )
          return;
        const updated = setConversationTitle(this.#db, conversation.id, title, this.#now(), false);
        if (updated) await this.#stateEvent(updated);
      })
      .catch(() => undefined);
  }

  async #flushCoalescers(active: ActiveConversation): Promise<void> {
    await Promise.all(
      [...active.coalescers.values()].map((coalescer) => coalescer.end().catch(() => undefined)),
    );
    active.coalescers.clear();
  }

  #markRemoved(
    conversationId: string,
    active: ActiveConversation,
    preserveCurrentMessage = false,
  ): void {
    active.removed = true;
    if (active.idleTimer) clearTimeout(active.idleTimer);
    active.idleTimer = undefined;
    if (active.messageSaveTimer) clearTimeout(active.messageSaveTimer);
    active.messageSaveTimer = undefined;
    active.messageToSave = undefined;
    if (!preserveCurrentMessage) active.currentMessage = undefined;
    active.deltaTimes.clear();
    for (const partId of active.pendingPartIds) this.#pendingParts.delete(partId);
    active.pendingPartIds.clear();
    this.#titleRequests.delete(conversationId);
    this.#latestUserAttachments.delete(conversationId);
  }

  async #disposeAdapter(active: ActiveConversation): Promise<void> {
    active.disposePromise ??= active.adapter.dispose();
    await active.disposePromise;
  }

  #scheduleMessageSave(active: ActiveConversation, message: ConversationMessage): void {
    if (active.removed) return;
    active.messageToSave = message;
    if (active.messageSaveTimer) return;
    const configured = Number(this.#env.KARONT_MESSAGE_SAVE_DEBOUNCE_MS ?? 1_000);
    const delayMs =
      Number.isFinite(configured) && configured >= 0 ? Math.min(configured, 60_000) : 1_000;
    active.messageSaveTimer = setTimeout(() => this.#flushMessageSave(active), delayMs);
    active.messageSaveTimer.unref?.();
  }

  #flushMessageSave(active: ActiveConversation, message?: ConversationMessage): void {
    if (active.messageSaveTimer) clearTimeout(active.messageSaveTimer);
    active.messageSaveTimer = undefined;
    if (active.removed) {
      active.messageToSave = undefined;
      return;
    }
    const pending = active.messageToSave;
    active.messageToSave = undefined;
    if (pending) saveMessage(this.#db, pending);
    if (message && pending?.id !== message.id) saveMessage(this.#db, message);
  }

  #timestampPart(message: ConversationMessage, part: MessagePart): MessagePart {
    const observedAt = this.#epochNow();
    const previous = message.parts.find((item) => item.id === part.id);
    if (part.type === "error") return { ...part, startedAt: observedAt, endedAt: observedAt };

    const startedAt = previous?.startedAt ?? observedAt;
    if (part.type === "action") {
      return {
        ...part,
        startedAt,
        ...(part.state === "ok" || part.state === "error"
          ? { endedAt: observedAt }
          : { endedAt: undefined }),
      };
    }
    if (part.type === "permission" || part.type === "question" || part.type === "plan") {
      return {
        ...part,
        startedAt,
        ...(part.state === "pending" ? { endedAt: undefined } : { endedAt: observedAt }),
      };
    }
    return { ...part, startedAt, endedAt: observedAt };
  }

  async #finishWithError(
    conversation: Conversation,
    message: ConversationMessage,
    type: "cli-not-found" | "not-logged-in" | "failed" | "interrupted",
    text: string,
  ): Promise<void> {
    if (message.status !== "streaming") return;
    if (this.#active.get(conversation.id)?.removed || !getConversation(this.#db, conversation.id))
      return;
    const endedAt = this.#epochNow();
    const description = describeAgentError(text, conversation.agent);
    const part: MessagePart = {
      id: randomUUID(),
      type: "error",
      errorType: type,
      text: description.message,
      ...(description.details ? { details: description.details } : {}),
      retryable: true,
      startedAt: endedAt,
      endedAt,
    };
    message.parts.push(part);
    message.status = type === "interrupted" ? "interrupted" : "error";
    const completedAt = this.#now();
    message.updatedAt = completedAt;
    message.endedAt = endedAt;
    const active = this.#active.get(conversation.id);
    if (active) this.#flushMessageSave(active, message);
    else saveMessage(this.#db, message);
    await this.#emit({
      event: "conversation.partUpdated",
      payload: { conversationId: conversation.id, messageId: message.id, kind: "upsert", part },
    });
    conversation = this.#requireConversation(conversation.id);
    conversation.state = message.status === "error" ? "error" : "idle";
    conversation.updatedAt = completedAt;
    if (message.status === "error") conversation.unreadAt = completedAt;
    updateConversation(this.#db, conversation);
    this.#scheduleAfterSnapshot(conversation.id, message.id, true);
    await this.#stateEvent(conversation, message);
    if (active?.currentMessage?.id === message.id) active.currentMessage = undefined;
  }

  #emitRestoreChanged(conversationId: string, messageId: string): Promise<void> {
    if (this.#closing || this.#deletingAll || this.#removedConversationIds.has(conversationId))
      return Promise.resolve();
    const row = getRestorePoint(this.#db, messageId);
    if (!row || row.conversationId !== conversationId) return Promise.resolve();
    return this.#broadcast({
      event: "restore.changed",
      payload: { conversationId, point: summarizeRestorePoint(row) },
    }).catch(() => undefined);
  }

  /** Lista os pontos da conversa só com o que está no banco: nunca chama o Git. */
  restoreList(conversationId: string): { points: RestorePointSummary[] } {
    this.#assertNotDeletingAll();
    this.#requireRestoreConversation(conversationId);
    return { points: listRestorePoints(this.#db, conversationId).map(summarizeRestorePoint) };
  }

  async restoreChanges(
    conversationId: string,
    messageId: string,
  ): Promise<ResultOf<"restore.changes">> {
    this.#assertNotDeletingAll();
    const { commits } = this.#requireViewablePoint(conversationId, messageId);
    try {
      return await this.#runRestoreOperation(conversationId, (signal) =>
        listRestoreChanges(commits.root, commits, signal),
      );
    } catch (error) {
      throw restoreServiceError(error);
    }
  }

  async restoreDiff(
    conversationId: string,
    messageId: string,
    filePath: string,
  ): Promise<ResultOf<"restore.diff">> {
    this.#assertNotDeletingAll();
    const { commits } = this.#requireViewablePoint(conversationId, messageId);
    try {
      return await this.#runRestoreOperation(conversationId, (signal) =>
        readRestorePatch(commits.root, commits, filePath, signal),
      );
    } catch (error) {
      throw restoreServiceError(error);
    }
  }

  async undoPreview(
    conversationId: string,
    messageId: string,
  ): Promise<ResultOf<"restore.undoPreview">> {
    this.#assertNotDeletingAll();
    const { row, commits } = this.#requireUndoablePoint(conversationId, messageId);
    try {
      const preview = await this.#runRestoreOperation(conversationId, (signal) =>
        previewUndo(commits.root, commits, signal),
      );
      return {
        ...preview,
        headMoved: summarizeRestorePoint(row).headMoved,
        concurrent: row.concurrent,
      };
    } catch (error) {
      throw restoreServiceError(error);
    }
  }

  async undo(conversationId: string, messageId: string): Promise<ResultOf<"restore.undo">> {
    this.#assertNotDeletingAll();
    const { row, commits } = this.#requireUndoablePoint(conversationId, messageId);
    // Marca já, antes de qualquer espera: send/retry e um segundo desfazer passam a falhar.
    this.#undoing.add(conversationId);
    return this.#trackAgentOperation(this.#undo(conversationId, row, commits));
  }

  async #undo(
    conversationId: string,
    row: RestorePointRecord,
    commits: RestoreCommits,
  ): Promise<ResultOf<"restore.undo">> {
    const messageId = row.messageId;
    try {
      return await this.#runRestoreOperation(conversationId, async (signal) => {
        const undoCommit = await saveUndoSafety(commits.root, commits, signal);
        if (!setRestorePointUndoCommit(this.#db, messageId, undoCommit, this.#now())) {
          throw new RestoreError("gone");
        }
        let outcome: { restored: number; removed: number };
        try {
          outcome = await applyUndo(commits.root, commits, signal);
        } catch (error) {
          if (error instanceof RestoreError && error.kind !== "gone") {
            throw new RestoreError(
              error.kind,
              `${error.message} O que havia antes do desfazer está guardado em ${undoRef(conversationId, messageId)}.`,
            );
          }
          throw error;
        }
        setRestorePointUndone(this.#db, messageId, this.#now());
        await this.#emitRestoreChanged(conversationId, messageId);
        return outcome;
      });
    } catch (error) {
      throw restoreServiceError(error);
    } finally {
      this.#undoing.delete(conversationId);
    }
  }

  #requireRestoreConversation(conversationId: string): void {
    if (!getConversation(this.#db, conversationId)) {
      throw new ServiceError("unavailable", "Conversa não encontrada.");
    }
  }

  #requireRestorePoint(conversationId: string, messageId: string): RestorePointRecord {
    this.#requireRestoreConversation(conversationId);
    const row = getRestorePoint(this.#db, messageId);
    if (!row || row.conversationId !== conversationId) {
      throw new ServiceError("invalid_request", "Ponto de restauração não encontrado.");
    }
    return row;
  }

  #requireViewablePoint(
    conversationId: string,
    messageId: string,
  ): { row: RestorePointRecord; commits: RestoreCommits } {
    const row = this.#requireRestorePoint(conversationId, messageId);
    if (!row.repoRoot || !row.beforeCommit) {
      throw new ServiceError("unavailable", "Esta mensagem não tem ponto de restauração.");
    }
    if (!row.afterCommit) {
      throw new ServiceError(
        "unavailable",
        "As mudanças desta mensagem ainda não foram registradas.",
      );
    }
    return {
      row,
      commits: {
        root: row.repoRoot,
        conversationId,
        messageId,
        before: row.beforeCommit,
        after: row.afterCommit,
      },
    };
  }

  /** Regras de segurança do desfazer; vale também para a prévia. */
  #requireUndoablePoint(
    conversationId: string,
    messageId: string,
  ): { row: RestorePointRecord; commits: RestoreCommits } {
    const conversation = this.#requireConversation(conversationId);
    const row = this.#requireRestorePoint(conversationId, messageId);
    const state = summarizeRestorePoint(row).state;
    if (state === "undone") throw new ServiceError("unavailable", "Esta mensagem já foi desfeita.");
    if (state === "unavailable") {
      throw new ServiceError("unavailable", "Esta mensagem não tem ponto de restauração.");
    }
    if (state === "incomplete") {
      throw new ServiceError(
        "unavailable",
        "As mudanças desta mensagem não foram registradas por completo. Não dá para desfazer.",
      );
    }
    if (this.#undoing.has(conversationId)) {
      throw new ServiceError("unavailable", "Já existe um desfazer em andamento nesta conversa.");
    }
    if (isBusyState(conversation.state)) {
      throw new ServiceError(
        "unavailable",
        "Espere a conversa terminar para desfazer. O agente ainda está trabalhando.",
      );
    }
    const viewable = this.#requireViewablePoint(conversationId, messageId);
    if ((this.#repoTurns.get(viewable.commits.root)?.size ?? 0) > 0) {
      throw new ServiceError(
        "unavailable",
        "Há um agente trabalhando neste repositório. Espere ele terminar para desfazer.",
      );
    }
    return viewable;
  }

  /** Operação de Git ligada à conversa: apagar a conversa ou fechar o serviço a interrompe. */
  #runRestoreOperation<T>(
    conversationId: string,
    operation: (signal: AbortSignal) => Promise<T>,
  ): Promise<T> {
    const controller = new AbortController();
    this.#restoreOps.set(controller, conversationId);
    return this.#trackAgentOperation(
      operation(controller.signal).finally(() => this.#restoreOps.delete(controller)),
    );
  }

  #restoreTimeoutMs(): number {
    const configured = Number(this.#env.KARONT_RESTORE_TIMEOUT_MS);
    return Number.isFinite(configured) && configured > 0
      ? Math.min(configured, 10 * 60_000)
      : DEFAULT_RESTORE_TIMEOUT_MS;
  }

  #abortRestoreOperations(conversationId?: string): void {
    for (const [controller, owner] of this.#restoreOps) {
      if (conversationId === undefined || owner === conversationId) controller.abort();
    }
  }

  /**
   * Foto "antes" do turno. Devolve falso quando o turno não deve seguir (parado, conversa apagada,
   * apagar todas ou fechamento). Falha ou tempo esgotado só gravam o motivo: a mensagem segue.
   */
  async #prepareRestorePoint(
    conversation: Conversation,
    message: ConversationMessage,
    operation: "send" | "compact",
  ): Promise<boolean> {
    if (operation === "compact") return true;
    const conversationId = conversation.id;
    const mustStop = (controller?: AbortController) =>
      this.#closing ||
      this.#deletingAll ||
      controller?.signal.aborted === true ||
      !getConversation(this.#db, conversationId);
    if (mustStop()) return false;
    const controller = new AbortController();
    const pending: PendingRestoreSnapshot = { controller, message, stopped: false };
    this.#restoreOps.set(controller, conversationId);
    this.#pendingRestoreSnapshots.set(conversationId, pending);
    let outcome: RestoreSnapshotOutcome | undefined;
    try {
      const previous = this.#restoreChains.get(conversationId);
      if (previous) await raceAbort(previous, controller.signal);
      if (!controller.signal.aborted) {
        outcome = await this.#takeSnapshot(
          {
            phase: "before",
            cwd: conversation.cwd,
            repoRoot: null,
            conversationId,
            messageId: message.id,
          },
          controller.signal,
        );
      }
    } catch {
      outcome = { repoRoot: null, unavailable: "failed" };
    } finally {
      this.#restoreOps.delete(controller);
      if (this.#pendingRestoreSnapshots.get(conversationId) === pending) {
        this.#pendingRestoreSnapshots.delete(conversationId);
      }
    }
    if (!outcome || mustStop(controller)) {
      if (outcome && "commit" in outcome) {
        this.#deleteRefsInBackground(outcome.repoRoot, restoreRefs(conversationId, message.id));
      }
      return false;
    }
    const repoRoot = outcome.repoRoot;
    try {
      createRestorePoint(this.#db, {
        messageId: message.id,
        conversationId,
        repoRoot: "commit" in outcome ? repoRoot : null,
        beforeCommit: "commit" in outcome ? outcome.commit : null,
        headBefore: "commit" in outcome ? outcome.head : null,
        unavailableReason: "unavailable" in outcome ? outcome.unavailable : null,
        now: this.#now(),
      });
    } catch {
      // Sem a linha não há desfazer, mas a mensagem precisa seguir: voltar aqui a deixaria presa.
      return true;
    }
    if ("commit" in outcome) {
      this.#registerRepoTurn(outcome.repoRoot, message.id);
      this.#pruneRestorePoints(conversationId);
    } else {
      this.#emitRestoreChanged(conversationId, message.id);
    }
    return true;
  }

  /** Chama o módulo Git (ou o substituto) com tempo total e aborto, sem nunca lançar. */
  async #takeSnapshot(
    base: Omit<RestoreSnapshotRequest, "signal" | "timeoutMs" | "homeDir">,
    parent: AbortSignal,
  ): Promise<RestoreSnapshotOutcome> {
    const timeoutMs = this.#restoreTimeoutMs();
    const child = new AbortController();
    let timedOut = false;
    let decided = false;
    const timer = setTimeout(() => {
      timedOut = true;
      child.abort();
    }, timeoutMs);
    const onParentAbort = () => child.abort();
    if (parent.aborted) child.abort();
    else parent.addEventListener("abort", onParentAbort, { once: true });
    const discardLate = (outcome: RestoreSnapshotOutcome) => {
      if ("commit" in outcome) {
        // Só a ref desta foto: uma "depois" atrasada não pode levar a "antes", que continua válida.
        this.#deleteRefsInBackground(outcome.repoRoot, [
          restoreRef(base.conversationId, base.messageId, base.phase),
        ]);
      }
    };
    try {
      return await new Promise<RestoreSnapshotOutcome>((resolve) => {
        const onAbort = () => {
          if (decided) return;
          decided = true;
          resolve({ repoRoot: base.repoRoot, unavailable: timedOut ? "timeout" : "failed" });
        };
        if (child.signal.aborted) onAbort();
        else child.signal.addEventListener("abort", onAbort, { once: true });
        Promise.resolve()
          .then(() =>
            this.#restoreSnapshot({
              ...base,
              homeDir: this.#homeDir,
              signal: child.signal,
              timeoutMs,
            }),
          )
          .then(
            (outcome) => {
              if (decided) discardLate(outcome);
              else {
                decided = true;
                resolve(outcome);
              }
            },
            () => {
              if (decided) return;
              decided = true;
              resolve({ repoRoot: base.repoRoot, unavailable: "failed" });
            },
          );
      });
    } finally {
      clearTimeout(timer);
      parent.removeEventListener("abort", onParentAbort);
    }
  }

  #registerRepoTurn(repoRoot: string, messageId: string): void {
    let turns = this.#repoTurns.get(repoRoot);
    if (!turns) {
      turns = new Set();
      this.#repoTurns.set(repoRoot, turns);
    }
    turns.add(messageId);
    this.#repoByMessage.set(messageId, repoRoot);
    if (turns.size > 1) {
      try {
        markRestorePointsConcurrent(this.#db, [...turns], this.#now());
      } catch {
        // Melhor esforço: o aviso de concorrência não pode derrubar a mensagem.
      }
    }
  }

  /** Plano aprovado: o agente volta a escrever na mesma mensagem, e o turno volta a contar. */
  #resumeRepoTurn(messageId: string): void {
    const row = getRestorePoint(this.#db, messageId);
    if (row?.repoRoot && row.beforeCommit && !row.afterCommit) {
      this.#registerRepoTurn(row.repoRoot, messageId);
    }
  }

  #releaseRepoTurn(messageId: string): void {
    const repoRoot = this.#repoByMessage.get(messageId);
    if (repoRoot === undefined) return;
    this.#repoByMessage.delete(messageId);
    const turns = this.#repoTurns.get(repoRoot);
    turns?.delete(messageId);
    if (turns?.size === 0) this.#repoTurns.delete(repoRoot);
  }

  /** Foto "depois": idempotente, em segundo plano e depois da foto anterior da mesma conversa. */
  #scheduleAfterSnapshot(conversationId: string, messageId: string, snapshot: boolean): void {
    if (!snapshot) {
      this.#releaseRepoTurn(messageId);
      return;
    }
    if (this.#afterSnapshotsInFlight.has(messageId)) return;
    const row = getRestorePoint(this.#db, messageId);
    if (!row?.beforeCommit || row.afterCommit || !row.repoRoot) {
      this.#releaseRepoTurn(messageId);
      return;
    }
    const repoRoot = row.repoRoot;
    this.#afterSnapshotsInFlight.add(messageId);
    const controller = new AbortController();
    this.#restoreOps.set(controller, conversationId);
    const previous = this.#restoreChains.get(conversationId) ?? Promise.resolve();
    const task: Promise<void> = previous
      .then(async () => {
        const conversation = getConversation(this.#db, conversationId);
        if (!conversation || controller.signal.aborted || this.#closing) return;
        const outcome = await this.#takeSnapshot(
          { phase: "after", cwd: conversation.cwd, repoRoot, conversationId, messageId },
          controller.signal,
        );
        if (!("commit" in outcome)) {
          // A tela precisa saber que esta resposta ficou sem desfazer.
          void this.#emitRestoreChanged(conversationId, messageId);
          return;
        }
        let changedFiles = 0;
        try {
          changedFiles = await countRestoreChanges(
            repoRoot,
            row.beforeCommit as string,
            outcome.commit,
            controller.signal,
            this.#restoreTimeoutMs(),
          );
        } catch {
          // Sem a contagem a tela mostra 0; o ponto continua utilizável.
        }
        const saved = setRestorePointAfter(
          this.#db,
          messageId,
          outcome.commit,
          outcome.head,
          this.#now(),
          changedFiles,
        );
        // A conversa foi apagada durante a foto: a ref ficaria órfã.
        if (!saved) this.#deleteRefsInBackground(repoRoot, restoreRefs(conversationId, messageId));
        else this.#emitRestoreChanged(conversationId, messageId);
      })
      .catch(() => undefined)
      .finally(() => {
        this.#restoreOps.delete(controller);
        this.#afterSnapshotsInFlight.delete(messageId);
        this.#releaseRepoTurn(messageId);
        if (this.#restoreChains.get(conversationId) === task) {
          this.#restoreChains.delete(conversationId);
        }
      });
    this.#restoreChains.set(conversationId, task);
    void this.#trackAgentOperation(task);
  }

  /** Fica com os últimos pontos da conversa; apaga refs e linhas dos excedentes em segundo plano. */
  #pruneRestorePoints(conversationId: string): void {
    const excess = listExcessRestorePoints(
      this.#db,
      conversationId,
      MAX_RESTORE_POINTS_PER_CONVERSATION,
    );
    if (excess.length === 0) return;
    const task = (async () => {
      await this.#deleteRefsForPoints(excess);
      deleteRestorePoints(
        this.#db,
        excess.map((point) => point.messageId),
      );
    })().catch(() => undefined);
    void this.#trackAgentOperation(task);
  }

  #discardRestorePoints(
    points: Array<{ messageId: string; conversationId: string; repoRoot: string | null }>,
  ): void {
    for (const point of points) this.#releaseRepoTurn(point.messageId);
    if (points.length === 0) return;
    void this.#trackAgentOperation(this.#deleteRefsForPoints(points).catch(() => undefined));
  }

  async #deleteRefsForPoints(
    points: Array<{ messageId: string; conversationId: string; repoRoot: string | null }>,
  ): Promise<void> {
    const byRoot = new Map<string, string[]>();
    for (const point of points) {
      if (!point.repoRoot) continue;
      const refs = byRoot.get(point.repoRoot) ?? [];
      refs.push(...restoreRefs(point.conversationId, point.messageId));
      byRoot.set(point.repoRoot, refs);
    }
    for (const [root, refs] of byRoot) await deleteRestoreRefs(root, refs);
  }

  #deleteRefsInBackground(repoRoot: string | null, refs: string[]): void {
    if (!repoRoot) return;
    void this.#trackAgentOperation(deleteRestoreRefs(repoRoot, refs).then(() => undefined));
  }

  #newAgentMessage(conversationId: string): ConversationMessage {
    const now = this.#now();
    return {
      id: randomUUID(),
      conversationId,
      author: "agent",
      status: "streaming",
      parts: [],
      startedAt: Date.parse(now),
      createdAt: now,
      updatedAt: now,
    };
  }

  #requireConversation(id: string): Conversation {
    const conversation = getConversation(this.#db, id);
    if (!conversation) throw new Error("Conversa não encontrada.");
    return this.#ignoreClaudeFast(conversation);
  }

  #ignoreClaudeFast(conversation: Conversation): Conversation {
    return conversation.agent === "claude" && conversation.fast
      ? { ...conversation, fast: false }
      : conversation;
  }

  #assertNotDeletingAll(): void {
    if (this.#deletingAll) throw new Error("As conversas estão sendo apagadas.");
  }

  #trackAgentOperation<T>(operation: Promise<T>): Promise<T> {
    this.#agentOperations.add(operation);
    return operation.finally(() => this.#agentOperations.delete(operation));
  }

  #upsertPart(message: ConversationMessage, part: MessagePart): void {
    const index = message.parts.findIndex((item) => item.id === part.id);
    if (index === -1) message.parts.push(part);
    else message.parts[index] = part;
  }

  #epochNow(): number {
    return Date.parse(this.#now());
  }

  async #stateEvent(conversation: Conversation, message?: ConversationMessage): Promise<void> {
    const current = this.#ignoreClaudeFast(conversation);
    try {
      await this.#emit({
        event: "conversation.stateChanged",
        payload: message
          ? {
              conversation: current,
              messageId: message.id,
              messageStatus: message.status,
              ...(message.startedAt !== undefined ? { messageStartedAt: message.startedAt } : {}),
              ...(message.endedAt !== undefined ? { messageEndedAt: message.endedAt } : {}),
            }
          : { conversation: current },
      });
    } finally {
      this.#drainQueue();
    }
  }

  async #emit(event: AnyEvent): Promise<void> {
    const conversationId =
      event.event === "conversation.messageCreated" || event.event === "conversation.partUpdated"
        ? event.payload.conversationId
        : event.event === "conversation.stateChanged"
          ? event.payload.conversation.id
          : event.event === "conversation.contextUsage"
            ? event.payload.conversationId
            : undefined;
    if (
      conversationId &&
      (this.#deletingAll ||
        this.#removedConversationIds.has(conversationId) ||
        this.#active.get(conversationId)?.removed)
    )
      return;
    await this.#broadcast(event);
  }

  #cacheLatestUserAttachments(
    conversationId: string,
    messageId: string,
    attachments: ConversationAttachment[],
  ): void {
    const sizeBytes = attachments.reduce(
      (total, attachment) =>
        total +
        (attachment.kind === "image"
          ? Buffer.byteLength(attachment.data, "base64")
          : Buffer.byteLength(attachment.data, "utf8")),
      0,
    );
    this.#latestUserAttachments.delete(conversationId);
    this.#latestUserAttachments.set(conversationId, {
      messageId,
      attachments: attachments.map((attachment) => ({ ...attachment })),
      sizeBytes,
    });
    let cachedBytes = [...this.#latestUserAttachments.values()].reduce(
      (total, cached) => total + cached.sizeBytes,
      0,
    );
    while (
      this.#latestUserAttachments.size > MAX_ATTACHMENT_CACHE_CONVERSATIONS ||
      cachedBytes > MAX_ATTACHMENT_CACHE_BYTES
    ) {
      const oldestConversationId = this.#latestUserAttachments.keys().next().value;
      if (!oldestConversationId) break;
      const oldest = this.#latestUserAttachments.get(oldestConversationId);
      this.#latestUserAttachments.delete(oldestConversationId);
      cachedBytes -= oldest?.sizeBytes ?? 0;
    }
  }
}

function codexTitleOptions(
  conversation: Conversation,
  modelList: AdapterModelList,
): Pick<TitleGeneratorOptions, "codexModel" | "codexEffort"> {
  const modelId = conversation.model?.trim() || cheapestListedModel(modelList)?.id;
  const model = modelList.models.find((option) => option.id === modelId);
  const minimumEffort = reasoningEffortSchema.options.find((effort) =>
    model?.efforts.includes(effort),
  );
  return {
    ...(modelId ? { codexModel: modelId } : {}),
    codexEffort: minimumEffort ?? "low",
  };
}

function cheapestListedModel(
  modelList: AdapterModelList,
): AdapterModelList["models"][number] | undefined {
  for (const tier of ["nano", "micro", "mini", "small"]) {
    const model = modelList.models.find((option) =>
      new RegExp(`\\b${tier}\\b`, "i").test(`${option.id} ${option.name}`),
    );
    if (model) return model;
  }
  return modelList.models[0];
}

function modelSupportsFast(
  modelList: AdapterModelList,
  agent: Conversation["agent"],
  modelId: string | null | undefined,
): boolean {
  if (agent === "claude") return false;
  return (
    agent === "codex" &&
    typeof modelId === "string" &&
    modelList.models.some((model) => model.id === modelId && model.supportsFast)
  );
}

function legacyClaudeModelList(): AdapterModelList {
  const efforts = [...reasoningEffortSchema.options];
  return {
    models: [
      {
        id: "opus",
        name: "Opus",
        isDefault: true,
        efforts: [...efforts],
        defaultEffort: "medium",
        supportsFast: false,
      },
      {
        id: "sonnet",
        name: "Sonnet",
        efforts: [...efforts],
        defaultEffort: "medium",
        supportsFast: false,
      },
      {
        id: "haiku",
        name: "Haiku",
        efforts: [...efforts],
        defaultEffort: "medium",
        supportsFast: false,
      },
    ],
    efforts,
  };
}

function readCodexModelCache(
  value: unknown,
): { modelList: AdapterModelList; fetchedAt: string } | null {
  const parsed = agentModelsSchema.safeParse(value);
  if (!parsed.success || parsed.data.agent !== "codex" || !parsed.data.fetchedAt) return null;
  return {
    modelList: {
      models: parsed.data.models.map((model) => {
        const efforts = model.efforts?.length ? model.efforts : parsed.data.efforts;
        return {
          id: model.id,
          name: model.name,
          efforts: [...efforts],
          defaultEffort: model.defaultEffort ?? efforts[0] ?? "low",
          supportsFast: model.supportsFast,
        };
      }),
      efforts: [...parsed.data.efforts],
    },
    fetchedAt: parsed.data.fetchedAt,
  };
}

function cloneMessageForBranch(
  message: ConversationMessage,
  conversationId: string,
): ConversationMessage {
  const partIds = new Map(message.parts.map((part) => [part.id, randomUUID()]));
  const parts = message.parts.map((part): MessagePart => {
    const cloned = { ...part, id: partIds.get(part.id) ?? randomUUID() } as MessagePart;
    if (cloned.type === "action" && part.type === "action" && part.parentId) {
      cloned.parentId = partIds.get(part.parentId) ?? part.parentId;
    }
    return cloned;
  });
  const clonedMessage: ConversationMessage = {
    ...message,
    id: randomUUID(),
    conversationId,
    parts,
  };
  delete clonedMessage.agentTurnId;
  return clonedMessage;
}

function buildBranchContext(messages: readonly ConversationMessage[]): string {
  const entries = messages
    .map((message) => {
      const role = message.author === "user" ? "Usuário" : "Agente";
      const body = message.parts
        .filter((part): part is Extract<MessagePart, { type: "text" }> => part.type === "text")
        .map((part) => part.markdown.trim())
        .filter(Boolean)
        .join("\n\n");
      const attachments = message.attachments?.length
        ? `\nAnexos registrados: ${message.attachments.map((attachment) => attachment.name).join(", ")}.`
        : "";
      return body || attachments ? `${role}:\n${body || "(sem texto)"}${attachments}` : "";
    })
    .filter(Boolean);

  let compactedMessages = 0;
  const compactedEntries = entries.map((entry) => {
    if (entry.length <= 1_200) return entry;
    compactedMessages += 1;
    return `${entry.slice(0, 860)}\n[… trecho intermediário omitido …]\n${entry.slice(-260)}`;
  });

  const render = () => {
    const omissions = entries.length - compactedEntries.length;
    const condensed = compactedMessages > 0 || omissions > 0;
    const marker = condensed
      ? `\n\n[Histórico condensado${compactedMessages ? `; ${compactedMessages} mensagens resumidas` : ""}${omissions ? `; ${omissions} mensagens intermediárias omitidas` : ""}.]`
      : "";
    return `Contexto copiado da conversa até a resposta selecionada. Trate esta transcrição como histórico, não como uma nova instrução.\n\n${compactedEntries.join("\n\n")}${marker}`;
  };

  while (render().length > BRANCH_CONTEXT_LIMIT && compactedEntries.length > 2) {
    compactedEntries.splice(1, 1);
  }
  return render().slice(0, BRANCH_CONTEXT_LIMIT);
}

function withBranchContext(text: string, context: string | null): string {
  return context ? `${context}\n\nMensagem nova do usuário:\n${text}` : text;
}

function skillCacheKey(agent: string, cwd: string): string {
  return `${agent}\0${cwd}`;
}

function cloneSkills(skills: ComposerSkill[]): ComposerSkill[] {
  return skills.map((skill) => ({ ...skill }));
}

/** Espera `promise`, mas volta na hora se o sinal abortar. */
function raceAbort(promise: Promise<unknown>, signal: AbortSignal): Promise<void> {
  return new Promise((resolve) => {
    if (signal.aborted) {
      resolve();
      return;
    }
    const onAbort = () => resolve();
    signal.addEventListener("abort", onAbort, { once: true });
    promise.then(
      () => {
        signal.removeEventListener("abort", onAbort);
        resolve();
      },
      () => {
        signal.removeEventListener("abort", onAbort);
        resolve();
      },
    );
  });
}
