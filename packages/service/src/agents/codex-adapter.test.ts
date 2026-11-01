import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
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
import { CodexAdapter } from "./codex-adapter.ts";
import { ConversationManager } from "./conversation-manager.ts";
import { createFakeCodexSpawn, type FakeCodexSpawn } from "./testing/fake-codex-process.ts";

const fixtureDir = new URL("./fixtures/codex/", import.meta.url);

type Harness = {
  manager: ConversationManager;
  db: ReturnType<typeof openDatabase>;
  events: AnyEvent[];
  fakes: FakeCodexSpawn[];
  subscribe(listener: (event: AnyEvent) => void): () => void;
  close(): Promise<void>;
};

async function createHarness(
  scenario: string,
  options: {
    mode?: Conversation["mode"];
    idleMs?: number;
    resumeExisting?: boolean;
    fakeError?: boolean;
  } = {},
): Promise<Harness> {
  const root = await mkdtemp(path.join(os.tmpdir(), "karont-codex-"));
  const db = openDatabase(path.join(root, "karont.db"));
  const events: AnyEvent[] = [];
  const listeners = new Set<(event: AnyEvent) => void>();
  const fakes: FakeCodexSpawn[] = [];
  const env: NodeJS.ProcessEnv = {
    ...process.env,
    KARONT_DISABLE_AGENT_DETECTION: "1",
    KARONT_CODEX_CLI: "codex",
    ...(options.idleMs === undefined ? {} : { KARONT_AGENT_IDLE_MS: String(options.idleMs) }),
  };
  const fixturePath = fileURLToPath(new URL(`${scenario}.jsonl`, fixtureDir));
  const manager = new ConversationManager({
    db,
    env,
    broadcast: async (event) => {
      events.push(event);
      for (const listener of listeners) listener(event);
    },
    adapterFactory: (_conversation, emit) =>
      new CodexAdapter(emit, {
        env,
        spawn: (command, args, spawnOptions) => {
          if (options.fakeError)
            throw Object.assign(new Error(`spawn ${command} ENOENT`), { code: "ENOENT" });
          const fake = createFakeCodexSpawn(fixturePath, {
            startAtResume:
              scenario === "continuar" && (options.resumeExisting === true || fakes.length > 0),
          });
          fakes.push(fake);
          return fake(command, args, spawnOptions);
        },
      }),
  });

  return {
    manager,
    db,
    events,
    fakes,
    subscribe: (listener) => {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    close: async () => {
      await manager.close();
      db.close();
    },
  };
}

function createConversation(
  manager: ConversationManager,
  mode: Conversation["mode"] = "read-only",
): Conversation {
  return manager.create({
    agent: "codex",
    title: "Conversa de teste",
    cwd: "/home/user/projeto",
    mode,
  });
}

function fixturePrompt(scenario: string, index = 0): string {
  const records = readFileSync(new URL(`${scenario}.jsonl`, fixtureDir), "utf8")
    .split(/\r?\n/)
    .filter(Boolean)
    .map((line) => JSON.parse(line) as { direction: string; stream: string; line: string });
  const prompts = records.flatMap((record) => {
    if (record.direction !== "out" || record.stream !== "stdin") return [];
    const request = JSON.parse(record.line) as {
      method?: string;
      params?: { input?: { text?: string }[] };
    };
    return request.method === "turn/start" ? [request.params?.input?.[0]?.text ?? ""] : [];
  });
  const selected = prompts[index < 0 ? prompts.length + index : index];
  if (!selected) throw new Error(`A fixture ${scenario} não possui esse turno.`);
  return selected;
}

async function waitForState(
  harness: Harness,
  id: string,
  state: Conversation["state"],
): Promise<void> {
  if (harness.manager.get(id)?.conversation.state === state) return;
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
          `Timeout esperando estado ${state}; atual=${snapshot?.conversation.state}; mensagens=${JSON.stringify(snapshot?.messages)}`,
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
      clearTimeout(timer);
      remove();
      resolve(event.payload.part);
    });
    const timer = setTimeout(() => {
      remove();
      reject(new Error("Timeout esperando parte do Codex."));
    }, 5_000);
  });
}

function latestAgent(harness: Harness, id: string) {
  return [...(harness.manager.get(id)?.messages ?? [])]
    .reverse()
    .find((message) => message.author === "agent");
}

