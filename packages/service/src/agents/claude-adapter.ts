import { type ChildProcess, spawn as nodeSpawn, type SpawnOptions } from "node:child_process";
import { randomUUID } from "node:crypto";
import os from "node:os";
import {
  type ComposerSkill,
  type Conversation,
  type ConversationAttachment,
  describeAgentError,
  MAX_FRAME_BYTES,
  type MessagePart,
  type MessageSource,
  reasoningEffortSchema,
} from "@karont/contract";
import { validateFolder } from "../folders.ts";
import type {
  AdapterEvent,
  AdapterFactory,
  AdapterModelList,
  AdapterResponse,
  AdapterStartOptions,
  AgentAdapter,
  AgentAdapterRegistration,
} from "./adapter.ts";
import { claudeContextUsage } from "./context-usage.ts";
import { resolveAgentCommand } from "./detect.ts";
import { makeMessageSource, mergeMessageSources } from "./source-metadata.ts";
import { mapClaudeToolAction, truncateUtf8 } from "./tool-actions.ts";

const MAX_ACTION_OUTPUT_BYTES = 64 * 1024;
const MAX_STDOUT_LINE_BYTES = 32 * 1024 * 1024;
const CONTROL_REQUEST_TIMEOUT_MS = 10_000;
const READ_ONLY_ALLOWED_TOOLS = new Set([
  "Read",
  "Glob",
  "Grep",
  "WebSearch",
  "WebFetch",
  "TaskCreate",
  "TaskUpdate",
  "TodoWrite",
]);
const READ_ONLY_TOOLS =
  "Read,Glob,Grep,WebSearch,WebFetch,AskUserQuestion,ExitPlanMode,TaskCreate,TaskUpdate,TodoWrite";
type SpawnFunction = (command: string, args: string[], options: SpawnOptions) => ChildProcess;
type ControlRequest = {
  resolve(): void;
  reject(error: Error): void;
  timer: ReturnType<typeof setTimeout>;
};

export class AgentCliError extends Error {
  readonly errorType: "cli-not-found" | "not-logged-in" | "failed";

  constructor(errorType: AgentCliError["errorType"], message: string) {
    super(message);
    this.name = "AgentCliError";
    this.errorType = errorType;
  }
}

export type ClaudeAdapterOptions = {
  env?: NodeJS.ProcessEnv;
  spawn?: SpawnFunction;
  homeDir?: string;
  platform?: NodeJS.Platform;
};

