import { EventEmitter } from "node:events";
import { createInterface } from "node:readline";
import { PassThrough } from "node:stream";

const threadId = "00000000-0000-4000-8000-000000000010";

class FakeCliProcess extends EventEmitter {
  constructor(agent, scenario) {
    super();
    this.agent = agent;
    this.scenario = scenario;
    this.stdin = new PassThrough();
    this.stdout = new PassThrough();
    this.stderr = new PassThrough();
    this.exitCode = null;
    this.signalCode = null;
    this.pending = new Map();
    this.nextId = 1;
    this.turnNumber = 0;
    this.inflight = 0;
    this.inputEnded = false;
    this.turnId = "00000000-0000-4000-8000-000000000020";
    this.interruptTurn = null;
    this.lines = createInterface({ input: this.stdin });
    this.lines.on("line", (line) => this.handleLine(line));
    this.stdin.on("finish", () => {
      this.inputEnded = true;
      this.maybeFinish();
    });
    queueMicrotask(() => this.emit("spawn"));
  }

  emitLine(target, value) {
    target.write(`${JSON.stringify(value)}\n`);
  }

  emitClaudeText(text) {
    this.emitLine(this.stdout, {
      type: "stream_event",
      event: { type: "content_block_delta", delta: { type: "text_delta", text } },
    });
  }

  claudeResult(text, subtype = "success") {
    this.emitClaudeText(text);
    this.emitLine(this.stdout, {
      type: "result",
      subtype,
      is_error: subtype !== "success",
      result: text,
      session_id: "00000000-0000-4000-8000-000000000001",
    });
  }

  requestClaudeTool(toolName, input) {
    const requestId = `fake-claude-${this.nextId++}`;
    const permissionSuggestions =
      toolName === "Bash"
        ? [
            {
              type: "addRules",
              destination: "localSettings",
              behavior: "allow",
              rules: [{ toolName, ruleContent: "touch .karont-approval-probe && ls" }],
            },
          ]
        : [];
    this.emitLine(this.stdout, {
      type: "control_request",
      request_id: requestId,
      request: {
        subtype: "can_use_tool",
        tool_name: toolName,
        input,
        permission_suggestions: permissionSuggestions,
      },
    });
    return new Promise((resolve) => this.pending.set(requestId, resolve));
  }

  async handleClaude(message) {
    if (message.type === "control_request") {
      this.emitLine(this.stdout, {
        type: "control_response",
        response: { subtype: "success", request_id: message.request_id, response: {} },
      });
      if (message.request?.subtype === "interrupt") {
        this.emitLine(this.stdout, {
          type: "result",
          subtype: "interrupted",
          is_error: false,
          result: "Interrompido pelo host.",
        });
      }
      return;
    }
    if (message.type === "control_response") {
      const requestId = message.response?.request_id;
      this.pending.get(requestId)?.(message.response?.response ?? {});
      this.pending.delete(requestId);
      return;
    }
    if (message.type !== "user") return;

    const content = message.message?.content ?? "";
    if (content.includes("Qual era a palavra secreta")) {
      this.claudeResult("jatobá");
    } else if (this.scenario === "comando-permitido" || this.scenario === "comando-negado") {
      const response = await this.requestClaudeTool("Bash", {
        command: "touch .karont-approval-probe && ls",
      });
      this.claudeResult(
        response.behavior === "deny" ? "Comando negado." : "Comando executado: ls /. ",
      );
    } else if (this.scenario === "pergunta") {
      const response = await this.requestClaudeTool("AskUserQuestion", {
        questions: [{ question: "Qual opção?", options: [{ label: "A" }, { label: "B" }] }],
      });
      const choice = response.updatedInput?.answers?.["Qual opção?"] ?? "A";
      this.claudeResult(`Escolha registrada: ${choice}.`);
    } else if (this.scenario === "plano") {
      await this.requestClaudeTool("ExitPlanMode", { plan: "1. Conferir; 2. Resumir." });
      this.claudeResult("Plano aprovado.");
    } else if (this.scenario === "parar") {
      this.emitClaudeText("Começando uma resposta extensa.");
    } else if (this.scenario === "erro") {
      this.emitLine(this.stdout, { type: "system", subtype: "error", message: "Modelo inválido." });
      this.claudeResult("Modelo inválido.", "error_during_execution");
    } else if (this.scenario === "leitura") {
      this.emitLine(this.stdout, {
        type: "assistant",
        message: {
          content: [
            {
              type: "tool_use",
              name: "Read",
              input: { file_path: "/home/user/projeto/README.md" },
            },
          ],
        },
      });
      this.claudeResult("O README descreve um projeto pequeno de gravação.");
    } else if (this.scenario === "tarefas") {
      this.emitLine(this.stdout, {
        type: "assistant",
        message: {
          content: [
            {
              type: "tool_use",
              name: "TaskCreate",
              input: { subject: "Tarefa 1", description: "Conferir o contexto" },
            },
            {
              type: "tool_use",
              name: "TaskCreate",
              input: { subject: "Tarefa 2", description: "Responder" },
            },
            {
              type: "tool_use",
              name: "TaskUpdate",
              input: { taskId: "fake-task-1", status: "completed" },
            },
            {
              type: "tool_use",
              name: "TaskUpdate",
              input: { taskId: "fake-task-2", status: "completed" },
            },
          ],
        },
      });
      this.claudeResult("As duas tarefas foram concluídas.");
    } else {
      this.claudeResult("Oi.");
    }
  }

