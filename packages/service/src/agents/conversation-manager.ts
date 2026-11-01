import { randomUUID } from "node:crypto";
import os from "node:os";
import type { DatabaseSync } from "node:sqlite";
import {
  type AnyEvent,
  agentModelsSchema,
  type Conversation,
  type ConversationAttachment,
  type ConversationMessage,
  type MessagePart,
} from "@karont/contract";
import { validateAttachments } from "../attachments.ts";
import { DeltaCoalescer } from "../coalescer.ts";
import {
  addMessage,
  createConversation,
  deleteConversation,
  getAgentSession,
  getConversation,
  getSetting,
  listConversations,
  listMessages,
  markConversationSeen,
  type NewConversation,
  saveMessage,
  setAgentSession,
  setConversationTitle,
  setSetting,
  updateConversation,
} from "../db.ts";
import type {
  AdapterEvent,
  AdapterFactory,
  AdapterModelList,
  AdapterResponse,
  AgentAdapter,
} from "./adapter.ts";
import { AgentCliError, createClaudeAdapterFactory } from "./claude-adapter.ts";
import { createCodexAdapterFactory, createCodexModelLoader } from "./codex-adapter.ts";
import { generateConversationTitle, type TitleGeneratorOptions } from "./title-generator.ts";

const CODEX_MODELS_SETTING = "agent.codex.models";