export class ClaudeAdapter implements AgentAdapter {
  readonly #emit: (event: AdapterEvent) => void;
  readonly #env: NodeJS.ProcessEnv;
  readonly #spawn: SpawnFunction;
  readonly #homeDir: string;
  readonly #platform: NodeJS.Platform;
  readonly #actions = new Map<
    string,
    { partId: string; startedAt: number; toolName: string; input: Record<string, unknown> }
  >();
  // Mantém todas as partes de ações: filhos de subagentes chegam depois do resultado do Agent.
  readonly #partIdByToolUse = new Map<string, string>();
  readonly #pending = new Map<
    string,
    {
      requestId: string;
      tool: string;
      input: Record<string, unknown>;
      suggestions: unknown[];
      actionId?: string;
    }
  >();
  readonly #taskIds = new Map<string, string>();
  readonly #parts = new Map<string, MessagePart>();
  #models: AdapterModelList = { models: [], efforts: [] };
  #skills: ComposerSkill[] = [];
  readonly #controlRequests = new Map<string, ControlRequest>();
  #child: ChildProcess | undefined;
  #conversation: Conversation | undefined;
  #sessionId = "";
  #resumeSession = false;
  #forkSessionPending = false;
  #forkSessionSourceId: string | undefined;
  #permissionMode = "";
  #nextControlRequestId = 0;
  #initResolve: (() => void) | undefined;
  #initReject: ((error: Error) => void) | undefined;
  #initPromise: Promise<void> | undefined;
  #stderrErrorType: "cli-not-found" | "not-logged-in" | undefined;
  #activeTextPartId: string | undefined;
  #sources: MessageSource[] = [];
  #activeThinkingPartId: string | undefined;
  #todosPartId: string | undefined;
  #todos: Array<{
    id: string;
    title: string;
    description?: string;
    state: "pending" | "working" | "done";
    note?: string;
  }> = [];
  #lastPlan = "";
  #lastAssistantUsage: unknown;
  #lastAssistantModel: string | undefined;
  #turnOpen = false;
  #stopRequested = false;
  #disposed = false;
  #interruptTimer: ReturnType<typeof setTimeout> | undefined;
  #interruptResolve: (() => void) | undefined;
  #stderrErrorText = "";
  #lineQueue: Promise<void> = Promise.resolve();
  #stdoutLineChunks: Buffer[] = [];
  #stdoutLineBytes = 0;
  #stdoutLineOverflow = false;
  #stdoutEnd: Promise<void> = Promise.resolve();

  constructor(emit: (event: AdapterEvent) => void, options: ClaudeAdapterOptions = {}) {
    this.#emit = (event) => {
      if (!this.#disposed) emit(event);
    };
    this.#env = options.env ?? process.env;
    this.#spawn = options.spawn ?? nodeSpawn;
    this.#homeDir = options.homeDir ?? os.homedir();
    this.#platform = options.platform ?? process.platform;
  }

  async start(
    conversation: Conversation,
    sessionId: string,
    resume: boolean,
    plan = false,
    options: AdapterStartOptions = {},
  ): Promise<void> {
    if (this.#child && this.#child.exitCode === null && this.#child.signalCode === null) return;
    this.#child = undefined;
    this.#disposed = false;
    this.#conversation = conversation;
    this.#skills = [];
    this.#sessionId = sessionId;
    this.#resumeSession = resume;
    this.#forkSessionPending = resume && options.forkSession === true;
    this.#forkSessionSourceId = this.#forkSessionPending ? sessionId : undefined;
    this.#stderrErrorType = undefined;
    this.#stderrErrorText = "";
    this.#stdoutLineChunks = [];
    this.#stdoutLineBytes = 0;
    this.#stdoutLineOverflow = false;
    const folder = await validateFolder(conversation.cwd);
    this.#throwIfDisposed();
    if (!folder.exists || !folder.isDirectory) {
      throw new AgentCliError("failed", `A pasta do projeto não existe mais: ${conversation.cwd}`);
    }
    const command =
      this.#env.KARONT_CLAUDE_CLI ||
      (await resolveAgentCommand("claude", {
        env: this.#env,
        homeDir: this.#homeDir,
        platform: this.#platform,
      })) ||
      "claude";
    this.#throwIfDisposed();
    const args = [
      "-p",
      "--input-format",
      "stream-json",
      "--output-format",
      "stream-json",
      "--verbose",
      "--include-partial-messages",
      "--permission-prompts",
      "host",
      "--permission-prompt-tool",
      "stdio",
    ];
    const permissionMode = plan ? "plan" : permissionModeFor(conversation);
    this.#permissionMode = permissionMode;
    args.push("--permission-mode", permissionMode);
    if (conversation.mode === "read-only") args.push("--tools", READ_ONLY_TOOLS);
    if (conversation.mode === "full")
      args.push(plan ? "--allow-dangerously-skip-permissions" : "--dangerously-skip-permissions");
    if (conversation.model && conversation.model !== "default")
      args.push("--model", conversation.model);
    if (conversation.effort) args.push("--effort", conversation.effort);
    args.push(resume ? "--resume" : "--session-id", sessionId);
    if (this.#forkSessionPending) args.push("--fork-session");
    let child: ChildProcess;
    try {
      child = this.#spawn(command, args, {
        cwd: conversation.cwd,
        env: this.#env,
        stdio: ["pipe", "pipe", "pipe"],
      });
      this.#child = child;
      if (this.#disposed) {
        terminateSpawnedChild(child);
        this.#child = undefined;
        this.#throwIfDisposed();
      }
    } catch (error) {
      throw classifyStartError(error, command);
    }
    const stdout = child.stdout;
    const stderr = child.stderr;
    const stdin = child.stdin;
    if (!stdout || !stderr || !stdin)
      throw new AgentCliError("failed", "A CLI não abriu os canais de comunicação esperados.");
    let resolveStdoutEnd!: () => void;
    this.#stdoutEnd = new Promise<void>((resolve) => {
      resolveStdoutEnd = resolve;
    });
    let stdoutEnded = false;
    const finishStdout = () => {
      if (stdoutEnded) return;
      stdoutEnded = true;
      this.#flushStdoutLine();
      resolveStdoutEnd();
    };
    stdout.on("data", (chunk: Buffer | string) => {
      const previousQueue = this.#lineQueue;
      this.#readStdout(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk, "utf8"));
      if (this.#lineQueue !== previousQueue) {
        stdout.pause();
        const queuedLines = this.#lineQueue;
        void queuedLines.then(() => stdout.resume());
      }
    });
    stdout.once("end", finishStdout);
    stdout.once("close", () => {
      if (stdout.readableLength === 0) finishStdout();
      else stdout.resume();
    });
    stderr.setEncoding("utf8");
    stderr.on("data", (chunk: string) => {
      this.#stderrErrorText = `${this.#stderrErrorText}${chunk}`.slice(-8_192);
      const errorType = classifyErrorText(this.#stderrErrorText);
      if (errorType !== "failed") this.#stderrErrorType = errorType;
    });
    this.#initPromise = new Promise<void>((resolve, reject) => {
      this.#initResolve = resolve;
      this.#initReject = reject;
    });
    child.once("error", (error) => {
      if (this.#initReject) this.#initReject(classifyStartError(error, command));
      this.#finishOnExit(error, child);
    });
    child.once("close", (code, signal) =>
      this.#finishOnExit(
        new Error(`CLI encerrou (código ${code ?? signal ?? "desconhecido"}).`),
        child,
      ),
    );
    await this.#write({
      type: "control_request",
      request_id: "karont-initialize",
      request: { subtype: "initialize" },
    });
    this.#throwIfDisposed();
    const timer = setTimeout(() => {
      const errorType = this.#stderrErrorType ?? "failed";
      const text =
        this.#stderrErrorText.trim() ||
        "Claude Code encerrou antes de concluir a resposta. Tente de novo.";
      this.#initReject?.(new AgentCliError(errorType, text));
    }, 15_000);
    try {
      await this.#initPromise;
      this.#throwIfDisposed();
    } finally {
      clearTimeout(timer);
      this.#initResolve = undefined;
      this.#initReject = undefined;
    }
    this.#resumeSession = true;
    if (!this.#forkSessionPending) this.#emit({ kind: "session", sessionId: this.#sessionId });
  }

  #throwIfDisposed(): void {
    if (this.#disposed) throw new AgentCliError("failed", "A CLI Claude foi encerrada.");
  }

  async send(
    text: string,
    plan = false,
    attachments: ConversationAttachment[] = [],
    skills: Array<Pick<ComposerSkill, "name" | "path">> = [],
  ): Promise<void> {
    if (!this.#child || this.#child.exitCode !== null || this.#child.signalCode !== null) {
      if (!this.#conversation || !this.#sessionId)
        throw new AgentCliError("failed", "A CLI não está ativa.");
      await this.start(this.#conversation, this.#sessionId, this.#resumeSession, plan, {
        forkSession: this.#forkSessionPending,
      });
    }
    const conversation = this.#conversation;
    if (!conversation) throw new AgentCliError("failed", "A conversa Claude não foi iniciada.");
    if (skills.length > 1)
      throw new AgentCliError("failed", "O Claude Code aceita uma skill por mensagem.");
    await this.#ensurePermissionMode(plan ? "plan" : permissionModeFor(conversation));
    this.#turnOpen = true;
    this.#stopRequested = false;
    this.#lastAssistantUsage = undefined;
    this.#lastAssistantModel = undefined;
    this.#sources = [];
    this.#activeTextPartId = undefined;
    this.#activeThinkingPartId = undefined;
    this.#todosPartId = undefined;
    this.#todos = [];
    const prompt = skills[0] ? `/${skills[0].name}${text ? ` ${text}` : ""}` : text;
    const content = attachments.length
      ? [
          { type: "text", text: prompt },
          ...attachments.map((attachment) =>
            attachment.kind === "image"
              ? {
                  type: "image",
                  source: {
                    type: "base64",
                    media_type: attachment.mimeType,
                    data: attachment.data,
                  },
                }
              : { type: "text", text: formatTextAttachment(attachment) },
          ),
        ]
      : prompt;
    await this.#write({ type: "user", message: { role: "user", content } });
  }

  async compact(): Promise<void> {
    await this.send("/compact");
  }

  async getModels(): Promise<AdapterModelList> {
    if (this.#conversation?.agent !== "claude") return { models: [], efforts: [] };
    return {
      models: this.#models.models.map((model) => ({
        ...model,
        ...(model.aliases ? { aliases: [...model.aliases] } : {}),
        efforts: [...model.efforts],
      })),
      efforts: [...this.#models.efforts],
    };
  }

  async getSkills(): Promise<ComposerSkill[]> {
    return this.#skills.map((skill) => ({ ...skill }));
  }

  async respond(partId: string, response: AdapterResponse): Promise<void> {
    const pending = this.#pending.get(partId);
    if (!pending) throw new Error("A resposta solicitada não está mais pendente.");
    let toolResponse: Record<string, unknown>;
    let state: "allowed" | "denied" | "answered" | "approved" | "rejected";
    if (response.responseType === "permission") {
      if (response.decision === "always" && !pending.suggestions.some(isAllowSuggestion))
        throw new Error("A CLI não sugeriu uma permissão persistente para esta ação.");
      const allow = response.decision !== "deny";
      const suggestion =
        response.decision === "always"
          ? pending.suggestions.find((item) => isAllowSuggestion(item))
          : undefined;
      toolResponse = allow
        ? {
            behavior: "allow",
            updatedInput: pending.input,
            ...(suggestion ? { updatedPermissions: [suggestion] } : {}),
          }
        : { behavior: "deny", message: "Ação negada pelo usuário." };
      state = allow ? "allowed" : "denied";
    } else if (response.responseType === "question") {
      const sourceQuestions = Array.isArray(pending.input.questions)
        ? pending.input.questions.filter(isRecord)
        : [];
      const answers = Object.fromEntries(
        Object.entries(response.answers).map(([key, values]) => {
          const index = Number(key);
          const indexedQuestion =
            Number.isInteger(index) && String(index) === key ? sourceQuestions[index] : undefined;
          const answerKey =
            indexedQuestion && typeof indexedQuestion.question === "string"
              ? indexedQuestion.question
              : key;
          return [answerKey, values.length === 1 ? values[0] : values];
        }),
      );
      toolResponse = { behavior: "allow", updatedInput: { ...pending.input, answers } };
      state = "answered";
    } else {
      const allow = response.decision === "approve";
      if (allow) {
        if (!this.#conversation)
          throw new AgentCliError("failed", "A conversa Claude não foi iniciada.");
        await this.#setPermissionMode(permissionModeFor(this.#conversation));
      }
      toolResponse = allow
        ? { behavior: "allow", updatedInput: pending.input }
        : {
            behavior: "deny",
            message: response.comment?.trim() || "Plano rejeitado pelo usuário.",
          };
      state = allow ? "approved" : "rejected";
    }
    this.#pending.delete(partId);
    const current = this.#pendingPart(partId);
    if (current?.type === "permission")
      this.#part({ ...current, state: state === "allowed" ? "allowed" : "denied" });
    if (pending.actionId) {
      const actionInfo = this.#actions.get(pending.actionId);
      const action = actionInfo ? this.#pendingPart(actionInfo.partId) : undefined;
      if (action?.type === "action" && action.state === "waiting")
        this.#part({
          ...action,
          state: state === "allowed" ? "running" : "error",
          ...(state === "denied"
            ? { durationMs: Math.max(0, Date.now() - (actionInfo?.startedAt ?? Date.now())) }
            : {}),
        });
    }
    if (current?.type === "question") this.#part({ ...current, state: "answered" });
    if (current?.type === "plan")
      this.#part({
        ...current,
        state: state === "approved" ? "approved" : "rejected",
        ...(response.responseType === "plan" && response.comment
          ? { comment: response.comment }
          : {}),
      });
    this.#emit({ kind: "state", state: "working" });
    await this.#write({
      type: "control_response",
      response: { subtype: "success", request_id: pending.requestId, response: toolResponse },
    });
  }

  async interrupt(): Promise<void> {
    if (!this.#child || !this.#turnOpen) return;
    this.#stopRequested = true;
    const requestId = randomUUID();
    let resolve!: () => void;
    const response = new Promise<void>((done) => {
      resolve = done;
    });
    this.#interruptResolve = resolve;
    await this.#write({
      type: "control_request",
      request_id: requestId,
      request: { subtype: "interrupt" },
    });
    this.#interruptTimer = setTimeout(() => {
      if (!this.#turnOpen) return;
      this.#child?.kill("SIGTERM");
      const force = setTimeout(() => this.#child?.kill("SIGKILL"), 500);
      force.unref?.();
      this.#completeTurn("interrupted", {
        type: "interrupted",
        text: "Resposta interrompida pelo usuário.",
      });
    }, 3_000);
    await response;
  }

  async dispose(): Promise<void> {
    this.#disposed = true;
    this.#initReject?.(new AgentCliError("failed", "A CLI Claude foi encerrada."));
    this.#rejectControlRequests(new AgentCliError("failed", "A CLI Claude foi encerrada."));
    if (this.#interruptTimer) clearTimeout(this.#interruptTimer);
    this.#interruptTimer = undefined;
    if (this.#child && this.#child.exitCode === null) {
      this.#child.kill("SIGTERM");
      const child = this.#child;
      await new Promise<void>((resolve) => {
        const timer = setTimeout(() => {
          child.kill("SIGKILL");
          resolve();
        }, 1_000);
        child.once("exit", () => {
          clearTimeout(timer);
          resolve();
        });
      });
    }
    this.#child = undefined;
  }

  #readStdout(chunk: Buffer): void {
    if (this.#stdoutLineOverflow) return;
    let offset = 0;
    while (offset < chunk.length) {
      const newline = chunk.indexOf(0x0a, offset);
      const end = newline < 0 ? chunk.length : newline;
      if (!this.#appendStdoutLineChunk(chunk.subarray(offset, end))) return;
      if (newline < 0) return;
      this.#queueLine(this.#takeStdoutLine());
      offset = newline + 1;
    }
  }

  #appendStdoutLineChunk(chunk: Buffer): boolean {
    if (this.#stdoutLineBytes + chunk.byteLength > MAX_STDOUT_LINE_BYTES) {
      this.#stdoutLineChunks = [];
      this.#stdoutLineBytes = 0;
      this.#stdoutLineOverflow = true;
      this.#completeTurn("error", {
        type: "failed",
        text: "A CLI enviou um evento acima do limite de 32 MiB.",
      });
      this.#child?.kill("SIGTERM");
      return false;
    }
    if (chunk.length > 0) {
      this.#stdoutLineChunks.push(chunk);
      this.#stdoutLineBytes += chunk.byteLength;
    }
    return true;
  }

  #takeStdoutLine(): string {
    const line = Buffer.concat(this.#stdoutLineChunks, this.#stdoutLineBytes).toString("utf8");
    this.#stdoutLineChunks = [];
    this.#stdoutLineBytes = 0;
    return line.endsWith("\r") ? line.slice(0, -1) : line;
  }

  #flushStdoutLine(): void {
    if (this.#stdoutLineOverflow || this.#stdoutLineBytes === 0) return;
    this.#queueLine(this.#takeStdoutLine());
  }

  #queueLine(line: string): void {
    this.#lineQueue = this.#lineQueue
      .then(() => this.#handleLine(line))
      .catch(() =>
        this.#completeTurn("error", {
          type: "failed",
          text: "Não foi possível processar uma ação da CLI Claude.",
        }),
      );
  }

  async #handleLine(line: string): Promise<void> {
    let value: Record<string, unknown>;
    try {
      value = JSON.parse(line) as Record<string, unknown>;
    } catch {
      return;
    }
    const type = value.type;
    if (type === "control_response") {
      const control = value.response as Record<string, unknown> | undefined;
      if (control?.request_id === "karont-initialize" && control.subtype === "success") {
        const response = control.response as Record<string, unknown> | undefined;
        if (Array.isArray(response?.models)) this.#models = mapClaudeModels(response.models);
        if (Array.isArray(response?.commands)) this.#skills = mapClaudeSkills(response.commands);
        this.#initResolve?.();
      } else if (typeof control?.request_id === "string") {
        const pending = this.#controlRequests.get(control.request_id);
        if (!pending) return;
        this.#controlRequests.delete(control.request_id);
        clearTimeout(pending.timer);
        if (control.subtype === "success") pending.resolve();
        else {
          const detail =
            typeof control.error === "string"
              ? control.error
              : "Claude Code recusou a troca de modo de permissão.";
          pending.reject(new AgentCliError("failed", detail));
        }
      }
      return;
    }
    if (type === "system") {
      if (value.subtype === "init" && typeof value.session_id === "string") {
        if (!this.#forkSessionSourceId || value.session_id !== this.#forkSessionSourceId) {
          this.#sessionId = value.session_id;
          this.#resumeSession = true;
          this.#forkSessionPending = false;
          this.#forkSessionSourceId = undefined;
          this.#emit({ kind: "session", sessionId: value.session_id });
        }
      }
      if (value.subtype === "api_error" || value.subtype === "error") {
        const detail =
          typeof value.error === "string"
            ? value.error
            : typeof value.message === "string"
              ? value.message
              : "Claude Code reportou um erro de execução.";
        const errorType = classifyErrorText(detail);
        this.#completeTurn("error", { type: errorType, text: detail });
      }
      if (value.subtype === "permission_denied") this.#emit({ kind: "state", state: "working" });
      return;
    }
    if (type === "stream_event") {
      const event = value.event as Record<string, unknown> | undefined;
      if (event?.type === "content_block_start" && isRecord(event.content_block)) {
        if (event.content_block.type === "text") this.#activeTextPartId = randomUUID();
        if (event.content_block.type === "thinking") this.#activeThinkingPartId = randomUUID();
      }
      if (event?.type === "content_block_delta") {
        const delta = event.delta as Record<string, unknown> | undefined;
        if (delta?.type === "text_delta" && typeof delta.text === "string")
          this.#textDelta("text", delta.text);
        if (delta?.type === "thinking_delta" && typeof delta.thinking === "string")
          this.#textDelta("thinking", delta.thinking);
      }
      if (event?.type === "content_block_stop") {
        this.#activeTextPartId = undefined;
        this.#activeThinkingPartId = undefined;
      }
      return;
    }
    if (type === "assistant") {
      const message = value.message as Record<string, unknown> | undefined;
      if (value.parent_tool_use_id == null) {
        this.#lastAssistantUsage = isRecord(message?.usage) ? message.usage : undefined;
        this.#lastAssistantModel = typeof message?.model === "string" ? message.model : undefined;
      }
      const content = Array.isArray(message?.content) ? message.content : [];
      this.#addSources(extractClaudeAssistantSources(content));
      for (const item of content) {
        if (!isRecord(item) || item.type !== "tool_use" || typeof item.name !== "string") continue;
        await this.#handleToolUse(
          item,
          typeof value.parent_tool_use_id === "string" ? value.parent_tool_use_id : undefined,
        );
      }
      return;
    }
    if (type === "user") {
      const message = value.message as Record<string, unknown> | undefined;
      const content = Array.isArray(message?.content) ? message.content : [];
      for (const item of content)
        if (isRecord(item) && item.type === "tool_result") this.#handleToolResult(item);
      return;
    }
    if (type === "control_request") {
      if (isRecord(value.request) && value.request.subtype === "can_use_tool")
        this.#handleCanUseTool(value);
      return;
    }
    if (type === "result") {
      const usage = claudeContextUsage(
        this.#lastAssistantUsage,
        value.modelUsage,
        this.#lastAssistantModel,
      );
      if (usage) this.#emit({ kind: "context-usage", ...usage });
      if (typeof value.session_id === "string" && value.session_id !== this.#forkSessionSourceId) {
        this.#sessionId = value.session_id;
        this.#resumeSession = true;
        this.#forkSessionPending = false;
        this.#forkSessionSourceId = undefined;
        this.#emit({ kind: "session", sessionId: value.session_id });
      }
      const errors = Array.isArray(value.errors)
        ? value.errors.filter((item): item is string => typeof item === "string")
        : [];
      if (value.is_error === true || value.subtype === "error_during_execution") {
        if (this.#stopRequested)
          this.#completeTurn("interrupted", {
            type: "interrupted",
            text: "Resposta interrompida pelo usuário.",
          });
        else {
          const text =
            errors.join(" ") || "Claude Code encerrou antes de concluir a resposta. Tente de novo.";
          const errorType = classifyErrorText(text);
          this.#completeTurn("error", { type: errorType, text });
        }
      } else this.#completeTurn("done");
    }
  }

  async #handleToolUse(item: Record<string, unknown>, parentToolUseId?: string): Promise<void> {
    const name = item.name as string;
    const input = isRecord(item.input) ? item.input : {};
    const id = typeof item.id === "string" ? item.id : randomUUID();
    if (name === "TaskCreate") {
      const taskId = String(this.#todos.length + 1);
      this.#taskIds.set(String(input.taskId ?? taskId), taskId);
      this.#todos.push({
        id: taskId,
        title: String(input.subject ?? "Tarefa"),
        ...(typeof input.description === "string" ? { description: input.description } : {}),
        state: "pending",
      });
      this.#emitTodos();
      return;
    }
    if (name === "TaskUpdate") {
      const taskId = this.#taskIds.get(String(input.taskId)) ?? String(input.taskId);
      const task = this.#todos.find((entry) => entry.id === taskId);
      if (task) {
        task.state =
          input.status === "completed"
            ? "done"
            : input.status === "in_progress"
              ? "working"
              : "pending";
        if (typeof input.description === "string") task.note = input.description;
        this.#emitTodos();
      }
      return;
    }
    if (name === "TodoWrite" && Array.isArray(input.todos)) {
      this.#todos = input.todos.filter(isRecord).map((todo, index) => ({
        id: String(todo.id ?? index + 1),
        title: String(todo.content ?? todo.subject ?? "Tarefa"),
        state:
          todo.status === "completed"
            ? "done"
            : todo.status === "in_progress"
              ? "working"
              : "pending",
      }));
      this.#emitTodos();
      return;
    }
    const partId = randomUUID();
    const parentId = parentToolUseId ? this.#partIdByToolUse.get(parentToolUseId) : undefined;
    const mapped = await mapClaudeToolAction(name, input, parentId, this.#conversation?.cwd);
    const action: MessagePart = {
      id: partId,
      type: "action",
      actionType: mapped.actionType,
      title: mapped.title.slice(0, 240),
      input: mapped.input,
      output: mapped.output,
      ...(mapped.parentId ? { parentId: mapped.parentId } : {}),
      ...(mapped?.server ? { server: mapped.server } : {}),
      ...(mapped?.tool ? { tool: mapped.tool } : {}),
      truncated: mapped.truncated,
      state: "running",
      durationMs: null,
    };
    this.#actions.set(id, { partId, startedAt: Date.now(), toolName: name, input });
    this.#partIdByToolUse.set(id, partId);
    this.#part(action);
    if (name === "Write" && typeof input.content === "string") this.#lastPlan = input.content;
  }

  #handleToolResult(item: Record<string, unknown>): void {
    const toolId = String(item.tool_use_id ?? "");
    const actionInfo = this.#actions.get(toolId);
    if (!actionInfo) return;
    this.#addSources(extractClaudeToolSources(actionInfo.toolName, actionInfo.input, item.content));
    const output = contentToText(item.content);
    const existing = this.#pendingPart(actionInfo.partId);
    const text =
      existing?.type === "action" && existing.actionType === "subagent"
        ? subagentReport(output)
        : output;
    const bounded = truncateUtf8(text, MAX_ACTION_OUTPUT_BYTES);
    if (existing?.type === "action") {
      const keepStructuredDiff =
        (existing.actionType === "edit" || existing.actionType === "write") && existing.output;
      this.#part({
        ...existing,
        output: keepStructuredDiff ? existing.output : bounded.text,
        truncated: existing.truncated || (!keepStructuredDiff && bounded.truncated),
        state: item.is_error === true ? "error" : "ok",
        durationMs: Math.max(0, Date.now() - actionInfo.startedAt),
      });
    }
    this.#actions.delete(toolId);
  }

  #handleCanUseTool(value: Record<string, unknown>): void {
    const requestId = typeof value.request_id === "string" ? value.request_id : randomUUID();
    const request = value.request as Record<string, unknown>;
    const tool = typeof request.tool_name === "string" ? request.tool_name : "Ferramenta";
    const input = isRecord(request.input) ? request.input : {};
    const suggestions = Array.isArray(request.permission_suggestions)
      ? request.permission_suggestions
      : [];
    const conversation = this.#conversation;
    const interactiveTool = tool === "AskUserQuestion" || tool === "ExitPlanMode";
    if (!interactiveTool) {
      if (conversation?.mode === "read-only" && !READ_ONLY_ALLOWED_TOOLS.has(tool)) {
        this.#respondAutomatically(requestId, {
          behavior: "deny",
          message: "O modo Só ler bloqueia esta ferramenta.",
        });
        return;
      }
      if (conversation?.mode === "read-only" && READ_ONLY_ALLOWED_TOOLS.has(tool)) {
        this.#respondAutomatically(requestId, { behavior: "allow", updatedInput: input });
        return;
      }
      if (conversation?.mode === "full") {
        this.#respondAutomatically(requestId, { behavior: "allow", updatedInput: input });
        return;
      }
    }
    const partId = randomUUID();
    const actionId =
      typeof input.command === "string" ? this.#markCommandWaiting(input.command) : undefined;
    this.#pending.set(partId, {
      requestId,
      tool,
      input,
      suggestions,
      ...(actionId ? { actionId } : {}),
    });
    if (tool === "AskUserQuestion") {
      const questions = Array.isArray(input.questions)
        ? input.questions.filter(isRecord).map((question) => ({
            question: String(question.question ?? ""),
            ...(typeof question.header === "string" ? { header: question.header } : {}),
            options: Array.isArray(question.options)
              ? question.options.filter(isRecord).map((option) => ({
                  label: String(option.label ?? ""),
                  ...(typeof option.description === "string"
                    ? { description: option.description }
                    : {}),
                }))
              : [],
            multiSelect: question.multiSelect === true,
            freeText: question.allowFreeResponse !== false,
          }))
        : [];
      this.#part({
        id: partId,
        type: "question",
        questions: questions.length
          ? questions
          : [
              {
                question: "O agente fez uma pergunta.",
                options: [],
                multiSelect: false,
                freeText: true,
              },
            ],
        state: "pending",
      });
    } else if (tool === "ExitPlanMode") {
      this.#part({
        id: partId,
        type: "plan",
        markdown: this.#lastPlan || "Plano enviado pelo Claude Code.",
        state: "pending",
      });
    } else {
      this.#part({
        id: partId,
        type: "permission",
        tool,
        summary:
          typeof input.command === "string" && input.command.length > 0
            ? truncateUtf8(input.command, 8 * 1024).text
            : summarizeInput(input),
        ...(typeof input.description === "string" && input.description.length > 0
          ? { description: truncateUtf8(input.description, 8 * 1024).text }
          : {}),
        options: [
          "allow",
          ...(suggestions.some(isAllowSuggestion) ? ["always" as const] : []),
          "deny",
        ],
        state: "pending",
      });
    }
    this.#emit({ kind: "state", state: "waiting" });
  }

  #emitTodos(): void {
    let partId = this.#todosPartId;
    if (!partId) {
      partId = randomUUID();
      this.#todosPartId = partId;
    }
    this.#part({ id: partId, type: "todos", items: this.#todos.map((item) => ({ ...item })) });
  }

  #respondAutomatically(requestId: string, response: Record<string, unknown>): void {
    void this.#write({
      type: "control_response",
      response: { subtype: "success", request_id: requestId, response },
    }).catch((error: unknown) => {
      const message = error instanceof Error ? error.message : String(error);
      this.#completeTurn("error", { type: "failed", text: message });
    });
  }

  #textDelta(partType: "text" | "thinking", delta: string): void {
    if (!delta) return;
    let id: string | undefined;
    if (partType === "text") {
      id = this.#activeTextPartId;
      if (!id) this.#activeTextPartId = id = randomUUID();
    } else {
      id = this.#activeThinkingPartId;
      if (!id) this.#activeThinkingPartId = id = randomUUID();
    }
    this.#emit({ kind: "text-delta", partType, partId: id, delta });
    // The manager creates a text part when it sees the first delta; IDs are allocated here for stable updates.
    if (partType === "text") this.#activeTextPartId = id;
    else this.#activeThinkingPartId = id;
  }

  #pendingPart(partId: string): MessagePart | undefined {
    return this.#parts.get(partId);
  }

  #markCommandWaiting(command: string): string | undefined {
    for (const [actionId, actionInfo] of this.#actions) {
      const action = this.#pendingPart(actionInfo.partId);
      if (action?.type !== "action" || action.actionType !== "command" || action.input !== command)
        continue;
      this.#part({ ...action, state: "waiting" });
      return actionId;
    }
    return undefined;
  }

  #part(part: MessagePart): void {
    this.#parts.set(part.id, part);
    this.#emit({ kind: "part", part });
  }

  #addSources(additions: MessageSource[]): void {
    if (!additions.length) return;
    const next = mergeMessageSources(this.#sources, additions);
    if (JSON.stringify(next) === JSON.stringify(this.#sources)) return;
    this.#sources = next;
    this.#emit({ kind: "sources", sources: next });
  }

  async #write(value: unknown): Promise<void> {
    const stdin = this.#child?.stdin;
    if (!stdin || stdin.destroyed)
      throw new AgentCliError("failed", "O canal de entrada da CLI foi encerrado.");
    const line = `${JSON.stringify(value)}\n`;
    if (Buffer.byteLength(line, "utf8") > MAX_FRAME_BYTES)
      throw new Error("A mensagem para a CLI excede o limite de 64 MiB.");
    if (!stdin.write(line))
      await new Promise<void>((resolve, reject) => {
        stdin.once("drain", resolve);
        stdin.once("error", reject);
      });
  }

  #finishOnExit(error: Error, child: ChildProcess): void {
    if (this.#child !== child) return;
    this.#child = undefined;
    if (this.#disposed) return;
    const stdoutEnd = this.#stdoutEnd;
    void stdoutEnd.then(() => this.#lineQueue).then(() => this.#completeAfterExit(error));
  }

  #completeAfterExit(error: Error): void {
    if (this.#disposed) return;
    this.#rejectControlRequests(
      new AgentCliError("failed", "Claude Code encerrou antes de responder ao controle."),
    );
    const text = this.#stderrErrorText.trim() || error.message;
    const type = this.#stderrErrorType ?? classifyErrorText(text);
    if (this.#initReject) this.#initReject(new AgentCliError(type, text));
    if (this.#turnOpen) {
      if (this.#stopRequested)
        this.#completeTurn("interrupted", {
          type: "interrupted",
          text: "Resposta interrompida pelo usuário.",
        });
      else this.#completeTurn("error", { type, text });
    }
  }

  #completeTurn(
    status: "done" | "interrupted" | "error",
    error?: { type: "cli-not-found" | "not-logged-in" | "failed" | "interrupted"; text: string },
  ): void {
    if (!this.#turnOpen) return;
    this.#turnOpen = false;
    if (status !== "done") {
      for (const action of this.#actions.values()) {
        const part = this.#parts.get(action.partId);
        if (part?.type === "action" && part.state === "running")
          this.#part({
            ...part,
            state: "error",
            durationMs: Math.max(0, Date.now() - action.startedAt),
          });
      }
    }
    this.#actions.clear();
    if (this.#interruptTimer) clearTimeout(this.#interruptTimer);
    this.#interruptTimer = undefined;
    this.#emit({ kind: "turn-end", status, ...(error ? { error } : {}) });
    this.#interruptResolve?.();
    this.#interruptResolve = undefined;
    this.#parts.clear();
    this.#pending.clear();
    this.#taskIds.clear();
    this.#lastPlan = "";
    this.#sources = [];
  }

  async #setPermissionMode(mode: string): Promise<void> {
    if (this.#permissionMode === mode) return;
    const requestId = `karont-mode-${++this.#nextControlRequestId}`;
    const response = new Promise<void>((resolve, reject) => {
      const timer = setTimeout(() => {
        this.#controlRequests.delete(requestId);
        reject(new AgentCliError("failed", "Claude Code não confirmou a troca do modo de acesso."));
      }, CONTROL_REQUEST_TIMEOUT_MS);
      timer.unref?.();
      this.#controlRequests.set(requestId, { resolve, reject, timer });
    });
    void response.catch(() => undefined);
    try {
      await this.#write({
        type: "control_request",
        request_id: requestId,
        request: { subtype: "set_permission_mode", mode },
      });
      await response;
      this.#permissionMode = mode;
    } catch (error) {
      const pending = this.#controlRequests.get(requestId);
      if (pending) {
        clearTimeout(pending.timer);
        this.#controlRequests.delete(requestId);
      }
      throw error;
    }
  }

  async #ensurePermissionMode(mode: string): Promise<void> {
    try {
      await this.#setPermissionMode(mode);
    } catch (error) {
      if (this.#turnOpen) throw error;
      const conversation = this.#conversation;
      if (!conversation || !this.#sessionId) throw error;
      const sessionId = this.#sessionId;
      await this.dispose();
      await this.start(conversation, sessionId, true, mode === "plan");
      if (this.#permissionMode !== mode) throw error;
    }
  }

  #rejectControlRequests(error: Error): void {
    for (const [requestId, pending] of this.#controlRequests) {
      clearTimeout(pending.timer);
      pending.reject(error);
      this.#controlRequests.delete(requestId);
    }
  }
}

