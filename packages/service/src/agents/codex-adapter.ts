import { type ChildProcess, spawn as nodeSpawn, type SpawnOptions } from "node:child_process";
import { randomUUID } from "node:crypto";
import { chmod, mkdtemp, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { performance } from "node:perf_hooks";
import { createInterface } from "node:readline";
import {
  type Conversation,
  type ConversationAttachment,
  describeAgentError,
  type MessagePart,
} from "@karont/contract";
import type {
  AdapterEvent,
  AdapterFactory,
  AdapterModelList,
  AdapterResponse,
  AgentAdapter,
} from "./adapter.ts";
import { AgentCliError } from "./claude-adapter.ts";
import { resolveAgentCommand } from "./detect.ts";

const MAX_ACTION_OUTPUT_BYTES = 64 * 1024;
const RPC_TIMEOUT_MS = 30_000;
const INTERRUPT_TIMEOUT_MS = 3_000;
const EFFORTS = ["low", "medium", "high", "xhigh", "max"] as const;
type Effort = (typeof EFFORTS)[number];
type RpcId = string | number;
type JsonRecord = Record<string, unknown>;
type SpawnFunction = (command: string, args: string[], options: SpawnOptions) => ChildProcess;
type RpcResult = {
  resolve(value: unknown): void;
  reject(error: Error): void;
  timer: ReturnType<typeof setTimeout>;
};
type PendingResponse =
  | {
      kind: "permission";
      requestId: RpcId;
      method: string;
    }
  | {
      kind: "question";
      requestId: RpcId;
      questions: JsonRecord[];
    }
  | { kind: "plan" };
type ActionRecord = {
  part: Extract<MessagePart, { type: "action" }>;
  startedAt: number | null;
  observedStartedAt: number | null;
};

export type CodexAdapterOptions = {
  env?: NodeJS.ProcessEnv;
  spawn?: SpawnFunction;
  homeDir?: string;
  platform?: NodeJS.Platform;
};

export class CodexAdapter implements AgentAdapter {
  readonly #emit: (event: AdapterEvent) => void;
  readonly #env: NodeJS.ProcessEnv;
  readonly #spawn: SpawnFunction;
  readonly #homeDir: string;
  readonly #platform: NodeJS.Platform;
  readonly #rpcResults = new Map<RpcId, RpcResult>();
  readonly #pendingResponses = new Map<string, PendingResponse>();
  readonly #parts = new Map<string, MessagePart>();
  readonly #actions = new Map<string, ActionRecord>();
  readonly #planText = new Map<string, string>();
  readonly #itemText = new Map<string, string>();
  #child: ChildProcess | undefined;
  #conversation: Conversation | undefined;
  #threadId = "";
  #turnId = "";
  #nextRpcId = 1;
  #models: AdapterModelList = { models: [], efforts: [...EFFORTS] };
  #modelId = "";
  #effort: Effort = "low";
  #turnOpen = false;
  #stopRequested = false;
  #turnComplete: Promise<void> = Promise.resolve();
  #turnCompleteResolve: (() => void) | undefined;
  #disposed = false;
  #approvedPlanPartId: string | undefined;
  #attachmentDirectory: string | undefined;
  #attachmentCleanup: Promise<void> = Promise.resolve();

  constructor(emit: (event: AdapterEvent) => void, options: CodexAdapterOptions = {}) {
    this.#emit = emit;
    this.#env = options.env ?? process.env;
    this.#spawn = options.spawn ?? nodeSpawn;
    this.#homeDir = options.homeDir ?? os.homedir();
    this.#platform = options.platform ?? process.platform;
  }

  async start(conversation: Conversation, sessionId: string, resume: boolean): Promise<void> {
    if (isRunning(this.#child)) return;
    this.#conversation = conversation;
    this.#threadId = sessionId;
    this.#disposed = false;
    this.#turnId = "";
    this.#stopRequested = false;
    this.#models = { models: [], efforts: [...EFFORTS] };
    await this.#startServer(conversation.cwd);
    const catalog = await this.#request("model/list", { limit: 100, includeHidden: false });
    this.#models = parseModelList(catalog);
    const selected = selectModel(this.#models, catalog, conversation.model);
    this.#modelId = selected.id;
    this.#effort = normalizeEffort(conversation.effort ?? selected.effort);

    if (resume) {
      await this.#request("thread/resume", { threadId: sessionId, cwd: conversation.cwd });
    } else {
      const { sandbox, approvalPolicy } = permissionSettings(conversation.mode);
      const result = await this.#request("thread/start", {
        cwd: conversation.cwd,
        model: this.#modelId,
        sandbox,
        approvalPolicy,
      });
      const thread = isRecord(result) && isRecord(result.thread) ? result.thread : undefined;
      if (!thread || typeof thread.id !== "string")
        throw new AgentCliError("failed", "O Codex não devolveu o identificador da conversa.");
      this.#threadId = thread.id;
    }
    this.#emit({ kind: "session", sessionId: this.#threadId });
  }

  async loadModelCatalog(cwd: string): Promise<AdapterModelList> {
    this.#disposed = false;
    this.#models = { models: [], efforts: [...EFFORTS] };
    try {
      await this.#startServer(cwd);
      const catalog = await this.#request("model/list", { limit: 100, includeHidden: false });
      this.#models = parseModelList(catalog);
      return await this.getModels();
    } finally {
      await this.dispose();
    }
  }

  async send(
    text: string,
    plan?: boolean,
    attachments: ConversationAttachment[] = [],
  ): Promise<void> {
    if (!isRunning(this.#child)) {
      if (!this.#conversation || !this.#threadId)
        throw new AgentCliError("failed", "O processo Codex não está ativo.");
      await this.start(this.#conversation, this.#threadId, true);
    }
    this.#approvedPlanPartId = undefined;
    await this.#startTurn(text, (plan ?? usesPlanMode(text)) ? "plan" : undefined, attachments);
  }

  async respond(partId: string, response: AdapterResponse): Promise<void> {
    const pending = this.#pendingResponses.get(partId);
    if (!pending) throw new Error("A resposta solicitada não está mais pendente.");

    if (response.responseType === "permission" && pending.kind === "permission") {
      const decision = mapPermissionDecision(pending.method, response.decision);
      this.#pendingResponses.delete(partId);
      const part = this.#parts.get(partId);
      if (part?.type === "permission")
        this.#emitPart({ ...part, state: response.decision === "deny" ? "denied" : "allowed" });
      await this.#writeResponse(pending.requestId, { decision });
      this.#emit({ kind: "state", state: "working" });
      return;
    }

    if (response.responseType === "question" && pending.kind === "question") {
      const answers: JsonRecord = {};
      for (const [index, question] of pending.questions.entries()) {
        if (typeof question.id !== "string") continue;
        const answer =
          response.answers[question.id] ??
          response.answers[String(index)] ??
          (typeof question.question === "string"
            ? response.answers[question.question]
            : undefined) ??
          (typeof question.header === "string" ? response.answers[question.header] : undefined);
        if (answer) answers[question.id] = { answers: answer };
      }
      this.#pendingResponses.delete(partId);
      const part = this.#parts.get(partId);
      if (part?.type === "question") this.#emitPart({ ...part, state: "answered" });
      await this.#writeResponse(pending.requestId, { answers });
      this.#emit({ kind: "state", state: "working" });
      return;
    }

    if (response.responseType === "plan" && pending.kind === "plan") {
      const part = this.#parts.get(partId);
      if (part?.type !== "plan") throw new Error("O plano aguardando decisão não está disponível.");
      this.#pendingResponses.delete(partId);
      const approved = response.decision === "approve";
      this.#emitPart({
        ...part,
        state: approved ? "approved" : "rejected",
        ...(response.comment ? { comment: response.comment } : {}),
      });
      if (approved) this.#approvedPlanPartId = partId;
      this.#emit({ kind: "state", state: "working" });
      const approval = approved
        ? "Execute o plano aprovado no modo de acesso escolhido para esta conversa."
        : response.comment?.trim() || "Revise o plano conforme solicitado.";
      await this.#startTurn(approval, approved ? "default" : "plan");
      return;
    }

    throw new Error("A resposta não corresponde à solicitação pendente.");
  }

  async interrupt(): Promise<void> {
    if (!isRunning(this.#child) || !this.#turnOpen) return;
    this.#stopRequested = true;
    const completion = this.#turnComplete;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const timeout = new Promise<"timeout">((resolve) => {
      timer = setTimeout(() => resolve("timeout"), INTERRUPT_TIMEOUT_MS);
    });
    const interrupt = this.#request("turn/interrupt", {
      threadId: this.#threadId,
      turnId: this.#turnId,
    });
    const finished = Promise.all([interrupt, completion])
      .then(() => "complete" as const)
      .catch(() => "timeout" as const);
    if ((await Promise.race([finished, timeout])) === "timeout") {
      this.#child?.kill("SIGTERM");
      const hardStop = setTimeout(() => this.#child?.kill("SIGKILL"), 300);
      hardStop.unref?.();
      this.#completeTurn("interrupted", {
        type: "interrupted",
        text: "Resposta interrompida pelo usuário.",
      });
    }
    if (timer) clearTimeout(timer);
  }

  async dispose(): Promise<void> {
    this.#disposed = true;
    this.#rejectPending(new AgentCliError("failed", "O processo Codex foi encerrado."));
    if (isRunning(this.#child)) {
      this.#child.kill("SIGTERM");
      const child = this.#child;
      await new Promise<void>((resolve) => {
        const timer = setTimeout(() => {
          child.kill("SIGKILL");
          resolve();
        }, 500);
        timer.unref?.();
        child.once("close", () => {
          clearTimeout(timer);
          resolve();
        });
      });
    }
    this.#child = undefined;
    await this.#attachmentCleanup;
    await this.#cleanupAttachmentFiles();
  }

  async getModels(): Promise<AdapterModelList> {
    return {
      models: this.#models.models.map((model) => ({ ...model, efforts: [...model.efforts] })),
      efforts: [...this.#models.efforts],
    };
  }

  async #startServer(cwd: string): Promise<void> {
    const command =
      this.#env.KARONT_CODEX_CLI ||
      (await resolveAgentCommand("codex", {
        env: this.#env,
        homeDir: this.#homeDir,
        platform: this.#platform,
      })) ||
      "codex";
    try {
      this.#child = this.#spawn(command, ["app-server", "--stdio"], {
        cwd,
        env: this.#env,
        stdio: ["pipe", "pipe", "pipe"],
      });
    } catch (error) {
      throw classifyStartError(error, command);
    }

    const child = this.#child;
    if (!child.stdin || !child.stdout || !child.stderr)
      throw new AgentCliError("failed", "O Codex não abriu os canais de comunicação esperados.");
    const lines = createInterface({ input: child.stdout, crlfDelay: Infinity });
    lines.on("line", (line) => this.#handleLine(line));
    child.stderr.on("data", () => undefined);
    child.once("error", (error) => this.#handleProcessError(error, child, command));
    child.once("close", (code, signal) => this.#handleProcessClose(code, signal, child));

    await this.#request("initialize", {
      clientInfo: { name: "karont", version: "0.0.0", title: "Karont" },
      capabilities: { experimentalApi: true },
    });
    await this.#notify("initialized", {});
  }

  async #startTurn(
    text: string,
    collaborationMode?: "default" | "plan",
    attachments: ConversationAttachment[] = [],
  ): Promise<void> {
    if (!this.#threadId) throw new AgentCliError("failed", "A conversa Codex não foi iniciada.");
    const input = await this.#prepareInput(text, attachments);
    this.#turnOpen = true;
    this.#stopRequested = false;
    this.#turnId = "";
    this.#turnComplete = new Promise<void>((resolve) => {
      this.#turnCompleteResolve = resolve;
    });
    const params: JsonRecord = {
      threadId: this.#threadId,
      input,
      model: this.#modelId,
      effort: this.#effort,
    };
    if (collaborationMode) {
      params.collaborationMode = {
        mode: collaborationMode,
        settings: {
          model: this.#modelId,
          reasoning_effort: this.#effort,
          developer_instructions: null,
        },
      };
    }
    let result: unknown;
    try {
      result = await this.#request("turn/start", params);
    } catch (error) {
      this.#turnOpen = false;
      this.#turnCompleteResolve?.();
      this.#turnCompleteResolve = undefined;
      this.#attachmentCleanup = this.#cleanupAttachmentFiles();
      await this.#attachmentCleanup;
      throw error;
    }
    if (isRecord(result) && isRecord(result.turn) && typeof result.turn.id === "string")
      this.#turnId = result.turn.id;
  }

  async #request(method: string, params: JsonRecord): Promise<unknown> {
    const id = this.#nextRpcId++;
    const response = new Promise<unknown>((resolve, reject) => {
      const timer = setTimeout(() => {
        this.#rpcResults.delete(id);
        reject(new AgentCliError("failed", `O Codex não respondeu a ${method} a tempo.`));
      }, RPC_TIMEOUT_MS);
      timer.unref?.();
      this.#rpcResults.set(id, { resolve, reject, timer });
    });
    await this.#write({ jsonrpc: "2.0", id, method, params }).catch((error: unknown) => {
      const pending = this.#rpcResults.get(id);
      if (!pending) return;
      this.#rpcResults.delete(id);
      clearTimeout(pending.timer);
      pending.reject(error instanceof Error ? error : new Error(String(error)));
    });
    return response;
  }

  async #notify(method: string, params: JsonRecord): Promise<void> {
    await this.#write({ jsonrpc: "2.0", method, params });
  }

  async #writeResponse(id: RpcId, result: JsonRecord): Promise<void> {
    await this.#write({ jsonrpc: "2.0", id, result });
  }

  async #write(value: JsonRecord): Promise<void> {
    const stdin = this.#child?.stdin;
    if (!stdin || stdin.destroyed || stdin.writableEnded)
      throw new AgentCliError("failed", "O canal de entrada do Codex foi encerrado.");
    const line = `${JSON.stringify(value)}\n`;
    await new Promise<void>((resolve, reject) => {
      stdin.write(line, "utf8", (error) => (error ? reject(error) : resolve()));
    });
  }

  #handleLine(line: string): void {
    let message: JsonRecord;
    try {
      const parsed: unknown = JSON.parse(line);
      if (!isRecord(parsed)) return;
      message = parsed;
    } catch {
      this.#completeTurn("error", {
        type: "failed",
        text: "O Codex enviou uma resposta JSON inválida.",
      });
      return;
    }
    if (typeof message.method === "string") {
      if (message.id !== undefined) void this.#handleServerRequest(message).catch(() => undefined);
      else this.#handleNotification(message.method, isRecord(message.params) ? message.params : {});
      return;
    }
    if (
      (typeof message.id === "number" || typeof message.id === "string") &&
      this.#rpcResults.has(message.id)
    ) {
      const pending = this.#rpcResults.get(message.id);
      if (!pending) return;
      this.#rpcResults.delete(message.id);
      clearTimeout(pending.timer);
      if (isRecord(message.error)) {
        const text =
          typeof message.error.message === "string"
            ? message.error.message
            : "Falha na chamada JSON-RPC.";
        pending.reject(new AgentCliError(classifyErrorText(text), text));
      } else pending.resolve(message.result);
    }
  }

  async #handleServerRequest(message: JsonRecord): Promise<void> {
    const id = message.id as RpcId;
    const method = typeof message.method === "string" ? message.method : "";
    const params = isRecord(message.params) ? message.params : {};
    if (
      method === "item/commandExecution/requestApproval" ||
      method === "item/fileChange/requestApproval" ||
      method === "execApproval/requestApproval" ||
      method === "applyPatchApproval/requestApproval"
    ) {
      const partId = randomUUID();
      const commandRequest = method.includes("commandExecution") || method.includes("execApproval");
      const target = commandRequest
        ? stringValue(params.command)
        : fileChangeSummary(params.fileChanges);
      const summary =
        [stringValue(params.reason), target, stringValue(params.cwd)].filter(Boolean).join("\n") ||
        "O Codex pede permissão para continuar.";
      const part: MessagePart = {
        id: partId,
        type: "permission",
        tool: commandRequest ? "Comando" : "Edição de arquivos",
        summary: truncateCharacters(summary, 8_192),
        options: ["allow", "always", "deny"],
        state: "pending",
      };
      this.#pendingResponses.set(partId, { kind: "permission", requestId: id, method });
      this.#emitPart(part);
      this.#emit({ kind: "state", state: "waiting" });
      return;
    }
    if (method === "item/tool/requestUserInput") {
      const itemId = typeof params.itemId === "string" ? params.itemId : String(id);
      const sourceQuestions = Array.isArray(params.questions)
        ? params.questions.filter(isRecord)
        : [];
      const partQuestions = sourceQuestions.map((question) => ({
        question: stringValue(question.question) || "O agente tem uma pergunta.",
        ...(typeof question.header === "string" ? { header: question.header } : {}),
        options: Array.isArray(question.options)
          ? question.options.filter(isRecord).map((option) => ({
              label: stringValue(option.label),
              ...(typeof option.description === "string"
                ? { description: option.description }
                : {}),
            }))
          : [],
        multiSelect: false,
        freeText: question.isOther === true,
      }));
      const part: MessagePart = {
        id: itemId,
        type: "question",
        questions: partQuestions,
        state: "pending",
      };
      this.#pendingResponses.set(itemId, {
        kind: "question",
        requestId: id,
        questions: sourceQuestions,
      });
      this.#emitPart(part);
      this.#emit({ kind: "state", state: "waiting" });
      return;
    }
    await this.#write({
      jsonrpc: "2.0",
      id,
      error: { code: -32601, message: `Método não suportado: ${method}` },
    });
  }

  #handleNotification(method: string, params: JsonRecord): void {
    if (method === "turn/started") {
      if (isRecord(params.turn) && typeof params.turn.id === "string")
        this.#turnId = params.turn.id;
      this.#emit({ kind: "state", state: "working" });
      return;
    }
    if (method === "item/agentMessage/delta") {
      const partId = stringValue(params.itemId);
      const delta = stringValue(params.delta);
      if (!partId || !delta) return;
      this.#itemText.set(partId, (this.#itemText.get(partId) ?? "") + delta);
      this.#emit({ kind: "text-delta", partType: "text", partId, delta });
      return;
    }
    if (method === "item/plan/delta") {
      const itemId = stringValue(params.itemId);
      const delta = stringValue(params.delta);
      if (itemId && delta) this.#planText.set(itemId, (this.#planText.get(itemId) ?? "") + delta);
      return;
    }
    if (method === "item/started" || method === "item/completed") {
      if (isRecord(params.item))
        this.#handleItem(method === "item/started" ? "started" : "completed", params.item);
      return;
    }
    if (method === "turn/completed") {
      const turn = isRecord(params.turn) ? params.turn : {};
      const status = stringValue(turn.status);
      if (status === "interrupted") {
        this.#completeTurn("interrupted", {
          type: "interrupted",
          text: "Resposta interrompida pelo usuário.",
        });
      } else if (status === "failed") {
        const error = isRecord(turn.error) ? turn.error : {};
        const text = stringValue(error.message) || "O Codex encerrou o turno com erro.";
        const errorType = classifyErrorText(text);
        this.#completeTurn("error", { type: errorType, text });
      } else this.#completeTurn("done");
    }
  }

  #handleItem(stage: "started" | "completed", item: JsonRecord): void {
    const type = stringValue(item.type);
    const id = stringValue(item.id);
    if (!type || !id) return;
    if (stage === "started") {
      if (type === "agentMessage") this.#itemText.set(id, stringValue(item.text));
      else if (type === "plan") this.#planText.set(id, stringValue(item.text));
      else if (isActionItem(type)) this.#upsertAction(item, "running");
      return;
    }

    if (type === "agentMessage") {
      const finalText = stringValue(item.text);
      const streamed = this.#itemText.get(id) ?? "";
      if (finalText && !streamed)
        this.#emit({ kind: "text-delta", partType: "text", partId: id, delta: finalText });
      else if (finalText.startsWith(streamed) && finalText.length > streamed.length)
        this.#emit({
          kind: "text-delta",
          partType: "text",
          partId: id,
          delta: finalText.slice(streamed.length),
        });
      this.#itemText.delete(id);
      return;
    }
    if (type === "reasoning") {
      const text = extractText(item.summary) || extractText(item.content);
      if (text) this.#emit({ kind: "text-delta", partType: "thinking", partId: id, delta: text });
      return;
    }
    if (type === "plan") {
      const text = stringValue(item.text) || this.#planText.get(id) || "";
      const approved = this.#approvedPlanPartId !== undefined;
      const partId = this.#approvedPlanPartId ?? id;
      const part: MessagePart = {
        id: partId,
        type: "plan",
        markdown: text,
        state: approved ? "approved" : "pending",
      };
      this.#emitPart(part);
      if (!approved) this.#pendingResponses.set(partId, { kind: "plan" });
      const todos = parseTodos(text);
      if (todos.length) this.#emitPart({ id: `${partId}-todos`, type: "todos", items: todos });
      this.#planText.delete(id);
      return;
    }
    if (isActionItem(type)) this.#upsertAction(item, "complete");
  }

  #upsertAction(item: JsonRecord, stage: "running" | "complete"): void {
    const type = stringValue(item.type);
    const id = stringValue(item.id);
    if (!type || !id) return;
    const prior = this.#actions.get(id);
    const startedAt =
      typeof item.startedAtMs === "number" ? item.startedAtMs : (prior?.startedAt ?? null);
    const observedStartedAt =
      stage === "running"
        ? (prior?.observedStartedAt ?? performance.now())
        : (prior?.observedStartedAt ?? null);
    const actionType = actionTypeFor(item);
    const action = Array.isArray(item.commandActions)
      ? item.commandActions.find(isRecord)
      : undefined;
    const command = unwrapCodexShellCommand(stringValue(item.command));
    const actionCommand = unwrapCodexShellCommand(stringValue(action?.command));
    const displayCommand = command || actionCommand;
    const input = actionInput(item, displayCommand);
    const title = actionTitle(item, actionType, displayCommand);
    const rawOutput = actionOutput(item);
    const { output, truncated } = truncateOutput(rawOutput);
    const status = stringValue(item.status);
    const successful =
      status === "completed" &&
      (item.exitCode === undefined || item.exitCode === null || item.exitCode === 0);
    const state = stage === "running" ? "running" : successful ? "ok" : "error";
    const reportedDuration =
      typeof item.durationMs === "number" && item.durationMs > 0
        ? Math.max(1, Math.trunc(item.durationMs))
        : null;
    const timestampDuration =
      startedAt !== null && typeof item.completedAtMs === "number"
        ? item.completedAtMs - startedAt
        : null;
    const observedDuration =
      stage === "complete" && observedStartedAt !== null
        ? Math.ceil(performance.now() - observedStartedAt)
        : null;
    const durationMs =
      reportedDuration ??
      (timestampDuration !== null && timestampDuration > 0
        ? Math.ceil(timestampDuration)
        : observedDuration !== null && observedDuration > 0
          ? observedDuration
          : null);
    const part: Extract<MessagePart, { type: "action" }> = {
      id,
      type: "action",
      actionType,
      title: truncateCharacters(title, 240),
      input: truncateCharacters(input, 8_192),
      output,
      truncated,
      state,
      durationMs,
    };
    this.#actions.set(id, { part, startedAt, observedStartedAt });
    this.#emitPart(part);
  }

  #emitPart(part: MessagePart): void {
    this.#parts.set(part.id, part);
    this.#emit({ kind: "part", part });
  }

  #completeTurn(
    status: "done" | "interrupted" | "error",
    error?: { type: "cli-not-found" | "not-logged-in" | "failed" | "interrupted"; text: string },
  ): void {
    if (!this.#turnOpen) return;
    this.#turnOpen = false;
    this.#turnCompleteResolve?.();
    this.#turnCompleteResolve = undefined;
    this.#approvedPlanPartId = undefined;
    this.#attachmentCleanup = this.#cleanupAttachmentFiles();
    void this.#attachmentCleanup.then(() => {
      this.#emit({ kind: "turn-end", status, ...(error ? { error } : {}) });
    });
  }

  async #prepareInput(text: string, attachments: ConversationAttachment[]): Promise<JsonRecord[]> {
    await this.#attachmentCleanup;
    const input: JsonRecord[] = [{ type: "text", text }];
    try {
      for (const attachment of attachments) {
        if (attachment.kind === "text") {
          input.push({ type: "text", text: formatTextAttachment(attachment) });
          continue;
        }
        if (!this.#attachmentDirectory) {
          this.#attachmentDirectory = await mkdtemp(path.join(os.tmpdir(), "karont-anexo-"));
          if (this.#disposed) throw new Error("O processo Codex foi encerrado durante o anexo.");
          await chmod(this.#attachmentDirectory, 0o700);
        }
        const imagePath = path.join(
          this.#attachmentDirectory,
          `${randomUUID()}${imageExtension(attachment.mimeType)}`,
        );
        await writeFile(imagePath, Buffer.from(attachment.data, "base64"), {
          flag: "wx",
          mode: 0o600,
        });
        input.push({ type: "localImage", path: imagePath });
      }
    } catch (error) {
      await this.#cleanupAttachmentFiles();
      throw error;
    }
    return input;
  }

  async #cleanupAttachmentFiles(): Promise<void> {
    const directory = this.#attachmentDirectory;
    this.#attachmentDirectory = undefined;
    if (directory) await rm(directory, { recursive: true, force: true }).catch(() => undefined);
  }

  #handleProcessError(error: Error, child: ChildProcess, command: string): void {
    const classified = classifyStartError(error, command);
    this.#rejectPending(classified);
    if (!this.#disposed && this.#turnOpen)
      this.#completeTurn("error", { type: classified.errorType, text: classified.message });
    if (this.#child === child) this.#child = undefined;
  }

  #handleProcessClose(
    code: number | null,
    signal: NodeJS.Signals | null,
    child: ChildProcess,
  ): void {
    if (this.#child !== child) return;
    this.#child = undefined;
    if (this.#disposed) return;
    const error = new AgentCliError(
      "failed",
      `O processo Codex encerrou (${code ?? signal ?? "sem código"}).`,
    );
    this.#rejectPending(error);
    if (this.#turnOpen) {
      if (this.#stopRequested)
        this.#completeTurn("interrupted", {
          type: "interrupted",
          text: "Resposta interrompida pelo usuário.",
        });
      else this.#completeTurn("error", { type: "failed", text: error.message });
    }
  }

  #rejectPending(error: Error): void {
    for (const [id, pending] of this.#rpcResults) {
      clearTimeout(pending.timer);
      pending.reject(error);
      this.#rpcResults.delete(id);
    }
  }
}