type ActiveConversation = {
  adapter: AgentAdapter;
  agent: Conversation["agent"];
  sessionId: string;
  startPromise: Promise<void>;
  idleTimer?: ReturnType<typeof setTimeout>;
  messageSaveTimer?: ReturnType<typeof setTimeout>;
  messageToSave?: ConversationMessage;
  currentMessage?: ConversationMessage;
  coalescers: Map<string, DeltaCoalescer>;
  deltaTimes: Map<string, { startedAt: number; endedAt: number }>;
  eventQueue: Promise<void>;
};
export type ConversationManagerOptions = {
  db: DatabaseSync;
  broadcast: (event: AnyEvent) => Promise<void>;
  env?: NodeJS.ProcessEnv;
  adapterFactory?: AdapterFactory;
  codexModelLoader?: (cwd: string) => Promise<AdapterModelList>;
  now?: () => string;
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
  readonly #factory: AdapterFactory;
  readonly #codexModelLoader: (cwd: string) => Promise<AdapterModelList>;
  readonly #now: () => string;
  readonly #titleGenerator: NonNullable<ConversationManagerOptions["titleGenerator"]>;
  readonly #active = new Map<string, ActiveConversation>();
  readonly #pendingParts = new Map<string, { conversationId: string; messageId: string }>();
  readonly #titleRequests = new Map<string, { userMessage: string; attempted: boolean }>();
  #codexModelList: AdapterModelList = {
    models: [],
    efforts: ["low", "medium", "high", "xhigh", "max"],
  };
  #codexModelFetchedAt: string | undefined;
  #codexModelLoadPromise: Promise<void> | undefined;
  #closing = false;

  constructor(options: ConversationManagerOptions) {
    this.#db = options.db;
    this.#broadcast = options.broadcast;
    this.#env = options.env ?? process.env;
    const claudeFactory = createClaudeAdapterFactory({ env: this.#env });
    const codexFactory = createCodexAdapterFactory({ env: this.#env });
    this.#codexModelLoader = options.codexModelLoader ?? createCodexModelLoader({ env: this.#env });
    this.#factory =
      options.adapterFactory ??
      ((conversation, emit) =>
        (conversation.agent === "codex" ? codexFactory : claudeFactory)(conversation, emit));
    this.#now = options.now ?? (() => new Date().toISOString());
    this.#titleGenerator =
      options.titleGenerator ??
      ((agent, userMessage, agentResponse, titleOptions) =>
        generateConversationTitle(agent, userMessage, agentResponse, {
          env: this.#env,
          ...titleOptions,
        }));
    const cached = readCodexModelCache(getSetting(this.#db, CODEX_MODELS_SETTING));
    if (cached) {
      this.#codexModelList = cached.modelList;
      this.#codexModelFetchedAt = cached.fetchedAt;
    }
  }

  create(input: NewConversation): Conversation {
    return createConversation(this.#db, input);
  }

  async rename(id: string, title: string): Promise<Conversation> {
    const conversation = setConversationTitle(this.#db, id, title.trim(), this.#now(), true);
    if (!conversation) throw new Error("Conversa não encontrada.");
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
    return listConversations(this.#db, filters);
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

  get(id: string): { conversation: Conversation; messages: ConversationMessage[] } | null {
    const conversation = getConversation(this.#db, id);
    return conversation ? { conversation, messages: listMessages(this.#db, id) } : null;
  }

  async markSeen(id: string): Promise<Conversation> {
    const result = markConversationSeen(this.#db, id);
    if (!result.conversation) throw new Error("Conversa não encontrada.");
    if (result.changed) await this.#stateEvent(result.conversation);
    return result.conversation;
  }

  async send(
    id: string,
    text: string,
    plan?: boolean,
    attachments?: ConversationAttachment[],
  ): Promise<{ userMessage: ConversationMessage; agentMessage: ConversationMessage }> {
    const validatedAttachments = validateAttachments(attachments);
    const conversation = this.#requireConversation(id);
    if (conversation.state === "working" || conversation.state === "waiting")
      throw new Error("A conversa já está em andamento.");
    const now = this.#now();
    if (
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
      parts: [{ id: randomUUID(), type: "text", markdown: text }],
      ...(validatedAttachments.metadata.length
        ? { attachments: validatedAttachments.metadata }
        : {}),
      createdAt: now,
      updatedAt: now,
    };
    addMessage(this.#db, userMessage);
    conversation.state = "working";
    conversation.updatedAt = this.#now();
    updateConversation(this.#db, conversation);
    try {
      await this.#emit({
        event: "conversation.messageCreated",
        payload: { conversationId: id, message: userMessage },
      });
    } catch (error) {
      conversation.state = "idle";
      conversation.updatedAt = this.#now();
      updateConversation(this.#db, conversation);
      throw error;
    }
    const agentMessage = this.#newAgentMessage(id);
    // O desligado mantém a inferência textual já usada pelo adaptador Codex.
    const requestedPlan = plan ?? (conversation.plan ? true : undefined);
    await this.#startTurn(
      conversation,
      agentMessage,
      text,
      requestedPlan,
      validatedAttachments.data,
    );
    return { userMessage, agentMessage };
  }

  async retry(id: string, messageId?: string): Promise<ConversationMessage> {
    const conversation = this.#requireConversation(id);
    if (conversation.state === "working" || conversation.state === "waiting")
      throw new Error("A conversa já está em andamento.");
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
      (failed.status !== "error" && failed.status !== "interrupted")
    )
      throw new Error("Não há resposta com erro para tentar novamente.");
    const failedIndex = messages.findIndex((message) => message.id === failed.id);
    const user = messages
      .slice(0, failedIndex)
      .reverse()
      .find((message) => message.author === "user");
    const textPart = user?.parts.find((part) => part.type === "text");
    const text = textPart?.type === "text" ? textPart.markdown : "";
    if (!text) throw new Error("A mensagem original não está disponível para nova tentativa.");
    const agentMessage = this.#newAgentMessage(id);
    await this.#startTurn(conversation, agentMessage, text);
    return agentMessage;
  }

  async stop(id: string): Promise<boolean> {
    const active = this.#active.get(id);
    if (!active?.currentMessage) return false;
    await this.#flushCoalescers(active);
    this.#flushMessageSave(active);
    await active.adapter.interrupt();
    return true;
  }

  async respond(id: string, partId: string, response: AdapterResponse): Promise<void> {
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
    },
  ): Promise<Conversation> {
    const conversation = this.#requireConversation(id);
    if (conversation.state === "working" || conversation.state === "waiting")
      throw new Error("As opções só podem ser alteradas quando a conversa está parada.");
    const active = this.#active.get(id);
    if (active) {
      if (active.idleTimer) clearTimeout(active.idleTimer);
      await active.adapter.dispose();
      this.#active.delete(id);
    }
    if (options.mode) conversation.mode = options.mode;
    if ("model" in options) {
      if (options.model === null) delete conversation.model;
      else if (options.model !== undefined) conversation.model = options.model;
    }
    if ("effort" in options) {
      if (options.effort === null) delete conversation.effort;
      else if (options.effort !== undefined) conversation.effort = options.effort;
    }
    if (options.plan !== undefined) conversation.plan = options.plan;
    conversation.updatedAt = this.#now();
    updateConversation(this.#db, conversation);
    await this.#stateEvent(conversation);
    return conversation;
  }

  async remove(id: string): Promise<boolean> {
    const active = this.#active.get(id);
    if (active) {
      if (active.idleTimer) clearTimeout(active.idleTimer);
      await active.adapter.dispose();
      this.#active.delete(id);
    }
    return deleteConversation(this.#db, id);
  }

  async models(agent: "claude" | "codex"): Promise<{
    agent: "claude" | "codex";
    models: {
      id: string;
      name: string;
      efforts?: NonNullable<Conversation["effort"]>[];
      defaultEffort?: NonNullable<Conversation["effort"]>;
    }[];
    efforts: ("low" | "medium" | "high" | "xhigh" | "max")[];
    fetchedAt?: string;
  }> {
    const efforts = ["low", "medium", "high", "xhigh", "max"] as const;
    if (agent === "codex") {
      await this.#loadCodexModelsIfNeeded();
      return {
        agent,
        models: this.#codexModelList.models.map(({ id, name, efforts, defaultEffort }) => ({
          id,
          name,
          efforts: [...efforts],
          defaultEffort,
        })),
        efforts: [...this.#codexModelList.efforts],
        ...(this.#codexModelFetchedAt ? { fetchedAt: this.#codexModelFetchedAt } : {}),
      };
    }
    return {
      agent,
      models: [
        { id: "opus", name: "Opus" },
        { id: "sonnet", name: "Sonnet" },
        { id: "haiku", name: "Haiku" },
      ],
      efforts: [...efforts],
    };
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
        modelList ??= await this.#codexModelLoader(os.homedir());
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
        models: modelList.models.map(({ id, name, efforts, defaultEffort }) => ({
          id,
          name,
          efforts,
          defaultEffort,
        })),
        efforts: modelList.efforts,
        fetchedAt: this.#codexModelFetchedAt,
      });
    } catch {
      // Keep the in-memory catalog available for this service run if persistence fails.
    }
  }

  async close(): Promise<void> {
    this.#closing = true;
    const adapters = [...this.#active.values()];
    await Promise.all(
      adapters.map(async (active) => {
        if (active.idleTimer) clearTimeout(active.idleTimer);
        await active.adapter.dispose();
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
  }

  async #startTurn(
    conversation: Conversation,
    message: ConversationMessage,
    text: string,
    plan?: boolean,
    attachments: ConversationAttachment[] = [],
  ): Promise<void> {
    addMessage(this.#db, message);
    conversation.state = "working";
    conversation.updatedAt = this.#now();
    updateConversation(this.#db, conversation);
    await this.#emit({
      event: "conversation.messageCreated",
      payload: { conversationId: conversation.id, message },
    });
    await this.#stateEvent(conversation);

    // Ponto único para aplicar o limite/fila de agentes quando a configuração da M3 existir.
    let active = this.#active.get(conversation.id);
    if (!active) {
      const previousSession = getAgentSession(this.#db, conversation.id);
      const sessionId = previousSession ?? randomUUID();
      let activeRef: ActiveConversation;
      const adapter = this.#factory(conversation, (event) => {
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
        currentMessage: message,
        eventQueue: Promise.resolve(),
      };
      active = activeRef;
      this.#active.set(conversation.id, activeRef);
      activeRef.startPromise = adapter
        .start(conversation, sessionId, previousSession !== null, plan)
        .then(async () => {
          await activeRef.eventQueue;
          if (conversation.agent !== "codex") return;
          const modelList = await adapter.getModels?.();
          if (modelList) this.#cacheCodexModelList(modelList);
        })
        .catch(async (error: unknown) => {
          if (!this.#closing) {
            const kind = error instanceof AgentCliError ? error.errorType : "failed";
            const detail = error instanceof Error ? error.message : String(error);
            await this.#finishWithError(conversation, message, kind, detail);
          }
          await adapter.dispose();
          if (this.#active.get(conversation.id) === activeRef) this.#active.delete(conversation.id);
          throw error;
        });
    } else {
      if (active.idleTimer) clearTimeout(active.idleTimer);
      active.idleTimer = undefined;
      active.currentMessage = message;
      await active.startPromise;
    }
    active.currentMessage = message;
    try {
      await active.startPromise;
      await active.adapter.send(text, plan, attachments);
    } catch (error) {
      if (message.status === "streaming" && !this.#closing) {
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
    if (!active || !message) return;
    if (event.kind === "session") {
      active.sessionId = event.sessionId;
      setAgentSession(this.#db, conversationId, event.sessionId);
      return;
    }
    if (event.kind === "state") {
      const conversation = this.#requireConversation(conversationId);
      if (event.state === "working" && message.status !== "streaming") {
        message.status = "streaming";
        message.updatedAt = this.#now();
        saveMessage(this.#db, message);
      }
      conversation.state = event.state;
      conversation.updatedAt = this.#now();
      updateConversation(this.#db, conversation);
      await this.#stateEvent(conversation, {
        messageId: message.id,
        messageStatus: message.status,
      });
      return;
    }
    if (event.kind === "part") {
      await this.#flushCoalescers(active);
      const part = this.#timestampPart(message, event.part);
      this.#upsertPart(message, part);
      if (part.type === "permission" || part.type === "question" || part.type === "plan") {
        if (part.state === "pending")
          this.#pendingParts.set(part.id, { conversationId, messageId: message.id });
        else this.#pendingParts.delete(part.id);
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
            let part = message.parts.find((item) => item.id === event.partId);
            if (!part) {
              const times = active.deltaTimes.get(event.partId);
              part =
                event.partType === "text"
                  ? {
                      id: event.partId,
                      type: "text",
                      markdown: "",
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
            await this.#emit({
              event: "conversation.partUpdated",
              payload: {
                conversationId,
                messageId: message.id,
                kind: "delta",
                partId: event.partId,
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
      const endedAt = this.#epochNow();
      const completedAt = this.#now();
      message.endedAt = endedAt;
      if (event.error) {
        const errorPart: MessagePart = {
          id: randomUUID(),
          type: "error",
          errorType: event.error.type,
          text: event.error.text,
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
      if (!pendingPlan) {
        active.currentMessage = undefined;
        for (const [partId, pending] of this.#pendingParts)
          if (pending.messageId === message.id) this.#pendingParts.delete(partId);
      }
      const conversation = this.#requireConversation(conversationId);
      conversation.state = event.status === "error" ? "error" : pendingPlan ? "waiting" : "idle";
      conversation.updatedAt = completedAt;
      if (event.status === "done" || event.status === "error") {
        conversation.unreadAt = completedAt;
      }
      updateConversation(this.#db, conversation);
      await this.#stateEvent(conversation, {
        messageId: message.id,
        messageStatus: message.status,
      });
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
      if (this.#active.get(conversationId) !== active || active.currentMessage) return;
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
        if (!title) return;
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

  #scheduleMessageSave(active: ActiveConversation, message: ConversationMessage): void {
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
    const endedAt = this.#epochNow();
    const part: MessagePart = {
      id: randomUUID(),
      type: "error",
      errorType: type,
      text,
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
    conversation.state = message.status === "error" ? "error" : "idle";
    conversation.updatedAt = completedAt;
    if (message.status === "error") conversation.unreadAt = completedAt;
    updateConversation(this.#db, conversation);
    await this.#stateEvent(conversation, { messageId: message.id, messageStatus: message.status });
    if (active?.currentMessage?.id === message.id) active.currentMessage = undefined;
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
    return conversation;
  }

  #upsertPart(message: ConversationMessage, part: MessagePart): void {
    const index = message.parts.findIndex((item) => item.id === part.id);
    if (index === -1) message.parts.push(part);
    else message.parts[index] = part;
  }

  #epochNow(): number {
    return Date.parse(this.#now());
  }

  async #stateEvent(
    conversation: Conversation,
    message?: { messageId: string; messageStatus: ConversationMessage["status"] },
  ): Promise<void> {
    await this.#emit({
      event: "conversation.stateChanged",
      payload: message
        ? { conversation, messageId: message.messageId, messageStatus: message.messageStatus }
        : { conversation },
    });
  }

  async #emit(event: AnyEvent): Promise<void> {
    await this.#broadcast(event);
  }
}

function codexTitleOptions(
  conversation: Conversation,
  modelList: AdapterModelList,
): Pick<TitleGeneratorOptions, "codexModel" | "codexEffort"> {
  const modelId = conversation.model?.trim() || cheapestListedModel(modelList)?.id;
  const model = modelList.models.find((option) => option.id === modelId);
  const minimumEffort = ["low", "medium", "high", "xhigh", "max"].find((effort) =>
    model?.efforts.includes(effort as NonNullable<Conversation["effort"]>),
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
        };
      }),
      efforts: [...parsed.data.efforts],
    },
    fetchedAt: parsed.data.fetchedAt,
  };
}