export const createClaudeAdapterFactory =
  (options: ClaudeAdapterOptions = {}): AdapterFactory =>
  (_conversation, emit) =>
    new ClaudeAdapter(emit, options);

export function createClaudeAdapterRegistration(
  options: ClaudeAdapterOptions = {},
): AgentAdapterRegistration {
  return {
    factory: createClaudeAdapterFactory(options),
    capabilities: {
      skills: true,
      compact: true,
      contextUsage: true,
      fileMentions: true,
      fastMode: false,
      plan: true,
      fork: true,
      maxSkillsPerMessage: 1,
    },
    loadSkills: createClaudeSkillLoader(options),
    loadModels: createClaudeModelLoader(options),
  };
}

export function createClaudeModelLoader(
  options: ClaudeAdapterOptions = {},
): (cwd: string) => Promise<AdapterModelList> {
  return async (cwd) => {
    const now = new Date().toISOString();
    const conversation: Conversation = {
      id: randomUUID(),
      agent: "claude",
      title: "Lista de modelos",
      cwd,
      mode: "edit",
      fast: false,
      pinnedAt: null,
      archivedAt: null,
      unreadAt: null,
      state: "idle",
      createdAt: now,
      updatedAt: now,
    };
    const adapter = new ClaudeAdapter(() => undefined, options);
    try {
      await adapter.start(conversation, randomUUID(), false);
      const modelList = await adapter.getModels();
      if (modelList.models.length === 0)
        throw new Error("Claude Code não devolveu a lista de modelos.");
      return modelList;
    } finally {
      await adapter.dispose();
    }
  };
}

