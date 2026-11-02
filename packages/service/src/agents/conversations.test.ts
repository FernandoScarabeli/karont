import assert from "node:assert/strict";
import type { ChildProcess, SpawnOptions } from "node:child_process";
import { EventEmitter } from "node:events";
import { mkdtemp } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { PassThrough } from "node:stream";
import { test } from "node:test";
import { fileURLToPath } from "node:url";
import type { AnyEvent, Conversation, MessagePart } from "@karont/contract";
import {
  addMessage,
  createConversation as createConversationRecord,
  getMessage,
  openDatabase,
  setAgentSession,
  setSetting,
} from "../db.ts";
import type { AdapterModelList } from "./adapter.ts";
import { AgentCliError, ClaudeAdapter } from "./claude-adapter.ts";
import { ConversationManager } from "./conversation-manager.ts";
import { createFakeClaudeSpawn, type FakeClaudeSpawn } from "./testing/fake-claude-process.ts";
import { generateConversationTitle, type TitleGeneratorOptions } from "./title-generator.ts";

const fixtureDir = new URL("./fixtures/claude/", import.meta.url);

type Harness = {
  manager: ConversationManager;
  db: ReturnType<typeof openDatabase>;
  events: AnyEvent[];
  subscribe(listener: (event: AnyEvent) => void): () => void;
  spawnArgs: string[][];
  claudeFake: FakeClaudeSpawn;
  close(): Promise<void>;
};

function createFakeTitleCli(output: string) {
  let invocation: { command: string; args: string[]; cwd: string } | undefined;
  const spawn = ((command: string | URL, args: readonly string[] = [], options?: SpawnOptions) => {
    const emitter = new EventEmitter();
    const stdout = new PassThrough();
    const stderr = new PassThrough();
    const child = Object.assign(emitter, {
      stdout,
      stderr,
      stdin: null,
      kill: () => {
        queueMicrotask(() => emitter.emit("close", null, "SIGKILL"));
        return true;
      },
    }) as unknown as ChildProcess;
    invocation = {
      command: String(command),
      args: [...args],
      cwd: String(options?.cwd ?? ""),
    };
    queueMicrotask(() => {
      stdout.write(output);
      stdout.end();
      stderr.end();
      emitter.emit("close", 0, null);
    });
    return child;
  }) as NonNullable<TitleGeneratorOptions["spawn"]>;
  return { spawn, getInvocation: () => invocation };
}

