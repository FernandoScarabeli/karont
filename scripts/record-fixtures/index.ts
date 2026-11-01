import { spawn } from "node:child_process";
import { randomUUID } from "node:crypto";
import { mkdir, mkdtemp, readdir, readFile, rm, writeFile } from "node:fs/promises";
import { homedir, tmpdir } from "node:os";
import { basename, join, resolve } from "node:path";
import { createInterface } from "node:readline";
import { fileURLToPath } from "node:url";
import { createFakeCli } from "./fake-transport.mjs";

const scriptDir = fileURLToPath(new URL(".", import.meta.url));
const projectRoot = resolve(scriptDir, "../..");
const scenarios = [
  "texto",
  "leitura",
  "comando-permitido",
  "comando-negado",
  "pergunta",
  "plano",
  "tarefas",
  "continuar",
  "parar",
  "erro",
];
const defaultTimeoutMs = 120_000;
const fakeUuid = "00000000-0000-4000-8000-000000000001";
const spawnFailures = new WeakSet();

function usage() {
  console.error("Uso: node scripts/record-fixtures/index.ts [claude|codex] [cenario|all]");
  console.error(
    "Sanitize fixtures existentes: node scripts/record-fixtures/index.ts --sanitize-existing",
  );
  console.error(`Cenários: ${scenarios.join(", ")}`);
}

function scenarioPrompt(scenario, agent = "claude", probePath = "") {
  switch (scenario) {
    case "texto":
      return "Diga oi em uma linha.";
    case "leitura":
      return "Leia o README.md e resuma em uma linha.";
    case "comando-permitido":
      return agent === "claude"
        ? "Execute agora, usando a ferramenta Bash, exatamente `touch .karont-approval-probe && ls` na pasta deste projeto. Aguarde o resultado da ferramenta e resuma em uma linha."
        : `Execute exatamente \`touch ${probePath} && ls\` e mostre o resultado. Aguarde a aprovação do host antes de continuar.`;
    case "comando-negado":
      return agent === "claude"
        ? "Execute agora, usando a ferramenta Bash, exatamente `touch .karont-approval-probe && ls` na pasta deste projeto. Aguarde o resultado da ferramenta e resuma em uma linha."
        : `Execute exatamente \`touch ${probePath} && ls\` e mostre o resultado. Aguarde a aprovação do host antes de continuar.`;
    case "pergunta":
      return agent === "claude"
        ? "Chame diretamente AskUserQuestion para perguntar se prefiro A ou B, com exatamente essas duas opções. Não use ToolSearch nem faça a pergunta em texto. Aguarde a resposta do host."
        : "Antes de agir, faça uma pergunta estruturada ao usuário com o texto 'Qual opção?' e exatamente as opções A e B. Aguarde a resposta.";
    case "plano":
      return agent === "claude"
        ? "Escreva um plano de dois passos e chame ExitPlanMode para pedir aprovação. Não leia arquivos nem execute ações antes de receber aprovação."
        : "Publique no plano estruturado exatamente dois passos simples e aguarde minha aprovação. Não execute comandos nem altere arquivos.";
    case "tarefas":
      return agent === "claude"
        ? "Use TaskCreate para criar exatamente duas tarefas curtas e TaskUpdate para marcar ambas como concluídas. Não use TodoWrite, ToolSearch ou Bash."
        : "Crie no plano estruturado exatamente duas tarefas simples, sem comandos nem alterações de arquivo, e aguarde minha aprovação antes de concluí-las.";
    case "continuar":
      return "Lembre que a palavra secreta é jatobá. Responda apenas entendido.";
    case "parar":
      return "Comece um texto longo sobre viagens espaciais e continue por vários parágrafos.";
    case "erro":
      return "";
    default:
      return "";
  }
}

function modeForClaude(scenario) {
  if (scenario === "plano") return "plan";
  if (scenario === "comando-permitido" || scenario === "comando-negado") return "manual";
  return "acceptEdits";
}

function claudeArgs(scenario, sessionId, resume = false) {
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
    "--permission-mode",
    modeForClaude(scenario),
    "--model",
    "haiku",
    "--effort",
    "low",
  ];
  const scenarioTools = {
    "comando-permitido": "Bash",
    "comando-negado": "Bash",
    pergunta: "AskUserQuestion",
    plano: "ExitPlanMode",
    tarefas: "TaskCreate,TaskUpdate",
  }[scenario];
  if (scenarioTools) args.push("--tools", scenarioTools);
  args.push(resume ? "--resume" : "--session-id", sessionId);
  return args;
}

function readEventText(message) {
  if (message?.type === "stream_event") {
    const event = message.event;
    return event?.delta?.text ?? event?.content_block?.text ?? "";
  }
  if (message?.type === "assistant") {
    return (message.message?.content ?? [])
      .filter((part) => part.type === "text")
      .map((part) => part.text ?? "")
      .join("");
  }
  return "";
}

function makeEventMonitor() {
  const events = [];
  const listeners = new Set();
  let onEvent = () => {};
  return {
    setOnEvent(handler) {
      onEvent = handler;
    },
    count() {
      return events.length;
    },
    has(predicate) {
      return events.some(predicate);
    },
    publish(event) {
      events.push(event);
      onEvent(event);
      for (const listener of listeners) listener(event);
    },
    waitFor(predicate, timeoutMs, afterIndex = events.length) {
      const found = events.slice(afterIndex).find(predicate);
      if (found) return Promise.resolve(found);
      return new Promise((resolveWait, rejectWait) => {
        const timer = setTimeout(() => {
          listeners.delete(onEvent);
          rejectWait(new Error("tempo esgotado aguardando evento da CLI"));
        }, timeoutMs);
        const onEvent = (event) => {
          if (!predicate(event)) return;
          clearTimeout(timer);
          listeners.delete(onEvent);
          resolveWait(event);
        };
        listeners.add(onEvent);
      });
    },
  };
}