export function createClaudeSkillLoader(
  options: ClaudeAdapterOptions = {},
): (cwd: string) => Promise<ComposerSkill[]> {
  return async (cwd) => {
    const now = new Date().toISOString();
    const conversation: Conversation = {
      id: randomUUID(),
      agent: "claude",
      title: "Lista de skills",
      cwd,
      mode: "edit",
      fast: false,
      pinnedAt: null,
      archivedAt: null,
      unreadAt: null,
      state: "idle",
      createdAt: now,
      updatedAt: now,
    };
    const adapter = new ClaudeAdapter(() => undefined, options);
    try {
      await adapter.start(conversation, randomUUID(), false);
      return await adapter.getSkills();
    } finally {
      await adapter.dispose();
    }
  };
}

function terminateSpawnedChild(child: ChildProcess): void {
  if (child.exitCode !== null || child.signalCode !== null) return;
  const timer = setTimeout(() => child.kill("SIGKILL"), 1_000);
  timer.unref?.();
  child.once("exit", () => clearTimeout(timer));
  child.kill("SIGTERM");
}

function mapClaudeModels(rawModels: unknown[]): AdapterModelList {
  const groups = new Map<string, Array<Record<string, unknown> & { value: string }>>();
  for (const raw of rawModels) {
    if (!isRecord(raw) || typeof raw.value !== "string" || raw.value.length === 0) continue;
    const resolvedModel =
      typeof raw.resolvedModel === "string" && raw.resolvedModel.length > 0
        ? raw.resolvedModel
        : raw.value;
    const group = groups.get(resolvedModel) ?? [];
    group.push(raw as Record<string, unknown> & { value: string });
    groups.set(resolvedModel, group);
  }

  const models: AdapterModelList["models"] = [];
  for (const [resolvedModel, group] of groups) {
    const defaultEntry = group.find((entry) => entry.value === "default");
    const selected = group.find((entry) => entry.value !== "default") ?? defaultEntry ?? group[0];
    if (!selected) continue;
    const capability =
      (defaultEntry?.supportsEffort === true ? defaultEntry : undefined) ??
      group.find((entry) => entry.supportsEffort === true);
    const efforts =
      capability && Array.isArray(capability.supportedEffortLevels)
        ? [...new Set(capability.supportedEffortLevels)].filter(
            (effort): effort is (typeof reasoningEffortSchema.options)[number] =>
              typeof effort === "string" &&
              reasoningEffortSchema.options.includes(
                effort as (typeof reasoningEffortSchema.options)[number],
              ),
          )
        : [];
    const aliasNames = group.filter((entry) => entry !== selected);
    const aliases = aliasNames.map((entry) => entry.value);
    if (selected.value === "default") aliases.push("default");
    const resolvedName = group.find(
      (entry) => entry.value !== "default" && typeof entry.displayName === "string",
    )?.displayName;
    const name = defaultEntry
      ? (typeof resolvedName === "string"
          ? resolvedName
          : modelNameFromResolvedModel(resolvedModel)
        )
          .replace(/\s*\(recommended\)\s*/i, "")
          .trim()
      : typeof selected.displayName === "string" && selected.displayName.length > 0
        ? selected.displayName
        : modelNameFromResolvedModel(resolvedModel);
    models.push({
      id: selected.value === "default" ? resolvedModel : selected.value,
      name,
      ...(aliases.length ? { aliases: [...new Set(aliases)] } : {}),
      ...(defaultEntry ? { isDefault: true } : {}),
      efforts,
      ...(efforts[0] ? { defaultEffort: efforts.includes("medium") ? "medium" : efforts[0] } : {}),
      supportsFast: false,
    });
  }

  models.sort((left, right) => Number(right.isDefault === true) - Number(left.isDefault === true));
  const efforts = [...new Set(models.flatMap((model) => model.efforts))];
  return {
    models,
    efforts,
  };
}