test("Codex transmite texto, converte leitura em ação e carrega os modelos reais", async (t) => {
  await t.test("texto", async () => {
    const harness = await createHarness("texto");
    try {
      const conversation = createConversation(harness.manager);
      await harness.manager.send(conversation.id, fixturePrompt("texto"));
      await waitForState(harness, conversation.id, "idle");
      const message = latestAgent(harness, conversation.id);
      assert.equal(message?.status, "done");
      assert.ok(
        message?.parts.some((part) => part.type === "text" && part.markdown.includes("Oi!")),
      );
      assert.ok(
        harness.events.some(
          (event) =>
            event.event === "conversation.partUpdated" &&
            event.payload.kind === "delta" &&
            event.payload.delta.length > 0,
        ),
      );
      const models = await harness.manager.models("codex");
      assert.equal(models.models.length, 8);
      assert.ok(models.models.some((model) => model.id === "gpt-6.1-sol"));
      assert.deepEqual(models.efforts, ["low", "medium", "high", "xhigh", "max"]);
      const hostRequests = harness.fakes[0]?.messages[0] ?? [];
      assert.equal(hostRequests.filter((request) => request.method === "model/list").length, 1);
      assert.equal(JSON.stringify(hostRequests).includes("serviceTier"), false);
    } finally {
      await harness.close();
    }
  });

  await t.test("leitura", async () => {
    const harness = await createHarness("leitura");
    try {
      const conversation = createConversation(harness.manager);
      await harness.manager.send(conversation.id, fixturePrompt("leitura"));
      await waitForState(harness, conversation.id, "idle");
      assert.ok(
        latestAgent(harness, conversation.id)?.parts.some(
          (part) =>
            part.type === "action" &&
            part.actionType === "read" &&
            part.title.includes("README.md"),
        ),
      );
      assert.ok(
        latestAgent(harness, conversation.id)?.parts.some(
          (part) => part.type === "text" && part.markdown.includes("Projeto de teste"),
        ),
      );
    } finally {
      await harness.close();
    }
  });
});

test("modos Codex usam as políticas reais do app-server", async (t) => {
  for (const [mode, sandbox, approvalPolicy] of [
    ["read-only", "read-only", "never"],
    ["edit", "workspace-write", "on-request"],
    ["full", "danger-full-access", "never"],
  ] as const) {
    await t.test(mode, async () => {
      const harness = await createHarness("texto", { mode });
      try {
        const conversation = createConversation(harness.manager, mode);
        await harness.manager.send(conversation.id, fixturePrompt("texto"));
        await waitForState(harness, conversation.id, "idle");
        const threadStart = harness.fakes[0]?.messages[0]?.find(
          (message) => message.method === "thread/start",
        );
        assert.equal(
          (threadStart?.params as Record<string, unknown> | undefined)?.sandbox,
          sandbox,
        );
        assert.equal(
          (threadStart?.params as Record<string, unknown> | undefined)?.approvalPolicy,
          approvalPolicy,
        );
      } finally {
        await harness.close();
      }
    });
  }
});

test("aprovações de comando permitem, permitem sempre nesta conversa ou negam", async (t) => {
  for (const scenario of [
    "comando-permitido",
    "comando-permitir-sempre",
    "comando-negado",
  ] as const) {
    await t.test(scenario, async () => {
      const harness = await createHarness(scenario, { mode: "edit" });
      try {
        const conversation = createConversation(harness.manager, "edit");
        await harness.manager.send(conversation.id, fixturePrompt(scenario));
        const permission = await waitForPart(
          harness,
          conversation.id,
          (part) => part.type === "permission" && part.state === "pending",
        );
        assert.ok(
          permission.type === "permission" &&
            permission.summary.includes("touch /tmp/arquivo-de-teste"),
        );
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
        const response = harness.fakes[0]?.messages[0]?.find(
          (message) => message.id === 0 && message.method === undefined,
        );
        assert.equal(
          (response?.result as Record<string, unknown> | undefined)?.decision,
          decision === "allow" ? "accept" : decision === "always" ? "acceptForSession" : "decline",
        );
        const finalPermission = latestAgent(harness, conversation.id)?.parts.find(
          (part) => part.id === permission.id,
        );
        assert.equal(
          finalPermission?.type === "permission" ? finalPermission.state : undefined,
          decision === "deny" ? "denied" : "allowed",
        );
      } finally {
        await harness.close();
      }
    });
  }
});