function startChild(agent, args, cwd, record, fake, children) {
  const scenario = process.env.KARONT_RECORDER_SCENARIO ?? "texto";
  const child =
    fake && scenario !== "erro"
      ? createFakeCli(agent, scenario)
      : spawn(fake ? `karont-recorder-fake-${agent}-missing` : agent, fake ? [] : args, {
          cwd,
          env: process.env,
          stdio: ["pipe", "pipe", "pipe"],
        });
  children.push(child);
  const monitor = makeEventMonitor();
  const stdout = createInterface({ input: child.stdout });
  const stderr = createInterface({ input: child.stderr });
  stdout.on("line", (line) => {
    record("in", line, "stdout");
    let message: Record<string, unknown>;
    try {
      message = JSON.parse(line);
    } catch {
      monitor.publish({ raw: line });
      return;
    }
    monitor.publish(message);
  });
  stderr.on("line", (line) => {
    record("stderr", line, "stderr");
  });
  child.on("error", (error) => {
    spawnFailures.add(child);
    const message = `falha ao iniciar CLI: ${error.message}`;
    record("stderr", message, "stderr");
    monitor.publish({ type: "recorder_spawn_error", code: error.code, message: error.message });
  });
  child.stdin.on("error", (error) =>
    record("stderr", `falha no stdin da CLI: ${error.message}`, "stderr"),
  );
  return { child, monitor };
}

function sendClaude(child, record, message) {
  const line = JSON.stringify(message);
  record("out", line, "stdin");
  child.stdin.write(`${line}\n`);
}

function answerClaudeQuestion(input) {
  const answers = Object.fromEntries(
    (input?.questions ?? []).map((question) => {
      const option = question.options?.[0];
      return [question.question ?? question.header ?? "pergunta", option?.label ?? option ?? "A"];
    }),
  );
  return { ...input, answers };
}

function configureClaudeHost({ scenario, child, record, monitor }) {
  let interruptionRequested = false;
  let controlCounter = 0;
  const requestInterrupt = () => {
    if (interruptionRequested) return;
    interruptionRequested = true;
    sendClaude(child, record, {
      type: "control_request",
      request_id: "karont-interrupt",
      request: { subtype: "interrupt" },
    });
  };

  monitor.setOnEvent((message) => {
    if (message?.type === "control_request") {
      const request = message.request ?? {};
      const requestId = message.request_id ?? `karont-${++controlCounter}`;
      const toolName = request.tool_name;
      const input = request.input ?? {};
      let response = { behavior: "allow", updatedInput: input };

      if (request.subtype === "can_use_tool") {
        if (toolName === "AskUserQuestion") {
          response = { behavior: "allow", updatedInput: answerClaudeQuestion(input) };
        } else if (toolName === "ExitPlanMode") {
          response = { behavior: "allow", updatedInput: input };
        } else if (
          scenario === "comando-permitido" &&
          ["Bash", "Shell", "Computer"].includes(toolName)
        ) {
          response = { behavior: "allow", updatedInput: input };
          if (process.env.KARONT_RECORDER_CLAUDE_PERMISSION === "always") {
            const suggestion = (request.permission_suggestions ?? []).find(
              (item) => item?.destination === "localSettings" && item?.type === "addRules",
            );
            if (suggestion) response.updatedPermissions = [suggestion];
          }
        } else if (
          scenario === "comando-negado" &&
          ["Bash", "Shell", "Computer"].includes(toolName)
        ) {
          response = { behavior: "deny", message: "Negado pelo usuário no cenário de gravação." };
        }
      } else if (request.subtype === "initialize") {
        response = { supportedCommands: [] };
      } else if (request.subtype === "interrupt") {
        response = {};
      } else {
        response = {
          behavior: "deny",
          message: "Pedido de controle não reconhecido pelo gravador.",
        };
      }

      sendClaude(child, record, {
        type: "control_response",
        response: {
          subtype: "success",
          request_id: requestId,
          response,
        },
      });
    }
    if (scenario === "parar" && !interruptionRequested && readEventText(message).length > 0) {
      requestInterrupt();
    }
  });
  return requestInterrupt;
}

async function runClaudeConversation({
  scenario,
  cwd,
  missingCwd,
  record,
  timeoutMs,
  fake,
  sessionId,
  probePath,
  children,
}) {
  const { child, monitor } = startChild(
    "claude",
    claudeArgs(scenario, sessionId),
    scenario === "erro" && !fake ? missingCwd : cwd,
    record,
    fake,
    children,
  );
  const requestInterrupt = configureClaudeHost({ scenario, child, record, monitor });

  await initializeClaude(child, record, monitor, "karont-initialize", timeoutMs);
  const done = monitor.waitFor((message) => message?.type === "result", timeoutMs);
  sendClaude(child, record, {
    type: "user",
    message: { role: "user", content: scenarioPrompt(scenario, "claude", probePath) },
  });
  let interruptTimer: ReturnType<typeof setTimeout> | undefined;
  if (scenario === "parar") {
    interruptTimer = setTimeout(
      () => {
        requestInterrupt();
      },
      Math.min(8_000, Math.floor(timeoutMs / 3)),
    );
    interruptTimer.unref?.();
  }

  try {
    await done;
  } finally {
    clearTimeout(interruptTimer);
  }
  if (scenario === "continuar") {
    child.stdin.end();
    await waitForExit(child, Math.min(5_000, timeoutMs));
    const resumed = startChild(
      "claude",
      claudeArgs(scenario, sessionId, true),
      cwd,
      record,
      fake,
      children,
    );
    configureClaudeHost({ scenario, child: resumed.child, record, monitor: resumed.monitor });
    await initializeClaude(
      resumed.child,
      record,
      resumed.monitor,
      "karont-initialize-resume",
      timeoutMs,
    );
    const resumedDone = resumed.monitor.waitFor((message) => message?.type === "result", timeoutMs);
    sendClaude(resumed.child, record, {
      type: "user",
      message: { role: "user", content: "Qual era a palavra secreta que mencionei?" },
    });
    await resumedDone;
    resumed.child.stdin.end();
    await waitForExit(resumed.child, Math.min(5_000, timeoutMs));
    return;
  }
  child.stdin.end();
  await waitForExit(child, Math.min(5_000, timeoutMs));
}