  codexNotification(method, params) {
    this.emitLine(this.stdout, { jsonrpc: "2.0", method, params });
  }

  codexPlanItem(turnId, text) {
    const itemId = `fake-plan-item-${this.turnNumber}`;
    this.codexNotification("item/started", {
      threadId,
      turnId,
      item: { id: itemId, type: "plan", text: "" },
    });
    this.codexNotification("item/plan/delta", { threadId, turnId, itemId, delta: text });
    this.codexNotification("item/completed", {
      threadId,
      turnId,
      item: { id: itemId, type: "plan", text },
    });
  }

  codexRequest(method, params) {
    const id = `fake-codex-${this.nextId++}`;
    this.emitLine(this.stdout, { jsonrpc: "2.0", id, method, params });
    return new Promise((resolve) => this.pending.set(id, resolve));
  }

  async handleCodexTurn(message) {
    this.turnNumber += 1;
    this.turnId = `00000000-0000-4000-8000-${String(20 + this.turnNumber).padStart(12, "0")}`;
    this.emitLine(this.stdout, {
      jsonrpc: "2.0",
      id: message.id,
      result: { turn: { id: this.turnId, status: "inProgress" } },
    });
    this.codexNotification("turn/started", {
      threadId,
      turn: { id: this.turnId, status: "inProgress" },
    });

    let answer = "Oi.";
    if (this.scenario === "comando-permitido" || this.scenario === "comando-negado") {
      const approval = await this.codexRequest("item/commandExecution/requestApproval", {
        threadId,
        turnId: this.turnId,
        itemId: "fake-command-item",
        startedAtMs: Date.now(),
        command: "touch /tmp/karont-recorder-probe && ls",
        cwd: "/home/user/projeto",
        reason: "Executar o comando solicitado.",
      });
      answer = approval.decision === "decline" ? "Comando negado." : "Comando executado: ls /.";
    } else if (this.scenario === "pergunta" && this.turnNumber === 1) {
      const response = await this.codexRequest("item/tool/requestUserInput", {
        threadId,
        turnId: this.turnId,
        itemId: "fake-question-item",
        isBlocking: true,
        questions: [
          {
            id: "preferencia",
            header: "Escolha",
            question: "Qual opção?",
            options: [
              { label: "A", description: "Primeira opção" },
              { label: "B", description: "Segunda opção" },
            ],
          },
        ],
      });
      answer = `Escolha registrada: ${response.answers?.preferencia?.answers?.[0] ?? "A"}.`;
    } else if (
      (this.scenario === "plano" || this.scenario === "tarefas") &&
      this.turnNumber === 1
    ) {
      this.codexPlanItem(
        this.turnId,
        "1. Conferir o contexto — pendente.\n2. Responder — pendente.",
      );
      answer = "Plano proposto. Aguardo aprovação.";
    } else if ((this.scenario === "plano" || this.scenario === "tarefas") && this.turnNumber > 1) {
      this.codexPlanItem(
        this.turnId,
        "1. Conferir o contexto — concluído.\n2. Responder — concluído.",
      );
      answer = "As duas tarefas foram concluídas.";
    } else if (this.scenario === "continuar" && this.turnNumber === 1) {
      answer = "Entendido.";
    } else if (this.scenario === "continuar") {
      answer = "jatobá";
    } else if (this.scenario === "leitura") {
      this.codexNotification("item/started", {
        threadId,
        turnId: this.turnId,
        item: {
          id: "fake-read-command",
          type: "commandExecution",
          command: "/bin/bash -lc cat README.md",
          cwd: "/home/user/projeto",
        },
      });
      this.codexNotification("item/completed", {
        threadId,
        turnId: this.turnId,
        item: { id: "fake-read-command", type: "commandExecution", exitCode: 0 },
      });
      answer = "O README descreve um projeto pequeno de gravação.";
    } else if (this.scenario === "parar") {
      answer = "A resposta foi interrompida.";
    } else if (this.scenario === "erro") {
      answer = "Modelo inválido.";
    } else if (this.scenario === "pergunta") {
      answer = "Vou agir conforme a primeira opção.";
    }

    this.codexNotification("item/agentMessage/delta", {
      threadId,
      turnId: this.turnId,
      itemId: "fake-agent-message",
      delta: answer,
    });
    if (this.scenario === "parar") await new Promise((resolve) => (this.interruptTurn = resolve));
    this.codexNotification("turn/completed", {
      threadId,
      turn: { id: this.turnId, status: this.scenario === "parar" ? "interrupted" : "completed" },
    });
  }