async function createHarness(
  scenario: string,
  extraEnv: NodeJS.ProcessEnv = {},
  fakeOptions: {
    exitAfterResult?: boolean;
    planDecision?: "approve" | "adjust";
    titleGenerator?: (
      agent: Conversation["agent"],
      userMessage: string,
      agentResponse: string,
      options?: Pick<TitleGeneratorOptions, "codexModel" | "codexEffort">,
    ) => Promise<string | null>;
    codexModelCache?: AdapterModelList;
  } = {},
): Promise<Harness> {
  const root = await mkdtemp(path.join(os.tmpdir(), "karont-conversations-"));
  const db = openDatabase(path.join(root, "karont.db"));
  if (fakeOptions.codexModelCache) {
    setSetting(db, "agent.codex.models", {
      agent: "codex",
      ...fakeOptions.codexModelCache,
      fetchedAt: new Date().toISOString(),
    });
  }
  const events: AnyEvent[] = [];
  const listeners = new Set<(event: AnyEvent) => void>();
  const spawnArgs: string[][] = [];
  const fixturePath = fileURLToPath(new URL(`${scenario}.jsonl`, fixtureDir));
  const env = {
    ...process.env,
    ...extraEnv,
    KARONT_DISABLE_AGENT_DETECTION: "1",
    KARONT_CLAUDE_CLI: "claude",
  };
  const fakeSpawn = createFakeClaudeSpawn(fixturePath, fakeOptions);
  const manager = new ConversationManager({
    db,
    env,
    broadcast: async (event) => {
      events.push(event);
      for (const listener of listeners) listener(event);
    },
    adapterFactory: (_conversation, emit) =>
      new ClaudeAdapter(emit, {
        env,
        spawn: (command, args, options) => {
          spawnArgs.push(args);
          return fakeSpawn(command, args, options);
        },
      }),
    ...(fakeOptions.titleGenerator ? { titleGenerator: fakeOptions.titleGenerator } : {}),
  });
  return {
    manager,
    db,
    events,
    subscribe: (listener) => {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    spawnArgs,
    claudeFake: fakeSpawn,
    close: async () => {
      await manager.close();
      db.close();
    },
  };
}

function createConversation(
  manager: ConversationManager,
  mode: Conversation["mode"] = "edit",
): Conversation {
  return manager.create({ agent: "claude", title: "Conversa de teste", cwd: os.tmpdir(), mode });
}

async function waitForState(
  harness: Harness,
  id: string,
  state: Conversation["state"],
): Promise<void> {
  const current = harness.manager.get(id)?.conversation.state;
  if (current === state) return;
  await new Promise<void>((resolve, reject) => {
    const remove = harness.subscribe((event) => {
      if (
        event.event === "conversation.stateChanged" &&
        event.payload.conversation.id === id &&
        event.payload.conversation.state === state
      ) {
        clearTimeout(timer);
        remove();
        resolve();
      }
    });
    const timer = setTimeout(() => {
      const snapshot = harness.manager.get(id);
      remove();
      reject(
        new Error(
          `Timeout esperando estado ${state}; estado atual=${snapshot?.conversation.state}; mensagens=${JSON.stringify(snapshot?.messages)}; eventos=${harness.events.map((event) => event.event).join(",")}`,
        ),
      );
    }, 5_000);
  });
}

async function waitForPart(
  harness: Harness,
  id: string,
  predicate: (part: MessagePart) => boolean,
): Promise<MessagePart> {
  const existing = harness.manager
    .get(id)
    ?.messages.flatMap((message) => message.parts)
    .find(predicate);
  if (existing) return existing;
  return new Promise((resolve, reject) => {
    const remove = harness.subscribe((event) => {
      if (
        event.event !== "conversation.partUpdated" ||
        event.payload.conversationId !== id ||
        event.payload.kind !== "upsert" ||
        !predicate(event.payload.part)
      )
        return;
      clearTimeout(timeout);
      remove();
      resolve(event.payload.part);
    });
    const timeout = setTimeout(() => {
      remove();
      reject(new Error("Timeout esperando parte da mensagem."));
    }, 5_000);
  });
}

function latestAgent(harness: Harness, id: string) {
  return [...(harness.manager.get(id)?.messages ?? [])]
    .reverse()
    .find((message) => message.author === "agent");
}

test("Claude transmite texto em deltas e converte leitura em ação", async () => {
  const harness = await createHarness("leitura");
  try {
    const conversation = createConversation(harness.manager);
    await harness.manager.send(conversation.id, "Leia o README.");
    await waitForState(harness, conversation.id, "idle");
    const deltas = harness.events.filter(
      (event) => event.event === "conversation.partUpdated" && event.payload.kind === "delta",
    );
    assert.ok(
      deltas.some(
        (event) =>
          event.event === "conversation.partUpdated" &&
          event.payload.kind === "delta" &&
          event.payload.delta.length > 0,
      ),
    );
    const message = latestAgent(harness, conversation.id);
    assert.equal(message?.status, "done");
    assert.equal(typeof message?.startedAt, "number");
    assert.equal(typeof message?.endedAt, "number");
    assert.ok((message?.endedAt ?? 0) >= (message?.startedAt ?? 0));
    for (const part of message?.parts ?? []) {
      assert.equal(typeof part.startedAt, "number", `parte ${part.id} sem início registrado`);
      assert.equal(typeof part.endedAt, "number", `parte ${part.id} sem fim registrado`);
      assert.ok((part.endedAt ?? 0) >= (part.startedAt ?? 0));
    }
    assert.ok(
      message?.parts.some(
        (part) =>
          part.type === "action" &&
          part.actionType === "read" &&
          part.title.includes("README.md") &&
          part.state === "ok",
      ),
    );
    assert.ok(
      message?.parts.some((part) => part.type === "text" && part.markdown.includes("README")),
    );
  } finally {
    await harness.close();
  }
});

test("Claude registra diff, subagente com ações filhas e resultado MCP", async () => {
  const harness = await createHarness("acoes-especiais");
  try {
    const conversation = createConversation(harness.manager);
    await harness.manager.send(conversation.id, "Registre ações especiais");
    await waitForState(harness, conversation.id, "idle");

    const actions =
      latestAgent(harness, conversation.id)?.parts.filter(
        (part): part is Extract<MessagePart, { type: "action" }> => part.type === "action",
      ) ?? [];
    const subagent = actions.find((action) => String(action.actionType) === "subagent");
    const childRead = actions.find((action) => action.title === "Read · src/modulo.ts");
    assert.ok(subagent);
    assert.equal(subagent.title, "Revisar o módulo");
    assert.equal(subagent.input, "Leia o módulo e registre os achados.");
    assert.ok(childRead);
    assert.equal(childRead.parentId, subagent.id);

    const edit = actions.find((action) => action.title.startsWith("Edit ·"));
    const multiEdit = actions.find((action) => action.title.startsWith("MultiEdit ·"));
    const write = actions.find((action) => action.title.startsWith("Write ·"));
    assert.equal(edit?.actionType, "edit");
    assert.equal(multiEdit?.actionType, "edit");
    assert.equal(write?.actionType, "write");
    assert.ok(edit);
    assert.ok(multiEdit);
    assert.ok(write);
    const editRecord = JSON.parse(edit.output) as Array<{
      path: string;
      kind: unknown;
      diff: string;
    }>;
    const multiEditRecord = JSON.parse(multiEdit.output) as Array<{
      path: string;
      kind: unknown;
      diff: string;
    }>;
    const writeRecord = JSON.parse(write.output) as Array<{
      path: string;
      kind: unknown;
      diff: string;
    }>;
    assert.deepEqual(
      editRecord.map(({ path, kind }) => ({ path, kind })),
      [{ path: "src/modulo.ts", kind: { type: "update" } }],
    );
    assert.match(editRecord[0]?.diff ?? "", /-const antigo = 1;/);
    assert.match(editRecord[0]?.diff ?? "", /\+const novo = 2;/);
    assert.doesNotMatch(multiEditRecord[0]?.diff ?? "", /^@@ /m);
    assert.match(multiEditRecord[0]?.diff ?? "", /\+1º/);
    assert.deepEqual(
      writeRecord.map(({ path, kind }) => ({ path, kind })),
      [{ path: "docs/novo.md", kind: { type: "add" } }],
    );
    assert.match(writeRecord[0]?.diff ?? "", /\+linha um\n\+linha dois/);

    const mcp = actions.find((action) => String(action.actionType) === "mcp");
    assert.ok(mcp);
    assert.equal(mcp.server, "docs");
    assert.equal(mcp.tool, "lookup");
    assert.deepEqual(JSON.parse(mcp.input), { query: "guia de instalação", limit: 2 });
    assert.equal(mcp.output, "Dois resultados");
  } finally {
    await harness.close();
  }
});

test("Claude 2.1.x chama o subagente de Agent: ações filhas ficam aninhadas e eventos task_* não viram ações", async () => {
  const harness = await createHarness("subagente-agent");
  try {
    const conversation = createConversation(harness.manager);
    await harness.manager.send(conversation.id, "Liste os arquivos do projeto.");
    await waitForState(harness, conversation.id, "idle");

    const actions =
      latestAgent(harness, conversation.id)?.parts.filter(
        (part): part is Extract<MessagePart, { type: "action" }> => part.type === "action",
      ) ?? [];
    assert.equal(actions.length, 2);
    const subagent = actions.find((action) => String(action.actionType) === "subagent");
    assert.ok(subagent);
    assert.equal(subagent.title, "Listar arquivos do projeto");
    assert.match(subagent.input, /^Explore · Liste todos os arquivos deste projeto/);
    assert.equal(
      subagent.output,
      "package.json,src/carrinho.js,src/desconto.js,test/carrinho.test.js,test/desconto.test.js",
    );
    assert.equal(subagent.state, "ok");

    const childBash = actions.find((action) => action.actionType === "command");
    assert.ok(childBash);
    assert.equal(childBash.parentId, subagent.id);
    assert.equal(
      actions.some((action) => action.actionType === "other"),
      false,
    );
  } finally {
    await harness.close();
  }
});

test("fluxo da UI create + send gera e transmite título após resposta concluída", async () => {
  let captured: { agent: string; userMessage: string; agentResponse: string } | undefined;
  const titleCli = createFakeTitleCli('### **Título:** `"Karont: app desktop de chat"`\n');
  const titleLogs: string[] = [];
  const harness = await createHarness(
    "texto",
    {},
    {
      titleGenerator: async (agent, userMessage, agentResponse) => {
        captured = { agent, userMessage, agentResponse };
        assert.equal(agent, "claude");
        return generateConversationTitle("claude", userMessage, agentResponse, {
          env: { ...process.env, KARONT_CLAUDE_CLI: "fake-title-cli" },
          spawn: titleCli.spawn,
          logger: { error: (message) => titleLogs.push(message) },
        });
      },
    },
  );
  try {
    const conversation = harness.manager.create({
      agent: "claude",
      title: "Nova conversa",
      cwd: os.tmpdir(),
      mode: "edit",
    });
    assert.equal(conversation.title, "Nova conversa");
    await harness.manager.send(conversation.id, "P".repeat(1_100));
    await waitForState(harness, conversation.id, "idle");
    for (
      let attempt = 0;
      attempt < 100 && harness.manager.get(conversation.id)?.conversation.title === "Nova conversa";
      attempt += 1
    ) {
      await new Promise((resolve) => setTimeout(resolve, 10));
    }

    const updated = harness.manager.get(conversation.id)?.conversation;
    assert.equal(captured?.agent, "claude");
    assert.equal(captured?.userMessage.length, 1_000);
    assert.ok(captured?.agentResponse.startsWith("Oi!"));
    assert.equal(updated?.title, "Karont: app desktop de chat");
    assert.ok(titleCli.getInvocation()?.args.at(-1)?.includes("P".repeat(1_000)));
    assert.deepEqual(titleLogs, []);
    assert.ok(
      harness.events.some(
        (event) =>
          event.event === "conversation.stateChanged" &&
          event.payload.conversation.id === conversation.id &&
          "messageStatus" in event.payload &&
          event.payload.messageStatus === "done",
      ),
    );
    assert.ok(
      harness.events.some(
        (event) =>
          event.event === "conversation.stateChanged" &&
          event.payload.conversation.id === conversation.id &&
          event.payload.conversation.title === "Karont: app desktop de chat",
      ),
    );
  } finally {
    await harness.close();
  }
});

test("não substitui o título quando a pessoa renomeia durante a geração", async () => {
  let resolveTitle: ((title: string | null) => void) | undefined;
  const harness = await createHarness(
    "texto",
    {},
    {
      titleGenerator: () =>
        new Promise((resolve) => {
          resolveTitle = resolve;
        }),
    },
  );
  try {
    const conversation = harness.manager.create({
      agent: "claude",
      title: "Nova conversa",
      cwd: os.tmpdir(),
      mode: "edit",
    });
    await harness.manager.send(conversation.id, "Me ajuda com esse código.");
    await waitForState(harness, conversation.id, "idle");
    for (let attempt = 0; attempt < 100 && !resolveTitle; attempt += 1) {
      await new Promise((resolve) => setTimeout(resolve, 10));
    }
    assert.equal(typeof resolveTitle, "function");
    await harness.manager.rename(conversation.id, "Título escolhido por mim");
    resolveTitle?.("Título automático curto");
    await new Promise((resolve) => setTimeout(resolve, 20));
    assert.equal(
      harness.manager.get(conversation.id)?.conversation.title,
      "Título escolhido por mim",
    );
  } finally {
    await harness.close();
  }
});

test("Codex escolhe um modelo econômico disponível com esforço mínimo para o título", async () => {
  let capturedOptions: Pick<TitleGeneratorOptions, "codexModel" | "codexEffort"> | undefined;
  const harness = await createHarness(
    "texto",
    {},
    {
      codexModelCache: {
        models: [
          {
            id: "codex-standard",
            name: "Codex Standard",
            efforts: ["low", "medium"],
            defaultEffort: "medium",
          },
          {
            id: "codex-small",
            name: "Codex Small",
            efforts: ["low"],
            defaultEffort: "low",
          },
          {
            id: "codex-mini-available",
            name: "Codex Mini",
            efforts: ["low", "high"],
            defaultEffort: "low",
          },
          {
            id: "codex-nano-available",
            name: "Codex Nano",
            efforts: ["low"],
            defaultEffort: "low",
          },
        ],
        efforts: ["low", "medium", "high"],
      },
      titleGenerator: async (_agent, _userMessage, _agentResponse, options) => {
        capturedOptions = options;
        return "Título do Codex";
      },
    },
  );
  try {
    const conversation = harness.manager.create({
      agent: "codex",
      title: "Nova conversa",
      cwd: os.tmpdir(),
      mode: "edit",
    });
    await harness.manager.send(conversation.id, "Ajude com o projeto.");
    await waitForState(harness, conversation.id, "idle");
    for (
      let attempt = 0;
      attempt < 100 && harness.manager.get(conversation.id)?.conversation.title === "Nova conversa";
      attempt += 1
    ) {
      await new Promise((resolve) => setTimeout(resolve, 10));
    }

    assert.equal(capturedOptions?.codexModel, "codex-nano-available");
    assert.equal(capturedOptions?.codexEffort, "low");
    assert.equal(harness.manager.get(conversation.id)?.conversation.title, "Título do Codex");
  } finally {
    await harness.close();
  }
});

test("permissões permitem uma vez, sempre com sugestão real e negam", async (t) => {
  for (const scenario of [
    "comando-permitido",
    "comando-permitir-sempre",
    "comando-negado",
  ] as const) {
    await t.test(scenario, async () => {
      const harness = await createHarness(scenario);
      try {
        const conversation = createConversation(harness.manager);
        await harness.manager.send(conversation.id, "Execute o pedido.");
        const permission = await waitForPart(
          harness,
          conversation.id,
          (part) => part.type === "permission" && part.state === "pending",
        );
        if (scenario === "comando-permitido") {
          assert.ok(
            permission.type === "permission" &&
              permission.summary === "touch .karont-approval-probe && ls" &&
              permission.description === "Create probe file in project folder and list contents",
          );
          const waitingAction = latestAgent(harness, conversation.id)?.parts.find(
            (part) => part.type === "action" && part.actionType === "command",
          );
          assert.equal(
            waitingAction?.type === "action" ? waitingAction.state : undefined,
            "waiting",
          );
        }
        const decision =
          scenario === "comando-permitir-sempre"
            ? "always"
            : scenario === "comando-negado"
              ? "deny"
              : "allow";
        await harness.manager.respond(conversation.id, permission.id, {
          responseType: "permission",
          decision,
        });
        await waitForState(harness, conversation.id, "idle");
        const finalPart = latestAgent(harness, conversation.id)?.parts.find(
          (part) => part.id === permission.id,
        );
        assert.equal(
          finalPart?.type === "permission" ? finalPart.state : undefined,
          decision === "deny" ? "denied" : "allowed",
        );
        assert.equal(typeof finalPart?.startedAt, "number");
        assert.equal(typeof finalPart?.endedAt, "number");
        assert.ok((finalPart?.endedAt ?? 0) >= (finalPart?.startedAt ?? 0));
        if (scenario === "comando-permitido") {
          const action = latestAgent(harness, conversation.id)?.parts.find(
            (part) => part.type === "action" && part.actionType === "command",
          );
          assert.equal(action?.type === "action" ? action.state : undefined, "ok");
        }
      } finally {
        await harness.close();
      }
    });
  }
});

test("modo Só leitura limita ferramentas e nega automaticamente comandos", async () => {
  const harness = await createHarness("comando-negado");
  try {
    const conversation = createConversation(harness.manager, "read-only");
    await harness.manager.send(conversation.id, "Tente rodar um comando.");
    await waitForState(harness, conversation.id, "idle");
    const args = harness.spawnArgs[0] ?? [];
    const toolList = args[args.indexOf("--tools") + 1] ?? "";
    assert.ok(args.includes("dontAsk"));
    assert.equal(toolList.includes("Bash"), false);
    assert.equal(
      latestAgent(harness, conversation.id)?.parts.some((part) => part.type === "permission"),
      false,
    );
    assert.ok(
      latestAgent(harness, conversation.id)?.parts.some(
        (part) => part.type === "action" && part.actionType === "command" && part.state === "error",
      ),
    );
  } finally {
    await harness.close();
  }
});

test("pergunta e plano aguardam decisão do usuário", async (t) => {
  await t.test("pergunta", async () => {
    const harness = await createHarness("pergunta");
    try {
      const conversation = createConversation(harness.manager, "read-only");
      await harness.manager.send(conversation.id, "Faça uma pergunta.");
      const question = await waitForPart(
        harness,
        conversation.id,
        (part) => part.type === "question" && part.state === "pending",
      );
      if (question.type !== "question") throw new Error("Fixture esperava uma parte de pergunta.");
      assert.ok(
        harness.spawnArgs[0]?.some((argument) => argument.includes("AskUserQuestion,ExitPlanMode")),
      );
      assert.equal(question.questions[0]?.options.length, 2);
      await harness.manager.respond(conversation.id, question.id, {
        responseType: "question",
        answers: { "0": ["A"] },
      });
      await waitForState(harness, conversation.id, "idle");
      const questionResponse = harness.claudeFake.controlResponses.find((entry) => {
        const response = entry.response as { updatedInput?: { answers?: unknown } } | undefined;
        return response?.updatedInput?.answers !== undefined;
      });
      assert.deepEqual(
        (
          questionResponse?.response as
            | { updatedInput?: { answers?: Record<string, string> } }
            | undefined
        )?.updatedInput?.answers,
        { "Você prefere A ou B?": "A" },
      );
      const answered = latestAgent(harness, conversation.id)?.parts.find(
        (part) => part.id === question.id,
      );
      assert.equal(answered?.type === "question" ? answered.state : undefined, "answered");
      assert.equal(typeof answered?.startedAt, "number");
      assert.equal(typeof answered?.endedAt, "number");
      assert.ok((answered?.endedAt ?? 0) >= (answered?.startedAt ?? 0));
    } finally {
      await harness.close();
    }
  });
  await t.test("plano", async () => {
    const harness = await createHarness("plano");
    try {
      const conversation = createConversation(harness.manager);
      await harness.manager.send(conversation.id, "Planeje.", true);
      const plan = await waitForPart(
        harness,
        conversation.id,
        (part) => part.type === "plan" && part.state === "pending",
      );
      await waitForState(harness, conversation.id, "waiting");
      await harness.manager.respond(conversation.id, plan.id, {
        responseType: "plan",
        decision: "approve",
      });
      await waitForState(harness, conversation.id, "idle");
      assert.ok(
        latestAgent(harness, conversation.id)?.parts.some(
          (part) => part.type === "plan" && part.state === "approved",
        ),
      );
      const permissionModeIndex = harness.spawnArgs[0]?.indexOf("--permission-mode") ?? -1;
      assert.equal(harness.spawnArgs[0]?.[permissionModeIndex + 1], "plan");
      assert.deepEqual(harness.claudeFake.controlRequests, [
        { subtype: "set_permission_mode", mode: "acceptEdits" },
      ]);
    } finally {
      await harness.close();
    }
  });

  await t.test("ajustar mantém o modo plano e envia o comentário ao Claude", async () => {
    const harness = await createHarness("plano", {}, { planDecision: "adjust" });
    try {
      const conversation = createConversation(harness.manager);
      await harness.manager.send(conversation.id, "Planeje.", true);
      const plan = await waitForPart(
        harness,
        conversation.id,
        (part) => part.type === "plan" && part.state === "pending",
      );
      await waitForState(harness, conversation.id, "waiting");
      const comment = "Inclua a validação do resultado como segundo passo.";
      await harness.manager.respond(conversation.id, plan.id, {
        responseType: "plan",
        decision: "reject",
        comment,
      });
      const revisedPlan = await waitForPart(
        harness,
        conversation.id,
        (part) => part.type === "plan" && part.state === "pending" && part.id !== plan.id,
      );
      assert.equal(revisedPlan.type, "plan");
      await waitForState(harness, conversation.id, "waiting");
      const rejectedPlan = latestAgent(harness, conversation.id)?.parts.find(
        (part) => part.id === plan.id,
      );
      assert.equal(rejectedPlan?.type === "plan" ? rejectedPlan.state : undefined, "rejected");
      const response = harness.claudeFake.controlResponses.at(-1)?.response as
        | { behavior?: string; message?: string }
        | undefined;
      assert.equal(response?.behavior, "deny");
      assert.equal(response?.message, comment);
      assert.deepEqual(harness.claudeFake.controlRequests, []);
    } finally {
      await harness.close();
    }
  });
});

test("TaskCreate/TaskUpdate mantêm uma parte de tarefas atualizada", async () => {
  const harness = await createHarness("tarefas");
  try {
    const conversation = createConversation(harness.manager);
    await harness.manager.send(conversation.id, "Crie tarefas.");
    await waitForState(harness, conversation.id, "idle");
    const todos = latestAgent(harness, conversation.id)?.parts.filter(
      (part) => part.type === "todos",
    );
    assert.equal(todos?.length, 1);
    assert.equal(todos?.[0]?.type === "todos" ? todos[0].items.length : 0, 2);
    assert.ok(
      todos?.[0]?.type === "todos" && todos[0].items.every((item) => item.state === "done"),
    );
  } finally {
    await harness.close();
  }
});

test("retomada usa --resume; interrupção usa o protocolo e mantém mensagem interrompida", async (t) => {
  await t.test("resume", async () => {
    const harness = await createHarness("continuar");
    try {
      const conversation = createConversation(harness.manager);
      setAgentSession(harness.db, conversation.id, "00000000-0000-4000-8000-000000000003");
      await harness.manager.send(conversation.id, "Continue.");
      await waitForState(harness, conversation.id, "idle");
      assert.ok(harness.spawnArgs[0]?.includes("--resume"));
      assert.equal(latestAgent(harness, conversation.id)?.status, "done");
    } finally {
      await harness.close();
    }
  });
  await t.test("parar", async () => {
    const harness = await createHarness("parar");
    try {
      const conversation = createConversation(harness.manager);
      await harness.manager.send(conversation.id, "Resposta longa.");
      await waitForPart(
        harness,
        conversation.id,
        (part) => part.type === "text" && part.markdown.length > 0,
      );
      assert.equal(await harness.manager.stop(conversation.id), true);
      await waitForState(harness, conversation.id, "idle");
      assert.equal(latestAgent(harness, conversation.id)?.status, "interrupted");
      assert.ok(
        latestAgent(harness, conversation.id)?.parts.some(
          (part) => part.type === "error" && part.errorType === "interrupted",
        ),
      );
    } finally {
      await harness.close();
    }
  });
});

test("CLI ausente gera erro retryable e o reinício marca streaming como interrupted", async (t) => {
  await t.test("erro", async () => {
    const harness = await createHarness("erro");
    try {
      const conversation = createConversation(harness.manager);
      await harness.manager.send(conversation.id, "Olá.");
      await waitForState(harness, conversation.id, "error");
      const failedMessage = latestAgent(harness, conversation.id);
      assert.equal(typeof failedMessage?.startedAt, "number");
      assert.equal(typeof failedMessage?.endedAt, "number");
      const error = failedMessage?.parts.find((part) => part.type === "error");
      assert.ok(error?.type === "error");
      assert.equal(error.startedAt, error.endedAt);
      assert.ok(error.type === "error" && error.errorType === "cli-not-found" && error.retryable);
    } finally {
      await harness.close();
    }
  });
  await t.test("serviço reiniciado", async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), "karont-restart-"));
    const dbPath = path.join(root, "karont.db");
    let db = openDatabase(dbPath);
    const conversation = createConversationRecord(db, {
      agent: "claude",
      title: "Interrompida",
      cwd: os.tmpdir(),
      mode: "edit",
    });
    const message = {
      id: "message-streaming",
      conversationId: conversation.id,
      author: "agent" as const,
      status: "streaming" as const,
      parts: [],
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    };
    addMessage(db, message);
    db.close();
    db = openDatabase(dbPath);
    const recovered = getMessage(db, message.id);
    assert.equal(recovered?.status, "interrupted");
    assert.ok(recovered?.parts.some((part) => part.type === "error" && part.retryable));
    db.close();
  });
});