function mapClaudeSkills(rawCommands: unknown[]): ComposerSkill[] {
  return rawCommands.flatMap((command) => {
    if (!isRecord(command) || command.builtin === true) return [];
    const name = typeof command.name === "string" ? command.name : "";
    if (!name) return [];
    return [
      {
        name,
        description: typeof command.description === "string" ? command.description : "",
        ...(typeof command.argumentHint === "string" ? { argumentHint: command.argumentHint } : {}),
        source: "claude",
      },
    ];
  });
}

function modelNameFromResolvedModel(modelId: string): string {
  const readable = modelId
    .replace(/^claude-/i, "")
    .replace(/(\d)-(?=\d)/g, "$1.")
    .replaceAll("-", " ");
  return readable.replace(/\b[a-z]/g, (letter) => letter.toUpperCase());
}

function permissionModeFor(conversation: Conversation): string {
  return conversation.mode === "read-only"
    ? "dontAsk"
    : conversation.mode === "edit"
      ? "acceptEdits"
      : "bypassPermissions";
}

function classifyStartError(error: unknown, command: string): AgentCliError {
  const message =
    isRecord(error) && error.code === "ENOENT"
      ? `spawn ${command} ENOENT`
      : error instanceof Error
        ? error.message
        : String(error);
  const errorType = classifyErrorText(message);
  return new AgentCliError(errorType, message);
}
function classifyErrorText(text: string): "cli-not-found" | "not-logged-in" | "failed" {
  if (/\bENOENT\b|spawn\s+claude\s+ENOENT/i.test(text)) return "cli-not-found";
  return describeAgentError(text, "claude").message.startsWith("Claude Code não está conectado.")
    ? "not-logged-in"
    : "failed";
}
// O harness envolve o relatório final do subagente em um quadro de aviso; mantém só o relatório.
function subagentReport(text: string): string {
  const marker = "The report follows:\n";
  const index = text.indexOf(marker);
  if (index < 0) return text;
  return text
    .slice(index + marker.length)
    .split(/\r?\n/)
    .map((line) => line.replace(/^ {2}/, ""))
    .join("\n")
    .trim();
}
function contentToText(content: unknown): string {
  if (typeof content === "string") return content;
  if (!Array.isArray(content)) return content == null ? "" : JSON.stringify(content);
  return content
    .map((item) => {
      if (isRecord(item) && item.type === "image") return summarizeImage(item);
      return isRecord(item) && typeof item.text === "string" ? item.text : JSON.stringify(item);
    })
    .join("\n");
}