async function initializeClaude(child, record, monitor, requestId, timeoutMs) {
  const response = monitor.waitFor(
    (message) =>
      (message?.type === "control_response" && message.response?.request_id === requestId) ||
      message?.type === "recorder_spawn_error",
    timeoutMs,
    0,
  );
  sendClaude(child, record, {
    type: "control_request",
    request_id: requestId,
    request: { subtype: "initialize" },
  });
  const result = await response;
  if (result?.type === "recorder_spawn_error") {
    throw new Error(result.message ?? "falha ao iniciar CLI");
  }
}

function waitForExit(child, timeoutMs) {
  if (spawnFailures.has(child) || child.exitCode !== null || child.signalCode !== null) {
    return Promise.resolve();
  }
  return new Promise((resolveWait) => {
    const timer = setTimeout(() => {
      child.kill("SIGTERM");
      setTimeout(() => child.kill("SIGKILL"), 1_000).unref?.();
      resolveWait();
    }, timeoutMs);
    child.once("exit", () => {
      clearTimeout(timer);
      resolveWait();
    });
  });
}

function createCodexTransport(child, record, timeoutMs) {
  const pending = new Map();
  const monitor = makeEventMonitor();
  let nextId = 1;
  const stdout = createInterface({ input: child.stdout });
  const stderr = createInterface({ input: child.stderr });
  stdout.on("line", (line) => {
    record("in", line, "stdout");
    let message: Record<string, unknown>;
    try {
      message = JSON.parse(line);
    } catch {
      monitor.publish({ raw: line });
      return;
    }
    if (Object.hasOwn(message, "id") && (Object.hasOwn(message, "result") || message.error)) {
      const waiter = pending.get(String(message.id));
      if (waiter) {
        pending.delete(String(message.id));
        if (message.error) waiter.reject(new Error(message.error.message ?? "erro JSON-RPC"));
        else waiter.resolve(message.result);
      }
      return;
    }
    monitor.publish(message);
  });
  stderr.on("line", (line) => {
    record("stderr", line, "stderr");
  });
  child.on("error", (error) => {
    spawnFailures.add(child);
    record("stderr", `falha ao iniciar CLI: ${error.message}`, "stderr");
    for (const [id, waiter] of pending) {
      pending.delete(id);
      waiter.reject(error);
    }
  });

  function send(message) {
    const line = JSON.stringify(message);
    record("out", line, "stdin");
    child.stdin.write(`${line}\n`);
  }

  function request(method, params = {}) {
    const id = nextId++;
    return new Promise((resolveRequest, rejectRequest) => {
      const timer = setTimeout(() => {
        pending.delete(String(id));
        rejectRequest(new Error(`tempo esgotado aguardando ${method}`));
      }, timeoutMs);
      pending.set(String(id), {
        resolve(value) {
          clearTimeout(timer);
          resolveRequest(value);
        },
        reject(error) {
          clearTimeout(timer);
          rejectRequest(error);
        },
      });
      send({ jsonrpc: "2.0", id, method, params });
    });
  }

  function respond(id, result) {
    send({ jsonrpc: "2.0", id, result });
  }

  return { monitor, request, respond, send };
}

function chooseModel(result) {
  const models = result?.data ?? result?.models ?? [];
  const visible = models.filter((model) => !model.hidden);
  const model =
    visible.find((item) => (item.model ?? item.id) === process.env.KARONT_RECORDER_CODEX_MODEL) ??
    visible.find((item) => /mini|nano|spark/i.test(item.model ?? item.id)) ??
    visible.find((item) => item.isDefault) ??
    visible[0];
  if (!model) throw new Error("model/list não retornou modelos disponíveis");
  const availableEfforts = (model.supportedReasoningEfforts ?? [])
    .map((item) => (typeof item === "string" ? item : (item.reasoningEffort ?? item.effort)))
    .filter(Boolean);
  const minimumEffort = ["minimal", "low", "medium", "high", "xhigh"].find((effort) =>
    availableEfforts.includes(effort),
  );
  return {
    model: model.model ?? model.id,
    effort: minimumEffort ?? model.defaultReasoningEffort ?? "low",
  };
}

function threadIdFrom(result) {
  return result?.thread?.id ?? result?.threadId ?? result?.thread?.threadId;
}

function turnIdFrom(result) {
  return result?.turn?.id ?? result?.turnId;
}

function userInput(text) {
  return [{ type: "text", text }];
}

function codexPlanEntries(message) {
  const params = message?.params ?? {};
  if (message?.method === "turn/plan/updated") {
    return (params.plan ?? []).map((step) => ({
      text: step.step ?? "",
      status: step.status ?? "pending",
    }));
  }
  if (
    message?.method === "item/completed" &&
    params.item?.type === "plan" &&
    typeof params.item.text === "string"
  ) {
    return params.item.text
      .split(/\r?\n/)
      .map((line) => line.trim())
      .filter((line) => /^(?:\d+[.)]|[-*])\s+/.test(line))
      .map((text) => ({
        text,
        status: /\b(?:completed|done|conclu[ií]d[oa]s?|finalizad[oa]s?|feit[oa]s?)\b/i.test(text)
          ? "completed"
          : "pending",
      }));
  }
  return [];
}

function codexHasPlanSnapshot(message) {
  return codexPlanEntries(message).length >= 2;
}

function codexHasTwoCompletedTasks(message) {
  const entries = codexPlanEntries(message);
  return entries.length >= 2 && entries.every((entry) => entry.status === "completed");
}

function codexPlanMode(model) {
  return {
    mode: "plan",
    settings: {
      model: model.model,
      reasoning_effort: model.effort ?? null,
      developer_instructions: null,
    },
  };
}