test("processo da CLI fecha por ociosidade e próxima mensagem retoma a sessão", async () => {
  const harness = await createHarness("texto", { KARONT_AGENT_IDLE_MS: "20" });
  try {
    const conversation = createConversation(harness.manager);
    await harness.manager.send(conversation.id, "Primeira.");
    await waitForState(harness, conversation.id, "idle");
    await new Promise((resolve) => setTimeout(resolve, 80));
    await harness.manager.send(conversation.id, "Segunda.");
    await waitForState(harness, conversation.id, "idle");
    assert.equal(harness.spawnArgs.length, 2);
    assert.ok(harness.spawnArgs[1]?.includes("--resume"));
  } finally {
    await harness.close();
  }
});

test("se a CLI fechar após um turno, o adaptador abre outra com --resume", async () => {
  const harness = await createHarness("texto", {}, { exitAfterResult: true });
  try {
    const conversation = createConversation(harness.manager);
    await harness.manager.send(conversation.id, "Primeira.");
    await waitForState(harness, conversation.id, "idle");
    await new Promise((resolve) => setTimeout(resolve, 20));
    await harness.manager.send(conversation.id, "Segunda.");
    await waitForState(harness, conversation.id, "idle");
    assert.equal(harness.spawnArgs.length, 2);
    assert.ok(harness.spawnArgs[1]?.includes("--resume"));
  } finally {
    await harness.close();
  }
});