export const createCodexAdapterFactory =
  (options: CodexAdapterOptions = {}): AdapterFactory =>
  (_conversation, emit) =>
    new CodexAdapter(emit, options);

export function createCodexModelLoader(
  options: CodexAdapterOptions = {},
): (cwd: string) => Promise<AdapterModelList> {
  return async (cwd) => new CodexAdapter(() => undefined, options).loadModelCatalog(cwd);
}

function permissionSettings(mode: Conversation["mode"]): {
  sandbox: "read-only" | "workspace-write" | "danger-full-access";
  approvalPolicy: "never" | "on-request" | "untrusted";
} {
  if (mode === "read-only") return { sandbox: "read-only", approvalPolicy: "never" };
  if (mode === "full") return { sandbox: "danger-full-access", approvalPolicy: "never" };
  return { sandbox: "workspace-write", approvalPolicy: "untrusted" };
}

function parseModelList(value: unknown): AdapterModelList {
  const data = isRecord(value) && Array.isArray(value.data) ? value.data.filter(isRecord) : [];
  const visible = data.filter((model) => model.hidden !== true);
  const validEfforts = new Set<string>(EFFORTS);
  const models = visible.flatMap((model) => {
    const id = stringValue(model.model) || stringValue(model.id);
    if (!id) return [];
    const supported = Array.isArray(model.supportedReasoningEfforts)
      ? model.supportedReasoningEfforts
          .filter(isRecord)
          .map((entry) => stringValue(entry.reasoningEffort))
          .filter((effort): effort is Effort => validEfforts.has(effort))
      : [];
    const requestedDefault = stringValue(model.defaultReasoningEffort);
    const defaultEffort =
      validEfforts.has(requestedDefault) &&
      (!supported.length || supported.includes(requestedDefault as Effort))
        ? (requestedDefault as Effort)
        : (supported[0] ?? EFFORTS[0]);
    const displayName = stringValue(model.displayName);
    return [
      {
        id,
        name: displayName && !/^\[redigido\]$/i.test(displayName) ? displayName : id,
        efforts: supported.length ? supported : [...EFFORTS],
        defaultEffort,
      },
    ];
  });
  const efforts = [...new Set(models.flatMap((model) => model.efforts))];
  return { models, efforts: efforts.length ? efforts : [...EFFORTS] };
}