export function extractClaudeAssistantSources(content: unknown): MessageSource[] {
  const sources: MessageSource[] = [];
  const visit = (value: unknown) => {
    if (Array.isArray(value)) {
      for (const item of value) visit(item);
      return;
    }
    if (!isRecord(value)) return;
    if (Array.isArray(value.citations)) {
      for (const citation of value.citations) {
        if (!isRecord(citation)) continue;
        const source = makeClaudeSource(citation);
        if (source) sources.push(source);
      }
    }
    if (
      typeof value.url === "string" &&
      typeof value.type === "string" &&
      /citation|web_search_result/iu.test(value.type)
    ) {
      const source = makeClaudeSource(value);
      if (source) sources.push(source);
    }
    for (const [key, child] of Object.entries(value)) {
      if (key !== "citations") visit(child);
    }
  };
  visit(content);
  return mergeMessageSources([], sources);
}

export function extractClaudeToolSources(
  toolName: string,
  input: Record<string, unknown>,
  result: unknown,
): MessageSource[] {
  const tool = toolName.toLowerCase();
  if (tool !== "websearch" && tool !== "web_search" && tool !== "webfetch" && tool !== "web_fetch")
    return [];
  const isSearch = tool === "websearch" || tool === "web_search";
  const sources: MessageSource[] = [];
  const plainText: string[] = [];
  const visit = (value: unknown) => {
    if (Array.isArray(value)) {
      for (const item of value) visit(item);
      return;
    }
    if (typeof value === "string") {
      const trimmed = value.trim();
      if ((trimmed.startsWith("{") || trimmed.startsWith("[")) && trimmed.length < 256_000) {
        try {
          visit(JSON.parse(trimmed) as unknown);
          return;
        } catch {
          // Texto livre do resultado, processado abaixo.
        }
      }
      plainText.push(value);
      if (isSearch) sources.push(...sourcesFromSearchText(value));
      return;
    }
    if (!isRecord(value)) return;
    if (typeof value.url === "string") {
      const source = makeClaudeSource(value);
      if (source) sources.push(source);
    }
    for (const child of Object.values(value)) visit(child);
  };
  visit(result);

  if (!isSearch && typeof input.url === "string") {
    const text = plainText
      .join(" ")
      .replace(/<[^>]*>/gu, " ")
      .replace(/\s+/gu, " ")
      .trim();
    const title =
      /(?:page\s+)?title\s*[:-]\s*([^\n]+)/iu.exec(plainText.join("\n"))?.[1] ??
      /^\s*#{1,3}\s+([^\n]+)/mu.exec(plainText.join("\n"))?.[1];
    const source = makeMessageSource({
      url: input.url,
      title,
      snippet: text,
    });
    if (source) sources.push(source);
  }
  return mergeMessageSources([], sources);
}