test("setOptions reabre a sessão com novas flags de acesso, modelo e esforço", async () => {
  const harness = await createHarness("texto");
  try {
    const conversation = createConversation(harness.manager);
    await harness.manager.send(conversation.id, "Primeira.");
    await waitForState(harness, conversation.id, "idle");
    await harness.manager.setOptions(conversation.id, {
      mode: "read-only",
      model: "haiku",
      effort: "low",
    });
    await harness.manager.send(conversation.id, "Segunda.");
    await waitForState(harness, conversation.id, "idle");
    assert.equal(harness.spawnArgs.length, 2);
    assert.ok(harness.spawnArgs[1]?.includes("dontAsk"));
    assert.ok(harness.spawnArgs[1]?.includes("--tools"));
    assert.ok(harness.spawnArgs[1]?.includes("--model"));
    assert.ok(harness.spawnArgs[1]?.includes("haiku"));
    assert.ok(harness.spawnArgs[1]?.includes("--effort"));
    assert.ok(harness.spawnArgs[1]?.includes("low"));
    assert.ok(harness.spawnArgs[1]?.includes("--resume"));
  } finally {
    await harness.close();
  }
});

test("send usa Planejar salvo por setOptions quando não recebe substituição", async () => {
  const harness = await createHarness("texto");
  try {
    const conversation = harness.manager.create({
      agent: "claude",
      title: "Planejar persistido",
      cwd: os.tmpdir(),
      mode: "edit",
    });
    await harness.manager.setOptions(conversation.id, { plan: true });
    await harness.manager.send(conversation.id, "Planeje e aguarde.");
    await waitForState(harness, conversation.id, "idle");

    const permissionModeIndex = harness.spawnArgs[0]?.indexOf("--permission-mode") ?? -1;
    assert.equal(harness.spawnArgs[0]?.[permissionModeIndex + 1], "plan");
    assert.equal(harness.manager.get(conversation.id)?.conversation.plan, true);
  } finally {
    await harness.close();
  }
});