async function handleCodexServerRequest(transport, message, scenario) {
  const params = message.params ?? {};
  const sessionApproval = process.env.KARONT_RECORDER_CODEX_PERMISSION === "session";
  let result = {};
  if (message.method === "item/commandExecution/requestApproval") {
    result = {
      decision:
        scenario === "comando-permitido"
          ? sessionApproval
            ? "acceptForSession"
            : "accept"
          : "decline",
    };
  } else if (message.method === "item/fileChange/requestApproval") {
    result = {
      decision:
        scenario === "comando-permitido"
          ? sessionApproval
            ? "acceptForSession"
            : "accept"
          : "decline",
    };
  } else if (message.method === "item/tool/requestUserInput") {
    const answers = Object.fromEntries(
      (params.questions ?? []).map((question) => [
        question.id,
        { answers: [question.options?.[0]?.label ?? "A"] },
      ]),
    );
    result = { answers };
  } else if (message.method === "item/permissions/requestApproval") {
    result = {
      permissions: scenario === "comando-permitido" ? (params.permissions ?? {}) : {},
      scope: sessionApproval ? "session" : "turn",
    };
  } else if (message.method === "applyPatchApproval" || message.method === "execCommandApproval") {
    result = { decision: scenario === "comando-permitido" ? "approved" : "abort" };
  } else {
    result = { decision: "decline" };
  }
  transport.respond(message.id, result);
}

async function startCodexTurn(
  transport,
  threadId,
  text,
  model,
  effort,
  scenario,
  timeoutMs,
  collaborationMode,
) {
  const eventStart = transport.monitor.count();
  const resultPromise = transport.monitor.waitFor(
    (message) => message?.method === "turn/completed" && message.params?.threadId === threadId,
    timeoutMs,
    eventStart,
  );
  const params = {
    threadId,
    input: userInput(text),
    model: model.model,
    effort: model.effort ?? effort,
    serviceTier: undefined,
  };
  if (collaborationMode) params.collaborationMode = collaborationMode;
  const result = await transport.request("turn/start", params);
  let turnId = turnIdFrom(result);
  const started = await transport.monitor
    .waitFor(
      (message) => message?.method === "turn/started" && message.params?.threadId === threadId,
      Math.min(5_000, timeoutMs),
      eventStart,
    )
    .catch(() => null);
  turnId ??= started?.params?.turn?.id ?? started?.params?.turnId;

  if (scenario === "parar" && turnId) {
    await transport.monitor
      .waitFor(
        (message) =>
          message?.method === "item/agentMessage/delta" && message.params?.threadId === threadId,
        Math.min(8_000, timeoutMs),
        eventStart,
      )
      .catch(() => null);
    await transport.request("turn/interrupt", { threadId, turnId });
  }
  await resultPromise;
}

async function runCodex({
  scenario,
  cwd,
  missingCwd,
  probePath,
  record,
  timeoutMs,
  fake,
  children,
}) {
  const child =
    fake && scenario !== "erro"
      ? createFakeCli("codex", scenario)
      : spawn(
          fake ? "karont-recorder-fake-codex-missing" : "codex",
          fake ? [] : ["app-server", "--stdio"],
          {
            cwd: scenario === "erro" && !fake ? missingCwd : cwd,
            env: process.env,
            stdio: ["pipe", "pipe", "pipe"],
          },
        );
  children.push(child);
  const transport = createCodexTransport(child, record, timeoutMs);
  const serverRequestHandler = (message) => {
    if (message?.method && Object.hasOwn(message, "id")) {
      void handleCodexServerRequest(transport, message, scenario);
    }
  };
  const originalPublish = transport.monitor.publish.bind(transport.monitor);
  transport.monitor.publish = (message) => {
    serverRequestHandler(message);
    originalPublish(message);
  };

  await transport.request("initialize", {
    clientInfo: {
      name: "karont-fixture-recorder",
      version: "0.1.0",
      title: "Gravador de fixtures",
    },
    capabilities: { experimentalApi: true },
  });
  transport.send({ jsonrpc: "2.0", method: "initialized", params: {} });
  const modelResult = await transport.request("model/list", { limit: 100, includeHidden: false });
  const selectedModel = chooseModel(modelResult);
  const collaborationMode = ["pergunta", "plano", "tarefas"].includes(scenario)
    ? codexPlanMode(selectedModel)
    : undefined;
  const turnTimeoutMs = scenario === "pergunta" ? Math.min(timeoutMs, 60_000) : timeoutMs;

  const threadParams = {
    cwd,
    model: selectedModel.model,
    sandbox:
      scenario === "comando-permitido" || scenario === "comando-negado"
        ? "workspace-write"
        : "read-only",
    approvalPolicy:
      scenario === "comando-permitido" || scenario === "comando-negado" ? "on-request" : "never",
    serviceTier: undefined,
  };
  const threadResult = await transport.request("thread/start", threadParams);
  const threadId = threadIdFrom(threadResult);
  if (!threadId) throw new Error("thread/start não retornou thread.id");

  if (scenario === "continuar") {
    await startCodexTurn(
      transport,
      threadId,
      "Lembre que a palavra secreta é jatobá. Responda apenas entendido.",
      selectedModel,
      selectedModel.effort,
      scenario,
      timeoutMs,
    );
    await transport.request("thread/resume", { threadId, cwd });
    await startCodexTurn(
      transport,
      threadId,
      "Qual era a palavra secreta que mencionei?",
      selectedModel,
      selectedModel.effort,
      scenario,
      timeoutMs,
    );
  } else if (scenario === "plano") {
    await startCodexTurn(
      transport,
      threadId,
      scenarioPrompt(scenario, "codex", probePath),
      selectedModel,
      selectedModel.effort,
      scenario,
      timeoutMs,
      collaborationMode,
    );
    const proposedPlan = transport.monitor.has(
      (message) => message?.params?.threadId === threadId && codexHasPlanSnapshot(message),
    );
    if (proposedPlan) {
      await startCodexTurn(
        transport,
        threadId,
        "Aprovado. Atualize o plano estruturado mantendo os mesmos dois passos e marcando ambos como completed. Não responda só em texto; não execute comandos nem altere arquivos.",
        selectedModel,
        selectedModel.effort,
        scenario,
        timeoutMs,
        collaborationMode,
      );
    }
  } else if (scenario === "pergunta") {
    await startCodexTurn(
      transport,
      threadId,
      scenarioPrompt(scenario, "codex", probePath),
      selectedModel,
      selectedModel.effort,
      scenario,
      turnTimeoutMs,
      collaborationMode,
    );
  } else if (scenario === "tarefas") {
    await startCodexTurn(
      transport,
      threadId,
      scenarioPrompt(scenario, "codex", probePath),
      selectedModel,
      selectedModel.effort,
      scenario,
      timeoutMs,
      collaborationMode,
    );
    const proposedTasks = transport.monitor.has(
      (message) => message?.params?.threadId === threadId && codexHasPlanSnapshot(message),
    );
    if (proposedTasks) {
      await startCodexTurn(
        transport,
        threadId,
        "Aprovado. Atualize o plano estruturado mantendo as duas tarefas originais e marcando ambas como completed. Não responda só em texto; não execute comandos nem altere arquivos.",
        selectedModel,
        selectedModel.effort,
        scenario,
        timeoutMs,
        collaborationMode,
      );
    }
  } else {
    await startCodexTurn(
      transport,
      threadId,
      scenarioPrompt(scenario, "codex", probePath),
      selectedModel,
      selectedModel.effort,
      scenario,
      timeoutMs,
    );
  }
  child.stdin.end();
  await waitForExit(child, Math.min(5_000, timeoutMs));
}