function makeClaudeSource(value: Record<string, unknown>): MessageSource | null {
  return makeMessageSource({
    url: value.url,
    title: value.title ?? value.name ?? value.headline,
    snippet:
      value.cited_text ?? value.snippet ?? value.description ?? value.excerpt ?? value.summary,
    date:
      value.page_age ??
      value.date ??
      value.publishedAt ??
      value.published_at ??
      value.published ??
      value.updated_at,
  });
}

function sourcesFromSearchText(text: string): MessageSource[] {
  const links = searchResultLinks(text);
  if (links) {
    return links.flatMap((value) => {
      if (!isRecord(value) || typeof value.url !== "string") return [];
      const source = makeClaudeSource(value);
      return source ? [source] : [];
    });
  }

  return [];
}

function searchResultLinks(text: string): unknown[] | null {
  const marker = /(?:^|\n)\s*(?:Links|Results)\s*:\s*/iu.exec(text);
  if (!marker) return null;
  let start = marker.index + marker[0].length;
  while (/\s/u.test(text[start] ?? "")) start += 1;
  if (text[start] !== "[") return null;

  let depth = 0;
  let inString = false;
  let escaped = false;
  for (let index = start; index < text.length; index += 1) {
    const character = text[index];
    if (inString) {
      if (escaped) escaped = false;
      else if (character === "\\") escaped = true;
      else if (character === '"') inString = false;
      continue;
    }
    if (character === '"') inString = true;
    else if (character === "[") depth += 1;
    else if (character === "]") {
      depth -= 1;
      if (depth === 0) {
        try {
          const parsed: unknown = JSON.parse(text.slice(start, index + 1));
          return Array.isArray(parsed) ? parsed : null;
        } catch {
          return null;
        }
      }
    }
  }
  return null;
}

function summarizeImage(item: Record<string, unknown>): string {
  const source = isRecord(item.source) ? item.source : undefined;
  if (typeof source?.data !== "string") return "imagem";
  const data = source.data;
  const padding = data.endsWith("==") ? 2 : data.endsWith("=") ? 1 : 0;
  const bytes = Math.max(0, Math.floor((data.length * 3) / 4) - padding);
  return `imagem, ${Math.ceil(bytes / 1024)} kB`;
}
function summarizeInput(input: Record<string, unknown>): string {
  const raw = [
    input.description,
    input.file_path,
    input.pattern,
    input.query,
    input.url,
    input.command,
  ].find((value) => typeof value === "string" && value.length > 0);
  const summary =
    typeof raw === "string"
      ? raw
      : Object.keys(input).length
        ? `Parâmetros: ${Object.keys(input).join(", ")}`
        : "Sem entrada resumida.";
  return truncateUtf8(summary, 8 * 1024).text;
}
function isAllowSuggestion(value: unknown): boolean {
  return isRecord(value) && value.behavior === "allow";
}
function isRecord(value: unknown): value is Record<string, unknown> {
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