  async handleCodex(message) {
    if (message.method === "initialize") {
      this.emitLine(this.stdout, {
        jsonrpc: "2.0",
        id: message.id,
        result: {
          codexHome: "/home/fake/.codex",
          platformFamily: "unix",
          platformOs: "linux",
          userAgent: "codex-fake/0",
        },
      });
    } else if (message.method === "initialized") {
      // A notificação do cliente não recebe resposta JSON-RPC.
    } else if (message.method === "model/list") {
      this.emitLine(this.stdout, {
        jsonrpc: "2.0",
        id: message.id,
        result: {
          models: [
            {
              id: "fake-model",
              model: "fake-model",
              hidden: false,
              isDefault: true,
              supportedReasoningEfforts: ["minimal"],
              defaultReasoningEffort: "minimal",
            },
          ],
        },
      });
    } else if (message.method === "thread/start" || message.method === "thread/resume") {
      if (message.params?.model === "karont-model-inexistente") {
        this.emitLine(this.stdout, {
          jsonrpc: "2.0",
          id: message.id,
          error: { code: -32602, message: "model not found" },
        });
      } else {
        this.emitLine(this.stdout, {
          jsonrpc: "2.0",
          id: message.id,
          result: { thread: { id: threadId } },
        });
      }
    } else if (message.method === "turn/start") {
      await this.handleCodexTurn(message);
    } else if (message.method === "turn/interrupt") {
      this.emitLine(this.stdout, { jsonrpc: "2.0", id: message.id, result: {} });
      this.interruptTurn?.();
    } else {
      this.emitLine(this.stdout, { jsonrpc: "2.0", id: message.id, result: {} });
    }
  }

  handleLine(line) {
    let message;
    try {
      message = JSON.parse(line);
    } catch {
      return;
    }
    if (this.agent === "codex" && Object.hasOwn(message, "id") && !message.method) {
      const id = String(message.id);
      this.pending.get(id)?.(message.result ?? {});
      this.pending.delete(id);
      return;
    }
    const task = this.agent === "claude" ? this.handleClaude(message) : this.handleCodex(message);
    this.inflight += 1;
    void Promise.resolve(task)
      .catch((error) => {
        this.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
      })
      .finally(() => {
        this.inflight -= 1;
        this.maybeFinish();
      });
  }

  maybeFinish() {
    if (this.inputEnded && this.inflight === 0) this.finish(0);
  }

  finish(code = 0, signal = null) {
    if (this.exitCode !== null || this.signalCode !== null) return;
    this.exitCode = code;
    this.signalCode = signal;
    this.stdout.end();
    this.stderr.end();
    this.emit("exit", code, signal);
    this.emit("close", code, signal);
  }

  kill(signal = "SIGTERM") {
    this.stdin.destroy();
    this.finish(null, signal);
    return true;
  }
}

export function createFakeCli(agent, scenario) {
  return new FakeCliProcess(agent, scenario);
}