function selectModel(
  list: AdapterModelList,
  rawCatalog: unknown,
  requested: string | undefined,
): { id: string; effort: string } {
  const data =
    isRecord(rawCatalog) && Array.isArray(rawCatalog.data) ? rawCatalog.data.filter(isRecord) : [];
  const selectedRaw = requested
    ? data.find((model) => model.model === requested || model.id === requested)
    : data.find((model) => model.isDefault === true && model.hidden !== true);
  const selected = requested
    ? list.models.find((model) => model.id === requested)
    : (list.models.find(
        (model) => model.id === stringValue(selectedRaw?.model ?? selectedRaw?.id),
      ) ?? list.models[0]);
  const effort =
    stringValue(selectedRaw?.defaultReasoningEffort) || selected?.defaultEffort || "low";
  return { id: requested || selected?.id || "gpt-6.1-sol", effort };
}

function normalizeEffort(value: string | undefined): Effort {
  return value && EFFORTS.includes(value as Effort) ? (value as Effort) : "low";
}

function mapPermissionDecision(method: string, decision: "allow" | "always" | "deny"): string {
  if (method.includes("commandExecution"))
    return decision === "allow" ? "accept" : decision === "always" ? "acceptForSession" : "decline";
  if (method.includes("fileChange"))
    return decision === "allow" ? "accept" : decision === "always" ? "acceptForSession" : "decline";
  return decision === "allow"
    ? "approved"
    : decision === "always"
      ? "approved_for_session"
      : "abort";
}