test("pergunta, plano aprovado e atualização da lista de tarefas", async (t) => {
  await t.test("pergunta", async () => {
    const harness = await createHarness("pergunta");
    try {
      const conversation = createConversation(harness.manager);
      await harness.manager.send(conversation.id, fixturePrompt("pergunta"));
      const question = await waitForPart(
        harness,
        conversation.id,
        (part) => part.type === "question" && part.state === "pending",
      );
      assert.ok(question.type === "question" && question.questions[0]?.options.length === 2);
      await harness.manager.respond(conversation.id, question.id, {
        responseType: "question",
        answers: { opcao: ["A"] },
      });
      await waitForState(harness, conversation.id, "idle");
      const response = harness.fakes[0]?.messages[0]?.find(
        (message) => message.id === 0 && message.method === undefined,
      );
      assert.deepEqual(
        (response?.result as { answers?: Record<string, { answers: string[] }> } | undefined)
          ?.answers,
        { opcao: { answers: ["A"] } },
      );
      const finalQuestion = latestAgent(harness, conversation.id)?.parts.find(
        (part) => part.id === question.id,
      );
      assert.equal(
        finalQuestion?.type === "question" ? finalQuestion.state : undefined,
        "answered",
      );
    } finally {
      await harness.close();
    }
  });

  await t.test("plano", async () => {
    const harness = await createHarness("plano");
    try {
      const conversation = createConversation(harness.manager);
      await harness.manager.send(conversation.id, fixturePrompt("plano"));
      const plan = await waitForPart(
        harness,
        conversation.id,
        (part) => part.type === "plan" && part.state === "pending",
      );
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
      assert.ok(
        harness.fakes[0]?.messages[0]?.some(
          (message) =>
            message.method === "turn/start" &&
            (
              (message.params as { input?: { text?: string }[] } | undefined)?.input?.[0]?.text ??
              ""
            ).startsWith("Aprovado."),
        ),
      );
    } finally {
      await harness.close();
    }
  });

  await t.test("tarefas", async () => {
    const harness = await createHarness("tarefas");
    try {
      const conversation = createConversation(harness.manager);
      await harness.manager.send(conversation.id, fixturePrompt("tarefas"));
      const plan = await waitForPart(
        harness,
        conversation.id,
        (part) => part.type === "plan" && part.state === "pending",
      );
      await harness.manager.respond(conversation.id, plan.id, {
        responseType: "plan",
        decision: "approve",
      });
      await waitForState(harness, conversation.id, "idle");
      const todos = latestAgent(harness, conversation.id)?.parts.find(
        (part) => part.type === "todos",
      );
      assert.ok(todos?.type === "todos" && todos.items.length === 2);
      assert.ok(todos?.type === "todos" && todos.items.every((item) => item.state === "done"));
    } finally {
      await harness.close();
    }
  });
});

test("retoma thread, interrompe turno e trata CLI ausente", async (t) => {
  await t.test("retomar thread", async () => {
    const harness = await createHarness("continuar", { resumeExisting: true });
    try {
      const conversation = createConversation(harness.manager);
      setAgentSession(harness.db, conversation.id, "00000000-0000-4000-8000-000000000002");
      await harness.manager.send(conversation.id, fixturePrompt("continuar", -1));
      await waitForState(harness, conversation.id, "idle");
      assert.equal(
        harness.fakes[0]?.messages[0]?.find((message) => message.method === "thread/resume")
          ?.method,
        "thread/resume",
      );
      assert.ok(
        latestAgent(harness, conversation.id)?.parts.some(
          (part) => part.type === "text" && part.markdown === "jatobá",
        ),
      );
    } finally {
      await harness.close();
    }
  });

  await t.test("parar", async () => {
    const harness = await createHarness("parar");
    try {
      const conversation = createConversation(harness.manager);
      await harness.manager.send(conversation.id, fixturePrompt("parar"));
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

  await t.test("CLI ausente", async () => {
    const harness = await createHarness("erro", { fakeError: true });
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
});

test("retomada após ociosidade reinicia o processo e consulta modelos uma vez por processo", async () => {
  const harness = await createHarness("continuar", { idleMs: 20 });
  try {
    const conversation = createConversation(harness.manager);
    await harness.manager.send(conversation.id, fixturePrompt("continuar", 0));
    await waitForState(harness, conversation.id, "idle");
    await new Promise((resolve) => setTimeout(resolve, 80));
    assert.equal((await harness.manager.models("codex")).models.length, 8);
    await harness.manager.send(conversation.id, fixturePrompt("continuar", -1));
    await waitForState(harness, conversation.id, "idle");
    assert.equal(harness.fakes.length, 2);
    assert.equal(
      harness.fakes[0]?.messages[0]?.filter((message) => message.method === "model/list").length,
      1,
    );
    assert.equal(
      harness.fakes[1]?.messages[0]?.filter((message) => message.method === "model/list").length,
      1,
    );
    assert.equal(
      harness.fakes[1]?.messages[0]?.some((message) => message.method === "thread/resume"),
      true,
    );
  } finally {
    await harness.close();
  }
});

test("o serviço recupera mensagens streaming após reinício", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "karont-codex-restart-"));
  const dbPath = path.join(root, "karont.db");
  let db = openDatabase(dbPath);
  const conversation = createConversationRecord(db, {
    agent: "codex",
    title: "Interrompida",
    cwd: "/home/user/projeto",
    mode: "read-only",
  });
  const message = {
    id: "codex-message-streaming",
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