function escapeRegExp(value) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function createSanitizer({ cwd, username, extraPaths = [] }) {
  const ids = new Map();
  let idCounter = 1;
  const userHome = homedir();
  const paths = [{ path: cwd, replacement: "/home/user/projeto" }, ...extraPaths]
    .filter((entry) => entry.path)
    .sort((a, b) => b.path.length - a.path.length);
  const replaceIds = (value) =>
    value.replace(
      /\b[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}\b/gi,
      (id) => {
        if (!ids.has(id)) {
          const suffix = String(idCounter++).padStart(12, "0");
          ids.set(id, `00000000-0000-4000-8000-${suffix}`);
        }
        return ids.get(id);
      },
    );

  function sanitizeText(value) {
    let output = value;
    if (userHome) {
      output = output.replace(
        new RegExp(`${escapeRegExp(userHome)}(?:/[^\\s\\x22'\\x60]+)?`, "g"),
        "/home/user/projeto",
      );
    }
    for (const { path, replacement } of paths) {
      output = output.replace(new RegExp(escapeRegExp(path), "g"), replacement);
    }
    output = output.replaceAll("/home/user/projeto/projeto", "/home/user/projeto");
    output = output.replace(
      /\/home\/user\/projeto\/(?:\.codex|\.claude(?:\.json)?)(?:\/[^\s"'`]+)?/g,
      "/home/user/projeto",
    );
    if (cwd) {
      output = output.replace(new RegExp(escapeRegExp(basename(cwd)), "g"), "projeto");
    }
    if (username && username.length > 1) {
      output = output.replace(new RegExp(escapeRegExp(username), "gi"), "user");
    }
    output = output
      .replace(/mcp__[^\s"'`,;]+/gi, "[ferramenta-mcp]")
      .replace(/\/tmp\/karont-recorder-[^\s"'`]+/g, "/tmp/arquivo-de-teste");
    return replaceIds(output)
      .replace(/\/home\/(?!user\/projeto(?:\/|$))[^/\s"'`]+/g, "/home/user/projeto")
      .replace(/\/Users\/(?!user\/projeto(?:\/|$))[^/\s"'`]+/g, "/Users/user/projeto")
      .replace(
        /(?:[A-Z]:\\Users\\)(?!user\\projeto(?:\\|$))[^\\\s"'`]+/gi,
        "C:\\Users\\user\\projeto",
      )
      .replace(/\b[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}\b/gi, "[e-mail]")
      .replace(/\bBearer\s+[A-Za-z0-9._~+/-]+=*/gi, "Bearer [token]")
      .replace(/\b(?:sk-proj-|sk-ant-|sk-)[A-Za-z0-9_-]{12,}\b/g, "[token]")
      .replace(/\b(?:gh[pousr]_|github_pat_|xox[baprs]-)[A-Za-z0-9_-]{8,}\b/g, "[token]")
      .replace(/\borg[-_][A-Za-z0-9_-]{6,}\b/gi, "org-[id]")
      .replace(/\b(?:acct|account|user)[-_][A-Za-z0-9_-]{8,}\b/gi, "[account-id]")
      .replace(/\beyJ[A-Za-z0-9_-]{20,}\.[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}\b/g, "[token]")
      .replace(/@/g, "[at]");
  }

  function sanitizeValue(value, key = "") {
    if (value === null || value === undefined) return value;
    if (
      /email|account|organization|(^|_)org(id|name)?$|user(id|name|email)|username|displayname|servername|hostname|authorization|token|secret|api.?key|codexhome/i.test(
        key,
      )
    ) {
      return "[redigido]";
    }
    if (typeof value === "string") return sanitizeText(value);
    if (Array.isArray(value)) {
      if (key === "tools") {
        return value
          .filter((tool) => {
            const name = typeof tool === "string" ? tool : tool?.name;
            return (
              !/^mcp__/i.test(name ?? "") &&
              !tool?.serverName &&
              !tool?.server_name &&
              !tool?.mcpServerName
            );
          })
          .map((tool) => sanitizeValue(tool));
      }
      return value.map((item) => sanitizeValue(item));
    }
    if (typeof value === "object") {
      return Object.fromEntries(
        Object.entries(value).map(([childKey, childValue]) => [
          childKey,
          sanitizeValue(childValue, childKey),
        ]),
      );
    }
    return value;
  }

  return (entry) => {
    let line = entry.line;
    try {
      line = JSON.stringify(sanitizeValue(JSON.parse(line)));
    } catch {
      line = sanitizeText(line);
    }
    return { ...entry, line };
  };
}

async function sanitizeExistingFixtures() {
  const fixtureRoot = join(projectRoot, "packages/service/src/agents/fixtures");
  let count = 0;
  for (const agent of ["claude", "codex"]) {
    const agentDir = join(fixtureRoot, agent);
    const files = (await readdir(agentDir)).filter((file) => file.endsWith(".jsonl"));
    for (const file of files) {
      const fixturePath = join(agentDir, file);
      const contents = await readFile(fixturePath, "utf8");
      const lines = contents.split(/\r?\n/);
      if (lines.at(-1) === "") lines.pop();
      const sanitizer = createSanitizer({ cwd: "", username: basename(homedir()) });
      const sanitized = lines.map((line) => sanitizer(JSON.parse(line)));
      await writeFile(
        fixturePath,
        sanitized.map((entry) => JSON.stringify(entry)).join("\n") + (sanitized.length ? "\n" : ""),
      );
      count += 1;
    }
  }
  console.log(`fixtures JSONL sanitizadas novamente: ${count}`);
}

function unavailableClaudeHeadlessTool(scenario, entries) {
  const toolName =
    scenario === "pergunta" ? "AskUserQuestion" : scenario === "plano" ? "ExitPlanMode" : "";
  if (!toolName) return "";
  const initEntry = entries.find((entry) => {
    try {
      const message = JSON.parse(entry.line);
      return message.type === "system" && message.subtype === "init";
    } catch {
      return false;
    }
  });
  if (!initEntry) return "";
  const init = JSON.parse(initEntry.line);
  const tools = (init.tools ?? []).map((tool) => (typeof tool === "string" ? tool : tool.name));
  return tools.includes(toolName)
    ? ""
    : `${toolName} não foi anunciada em system.init.tools na execução headless -p`;
}

function fixtureNameFor(agent, scenario) {
  if (scenario !== "comando-permitido") return scenario;
  if (
    (agent === "claude" && process.env.KARONT_RECORDER_CLAUDE_PERMISSION === "always") ||
    (agent === "codex" && process.env.KARONT_RECORDER_CODEX_PERMISSION === "session")
  ) {
    return "comando-permitir-sempre";
  }
  return scenario;
}

function scenarioEvidenceError(agent, scenario, entries) {
  const rows = entries.flatMap((entry) => {
    try {
      return [{ entry, message: JSON.parse(entry.line) }];
    } catch {
      return [];
    }
  });
  const hasClaudeToolUse = (name) =>
    rows.some(
      ({ message }) =>
        message?.type === "assistant" &&
        (message.message?.content ?? []).some(
          (item) => item?.type === "tool_use" && item.name === name,
        ),
    );
  const hasClaudeControl = (toolName, behavior) => {
    const requests = rows.filter(
      ({ message }) =>
        message?.type === "control_request" &&
        message.request?.subtype === "can_use_tool" &&
        message.request?.tool_name === toolName,
    );
    return requests.some(({ message: request }) =>
      rows.some(
        ({ entry, message }) =>
          entry.direction === "out" &&
          message?.type === "control_response" &&
          message.response?.request_id === request.request_id &&
          message.response?.response?.behavior === behavior,
      ),
    );
  };
  const hasClaudePersistentPermission = () => {
    const requests = rows.filter(
      ({ message }) =>
        message?.type === "control_request" &&
        message.request?.subtype === "can_use_tool" &&
        message.request?.tool_name === "Bash",
    );
    return requests.some(({ message: request }) => {
      const suggested = (request.request?.permission_suggestions ?? []).length > 0;
      return (
        suggested &&
        rows.some(
          ({ entry, message }) =>
            entry.direction === "out" &&
            message?.type === "control_response" &&
            message.response?.request_id === request.request_id &&
            message.response?.response?.behavior === "allow" &&
            (message.response?.response?.updatedPermissions ?? []).length > 0,
        )
      );
    });
  };
  const hasClaudeQuestionAnswer = rows.some(({ entry, message }) => {
    if (entry.direction !== "out" || message?.type !== "control_response") return false;
    const response = message.response?.response ?? {};
    return (
      response.behavior === "allow" && Object.keys(response.updatedInput?.answers ?? {}).length > 0
    );
  });
  const hasCodexRequest = (method) =>
    rows.some(({ entry, message }) => entry.direction === "in" && message?.method === method);
  const hasCodexResponse = (method, predicate) => {
    const requests = rows.filter(
      ({ entry, message }) =>
        entry.direction === "in" && message?.method === method && Object.hasOwn(message, "id"),
    );
    return requests.some(({ message: request }) =>
      rows.some(
        ({ entry, message }) =>
          entry.direction === "out" &&
          String(message?.id) === String(request.id) &&
          Object.hasOwn(message, "result") &&
          predicate(message.result ?? {}),
      ),
    );
  };
  const hasCodexApproval = (decision) => {
    const commandPredicate =
      decision === "allow"
        ? (result) => ["accept", "acceptForSession"].includes(result.decision)
        : (result) => ["decline", "cancel"].includes(result.decision);
    if (hasCodexResponse("item/commandExecution/requestApproval", commandPredicate)) return true;
    if (
      hasCodexResponse("execCommandApproval", (result) =>
        decision === "allow" ? result.decision === "approved" : result.decision === "abort",
      )
    ) {
      return true;
    }
    return hasCodexResponse("item/permissions/requestApproval", (result) => {
      const permissions = result.permissions ?? {};
      return decision === "allow"
        ? Object.keys(permissions).length > 0
        : Object.keys(permissions).length === 0;
    });
  };
  const hasCodexPlanApprovalTurn = () => {
    const planIndex = rows.findIndex(
      ({ entry, message }) =>
        entry.direction === "in" && message?.params?.threadId && codexHasPlanSnapshot(message),
    );
    return (
      planIndex >= 0 &&
      rows
        .slice(planIndex + 1)
        .some(
          ({ entry, message }) =>
            entry.direction === "out" &&
            message?.method === "turn/start" &&
            /aprovad/i.test(JSON.stringify(message.params?.input ?? "")),
        )
    );
  };
  const hasCodexCompletedTasksAfterApproval = () => {
    const planIndex = rows.findIndex(
      ({ entry, message }) =>
        entry.direction === "in" && message?.params?.threadId && codexHasPlanSnapshot(message),
    );
    if (planIndex < 0) return false;
    const approvalIndex = rows.findIndex(
      ({ entry, message }, index) =>
        index > planIndex &&
        entry.direction === "out" &&
        message?.method === "turn/start" &&
        /aprovad/i.test(JSON.stringify(message.params?.input ?? "")),
    );
    if (approvalIndex < 0) return false;
    return rows
      .slice(approvalIndex + 1)
      .some(
        ({ entry, message }) =>
          entry.direction === "in" &&
          message?.params?.threadId &&
          codexHasTwoCompletedTasks(message),
      );
  };

  if (agent === "claude") {
    if (scenario === "texto" && !rows.some(({ message }) => message?.type === "stream_event")) {
      return "não houve deltas de texto (stream_event)";
    }
    if (scenario === "leitura" && !hasClaudeToolUse("Read")) {
      return "não houve chamada da ferramenta Read";
    }
    if (scenario === "comando-permitido" && !hasClaudeControl("Bash", "allow")) {
      return "não houve can_use_tool/Bash respondido com allow";
    }
    if (
      scenario === "comando-permitido" &&
      process.env.KARONT_RECORDER_CLAUDE_PERMISSION === "always" &&
      !hasClaudePersistentPermission()
    ) {
      return "não houve updatedPermissions com uma permission_suggestions recebida";
    }
    if (scenario === "comando-negado" && !hasClaudeControl("Bash", "deny")) {
      return "não houve can_use_tool/Bash respondido com deny";
    }
    if (
      scenario === "pergunta" &&
      (!hasClaudeControl("AskUserQuestion", "allow") || !hasClaudeQuestionAnswer)
    ) {
      return "não houve AskUserQuestion respondido pelo host";
    }
    if (scenario === "plano" && !hasClaudeControl("ExitPlanMode", "allow")) {
      return "não houve ExitPlanMode aprovado pelo host";
    }
    if (
      scenario === "tarefas" &&
      !(hasClaudeToolUse("TaskCreate") && hasClaudeToolUse("TaskUpdate"))
    ) {
      return "não houve TaskCreate e TaskUpdate";
    }
    if (scenario === "continuar") {
      const userMessages = rows.filter(
        ({ entry, message }) => entry.direction === "out" && message?.type === "user",
      );
      const results = rows.filter(({ message }) => message?.type === "result");
      if (
        userMessages.length < 2 ||
        results.length < 2 ||
        !/jatobá/i.test(results.at(-1)?.message?.result ?? "")
      ) {
        return "a retomada não confirmou a palavra da primeira mensagem";
      }
    }
    if (
      scenario === "parar" &&
      !rows.some(
        ({ entry, message }) =>
          entry.direction === "out" &&
          message?.type === "control_request" &&
          message.request?.subtype === "interrupt",
      )
    ) {
      return "não houve control_request/interrupt do host";
    }
  } else {
    if (scenario === "texto" && !hasCodexRequest("item/agentMessage/delta")) {
      return "não houve deltas item/agentMessage/delta";
    }
    if (
      scenario === "leitura" &&
      !rows.some(
        ({ message }) =>
          message?.method === "item/started" &&
          /README\.md/i.test(message.params?.item?.command ?? ""),
      )
    ) {
      return "não houve execução de leitura que mencione README.md";
    }
    if (scenario === "comando-permitido" && !hasCodexApproval("allow")) {
      return "não houve pedido de aprovação de comando aceito pelo host";
    }
    if (
      scenario === "comando-permitido" &&
      process.env.KARONT_RECORDER_CODEX_PERMISSION === "session" &&
      !(
        hasCodexResponse("item/commandExecution/requestApproval", (result) =>
          ["acceptForSession"].includes(result.decision),
        ) ||
        hasCodexResponse(
          "item/fileChange/requestApproval",
          (result) => result.decision === "acceptForSession",
        ) ||
        hasCodexResponse(
          "item/permissions/requestApproval",
          (result) =>
            result.scope === "session" && Object.keys(result.permissions ?? {}).length > 0,
        )
      )
    ) {
      return "não houve decisão de aprovação válida para a sessão";
    }
    if (scenario === "comando-negado" && !hasCodexApproval("deny")) {
      return "não houve pedido de aprovação de comando negado pelo host";
    }
    if (
      scenario === "pergunta" &&
      !hasCodexResponse("item/tool/requestUserInput", (result) => Object.hasOwn(result, "answers"))
    ) {
      return "não houve pedido estruturado de input respondido pelo host";
    }
    if (scenario === "plano" && !hasCodexPlanApprovalTurn()) {
      return "não houve item plan com dois passos seguido do turno de aprovação do host";
    }
    if (scenario === "tarefas" && !hasCodexCompletedTasksAfterApproval()) {
      return "não houve segundo turno após aprovação com item plan de duas tarefas concluídas";
    }
    if (scenario === "continuar") {
      const resumeIndex = rows.findIndex(
        ({ entry, message }) => entry.direction === "out" && message?.method === "thread/resume",
      );
      const resumedAnswer = rows
        .slice(resumeIndex + 1)
        .some(
          ({ message }) =>
            message?.method === "item/agentMessage/delta" &&
            /jatobá/i.test(message.params?.delta ?? ""),
        );
      if (resumeIndex < 0 || !resumedAnswer) {
        return "thread/resume não confirmou a palavra da primeira mensagem";
      }
    }
    if (
      scenario === "parar" &&
      !rows.some(
        ({ entry, message }) => entry.direction === "out" && message?.method === "turn/interrupt",
      )
    ) {
      return "não houve requisição turn/interrupt";
    }
  }
  return "";
}

async function prepareWorkspace() {
  const cwd = await mkdtemp(join(tmpdir(), "karont-recorder-"));
  await writeFile(
    join(cwd, "README.md"),
    "# Projeto de teste\n\nArquivo pequeno para gravação de protocolo.\n",
  );
  const git = spawn("git", ["init", "--quiet"], { cwd, stdio: "ignore" });
  await new Promise((resolveGit, rejectGit) => {
    git.once("error", rejectGit);
    git.once("exit", (code) =>
      code === 0 ? resolveGit() : rejectGit(new Error(`git init terminou com código ${code}`)),
    );
  });
  return cwd;
}

async function recordScenario(agent, scenario) {
  const timeoutMs = Number(process.env.KARONT_RECORDER_TIMEOUT_MS ?? defaultTimeoutMs);
  const outDir = resolve(process.env.KARONT_RECORDER_OUT_DIR ?? join(scriptDir, "out"));
  const fake = process.env.KARONT_RECORDER_FAKE === "1";
  const writeFakeFixture = fake && process.env.KARONT_RECORDER_WRITE_FAKE_FIXTURE === "1";
  const fixtureRoot = resolve(
    process.env.KARONT_RECORDER_FIXTURE_DIR ??
      join(projectRoot, "packages/service/src/agents/fixtures"),
  );
  const cwd = await prepareWorkspace();
  const missingCwd = join(cwd, "__karont_recorder_cwd_inexistente__");
  const probePath = join(tmpdir(), `karont-recorder-probe-${randomUUID()}`);
  const entries = [];
  const children = [];
  const record = (direction, line, stream) => {
    entries.push({ direction, stream, line, at: new Date().toISOString() });
  };
  const sessionId = scenario === "continuar" ? fakeUuid : randomUUID();
  const previousScenario = process.env.KARONT_RECORDER_SCENARIO;
  process.env.KARONT_RECORDER_SCENARIO = scenario;
  let error = "";
  let expectedError = false;
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    await Promise.race([
      agent === "claude"
        ? runClaudeConversation({
            scenario,
            cwd,
            missingCwd,
            record,
            timeoutMs,
            fake,
            sessionId,
            probePath,
            children,
          })
        : runCodex({ scenario, cwd, missingCwd, probePath, record, timeoutMs, fake, children }),
      new Promise((_, rejectTimeout) => {
        timer = setTimeout(() => rejectTimeout(new Error(`timeout de ${timeoutMs} ms`)), timeoutMs);
      }),
    ]);
  } catch (caught) {
    error = caught instanceof Error ? caught.message : String(caught);
  } finally {
    clearTimeout(timer);
    await Promise.all(
      children.map((child) => {
        if (spawnFailures.has(child) || child.exitCode !== null || child.signalCode !== null) {
          return Promise.resolve();
        }
        child.kill("SIGTERM");
        return waitForExit(child, 2_000);
      }),
    );
    if (previousScenario === undefined) delete process.env.KARONT_RECORDER_SCENARIO;
    else process.env.KARONT_RECORDER_SCENARIO = previousScenario;
    await mkdir(outDir, { recursive: true });
    const timestamp = new Date().toISOString().replace(/[:.]/g, "-");
    const rawPath = join(outDir, `${agent}-${scenario}-${timestamp}.raw.jsonl`);
    await writeFile(
      rawPath,
      entries.map((entry) => JSON.stringify(entry)).join("\n") + (entries.length ? "\n" : ""),
    );
    if (
      (!fake || (writeFakeFixture && process.env.KARONT_RECORDER_FIXTURE_DIR)) &&
      process.env.KARONT_RECORDER_NO_FIXTURE !== "1"
    ) {
      const sanitizer = createSanitizer({
        cwd,
        username: basename(homedir()),
        extraPaths: [
          { path: missingCwd, replacement: "/home/user/projeto" },
          { path: probePath, replacement: "/tmp/arquivo-de-teste" },
        ],
      });
      const sanitized = entries.map(sanitizer);
      const fixturePath = join(fixtureRoot, agent, `${fixtureNameFor(agent, scenario)}.jsonl`);
      await mkdir(join(fixtureRoot, agent), { recursive: true });
      await writeFile(
        fixturePath,
        sanitized.map((entry) => JSON.stringify(entry)).join("\n") + (sanitized.length ? "\n" : ""),
      );
    }
    await rm(probePath, { force: true });
    await rm(cwd, { recursive: true, force: true });
  }
  if (scenario === "erro") {
    expectedError =
      /\bENOENT\b/.test(error) || entries.some((entry) => /\bENOENT\b/.test(entry.line));
    if (!expectedError) error ||= "falha esperada de inicialização (ENOENT) não observada";
  } else {
    const evidenceError = scenarioEvidenceError(agent, scenario, entries);
    if (evidenceError) {
      const unsupported =
        agent === "claude" ? unavailableClaudeHeadlessTool(scenario, entries) : "";
      if (unsupported) error ||= unsupported;
      else error ||= evidenceError;
    }
  }
  const unavailable =
    agent === "claude" && error && !expectedError
      ? unavailableClaudeHeadlessTool(scenario, entries)
      : "";
  const status = unavailable ? "indisponível" : error && !expectedError ? "falhou" : "ok";
  const safeError = error
    ? createSanitizer({ cwd: "", username: basename(homedir()) })({
        direction: "error",
        line: error,
      }).line
    : "-";
  console.log(`${agent}/${scenario}: ${status}; linhas=${entries.length}; erro=${safeError}`);
  return status !== "falhou";
}

const [agent, selectedScenario = "all"] = process.argv.slice(2);
if (agent === "--sanitize-existing") {
  await sanitizeExistingFixtures();
} else if (
  !["claude", "codex"].includes(agent) ||
  (selectedScenario !== "all" && !scenarios.includes(selectedScenario))
) {
  usage();
  process.exitCode = 2;
} else {
  const selected = selectedScenario === "all" ? scenarios : [selectedScenario];
  let failed = 0;
  for (const scenario of selected) {
    if (!(await recordScenario(agent, scenario))) failed += 1;
  }
  if (failed) process.exitCode = 1;
}
