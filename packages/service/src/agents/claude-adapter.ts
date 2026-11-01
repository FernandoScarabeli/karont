import { type ChildProcess, spawn as nodeSpawn, type SpawnOptions } from "node:child_process";
import { randomUUID } from "node:crypto";
import os from "node:os";
import { createInterface } from "node:readline";
import type { Conversation, MessagePart } from "@karont/contract";
import type { AdapterEvent, AdapterFactory, AdapterResponse, AgentAdapter } from "./adapter.ts";
import { resolveAgentCommand } from "./detect.ts";

const MAX_ACTION_OUTPUT_BYTES = 64 * 1024;
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
  readonly #actions = new Map<string, { partId: string; startedAt: number }>();
  readonly #pending = new Map<
    string,
    { requestId: string; tool: string; input: Record<string, unknown>; suggestions: unknown[] }
  >();
  readonly #taskIds = new Map<string, string>();
  readonly #parts = new Map<string, MessagePart>();
  #child: ChildProcess | undefined;
  #conversation: Conversation | undefined;
  #sessionId = "";
  #resumeSession = false;
  #initResolve: (() => void) | undefined;
  #initReject: ((error: Error) => void) | undefined;
  #initPromise: Promise<void> | undefined;
  #stderrErrorType: "cli-not-found" | "not-logged-in" | undefined;
  #activeTextPartId: string | undefined;
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
  #turnOpen = false;
  #stopRequested = false;
  #disposed = false;
  #interruptTimer: ReturnType<typeof setTimeout> | undefined;
  #interruptResolve: (() => void) | undefined;

  constructor(emit: (event: AdapterEvent) => void, options: ClaudeAdapterOptions = {}) {
    this.#emit = emit;
    this.#env = options.env ?? process.env;
    this.#spawn = options.spawn ?? nodeSpawn;
    this.#homeDir = options.homeDir ?? os.homedir();
    this.#platform = options.platform ?? process.platform;
  }

  async start(conversation: Conversation, sessionId: string, resume: boolean): Promise<void> {
    if (this.#child && this.#child.exitCode === null && this.#child.signalCode === null) return;
    this.#child = undefined;
    this.#conversation = conversation;
    this.#sessionId = sessionId;
    this.#resumeSession = resume;
    this.#stderrErrorType = undefined;
    const command =
      this.#env.KARONT_CLAUDE_CLI ||
      (await resolveAgentCommand("claude", {
        env: this.#env,
        homeDir: this.#homeDir,
        platform: this.#platform,
      })) ||
      "claude";
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
    const permissionMode =
      conversation.mode === "read-only"
        ? "dontAsk"
        : conversation.mode === "edit"
          ? "acceptEdits"
          : "bypassPermissions";
    args.push("--permission-mode", permissionMode);
    if (conversation.mode === "read-only") args.push("--tools", READ_ONLY_TOOLS);
    if (conversation.mode === "full") args.push("--dangerously-skip-permissions");
    if (conversation.model) args.push("--model", conversation.model);
    if (conversation.effort) args.push("--effort", conversation.effort);
    args.push(resume ? "--resume" : "--session-id", sessionId);
    try {
      this.#child = this.#spawn(command, args, {
        cwd: conversation.cwd,
        env: this.#env,
        stdio: ["pipe", "pipe", "pipe"],
      });
    } catch (error) {
      throw classifyStartError(error, command);
    }
    const child = this.#child;
    const stdout = child.stdout;
    const stderr = child.stderr;
    const stdin = child.stdin;
    if (!stdout || !stderr || !stdin)
      throw new AgentCliError("failed", "A CLI não abriu os canais de comunicação esperados.");
    const lines = createInterface({ input: stdout, crlfDelay: Infinity });
    lines.on("line", (line) => this.#handleLine(line));
    stderr.setEncoding("utf8");
    stderr.on("data", (chunk: string) => {
      const errorType = classifyErrorText(chunk);
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
    const timer = setTimeout(() => {
      const errorType = this.#stderrErrorType ?? "failed";
      this.#initReject?.(new AgentCliError(errorType, friendlyError(errorType)));
    }, 15_000);
    try {
      await this.#initPromise;
    } finally {
      clearTimeout(timer);
      this.#initResolve = undefined;
      this.#initReject = undefined;
    }
    this.#resumeSession = true;
    this.#emit({ kind: "session", sessionId });
  }

  async send(text: string): Promise<void> {
    if (!this.#child || this.#child.exitCode !== null || this.#child.signalCode !== null) {
      if (!this.#conversation || !this.#sessionId)
        throw new AgentCliError("failed", "A CLI não está ativa.");
      await this.start(this.#conversation, this.#sessionId, this.#resumeSession);
    }
    this.#turnOpen = true;
    this.#stopRequested = false;
    this.#activeTextPartId = undefined;
    this.#activeThinkingPartId = undefined;
    this.#todosPartId = undefined;
    this.#todos = [];
    await this.#write({ type: "user", message: { role: "user", content: text } });
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
      const answers = Object.fromEntries(
        Object.entries(response.answers).map(([key, values]) => [
          key,
          values.length === 1 ? values[0] : values,
        ]),
      );
      toolResponse = { behavior: "allow", updatedInput: { ...pending.input, answers } };
      state = "answered";
    } else {
      const allow = response.decision === "approve";
      toolResponse = allow
        ? { behavior: "allow", updatedInput: pending.input }
        : { behavior: "deny", message: response.comment || "Plano rejeitado pelo usuário." };
      state = allow ? "approved" : "rejected";
    }
    this.#pending.delete(partId);
    const current = this.#pendingPart(partId);
    if (current?.type === "permission")
      this.#part({ ...current, state: state === "allowed" ? "allowed" : "denied" });
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

  #handleLine(line: string): void {
    if (Buffer.byteLength(line, "utf8") > 4 * 1024 * 1024) {
      this.#completeTurn("error", {
        type: "failed",
        text: "A CLI enviou um evento acima do limite de 4 MiB.",
      });
      this.#child?.kill("SIGTERM");
      return;
    }
    let value: Record<string, unknown>;
    try {
      value = JSON.parse(line) as Record<string, unknown>;
    } catch {
      return;
    }
    const type = value.type;
    if (type === "control_response") {
      const control = value.response as Record<string, unknown> | undefined;
      if (control?.request_id === "karont-initialize" && control.subtype === "success")
        this.#initResolve?.();
      return;
    }
    if (type === "system") {
      if (value.subtype === "init" && typeof value.session_id === "string") {
        this.#sessionId = value.session_id;
        this.#resumeSession = true;
        this.#emit({ kind: "session", sessionId: value.session_id });
      }
      if (value.subtype === "api_error" || value.subtype === "error") {
        const detail =
          typeof value.error === "string"
            ? value.error
            : typeof value.message === "string"
              ? value.message
              : "Claude Code reportou um erro de execução.";
        const errorType = classifyErrorText(detail);
        this.#completeTurn("error", { type: errorType, text: friendlyError(errorType) });
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
      const content = Array.isArray(message?.content) ? message.content : [];
      for (const item of content) {
        if (!isRecord(item) || item.type !== "tool_use" || typeof item.name !== "string") continue;
        this.#handleToolUse(item);
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
      if (typeof value.session_id === "string") {
        this.#sessionId = value.session_id;
        this.#resumeSession = true;
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
          const errorType = classifyErrorText(errors.join(" "));
          this.#completeTurn("error", { type: errorType, text: friendlyError(errorType) });
        }
      } else this.#completeTurn("done");
    }
  }

  #handleToolUse(item: Record<string, unknown>): void {
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
    const action: MessagePart = {
      id: partId,
      type: "action",
      actionType: actionType(name),
      title: actionTitle(name, input),
      input: summarizeInput(input),
      output: "",
      truncated: false,
      state: "running",
      durationMs: null,
    };
    this.#actions.set(id, { partId, startedAt: Date.now() });
    this.#part(action);
    if (name === "Write" && typeof input.content === "string") this.#lastPlan = input.content;
  }

  #handleToolResult(item: Record<string, unknown>): void {
    const toolId = String(item.tool_use_id ?? "");
    const actionInfo = this.#actions.get(toolId);
    if (!actionInfo) return;
    const output = contentToText(item.content);
    const bounded = truncateUtf8(output, MAX_ACTION_OUTPUT_BYTES);
    const existing = this.#pendingPart(actionInfo.partId);
    if (existing?.type === "action")
      this.#part({
        ...existing,
        output: bounded.text,
        truncated: bounded.truncated,
        state: item.is_error === true ? "error" : "ok",
        durationMs: Math.max(0, Date.now() - actionInfo.startedAt),
      });
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
          message: "O modo Só leitura bloqueia esta ferramenta.",
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
    this.#pending.set(partId, { requestId, tool, input, suggestions });
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
        summary: summarizeInput(input),
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

  #part(part: MessagePart): void {
    this.#parts.set(part.id, part);
    this.#emit({ kind: "part", part });
  }

  async #write(value: unknown): Promise<void> {
    const stdin = this.#child?.stdin;
    if (!stdin || stdin.destroyed)
      throw new AgentCliError("failed", "O canal de entrada da CLI foi encerrado.");
    const line = `${JSON.stringify(value)}\n`;
    if (Buffer.byteLength(line, "utf8") > 64 * 1024)
      throw new Error("A mensagem para a CLI excede o limite de 64 KiB.");
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
    const type = this.#stderrErrorType ?? classifyErrorText(error.message);
    if (this.#initReject) this.#initReject(new AgentCliError(type, friendlyError(type)));
    if (this.#turnOpen) {
      if (this.#stopRequested)
        this.#completeTurn("interrupted", {
          type: "interrupted",
          text: "Resposta interrompida pelo usuário.",
        });
      else this.#completeTurn("error", { type, text: friendlyError(type) });
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
  }
}