test("send aceita uma substituição explícita de Planejar sem mudar a preferência salva", async () => {
  const harness = await createHarness("texto");
  try {
    const conversation = harness.manager.create({
      agent: "claude",
      title: "Substituição do composer",
      cwd: os.tmpdir(),
      mode: "edit",
      plan: true,
    });
    await harness.manager.send(conversation.id, "Responda diretamente.", false);
    await waitForState(harness, conversation.id, "idle");

    const permissionModeIndex = harness.spawnArgs[0]?.indexOf("--permission-mode") ?? -1;
    assert.equal(harness.spawnArgs[0]?.[permissionModeIndex + 1], "acceptEdits");
    assert.equal(harness.manager.get(conversation.id)?.conversation.plan, true);
  } finally {
    await harness.close();
  }
});

test("ClaudeAdapter preserva nome do executável no erro de binário ausente", () => {
  const error = new AgentCliError("cli-not-found", "Claude Code não encontrado.");
  assert.equal(error.errorType, "cli-not-found");
});

test("Claude recebe anexos em blocos e a mensagem salva apenas metadados", async () => {
  const harness = await createHarness("texto");
  try {
    const conversation = createConversation(harness.manager);
    const imageData = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]).toString("base64");
    const attachments = [
      { name: "notas.md", mimeType: "text/markdown", kind: "text" as const, data: "Use `code`." },
      { name: "pixel.png", mimeType: "image/png", kind: "image" as const, data: imageData },
    ];
    const sent = await harness.manager.send(
      conversation.id,
      "Leia os arquivos.",
      false,
      attachments,
    );
    await waitForState(harness, conversation.id, "idle");

    const userLine = harness.claudeFake.messages.find((message) => message.type === "user");
    assert.ok(userLine);
    const content = (userLine.message as { content: unknown[] }).content;
    assert.deepEqual(content, [
      { type: "text", text: "Leia os arquivos." },
      {
        type: "text",
        text: "Arquivo anexado: notas.md\n\n```\nUse `code`.\n```",
      },
      {
        type: "image",
        source: { type: "base64", media_type: "image/png", data: imageData },
      },
    ]);

    assert.deepEqual(harness.manager.get(conversation.id)?.messages[0]?.attachments, [
      { name: "notas.md", mimeType: "text/markdown", kind: "text", sizeBytes: 11 },
      { name: "pixel.png", mimeType: "image/png", kind: "image", sizeBytes: 8 },
    ]);
    const persisted = getMessage(harness.db, sent.userMessage.id);
    assert.deepEqual(
      persisted?.attachments,
      harness.manager.get(conversation.id)?.messages[0]?.attachments,
    );
    const raw = harness.db
      .prepare("SELECT attachments_json FROM messages WHERE id=?")
      .get(sent.userMessage.id) as { attachments_json: string };
    assert.equal(raw.attachments_json.includes(imageData), false);
    assert.equal(raw.attachments_json.includes("Use `code`."), false);
  } finally {
    await harness.close();
  }
});