function parseTodos(text: string): Extract<MessagePart, { type: "todos" }>["items"] {
  return text.split(/\r?\n/).flatMap((line, index) => {
    const match = line.match(/^\s*(?:[-*]|\d+[.)])\s+(.+?)\s*$/);
    if (!match?.[1]) return [];
    const content = match[1].replaceAll("**", "").replaceAll("__", "").trim();
    const statusText = content.toLowerCase();
    const state = /`(?:completed|done)`|\bconclu[ií]d[oa]s?\b|✅/.test(statusText)
      ? "done"
      : /`(?:in_progress|working)`|\bem andamento\b/.test(statusText)
        ? "working"
        : "pending";
    const title = content
      .replace(/\s*[—-]\s*`(?:completed|done|pending|in_progress|working)`\s*$/i, "")
      .trim();
    return [{ id: String(index + 1), title: title || `Tarefa ${index + 1}`, state }];
  });
}

function isActionItem(type: string): boolean {
  return [
    "commandExecution",
    "fileChange",
    "webSearch",
    "mcpToolCall",
    "collabAgentToolCall",
    "imageGeneration",
  ].includes(type);
}

function actionTypeFor(item: JsonRecord): Extract<MessagePart, { type: "action" }>["actionType"] {
  const type = stringValue(item.type);
  if (type === "fileChange") {
    const changes = isRecord(item.changes) ? Object.values(item.changes).filter(isRecord) : [];
    return changes.some((change) => change.type === "add") ? "write" : "edit";
  }
  if (type === "webSearch") return "search";
  if (type !== "commandExecution") return "other";
  const actions = Array.isArray(item.commandActions) ? item.commandActions.filter(isRecord) : [];
  if (actions.some((action) => action.type === "write")) return "write";
  if (actions.some((action) => action.type === "edit")) return "edit";
  if (
    actions.length &&
    actions.every(
      (action) => action.type === "read" || action.type === "listFiles" || action.type === "search",
    )
  ) {
    if (actions.some((action) => action.type === "search")) return "search";
    return "read";
  }
  return "command";
}

