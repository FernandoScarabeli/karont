import assert from "node:assert/strict";
import { mkdtemp } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";
import type { AnyEvent, Conversation, MessagePart } from "@karont/contract";
import {
  addMessage,
  createConversation as createConversationRecord,
  getMessage,
  openDatabase,
  setAgentSession,
} from "../db.ts";
import { AgentCliError, ClaudeAdapter } from "./claude-adapter.ts";
import { ConversationManager } from "./conversation-manager.ts";
import { createFakeClaudeSpawn, type FakeClaudeSpawn } from "./testing/fake-claude-process.ts";

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

async function createHarness(
  scenario: string,
  extraEnv: NodeJS.ProcessEnv = {},
  fakeOptions: { exitAfterResult?: boolean; planDecision?: "approve" | "adjust" } = {},
): Promise<Harness> {
  const root = await mkdtemp(path.join(os.tmpdir(), "karont-conversations-"));
  const db = openDatabase(path.join(root, "karont.db"));
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
        answers: { "Você prefere A ou B?": ["A"] },
      });
      await waitForState(harness, conversation.id, "idle");
      const answered = latestAgent(harness, conversation.id)?.parts.find(
        (part) => part.id === question.id,
      );
      assert.equal(answered?.type === "question" ? answered.state : undefined, "answered");
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
      assert.ok(
        latestAgent(harness, conversation.id)?.parts.some(
          (part) => part.type === "error" && part.errorType === "cli-not-found" && part.retryable,
        ),
      );
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

test("ClaudeAdapter preserva nome do executável no erro de binário ausente", () => {
  const error = new AgentCliError("cli-not-found", "Claude Code não encontrado.");
  assert.equal(error.errorType, "cli-not-found");
});