export const createClaudeAdapterFactory =
  (options: ClaudeAdapterOptions = {}): AdapterFactory =>
  (_conversation, emit) =>
    new ClaudeAdapter(emit, options);

function classifyStartError(error: unknown, command: string): AgentCliError {
  if (isRecord(error) && error.code === "ENOENT")
    return new AgentCliError("cli-not-found", `CLI do Claude Code não encontrada (${command}).`);
  const message = error instanceof Error ? error.message : String(error);
  const errorType = classifyErrorText(message);
  return new AgentCliError(errorType, friendlyError(errorType));
}
function classifyErrorText(text: string): "cli-not-found" | "not-logged-in" | "failed" {
  if (/\bENOENT\b|spawn\s+claude\s+ENOENT/i.test(text)) return "cli-not-found";
  return /not logged in|please log in|run\s+\/login|authentication required|logged out|oauth.*(expired|invalid)/i.test(
    text,
  )
    ? "not-logged-in"
    : "failed";
}
function friendlyError(type: "cli-not-found" | "not-logged-in" | "failed"): string {
  if (type === "cli-not-found")
    return "Claude Code não encontrado. Instale a CLI e tente novamente.";
  if (type === "not-logged-in")
    return "Claude Code não está conectado. Faça login na CLI e tente novamente.";
  return "Claude Code encerrou antes de concluir a resposta. Tente de novo.";
}
function actionType(
  tool: string,
): "read" | "edit" | "write" | "command" | "search" | "web" | "other" {
  if (tool === "Read") return "read";
  if (tool === "Edit" || tool === "NotebookEdit") return "edit";
  if (tool === "Write") return "write";
  if (tool === "Bash") return "command";
  if (tool === "Glob" || tool === "Grep") return "search";
  if (tool === "WebSearch" || tool === "WebFetch") return "web";
  return "other";
}
function actionTitle(tool: string, input: Record<string, unknown>): string {
  const detail =
    typeof input.file_path === "string"
      ? input.file_path
      : typeof input.command === "string"
        ? input.command
        : typeof input.pattern === "string"
          ? input.pattern
          : "";
  return `${tool}${detail ? ` · ${detail}` : ""}`.slice(0, 240);
}
function summarizeInput(input: Record<string, unknown>): string {
  const raw = [
    input.description,
    input.file_path,
    input.pattern,
    input.query,
    input.url,
    input.command,
    input.subject,
  ].find((value) => typeof value === "string" && value.length > 0);
  const summary =
    typeof raw === "string"
      ? raw
      : Object.keys(input).length
        ? `Parâmetros: ${Object.keys(input).join(", ")}`
        : "Sem entrada resumida.";
  return truncateUtf8(summary, 8 * 1024).text;
}
function contentToText(content: unknown): string {
  if (typeof content === "string") return content;
  if (!Array.isArray(content)) return content == null ? "" : JSON.stringify(content);
  return content
    .map((item) =>
      isRecord(item) && typeof item.text === "string" ? item.text : JSON.stringify(item),
    )
    .join("\n");
}
function truncateUtf8(text: string, maxBytes: number): { text: string; truncated: boolean } {
  if (Buffer.byteLength(text, "utf8") <= maxBytes) return { text, truncated: false };
  const marker = "\n… [truncado]";
  const budget = maxBytes - Buffer.byteLength(marker, "utf8");
  let output = "";
  for (const char of text) {
    if (Buffer.byteLength(output, "utf8") + Buffer.byteLength(char, "utf8") > budget) break;
    output += char;
  }
  return { text: output + marker, truncated: true };
}
function isAllowSuggestion(value: unknown): boolean {
  return isRecord(value) && value.behavior === "allow";
}
function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