function actionTitle(
  item: JsonRecord,
  actionType: Extract<MessagePart, { type: "action" }>["actionType"],
  command: string,
): string {
  const type = stringValue(item.type);
  if (type === "commandExecution") {
    const action = Array.isArray(item.commandActions)
      ? item.commandActions.find(isRecord)
      : undefined;
    const name = stringValue(action?.name) || baseName(stringValue(action?.path));
    if (actionType === "read") return name ? `Leu ${name}` : "Leu arquivos";
    if (actionType === "search") return "Buscou arquivos";
    return command || "Executou um comando";
  }
  if (type === "fileChange") return actionType === "write" ? "Criou arquivos" : "Editou arquivos";
  if (type === "webSearch")
    return stringValue(item.query) ? `Buscou ${stringValue(item.query)}` : "Buscou na web";
  return stringValue(item.tool) || "Usou uma ferramenta";
}

function actionInput(item: JsonRecord, command: string): string {
  if (stringValue(item.type) === "commandExecution") {
    return command;
  }
  if (stringValue(item.type) === "webSearch") return stringValue(item.query);
  if (stringValue(item.type) === "fileChange") return fileChangeSummary(item.changes);
  return command || JSON.stringify(item);
}

export function unwrapCodexShellCommand(command: string): string {
  const match = command.match(
    /^\s*(?:[^\s]*\/)?(?:bash|sh|zsh)\s+-(?:lc|c)\s+(['"])([\s\S]*)\1\s*$/,
  );
  if (!match) return command;
  const quote = match[1];
  const inner = match[2] ?? "";
  if (quote === "'") return inner.replaceAll("'\\''", "'");
  return inner.replace(/\\([\\"$`])/g, "$1");
}

function actionOutput(item: JsonRecord): string {
  if (typeof item.aggregatedOutput === "string") return item.aggregatedOutput;
  if (stringValue(item.type) === "fileChange") return JSON.stringify(item.changes ?? {}, null, 2);
  const output = item.results ?? item.result ?? item.summary ?? item.content;
  return output === undefined || output === null
    ? ""
    : typeof output === "string"
      ? output
      : JSON.stringify(output, null, 2);
}

function fileChangeSummary(value: unknown): string {
  if (!isRecord(value)) return "";
  return Object.keys(value).join("\n");
}

function truncateOutput(value: string): { output: string; truncated: boolean } {
  const bytes = Buffer.from(value, "utf8");
  if (bytes.byteLength <= MAX_ACTION_OUTPUT_BYTES) return { output: value, truncated: false };
  const output = new TextDecoder("utf-8", { fatal: false }).decode(
    bytes.subarray(0, MAX_ACTION_OUTPUT_BYTES),
  );
  return { output, truncated: true };
}

function truncateCharacters(value: string, max: number): string {
  return value.length <= max ? value : value.slice(0, max);
}

function extractText(value: unknown): string {
  if (typeof value === "string") return value;
  if (!Array.isArray(value)) return "";
  return value
    .map((part) => {
      if (typeof part === "string") return part;
      if (isRecord(part)) return stringValue(part.text) || stringValue(part.summary);
      return "";
    })
    .filter(Boolean)
    .join("\n");
}

function usesPlanMode(text: string): boolean {
  return /\b(plan|planej|pergunta|quest(?:ão|ao)|taref|task)\w*/i.test(text);
}

function classifyStartError(error: unknown, command: string): AgentCliError {
  if (isRecord(error) && error.code === "ENOENT")
    return new AgentCliError("cli-not-found", `spawn ${command} ENOENT`);
  const message = error instanceof Error ? error.message : String(error);
  const errorType = classifyErrorText(message);
  return new AgentCliError(errorType, message);
}

function classifyErrorText(text: string): "not-logged-in" | "failed" {
  return describeAgentError(text, "codex").message.startsWith("Codex não está conectado.")
    ? "not-logged-in"
    : "failed";
}

function isRunning(child: ChildProcess | undefined): child is ChildProcess {
  return Boolean(child && child.exitCode === null && child.signalCode === null);
}

function isRecord(value: unknown): value is JsonRecord {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function formatTextAttachment(
  attachment: Extract<ConversationAttachment, { kind: "text" }>,
): string {
  const longestFence = Math.max(
    0,
    ...[...attachment.data.matchAll(/`+/gu)].map((match) => match[0].length),
  );
  const fence = "`".repeat(Math.max(3, longestFence + 1));
  return `Arquivo anexado: ${attachment.name}\n\n${fence}\n${attachment.data}\n${fence}`;
}

function imageExtension(mimeType: string): string {
  switch (mimeType) {
    case "image/png":
      return ".png";
    case "image/jpeg":
      return ".jpg";
    case "image/gif":
      return ".gif";
    case "image/webp":
      return ".webp";
    default:
      return ".img";
  }
}

function stringValue(value: unknown): string {
  return typeof value === "string" ? value : "";
}

function baseName(value: string): string {
  return value.split(/[\\/]/).filter(Boolean).at(-1) ?? "";
}
