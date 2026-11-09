import assert from "node:assert/strict";
import { type ChildProcess, execFileSync, type SpawnOptions } from "node:child_process";
import { EventEmitter } from "node:events";
import { readFileSync } from "node:fs";
import { mkdir, mkdtemp, readFile, realpath, rename, rm, stat, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { PassThrough } from "node:stream";
import { test } from "node:test";
import { fileURLToPath } from "node:url";
import type {
  AnyEvent,
  ComposerSkill,
  Conversation,
  ConversationAttachment,
  ConversationMessage,
  MessagePart,
} from "@karont/contract";
import { methods } from "@karont/contract";
import {
  addMessage,
  createConversation as createConversationRecord,
  createProject,
  createWorkspace,
  getAgentSession,
  getMessage,
  getRestorePoint,
  isBranchForkPending,
  listRestorePoints,
  openDatabase,
  removeWorkspace,
  setAgentSession,
  setSetting,
  updateConversation,
  updateProject,
} from "../db.ts";
import { updateDot } from "../dot.ts";
import { ServiceError } from "../errors.ts";
import {
  type RestoreSnapshotOutcome,
  type RestoreSnapshotRequest,
  takeRestorePoint,
} from "../git/restore-points.ts";
import type {
  AdapterEvent,
  AdapterFactory,
  AdapterModelList,
  AgentAdapterRegistration,
} from "./adapter.ts";
import {
  AgentCliError,
  ClaudeAdapter,
  createClaudeModelLoader,
  createClaudeSkillLoader,
} from "./claude-adapter.ts";
import { ConversationManager, type ConversationManagerOptions } from "./conversation-manager.ts";
import { createFakeClaudeSpawn, type FakeClaudeSpawn } from "./testing/fake-claude-process.ts";
import { generateConversationTitle, type TitleGeneratorOptions } from "./title-generator.ts";

const fixtureDir = new URL("./fixtures/claude/", import.meta.url);
const modelFixture = JSON.parse(
  readFileSync(fileURLToPath(new URL("modelos.json", fixtureDir)), "utf8"),
) as Record<string, unknown>[];
const claudeCommands = JSON.parse(
  readFileSync(fileURLToPath(new URL("comandos.json", fixtureDir)), "utf8"),
) as Record<string, unknown>[];

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
    initializeGate?: { started: () => void; released: Promise<void> };
    largeImageBytes?: number;
    messageCreatedGate?: { started: () => void; released: Promise<void>; onlyNth?: number };
    titleGenerator?: (
      agent: Conversation["agent"],
      userMessage: string,
      agentResponse: string,
      options?: Pick<TitleGeneratorOptions, "codexModel" | "codexEffort">,
    ) => Promise<string | null>;
    codexModelCache?: AdapterModelList;
    claudeModelLoader?: (cwd: string) => Promise<AdapterModelList>;
    adapterFactory?: AdapterFactory;
    agentRegistrations?: Readonly<Record<string, AgentAdapterRegistration>>;
    homeDir?: string;
    restoreSnapshot?: ConversationManagerOptions["restoreSnapshot"];
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
  let createdSoFar = 0;
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
  const fakeSpawn = createFakeClaudeSpawn(fixturePath, {
    ...fakeOptions,
    initializeModels: modelFixture,
  });
  const spawn = (command: string, args: string[], options: SpawnOptions) => {
    spawnArgs.push(args);
    return fakeSpawn(command, args, options);
  };
  const manager = new ConversationManager({
    db,
    env,
    broadcast: async (event) => {
      events.push(event);
      for (const listener of listeners) listener(event);
      if (event.event === "conversation.messageCreated" && fakeOptions.messageCreatedGate) {
        createdSoFar += 1;
        const gate = fakeOptions.messageCreatedGate;
        if (gate.onlyNth === undefined || gate.onlyNth === createdSoFar) {
          gate.started();
          await gate.released;
        }
      }
    },
    adapterFactory:
      fakeOptions.adapterFactory ??
      ((_conversation, emit) =>
        new ClaudeAdapter(emit, {
          env,
          spawn,
        })),
    claudeModelLoader: fakeOptions.claudeModelLoader ?? createClaudeModelLoader({ env, spawn }),
    ...(fakeOptions.agentRegistrations
      ? { agentRegistrations: fakeOptions.agentRegistrations }
      : {}),
    ...(fakeOptions.titleGenerator ? { titleGenerator: fakeOptions.titleGenerator } : {}),
    ...(fakeOptions.homeDir ? { homeDir: fakeOptions.homeDir } : {}),
    ...(fakeOptions.restoreSnapshot ? { restoreSnapshot: fakeOptions.restoreSnapshot } : {}),
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

test("capacidades e skills vazias usam o registro do agente", async () => {
  const harness = await createHarness(
    "texto",
    {},
    {
      agentRegistrations: {
        teste: {
          factory: () => {
            throw new Error("A fábrica de teste não deve iniciar uma conversa.");
          },
          capabilities: {
            skills: false,
            compact: false,
            contextUsage: false,
            fileMentions: true,
            fastMode: false,
            plan: false,
            fork: false,
          },
        },
      },
    },
  );
  try {
    assert.deepEqual(await harness.manager.capabilities("teste"), {
      capabilities: {
        skills: false,
        compact: false,
        contextUsage: false,
        fileMentions: true,
        fastMode: false,
        plan: false,
        fork: false,
      },
    });
    assert.deepEqual(await harness.manager.skills({ agent: "teste", cwd: os.tmpdir() }), {
      skills: [],
    });
    await assert.rejects(harness.manager.capabilities("nao-registrado"), /não está registrado/);
  } finally {
    await harness.close();
  }
});

test("pedidos simultâneos de skills compartilham a carga do agente", async () => {
  let releaseLoad!: () => void;
  const loadGate = new Promise<void>((resolve) => {
    releaseLoad = resolve;
  });
  let signalStarted!: () => void;
  const started = new Promise<void>((resolve) => {
    signalStarted = resolve;
  });
  let processCount = 0;
  let firstProcessStarted = false;
  const fakeSpawn = createFakeClaudeSpawn(fileURLToPath(new URL("texto.jsonl", fixtureDir)), {
    initializeCommands: claudeCommands,
    initializeGate: {
      started: () => {
        processCount += 1;
        if (!firstProcessStarted) {
          firstProcessStarted = true;
          signalStarted();
        }
      },
      released: loadGate,
    },
  });
  const loadSkills = createClaudeSkillLoader({
    env: { ...process.env, KARONT_CLAUDE_CLI: "claude" },
    spawn: fakeSpawn,
  });
  const expectedSkills: ComposerSkill[] = [
    {
      name: "project-helper",
      description: "Executa uma tarefa de exemplo no Projeto.",
      argumentHint: "[arquivo]",
      source: "claude",
    },
  ];
  const harness = await createHarness(
    "texto",
    {},
    {
      agentRegistrations: {
        teste: {
          factory: () => {
            throw new Error("A fábrica de teste não deve iniciar uma conversa.");
          },
          capabilities: {
            skills: true,
            compact: false,
            contextUsage: false,
            fileMentions: false,
            fastMode: false,
            plan: false,
            fork: false,
          },
          loadSkills,
        },
      },
    },
  );
  const originalNow = Date.now;
  let currentTime = originalNow();
  Date.now = () => currentTime;
  try {
    const first = harness.manager.skills({ agent: "teste", cwd: os.tmpdir() });
    const second = harness.manager.skills({ agent: "teste", cwd: os.tmpdir() });
    await started;
    releaseLoad();

    const results = await Promise.all([first, second]);
    assert.equal(processCount, 1);
    assert.deepEqual(results, [{ skills: expectedSkills }, { skills: expectedSkills }]);

    currentTime += 11_000;
    assert.deepEqual(await harness.manager.skills({ agent: "teste", cwd: os.tmpdir() }), {
      skills: expectedSkills,
    });
    assert.equal(processCount, 1);
  } finally {
    Date.now = originalNow;
    await harness.close();
  }
});

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

function addTranscriptMessages(
  db: ReturnType<typeof openDatabase>,
  conversationId: string,
  entries: Array<{
    id: string;
    author: "user" | "agent";
    text: string;
    agentTurnId?: string;
  }>,
): void {
  for (const [index, entry] of entries.entries()) {
    const timestamp = new Date(Date.UTC(2026, 10, 1, 10, index)).toISOString();
    const message: ConversationMessage = {
      id: entry.id,
      conversationId,
      author: entry.author,
      status: "done",
      parts: [{ id: `part-${entry.id}`, type: "text", markdown: entry.text }],
      ...(entry.agentTurnId ? { agentTurnId: entry.agentTurnId } : {}),
      createdAt: timestamp,
      updatedAt: timestamp,
    };
    addMessage(db, message);
  }
}

test("remover durante a abertura ignora a falha tardia e avisa a interface", async () => {
  let announceStart!: () => void;
  let rejectOpening!: (error: Error) => void;
  let announceDisposal!: () => void;
  let releaseDisposal!: () => void;
  let disposeCalls = 0;
  const started = new Promise<void>((resolve) => {
    announceStart = resolve;
  });
  const disposalStarted = new Promise<void>((resolve) => {
    announceDisposal = resolve;
  });
  const disposalGate = new Promise<void>((resolve) => {
    releaseDisposal = resolve;
  });
  const opening = new Promise<void>((_resolve, reject) => {
    rejectOpening = reject;
  });
  const harness = await createHarness(
    "texto",
    {},
    {
      adapterFactory: (_conversation, _emit) => {
        return {
          start: async () => {
            announceStart();
            await opening;
          },
          send: async () => undefined,
          respond: async () => undefined,
          interrupt: async () => undefined,
          dispose: async () => {
            disposeCalls += 1;
            if (disposeCalls === 1) {
              announceDisposal();
              await disposalGate;
            }
          },
        };
      },
    },
  );
  const conversation = createConversation(harness.manager);
  const sending = harness.manager.send(conversation.id, "Falhe durante a abertura.");

  try {
    await started;
    const removing = harness.manager.remove(conversation.id);
    await disposalStarted;
    rejectOpening(new Error("A abertura falhou depois da remoção."));
    await new Promise<void>((resolve) => setImmediate(resolve));

    assert.equal(
      harness.events.some(
        (event) =>
          event.event === "conversation.stateChanged" &&
          "messageStatus" in event.payload &&
          event.payload.conversation.id === conversation.id &&
          event.payload.messageStatus === "error",
      ),
      false,
      "a falha de abertura não pode publicar estado de uma conversa em remoção",
    );

    releaseDisposal();
    const [deleted] = await Promise.all([removing, sending]);
    assert.equal(deleted, true);
    assert.ok(
      harness.events.some(
        (event) => event.event === "conversation.removed" && event.payload.id === conversation.id,
      ),
    );
  } finally {
    releaseDisposal();
    await harness.close();
  }
});

test("apagar todas invalida falhas tardias durante a abertura", async () => {
  let announceStart!: () => void;
  let rejectOpening!: (error: Error) => void;
  let disposed = false;
  const started = new Promise<void>((resolve) => {
    announceStart = resolve;
  });
  const opening = new Promise<void>((_resolve, reject) => {
    rejectOpening = reject;
  });
  const harness = await createHarness(
    "texto",
    {},
    {
      adapterFactory: () => ({
        start: async () => {
          announceStart();
          await opening;
        },
        send: async () => undefined,
        respond: async () => undefined,
        interrupt: async () => undefined,
        dispose: async () => {
          disposed = true;
        },
      }),
    },
  );
  const conversation = createConversation(harness.manager);
  const sending = harness.manager.send(conversation.id, "Falhe durante o apagamento.");

  try {
    await started;
    const deleting = harness.manager.deleteAll();
    rejectOpening(new Error("A abertura falhou durante o apagamento."));
    const [deleted] = await Promise.all([deleting, sending]);

    assert.equal(deleted, 1);
    assert.equal(disposed, true);
    assert.equal(
      harness.events.some(
        (event) =>
          event.event === "conversation.stateChanged" &&
          "messageStatus" in event.payload &&
          event.payload.conversation.id === conversation.id &&
          event.payload.messageStatus === "error",
      ),
      false,
    );
    assert.ok(harness.events.some((event) => event.event === "conversation.deletedAll"));
  } finally {
    await harness.close();
  }
});

test("remover limpa partes pendentes e o temporizador de deltas", async () => {
  let announcePermission!: () => void;
  const permissionPublished = new Promise<void>((resolve) => {
    announcePermission = resolve;
  });
  const harness = await createHarness(
    "texto",
    {},
    {
      adapterFactory: (_conversation, emit) => ({
        start: async () => undefined,
        send: async () => {
          emit({
            kind: "part",
            part: {
              id: "permissao-pendente",
              type: "permission",
              tool: "Bash",
              summary: "Executar comando",
              options: ["allow", "always", "deny"],
              state: "pending",
            },
          });
          emit({
            kind: "text-delta",
            partType: "text",
            partId: "texto-pendente",
            delta: "rascunho",
          });
        },
        respond: async () => undefined,
        interrupt: async () => undefined,
        dispose: async () => undefined,
      }),
    },
  );
  const conversation = createConversation(harness.manager);
  harness.subscribe((event) => {
    if (
      event.event === "conversation.partUpdated" &&
      event.payload.kind === "upsert" &&
      event.payload.part.id === "permissao-pendente"
    )
      announcePermission();
  });

  try {
    await harness.manager.send(conversation.id, "Gere uma resposta.");
    await permissionPublished;
    await new Promise<void>((resolve) => setImmediate(resolve));
    await harness.manager.remove(conversation.id);

    await assert.rejects(
      harness.manager.respond(conversation.id, "permissao-pendente", {
        responseType: "permission",
        decision: "allow",
      }),
      /A parte não está aguardando resposta/,
    );
    await new Promise((resolve) => setTimeout(resolve, 75));
    assert.equal(
      harness.events.some(
        (event) =>
          event.event === "conversation.partUpdated" &&
          event.payload.conversationId === conversation.id &&
          event.payload.kind === "delta",
      ),
      false,
    );
  } finally {
    await harness.close();
  }
});

test("ramifica a última resposta Claude com --resume e --fork-session", async () => {
  const harness = await createHarness("texto");
  try {
    const source = harness.manager.create({
      agent: "claude",
      title: "Conversa original",
      cwd: os.tmpdir(),
      mode: "edit",
      model: "haiku",
      effort: "low",
      plan: true,
    });
    setAgentSession(harness.db, source.id, "claude-source-session");
    addTranscriptMessages(harness.db, source.id, [
      { id: "source-user-1", author: "user", text: "Pergunta original" },
      { id: "source-agent-1", author: "agent", text: "Resposta original" },
    ]);
    const originalBefore = harness.manager.get(source.id);

    const branch = await harness.manager.branch(source.id, "source-agent-1");
    assert.equal(branch.title, "Conversa original · ramo");
    assert.equal(branch.agent, source.agent);
    assert.equal(branch.cwd, source.cwd);
    assert.equal(branch.mode, source.mode);
    assert.equal(branch.model, source.model);
    assert.equal(branch.effort, source.effort);
    assert.equal(branch.plan, source.plan);
    assert.equal(branch.branchedFromId, source.id);
    assert.equal(branch.branchedFromMessageId, "source-agent-1");
    assert.equal(branch.branchContext, undefined);
    assert.equal(getAgentSession(harness.db, branch.id), "claude-source-session");
    assert.notEqual(harness.manager.get(branch.id)?.messages[0]?.id, "source-user-1");

    await harness.manager.send(branch.id, "Continue a partir daqui.");
    await waitForState(harness, branch.id, "idle");
    const args = harness.spawnArgs.at(-1) ?? [];
    const resumeIndex = args.indexOf("--resume");
    assert.ok(resumeIndex >= 0);
    assert.equal(args[resumeIndex + 1], "claude-source-session");
    assert.ok(args.includes("--fork-session"));
    assert.equal(getAgentSession(harness.db, source.id), "claude-source-session");
    assert.equal(harness.manager.get(source.id)?.messages.length, originalBefore?.messages.length);
  } finally {
    await harness.close();
  }
});

test("mantém o fork Claude pendente se o primeiro turno não informa um novo system/init", async () => {
  const harness = await createHarness("branch-fork-no-init", {}, { exitAfterResult: true });
  try {
    const source = harness.manager.create({
      agent: "claude",
      title: "Conversa original",
      cwd: os.tmpdir(),
      mode: "edit",
    });
    setAgentSession(harness.db, source.id, "claude-source-session");
    addTranscriptMessages(harness.db, source.id, [
      { id: "source-user-1", author: "user", text: "Pergunta original" },
      { id: "source-agent-1", author: "agent", text: "Resposta original" },
    ]);

    const branch = await harness.manager.branch(source.id, "source-agent-1");
    await harness.manager.send(branch.id, "Primeiro turno do ramo.");
    await waitForState(harness, branch.id, "idle");

    assert.equal(isBranchForkPending(harness.db, branch.id), true);

    await harness.manager.send(branch.id, "Retome o ramo.");
    await waitForState(harness, branch.id, "idle");
    const args = harness.spawnArgs.at(-1) ?? [];
    assert.ok(args.includes("--fork-session"));
  } finally {
    await harness.close();
  }
});

test("conclui o fork Claude quando result informa um id novo sem system/init", async () => {
  const harness = await createHarness("branch-fork-result-new-id", {}, { exitAfterResult: true });
  try {
    const source = harness.manager.create({
      agent: "claude",
      title: "Conversa original",
      cwd: os.tmpdir(),
      mode: "edit",
    });
    setAgentSession(harness.db, source.id, "claude-source-session");
    addTranscriptMessages(harness.db, source.id, [
      { id: "source-user-1", author: "user", text: "Pergunta original" },
      { id: "source-agent-1", author: "agent", text: "Resposta original" },
    ]);

    const branch = await harness.manager.branch(source.id, "source-agent-1");
    await harness.manager.send(branch.id, "Primeiro turno do ramo.");
    await waitForState(harness, branch.id, "idle");

    assert.equal(getAgentSession(harness.db, branch.id), "claude-forked-session");
    assert.equal(isBranchForkPending(harness.db, branch.id), false);
  } finally {
    await harness.close();
  }
});

test("conclui o fork Claude quando system/init informa uma sessão nova", async () => {
  const harness = await createHarness("branch-fork");
  try {
    const source = harness.manager.create({
      agent: "claude",
      title: "Conversa original",
      cwd: os.tmpdir(),
      mode: "edit",
    });
    setAgentSession(harness.db, source.id, "claude-source-session");
    addTranscriptMessages(harness.db, source.id, [
      { id: "source-user-1", author: "user", text: "Pergunta original" },
      { id: "source-agent-1", author: "agent", text: "Resposta original" },
    ]);

    const branch = await harness.manager.branch(source.id, "source-agent-1");
    await harness.manager.send(branch.id, "Primeiro turno do ramo.");
    await waitForState(harness, branch.id, "idle");

    assert.equal(getAgentSession(harness.db, branch.id), "claude-forked-session");
    assert.equal(isBranchForkPending(harness.db, branch.id), false);
  } finally {
    await harness.close();
  }
});

test("ramifica resposta antiga copiando só até ela e envia o histórico como contexto", async () => {
  const harness = await createHarness("texto");
  try {
    const source = createConversation(harness.manager);
    setAgentSession(harness.db, source.id, "claude-source-session");
    addTranscriptMessages(harness.db, source.id, [
      { id: "source-user-1", author: "user", text: "Primeira pergunta" },
      { id: "source-agent-1", author: "agent", text: "Resposta antiga" },
      { id: "source-user-2", author: "user", text: "Pergunta mais nova" },
      { id: "source-agent-2", author: "agent", text: "Resposta mais nova" },
    ]);
    const originalBefore = harness.manager.get(source.id);

    const branch = await harness.manager.branch(source.id, "source-agent-1");
    const copied = harness.manager.get(branch.id)?.messages ?? [];
    assert.equal(branch.branchContext, true);
    assert.equal(branch.branchedFromMessageId, "source-agent-1");
    assert.equal(getAgentSession(harness.db, branch.id), null);
    assert.deepEqual(
      copied.map((message) => message.parts.find((part) => part.type === "text")),
      ["Primeira pergunta", "Resposta antiga"].map((markdown, index) => ({
        id: copied[index]?.parts[0]?.id,
        type: "text",
        markdown,
      })),
    );
    assert.notEqual(copied[0]?.id, "source-user-1");
    assert.equal(harness.manager.get(source.id)?.messages.length, 4);

    await harness.manager.send(branch.id, "Nova pergunta no ramo.");
    await waitForState(harness, branch.id, "idle");
    const prompt = JSON.stringify(
      harness.claudeFake.messages.find((message) => message.type === "user"),
    );
    assert.match(prompt, /Resposta antiga/u);
    assert.doesNotMatch(prompt, /Resposta mais nova/u);
    assert.match(prompt, /Nova pergunta no ramo\./u);
    assert.equal(harness.manager.get(source.id)?.messages.length, originalBefore?.messages.length);
  } finally {
    await harness.close();
  }
});

test("ramifica turno Codex usando o fork do adaptador e mantém o id da resposta", async () => {
  const forkCalls: Array<{ sourceSessionId: string; branchPoint: unknown }> = [];
  const adapterFactory: AdapterFactory = () => ({
    start: async () => undefined,
    send: async () => undefined,
    respond: async () => undefined,
    interrupt: async () => undefined,
    dispose: async () => undefined,
    forkThread: async (_conversation, sourceSessionId, branchPoint) => {
      forkCalls.push({ sourceSessionId, branchPoint });
      return "codex-forked-session";
    },
  });
  const harness = await createHarness("texto", {}, { adapterFactory });
  try {
    const source = harness.manager.create({
      agent: "codex",
      title: "Conversa Codex",
      cwd: os.tmpdir(),
      mode: "edit",
      model: "gpt-test",
      effort: "high",
    });
    setAgentSession(harness.db, source.id, "codex-source-session");
    addTranscriptMessages(harness.db, source.id, [
      { id: "codex-user-1", author: "user", text: "Pergunta Codex" },
      {
        id: "codex-agent-1",
        author: "agent",
        text: "Resposta Codex",
        agentTurnId: "codex-turn-1",
      },
    ]);

    const branch = await harness.manager.branch(source.id, "codex-agent-1");
    assert.deepEqual(forkCalls, [
      { sourceSessionId: "codex-source-session", branchPoint: { lastTurnId: "codex-turn-1" } },
    ]);
    assert.equal(getAgentSession(harness.db, branch.id), "codex-forked-session");
    assert.equal(branch.branchContext, undefined);
    assert.equal(branch.model, source.model);
    assert.equal(branch.effort, source.effort);
    assert.equal(harness.manager.get(branch.id)?.messages.length, 2);
  } finally {
    await harness.close();
  }
});

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

test("Claude publica e persiste o uso da última mensagem assistant", async () => {
  const harness = await createHarness("texto");
  try {
    const conversation = createConversation(harness.manager);
    await harness.manager.send(conversation.id, "Resuma o contexto.");
    await waitForState(harness, conversation.id, "idle");

    const usage = { usedTokens: 90_000, windowTokens: 200_000 };
    assert.ok(
      harness.events.some(
        (event) =>
          event.event === "conversation.contextUsage" &&
          event.payload.conversationId === conversation.id &&
          event.payload.usedTokens === usage.usedTokens &&
          event.payload.windowTokens === usage.windowTokens,
      ),
    );
    assert.deepEqual(harness.manager.get(conversation.id)?.contextUsage, usage);

    await harness.manager.close();
    harness.manager = new ConversationManager({
      db: harness.db,
      env: { ...process.env, KARONT_DISABLE_AGENT_DETECTION: "1" },
      broadcast: async () => undefined,
    });
    assert.deepEqual(harness.manager.get(conversation.id)?.contextUsage, usage);
  } finally {
    await harness.close();
  }
});

test("Claude atualiza o uso de contexto depois de compactar", async () => {
  const harness = await createHarness("compactar");
  try {
    const conversation = createConversation(harness.manager);
    await harness.manager.send(conversation.id, "Resuma o contexto.");
    await waitForState(harness, conversation.id, "idle");

    const beforeCompact = { usedTokens: 90_000, windowTokens: 200_000 };
    assert.deepEqual(harness.manager.get(conversation.id)?.contextUsage, beforeCompact);

    await harness.manager.compact(conversation.id);
    await waitForState(harness, conversation.id, "idle");

    const afterCompact = { usedTokens: 6_642, windowTokens: 1_000_000 };
    assert.deepEqual(harness.manager.get(conversation.id)?.contextUsage, afterCompact);
    assert.ok(
      harness.events.some(
        (event) =>
          event.event === "conversation.contextUsage" &&
          event.payload.conversationId === conversation.id &&
          event.payload.usedTokens === afterCompact.usedTokens &&
          event.payload.windowTokens === afterCompact.windowTokens,
      ),
    );
  } finally {
    await harness.close();
  }
});

test("Claude limpa o uso de contexto se a compactação não informar tokens pós-compactação", async () => {
  const harness = await createHarness("compactar-sem-uso");
  try {
    const conversation = createConversation(harness.manager);
    await harness.manager.send(conversation.id, "Resuma o contexto.");
    await waitForState(harness, conversation.id, "idle");
    assert.deepEqual(harness.manager.get(conversation.id)?.contextUsage, {
      usedTokens: 90_000,
      windowTokens: 200_000,
    });

    await harness.manager.compact(conversation.id);
    await waitForState(harness, conversation.id, "idle");
    assert.equal(harness.manager.get(conversation.id)?.contextUsage, undefined);

    await harness.manager.close();
    harness.manager = new ConversationManager({
      db: harness.db,
      env: { ...process.env, KARONT_DISABLE_AGENT_DETECTION: "1" },
      broadcast: async () => undefined,
    });
    assert.equal(harness.manager.get(conversation.id)?.contextUsage, undefined);
  } finally {
    await harness.close();
  }
});

test("o manager não publica uso quando o adaptador não declara a capacidade", async () => {
  const harness = await createHarness(
    "texto",
    {},
    {
      agentRegistrations: {
        claude: {
          factory: () => {
            throw new Error("O adaptador do teste usa a fábrica injetada.");
          },
          capabilities: {
            skills: false,
            compact: false,
            contextUsage: false,
            fileMentions: false,
            fastMode: false,
            plan: false,
            fork: false,
          },
        },
      },
      adapterFactory: (_conversation, emit) => ({
        start: async () => undefined,
        send: async () => {
          emit({ kind: "context-usage", usedTokens: 90_000, windowTokens: 200_000 });
          emit({ kind: "turn-end", status: "done" });
        },
        respond: async () => undefined,
        interrupt: async () => undefined,
        dispose: async () => undefined,
      }),
    },
  );
  try {
    const conversation = createConversation(harness.manager);
    await harness.manager.send(conversation.id, "Responda.");
    await waitForState(harness, conversation.id, "idle");
    assert.equal(
      harness.events.some((event) => event.event === "conversation.contextUsage"),
      false,
    );
    assert.equal(harness.manager.get(conversation.id)?.contextUsage, undefined);
  } finally {
    await harness.close();
  }
});

test("Claude conclui leitura com imagem grande sem guardar o base64", async () => {
  const harness = await createHarness(
    "leitura",
    {},
    { largeImageBytes: 3_500_001, titleGenerator: async () => null },
  );
  try {
    const conversation = createConversation(harness.manager);
    await harness.manager.send(conversation.id, "Leia a imagem.");
    await waitForState(harness, conversation.id, "idle");

    const message = latestAgent(harness, conversation.id);
    const action = message?.parts.find(
      (part): part is Extract<MessagePart, { type: "action" }> =>
        part.type === "action" && part.actionType === "read",
    );
    assert.equal(message?.status, "done");
    assert.equal(action?.state, "ok");
    assert.equal(action?.output, "imagem, 3418 kB");
    assert.equal(action?.output.includes("AAAA"), false);
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
            supportsFast: false,
          },
          {
            id: "codex-small",
            name: "Codex Small",
            efforts: ["low"],
            defaultEffort: "low",
            supportsFast: false,
          },
          {
            id: "codex-mini-available",
            name: "Codex Mini",
            efforts: ["low", "high"],
            defaultEffort: "low",
            supportsFast: false,
          },
          {
            id: "codex-nano-available",
            name: "Codex Nano",
            efforts: ["low"],
            defaultEffort: "low",
            supportsFast: false,
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
  await t.test("parar durante a abertura não envia a mensagem à CLI", async () => {
    let announceOpening!: () => void;
    let releaseOpening!: () => void;
    const opening = new Promise<void>((resolve) => {
      releaseOpening = resolve;
    });
    const openingStarted = new Promise<void>((resolve) => {
      announceOpening = resolve;
    });
    const harness = await createHarness(
      "texto",
      {},
      {
        initializeGate: { started: announceOpening, released: opening },
      },
    );
    try {
      const conversation = createConversation(harness.manager);
      const sending = harness.manager.send(conversation.id, "Não envie depois de parar.");
      await openingStarted;
      assert.equal(await harness.manager.stop(conversation.id), true);
      assert.equal(harness.manager.get(conversation.id)?.conversation.state, "idle");
      assert.equal(latestAgent(harness, conversation.id)?.status, "interrupted");

      releaseOpening();
      await sending;
      assert.equal(
        harness.claudeFake.messages.some((message) => message.type === "user"),
        false,
      );
    } finally {
      releaseOpening();
      await harness.close();
    }
  });
});

test("falha ao abrir preserva renomeação, fixação e arquivamento concorrentes", async (t) => {
  const runOpeningFailure = async (
    mutate: (manager: ConversationManager, id: string) => Promise<void>,
  ) => {
    let announceOpening!: () => void;
    let rejectOpening!: (error: Error) => void;
    const openingStarted = new Promise<void>((resolve) => {
      announceOpening = resolve;
    });
    const opening = new Promise<void>((_resolve, reject) => {
      rejectOpening = reject;
    });
    const adapterFactory: AdapterFactory = () => ({
      start: async () => {
        announceOpening();
        await opening;
      },
      send: async () => undefined,
      respond: async () => undefined,
      interrupt: async () => undefined,
      dispose: async () => undefined,
    });
    const harness = await createHarness("texto", {}, { adapterFactory });
    try {
      const conversation = createConversation(harness.manager);
      const sending = harness.manager.send(conversation.id, "Abra a conversa.");
      await openingStarted;
      await mutate(harness.manager, conversation.id);
      rejectOpening(new Error("Falha de abertura simulada."));
      await sending;

      const current = harness.manager.get(conversation.id)?.conversation;
      const stateEvents = harness.events.filter(
        (event) =>
          event.event === "conversation.stateChanged" &&
          event.payload.conversation.id === conversation.id,
      );
      const lastStateEvent = stateEvents.at(-1);
      assert.equal(current?.state, "error");
      assert.equal(lastStateEvent?.event, "conversation.stateChanged");
      return { current, lastStateEvent };
    } finally {
      rejectOpening(new Error("Abertura encerrada pelo teste."));
      await harness.close();
    }
  };

  await t.test("mantém o novo título e a fixação", async () => {
    const result = await runOpeningFailure(async (manager, id) => {
      await manager.rename(id, "Título atualizado");
      await manager.setPinned(id, true);
    });
    assert.equal(result.current?.title, "Título atualizado");
    assert.ok(result.current?.pinnedAt);
    if (result.lastStateEvent.event === "conversation.stateChanged") {
      assert.equal(result.lastStateEvent.payload.conversation.title, "Título atualizado");
      assert.ok(result.lastStateEvent.payload.conversation.pinnedAt);
    }
  });

  await t.test("mantém o arquivamento", async () => {
    const result = await runOpeningFailure(async (manager, id) => {
      await manager.setArchived(id, true);
    });
    assert.ok(result.current?.archivedAt);
    if (result.lastStateEvent.event === "conversation.stateChanged") {
      assert.ok(result.lastStateEvent.payload.conversation.archivedAt);
    }
  });
});

test("início do turno preserva metadados alterados durante a emissão da mensagem", async () => {
  let announceMessage!: () => void;
  let releaseMessage!: () => void;
  const messageCreated = new Promise<void>((resolve) => {
    announceMessage = resolve;
  });
  const messageEmission = new Promise<void>((resolve) => {
    releaseMessage = resolve;
  });
  const adapterFactory: AdapterFactory = (_conversation, emit) => ({
    start: async () => undefined,
    send: async () => emit({ kind: "turn-end", status: "done" }),
    respond: async () => undefined,
    interrupt: async () => undefined,
    dispose: async () => undefined,
  });
  const harness = await createHarness(
    "texto",
    {},
    { adapterFactory, messageCreatedGate: { started: announceMessage, released: messageEmission } },
  );
  try {
    const conversation = createConversation(harness.manager);
    const sending = harness.manager.send(conversation.id, "Envie a mensagem.");
    await messageCreated;
    await harness.manager.rename(conversation.id, "Título durante envio");
    await harness.manager.setPinned(conversation.id, true);
    releaseMessage();
    await sending;
    await waitForState(harness, conversation.id, "idle");

    const current = harness.manager.get(conversation.id)?.conversation;
    assert.equal(current?.title, "Título durante envio");
    assert.ok(current?.pinnedAt);
  } finally {
    releaseMessage();
    await harness.close();
  }
});

test("setOptions preserva metadados alterados durante descarte do agente", async () => {
  let announceDisposal!: () => void;
  let releaseDisposal!: () => void;
  const disposalStarted = new Promise<void>((resolve) => {
    announceDisposal = resolve;
  });
  const disposal = new Promise<void>((resolve) => {
    releaseDisposal = resolve;
  });
  const adapterFactory: AdapterFactory = (_conversation, emit) => ({
    start: async () => undefined,
    send: async () => emit({ kind: "turn-end", status: "done" }),
    respond: async () => undefined,
    interrupt: async () => undefined,
    dispose: async () => {
      announceDisposal();
      await disposal;
    },
  });
  const harness = await createHarness(
    "texto",
    { KARONT_AGENT_IDLE_MS: "60000" },
    { adapterFactory },
  );
  try {
    const conversation = createConversation(harness.manager);
    await harness.manager.send(conversation.id, "Conclua a primeira resposta.");
    await waitForState(harness, conversation.id, "idle");

    const updatingOptions = harness.manager.setOptions(conversation.id, { mode: "read-only" });
    await disposalStarted;
    await harness.manager.rename(conversation.id, "Título durante opções");
    await harness.manager.setPinned(conversation.id, true);
    releaseDisposal();
    await updatingOptions;

    const current = harness.manager.get(conversation.id)?.conversation;
    assert.equal(current?.mode, "read-only");
    assert.equal(current?.title, "Título durante opções");
    assert.ok(current?.pinnedAt);
  } finally {
    releaseDisposal();
    await harness.close();
  }
});

test("setOptions sem alteração efetiva mantém o adaptador aquecido", async () => {
  let starts = 0;
  let disposals = 0;
  const adapterFactory: AdapterFactory = (_conversation, emit) => ({
    start: async () => {
      starts += 1;
    },
    send: async () => emit({ kind: "turn-end", status: "done" }),
    respond: async () => undefined,
    interrupt: async () => undefined,
    dispose: async () => {
      disposals += 1;
    },
  });
  const harness = await createHarness(
    "texto",
    { KARONT_AGENT_IDLE_MS: "60000" },
    {
      adapterFactory,
      codexModelCache: {
        models: [{ id: "gpt-basic", name: "GPT básico", efforts: ["low"], supportsFast: false }],
        efforts: ["low"],
      },
    },
  );
  try {
    const conversation = harness.manager.create({
      agent: "codex",
      title: "Conversa Codex",
      cwd: os.tmpdir(),
      mode: "edit",
      model: "gpt-basic",
    });
    await harness.manager.send(conversation.id, "Primeira mensagem.");
    await waitForState(harness, conversation.id, "idle");

    await harness.manager.setOptions(conversation.id, { fast: true });
    await harness.manager.send(conversation.id, "Segunda mensagem.");
    await waitForState(harness, conversation.id, "idle");

    assert.equal(starts, 1);
    assert.equal(disposals, 0);
  } finally {
    await harness.close();
  }
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

test("Claude não abre processo se for descartado enquanto valida a pasta", async () => {
  const fixturePath = fileURLToPath(new URL("texto.jsonl", fixtureDir));
  const fake = createFakeClaudeSpawn(fixturePath, { initializeModels: modelFixture });
  const env = {
    ...process.env,
    KARONT_DISABLE_AGENT_DETECTION: "1",
    KARONT_CLAUDE_CLI: "claude",
  };
  let spawnCount = 0;
  const adapter = new ClaudeAdapter(() => undefined, {
    env,
    spawn: (command, args, options) => {
      spawnCount += 1;
      return fake(command, args, options);
    },
  });
  const timestamp = new Date().toISOString();
  const conversation: Conversation = {
    workspaceId: "ws-test",
    id: "dispose-before-spawn-claude",
    agent: "claude",
    title: "Abertura cancelada",
    cwd: os.tmpdir(),
    mode: "edit",
    fast: false,
    pinnedAt: null,
    archivedAt: null,
    unreadAt: null,
    state: "idle",
    createdAt: timestamp,
    updatedAt: timestamp,
  };
  const starting = adapter.start(conversation, "session-id", false);
  try {
    await adapter.dispose();
    await assert.rejects(starting, /foi encerrada/);
    assert.equal(spawnCount, 0);
  } finally {
    await adapter.dispose();
  }
});

test("Claude mata o processo se dispose acontecer dentro do spawn", async () => {
  const env = {
    ...process.env,
    KARONT_DISABLE_AGENT_DETECTION: "1",
    KARONT_CLAUDE_CLI: "claude",
  };
  let adapter!: ClaudeAdapter;
  let disposal: Promise<void> | undefined;
  const signals: NodeJS.Signals[] = [];
  const child = Object.assign(new EventEmitter(), {
    exitCode: null as number | null,
    signalCode: null as NodeJS.Signals | null,
    kill(signal: NodeJS.Signals) {
      signals.push(signal);
      child.signalCode = signal;
      queueMicrotask(() => child.emit("exit", null, signal));
      return true;
    },
  });
  adapter = new ClaudeAdapter(() => undefined, {
    env,
    spawn: () => {
      disposal = adapter.dispose();
      return child as unknown as ChildProcess;
    },
  });
  const timestamp = new Date().toISOString();
  const conversation: Conversation = {
    workspaceId: "ws-test",
    id: "dispose-during-spawn-claude",
    agent: "claude",
    title: "Abertura cancelada",
    cwd: os.tmpdir(),
    mode: "edit",
    fast: false,
    pinnedAt: null,
    archivedAt: null,
    unreadAt: null,
    state: "idle",
    createdAt: timestamp,
    updatedAt: timestamp,
  };

  await assert.rejects(adapter.start(conversation, "session-id", false), /foi encerrada/);
  await disposal;
  assert.deepEqual(signals, ["SIGTERM"]);
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

test("o serviço ignora modo rápido nas conversas Claude, inclusive as antigas", async () => {
  const harness = await createHarness("texto");
  try {
    const conversation = harness.manager.create({
      agent: "claude",
      title: "Conversa antiga",
      cwd: os.tmpdir(),
      mode: "edit",
      model: "opus",
      fast: true,
    });
    assert.equal(conversation.fast, false);
    harness.db.prepare("UPDATE conversations SET fast = 1 WHERE id = ?").run(conversation.id);

    const models = await harness.manager.models("claude");
    assert.ok(models.models.every((model) => model.supportsFast === false));
    assert.equal(harness.manager.get(conversation.id)?.conversation.fast, false);
    assert.equal(harness.manager.list({ limit: 10 })[0]?.fast, false);
    assert.equal((await harness.manager.rename(conversation.id, "Renomeada")).fast, false);
    assert.equal((await harness.manager.markSeen(conversation.id)).fast, false);

    await harness.manager.send(conversation.id, "Responda ao pedido.");
    await waitForState(harness, conversation.id, "idle");

    const current = harness.manager.get(conversation.id)?.conversation;
    assert.equal(current?.fast, false);
    assert.equal(harness.spawnArgs[0]?.includes("--settings"), false);
  } finally {
    await harness.close();
  }
});

test("agent.models lê o initialize uma vez, elimina o alias do padrão e respeita capacidades", async () => {
  const harness = await createHarness("texto");
  try {
    const first = await harness.manager.models("claude");
    const second = await harness.manager.models("claude");
    const defaultModel = first.models.find((model) => model.isDefault);
    const legacyHaiku = first.models.find((model) => model.id === "claude-haiku-4-5-20251001");

    assert.equal(first.models.length, 12);
    assert.equal(defaultModel?.id, "opus");
    assert.equal(defaultModel?.name, "Opus 5.5");
    assert.deepEqual(defaultModel?.aliases, ["default"]);
    assert.equal(
      first.models.some((model) => model.id === "default"),
      false,
    );
    assert.deepEqual(defaultModel?.efforts, ["low", "medium", "high", "xhigh", "max"]);
    assert.deepEqual(legacyHaiku?.efforts, []);
    assert.equal(
      first.models.every((model) => model.supportsFast === false),
      true,
    );
    assert.deepEqual(second, first);
    assert.equal(
      harness.claudeFake.messages.filter(
        (message) =>
          message.type === "control_request" &&
          (message.request as { subtype?: string } | undefined)?.subtype === "initialize",
      ).length,
      1,
    );
    assert.equal(
      harness.claudeFake.messages.some((message) => message.type === "user"),
      false,
    );
  } finally {
    await harness.close();
  }
});

test("agent.models reaproveita o initialize do adaptador Claude ativo", async () => {
  const harness = await createHarness("texto");
  try {
    const conversation = createConversation(harness.manager);
    await harness.manager.send(conversation.id, "Leia a mensagem.");
    await waitForState(harness, conversation.id, "idle");

    const models = await harness.manager.models("claude");
    assert.equal(models.models.find((model) => model.isDefault)?.id, "opus");
    assert.equal(harness.spawnArgs.length, 1);
    assert.equal(
      harness.claudeFake.messages.filter(
        (message) =>
          message.type === "control_request" &&
          (message.request as { subtype?: string } | undefined)?.subtype === "initialize",
      ).length,
      1,
    );
  } finally {
    await harness.close();
  }
});

test("Claude não envia o marcador default como modelo explícito", async () => {
  const harness = await createHarness("texto");
  try {
    const conversation = harness.manager.create({
      agent: "claude",
      title: "Preferência antiga",
      cwd: os.tmpdir(),
      mode: "edit",
      model: "default",
    });
    await harness.manager.send(conversation.id, "Continue com o modelo padrão.");
    await waitForState(harness, conversation.id, "idle");

    assert.equal(harness.spawnArgs[0]?.includes("--model"), false);
  } finally {
    await harness.close();
  }
});

test("agent.models usa a lista fixa quando a consulta independente falha e não repete a tentativa", async () => {
  let attempts = 0;
  const harness = await createHarness(
    "texto",
    {},
    {
      claudeModelLoader: async () => {
        attempts += 1;
        throw new Error("Claude Code indisponível.");
      },
    },
  );
  try {
    const first = await harness.manager.models("claude");
    const second = await harness.manager.models("claude");
    assert.deepEqual(
      first.models.map(({ id }) => id),
      ["opus", "sonnet", "haiku"],
    );
    assert.equal(first.models.find((model) => model.id === "opus")?.isDefault, true);
    assert.deepEqual(second, first);
    assert.equal(attempts, 1);
  } finally {
    await harness.close();
  }
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

test("retry reenvia os bytes dos anexos da mensagem original", async () => {
  const receivedAttachments: ConversationAttachment[][] = [];
  const adapterFactory: AdapterFactory = (_conversation, emit) => ({
    start: async () => undefined,
    send: async (_text, _plan, attachments = []) => {
      receivedAttachments.push(structuredClone(attachments));
      emit({ kind: "turn-end", status: "done" });
    },
    respond: async () => undefined,
    interrupt: async () => undefined,
    dispose: async () => undefined,
  });
  const harness = await createHarness("texto", {}, { adapterFactory });
  try {
    const conversation = createConversation(harness.manager);
    const imageData = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]).toString("base64");
    const attachments: ConversationAttachment[] = [
      { name: "notas.txt", mimeType: "text/plain", kind: "text", data: "Trecho de referência." },
      { name: "pixel.png", mimeType: "image/png", kind: "image", data: imageData },
    ];

    await harness.manager.send(conversation.id, "Leia a imagem.", false, attachments);
    await waitForState(harness, conversation.id, "idle");
    const agentMessage = harness.manager
      .get(conversation.id)
      ?.messages.find((message) => message.author === "agent");
    assert.ok(agentMessage);
    await harness.manager.retry(conversation.id, agentMessage.id);
    await waitForState(harness, conversation.id, "idle");

    assert.deepEqual(receivedAttachments, [attachments, attachments]);
    const raw = harness.db
      .prepare(
        "SELECT attachments_json FROM messages WHERE conversation_id = ? AND author = 'user'",
      )
      .get(conversation.id) as { attachments_json: string };
    assert.equal(raw.attachments_json.includes(imageData), false);
    assert.equal(raw.attachments_json.includes("Trecho de referência."), false);
  } finally {
    await harness.close();
  }
});

test("retry reenvia as skills da mensagem original", async () => {
  const receivedSkills: Array<Array<{ name: string; path?: string }>> = [];
  const adapterFactory: AdapterFactory = (_conversation, emit) => ({
    start: async () => undefined,
    send: async (_text, _plan, _attachments, skills = []) => {
      receivedSkills.push(structuredClone(skills));
      emit({ kind: "turn-end", status: "done" });
    },
    respond: async () => undefined,
    interrupt: async () => undefined,
    dispose: async () => undefined,
  });
  const harness = await createHarness("texto", {}, { adapterFactory });
  let restartedManager: ConversationManager | undefined;
  try {
    const conversation = createConversation(harness.manager);
    const skills: Array<Pick<ComposerSkill, "name" | "path">> = [
      { name: "project-helper", path: "/projeto/.agents/skills/project-helper/SKILL.md" },
    ];

    await harness.manager.send(conversation.id, "Use a skill do projeto.", false, [], skills);
    await waitForState(harness, conversation.id, "idle");
    const userMessage = harness.manager
      .get(conversation.id)
      ?.messages.find((message) => message.author === "user");
    assert.deepEqual(userMessage?.parts[0], {
      id: userMessage?.parts[0]?.id,
      type: "text",
      markdown: "Use a skill do projeto.",
      skills,
    });
    const agentMessage = harness.manager
      .get(conversation.id)
      ?.messages.find((message) => message.author === "agent");
    assert.ok(agentMessage);

    await harness.manager.close();
    restartedManager = new ConversationManager({
      db: harness.db,
      broadcast: async (event) => {
        harness.events.push(event);
      },
      adapterFactory,
    });
    await restartedManager.retry(conversation.id, agentMessage.id);
    await waitForState(harness, conversation.id, "idle");

    assert.deepEqual(receivedSkills, [skills, skills]);
  } finally {
    await restartedManager?.close();
    await harness.close();
  }
});

test("retry repete uma compactação pela operação do adaptador", async () => {
  let compactCalls = 0;
  let sendCalls = 0;
  const adapterFactory: AdapterFactory = (_conversation, emit) => ({
    start: async () => emit({ kind: "session", sessionId: "sessao-teste" }),
    send: async () => {
      sendCalls += 1;
      emit({ kind: "turn-end", status: "done" });
    },
    compact: async () => {
      compactCalls += 1;
      emit({
        kind: "turn-end",
        status: compactCalls === 1 ? "error" : "done",
        ...(compactCalls === 1
          ? { error: { type: "failed" as const, text: "Falha simulada." } }
          : {}),
      });
    },
    respond: async () => undefined,
    interrupt: async () => undefined,
    dispose: async () => undefined,
  });
  const harness = await createHarness("texto", {}, { adapterFactory });
  try {
    const conversation = createConversation(harness.manager);
    await harness.manager.send(conversation.id, "Mensagem original.");
    await waitForState(harness, conversation.id, "idle");

    await harness.manager.compact(conversation.id);
    await waitForState(harness, conversation.id, "error");
    const compactMarker = harness.manager
      .get(conversation.id)
      ?.messages.filter((message) => message.author === "user")
      .at(-1)
      ?.parts.find((part) => part.type === "text");
    assert.equal(compactMarker?.type === "text" ? compactMarker.operation : undefined, "compact");
    const failed = harness.manager
      .get(conversation.id)
      ?.messages.filter((message) => message.author === "agent")
      .at(-1);
    assert.ok(failed);

    await harness.manager.retry(conversation.id, failed.id);
    await waitForState(harness, conversation.id, "idle");

    assert.equal(compactCalls, 2);
    assert.equal(sendCalls, 1);
  } finally {
    await harness.close();
  }
});

test("retry descarta os bytes de anexos das conversas mais antigas", async () => {
  const adapterFactory: AdapterFactory = (_conversation, emit) => ({
    start: async () => undefined,
    send: async () =>
      emit({
        kind: "turn-end",
        status: "error",
        error: { type: "failed", text: "Falha simulada." },
      }),
    respond: async () => undefined,
    interrupt: async () => undefined,
    dispose: async () => undefined,
  });
  const harness = await createHarness("texto", {}, { adapterFactory });
  try {
    const conversations = Array.from({ length: 4 }, () => createConversation(harness.manager));
    for (const [index, conversation] of conversations.entries()) {
      await harness.manager.send(conversation.id, `Mensagem ${index}.`, false, [
        {
          name: `nota-${index}.txt`,
          mimeType: "text/plain",
          kind: "text",
          data: `anexo-${index}`,
        },
      ]);
      await waitForState(harness, conversation.id, "error");
    }

    const oldest = conversations[0];
    const latest = conversations.at(-1);
    assert.ok(oldest && latest);
    const oldestAgent = latestAgent(harness, oldest.id);
    assert.ok(oldestAgent);
    await assert.rejects(
      harness.manager.retry(oldest.id, oldestAgent.id),
      /bytes dos anexos não estão mais disponíveis/,
    );
    const latestAgentMessage = latestAgent(harness, latest.id);
    assert.ok(latestAgentMessage);
    await harness.manager.retry(latest.id, latestAgentMessage.id);
    await waitForState(harness, latest.id, "error");
  } finally {
    await harness.close();
  }
});

test("retry falha claramente se os bytes dos anexos não estão mais em memória", async () => {
  const harness = await createHarness(
    "texto",
    {},
    {
      adapterFactory: (_conversation, emit) => ({
        start: async () => undefined,
        send: async () => emit({ kind: "turn-end", status: "done" }),
        respond: async () => undefined,
        interrupt: async () => undefined,
        dispose: async () => undefined,
      }),
    },
  );
  let retrySendCount = 0;
  try {
    const conversation = createConversation(harness.manager);
    const imageData = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]).toString("base64");
    await harness.manager.send(conversation.id, "Leia a imagem.", false, [
      { name: "pixel.png", mimeType: "image/png", kind: "image", data: imageData },
    ]);
    await waitForState(harness, conversation.id, "idle");
    const agentMessage = harness.manager
      .get(conversation.id)
      ?.messages.find((message) => message.author === "agent");
    assert.ok(agentMessage);
    await harness.manager.close();

    const restartedManager = new ConversationManager({
      db: harness.db,
      broadcast: async (event) => {
        harness.events.push(event);
      },
      adapterFactory: () => ({
        start: async () => undefined,
        send: async () => {
          retrySendCount += 1;
        },
        respond: async () => undefined,
        interrupt: async () => undefined,
        dispose: async () => undefined,
      }),
    });
    try {
      await assert.rejects(
        restartedManager.retry(conversation.id, agentMessage.id),
        /bytes dos anexos não estão mais disponíveis/u,
      );
      assert.equal(retrySendCount, 0);
    } finally {
      await restartedManager.close();
    }
  } finally {
    await harness.close();
  }
});

test("Claude distingue pasta do projeto apagada de CLI ausente", async (context) => {
  const cwd = await mkdtemp(path.join(os.tmpdir(), "karont-pasta-apagada-"));
  context.after(() => rm(cwd, { recursive: true, force: true }));
  await rm(cwd, { recursive: true, force: true });
  const timestamp = new Date().toISOString();
  const conversation: Conversation = {
    workspaceId: "ws-test",
    id: "missing-folder-claude",
    agent: "claude",
    title: "Pasta apagada",
    cwd,
    mode: "edit",
    fast: false,
    pinnedAt: null,
    archivedAt: null,
    unreadAt: null,
    state: "idle",
    createdAt: timestamp,
    updatedAt: timestamp,
  };
  let spawnCount = 0;
  const adapter = new ClaudeAdapter(() => undefined, {
    env: { ...process.env, KARONT_DISABLE_AGENT_DETECTION: "1", KARONT_CLAUDE_CLI: "claude" },
    spawn: () => {
      spawnCount += 1;
      throw Object.assign(new Error("spawn claude ENOENT"), { code: "ENOENT" });
    },
  });

  await assert.rejects(
    adapter.start(conversation, "session-id", false),
    (error: unknown) =>
      error instanceof AgentCliError &&
      error.errorType === "failed" &&
      error.message === `A pasta do projeto não existe mais: ${cwd}`,
  );
  assert.equal(spawnCount, 0);
});

// ---------------------------------------------------------------------------
// Fila e limite de agentes (M3-B3)
// ---------------------------------------------------------------------------

type QueueAdapterEntry = {
  emit: (event: Parameters<AdapterFactory>[1] extends (e: infer E) => void ? E : never) => void;
  starts: number;
  sends: number;
  interrupts: number;
};

async function createQueueRig(limit: number | undefined, failStartFor: Set<string> = new Set()) {
  const entries = new Map<string, QueueAdapterEntry>();
  const harness = await createHarness(
    "texto",
    {},
    {
      adapterFactory: (conversation, emit) => {
        const entry: QueueAdapterEntry = { emit, starts: 0, sends: 0, interrupts: 0 };
        entries.set(conversation.id, entry);
        return {
          start: async () => {
            entry.starts += 1;
            if (failStartFor.has(conversation.id)) throw new Error("falha ao iniciar");
          },
          send: async () => {
            entry.sends += 1;
            emit({ kind: "state", state: "working" });
          },
          respond: async () => undefined,
          interrupt: async () => {
            entry.interrupts += 1;
            emit({
              kind: "turn-end",
              status: "interrupted",
              error: { type: "interrupted", text: "Interrompida." },
            });
          },
          dispose: async () => undefined,
        };
      },
    },
  );
  if (limit !== undefined) setSetting(harness.db, "agents.maxConcurrent", limit);
  const create = () => createConversation(harness.manager);
  // O adaptador só recebe a mensagem depois da foto de restauração (assíncrona): espera o envio.
  const finish = (id: string, status: "done" | "error" = "done") => {
    const emitEnd = () =>
      entries
        .get(id)
        ?.emit(
          status === "error"
            ? { kind: "turn-end", status, error: { type: "failed", text: "falhou" } }
            : { kind: "turn-end", status },
        );
    if (entries.get(id)?.sends) {
      emitEnd();
      return;
    }
    void (async () => {
      for (let attempt = 0; attempt < 200; attempt += 1) {
        await new Promise<void>((resolve) => setTimeout(resolve, 10));
        if (entries.get(id)?.sends) {
          emitEnd();
          return;
        }
      }
    })();
  };
  const stateOf = (id: string) => harness.manager.get(id)?.conversation.state;
  const until = async (predicate: () => boolean, label: string) => {
    for (let attempt = 0; attempt < 200; attempt += 1) {
      if (predicate()) return;
      await new Promise<void>((resolve) => setTimeout(resolve, 10));
    }
    throw new Error(`Timeout esperando: ${label}`);
  };
  const states = (id: string) =>
    harness.events.flatMap((event) =>
      event.event === "conversation.stateChanged" && event.payload.conversation.id === id
        ? [event.payload.conversation.state]
        : [],
    );
  return { harness, entries, create, finish, stateOf, until, states };
}

test("fila: com limite 2 a terceira mensagem espera sem iniciar o adaptador", async () => {
  const rig = await createQueueRig(2);
  try {
    const [a, b, c] = [rig.create(), rig.create(), rig.create()];
    await rig.harness.manager.send(a.id, "a");
    await rig.harness.manager.send(b.id, "b");
    const sent = await rig.harness.manager.send(c.id, "c");
    assert.equal(sent.agentMessage.status, "streaming");
    assert.equal(rig.stateOf(c.id), "queued");
    assert.equal(rig.entries.has(c.id), false);
    assert.equal(rig.states(c.id).includes("working"), false);
    assert.equal(rig.states(c.id)[0], "queued");
    assert.deepEqual(rig.harness.manager.queueStatus(), {
      limit: 2,
      running: 2,
      queuedConversationIds: [c.id],
    });
  } finally {
    await rig.harness.close();
  }
});

test("fila: terminar um turno inicia o próximo em ordem FIFO e mensagem nova não fura", async () => {
  const rig = await createQueueRig(2);
  try {
    const [a, b, c, d, e] = [rig.create(), rig.create(), rig.create(), rig.create(), rig.create()];
    for (const [conversation, text] of [
      [a, "a"],
      [b, "b"],
      [c, "c"],
      [d, "d"],
    ] as const)
      await rig.harness.manager.send(conversation.id, text);
    rig.finish(a.id);
    await rig.until(() => rig.stateOf(c.id) === "working", "c sai da fila");
    assert.equal(rig.stateOf(d.id), "queued");
    await rig.harness.manager.send(e.id, "e");
    assert.equal(rig.stateOf(e.id), "queued");
    assert.deepEqual(rig.harness.manager.queueStatus().queuedConversationIds, [d.id, e.id]);
    rig.finish(b.id);
    await rig.until(() => rig.stateOf(d.id) === "working", "d sai da fila");
    assert.equal(rig.stateOf(e.id), "queued");
  } finally {
    await rig.harness.close();
  }
});

test("fila: envios simultâneos nunca passam do limite", async () => {
  const rig = await createQueueRig(2);
  try {
    const conversations = Array.from({ length: 7 }, () => rig.create());
    await Promise.all(
      conversations.map((conversation) => rig.harness.manager.send(conversation.id, "oi")),
    );
    const status = rig.harness.manager.queueStatus();
    assert.equal(status.running, 2);
    assert.equal(status.queuedConversationIds.length, 5);
    assert.equal(
      conversations.filter((conversation) => rig.stateOf(conversation.id) === "working").length,
      2,
    );
    // O adaptador só nasce depois da foto de restauração, que é assíncrona.
    await rig.until(() => rig.entries.size === 2, "dois adaptadores criados");
    assert.equal(rig.entries.size, 2);
    // Esvazia a fila por completo sem nunca passar do limite.
    for (let round = 0; round < 7; round += 1) {
      const running = conversations.filter((c) => rig.stateOf(c.id) === "working");
      assert.ok(running.length <= 2);
      for (const conversation of running) rig.finish(conversation.id);
      await rig.until(
        () =>
          conversations.every((c) => rig.stateOf(c.id) !== "working") ||
          conversations.filter((c) => rig.stateOf(c.id) === "working").length > 0,
        "próxima rodada",
      );
      await new Promise<void>((resolve) => setTimeout(resolve, 30));
    }
    assert.equal(rig.harness.manager.queueStatus().queuedConversationIds.length, 0);
  } finally {
    await rig.harness.close();
  }
});

test("fila: erro, parar e falha ao iniciar liberam a vaga e drenam", async () => {
  const rig = await createQueueRig(1);
  try {
    const [a, b, c, d, e] = [rig.create(), rig.create(), rig.create(), rig.create(), rig.create()];
    await rig.harness.manager.send(a.id, "a");
    await rig.harness.manager.send(b.id, "b");
    await rig.harness.manager.send(c.id, "c");
    await rig.harness.manager.send(d.id, "d");
    await rig.harness.manager.send(e.id, "e");
    // Erro de turno.
    rig.finish(a.id, "error");
    await rig.until(() => rig.stateOf(b.id) === "working", "b roda depois do erro de a");
    assert.equal(rig.stateOf(a.id), "error");
    // Parar o turno em andamento.
    assert.equal(await rig.harness.manager.stop(b.id), true);
    await rig.until(() => rig.stateOf(c.id) === "working", "c roda depois de parar b");
    assert.equal(rig.stateOf(b.id), "idle");
    rig.finish(c.id);
    await rig.until(() => rig.stateOf(d.id) === "working", "d roda");
    rig.finish(d.id);
    await rig.until(() => rig.stateOf(e.id) === "working", "e roda");
  } finally {
    await rig.harness.close();
  }
});

test("fila: falha ao iniciar o adaptador na saída da fila libera a vaga", async () => {
  const failFor = new Set<string>();
  const rig = await createQueueRig(1, failFor);
  try {
    const [a, b, c] = [rig.create(), rig.create(), rig.create()];
    failFor.add(b.id);
    await rig.harness.manager.send(a.id, "a");
    await rig.harness.manager.send(b.id, "b");
    await rig.harness.manager.send(c.id, "c");
    rig.finish(a.id);
    await rig.until(() => rig.stateOf(b.id) === "error", "b falha ao iniciar");
    await rig.until(() => rig.stateOf(c.id) === "working", "c ocupa a vaga liberada");
    assert.equal(rig.harness.manager.queueStatus().queuedConversationIds.length, 0);
  } finally {
    await rig.harness.close();
  }
});

test("fila: permissão ocupa vaga; plano pendente e processo ocioso não ocupam", async () => {
  const rig = await createQueueRig(1);
  try {
    const [a, b, c, d] = [rig.create(), rig.create(), rig.create(), rig.create()];
    // Esperando permissão ou resposta ocupa vaga.
    await rig.harness.manager.send(a.id, "a");
    rig.entries.get(a.id)?.emit({ kind: "state", state: "waiting" });
    await rig.until(() => rig.stateOf(a.id) === "waiting", "a espera");
    await rig.harness.manager.send(b.id, "b");
    assert.equal(rig.stateOf(b.id), "queued");
    // Plano pendente: turno terminado, não ocupa.
    rig.entries.get(a.id)?.emit({ kind: "state", state: "working" });
    rig.entries.get(a.id)?.emit({
      kind: "part",
      part: { id: "plano", type: "plan", markdown: "Plano", state: "pending" },
    });
    rig.finish(a.id);
    await rig.until(() => rig.stateOf(a.id) === "waiting", "a com plano pendente");
    await rig.until(() => rig.stateOf(b.id) === "working", "b usa a vaga do plano");
    // Processo ocioso no #active (a terminou) também não ocupa.
    rig.finish(b.id);
    await rig.until(() => rig.stateOf(b.id) === "idle", "b ocioso");
    await rig.harness.manager.send(c.id, "c");
    assert.equal(rig.stateOf(c.id), "working");
    assert.equal(rig.harness.manager.queueStatus().running, 1);
    rig.finish(c.id);
    await rig.until(() => rig.stateOf(c.id) === "idle", "c ocioso");
    await rig.harness.manager.send(d.id, "d");
    assert.equal(rig.stateOf(d.id), "working");
  } finally {
    await rig.harness.close();
  }
});

test("fila: parar na fila interrompe a mensagem sem iniciar o adaptador e não afeta o próximo", async () => {
  const rig = await createQueueRig(1);
  try {
    const [a, b, c] = [rig.create(), rig.create(), rig.create()];
    await rig.harness.manager.send(a.id, "a");
    const sentB = await rig.harness.manager.send(b.id, "b");
    await rig.harness.manager.send(c.id, "c");
    assert.equal(await rig.harness.manager.stop(b.id), true);
    assert.equal(rig.stateOf(b.id), "idle");
    assert.equal(rig.entries.has(b.id), false);
    const message = latestAgent(rig.harness, b.id);
    assert.equal(message?.id, sentB.agentMessage.id);
    assert.equal(message?.status, "interrupted");
    assert.ok(message?.parts.some((part) => part.type === "error" && part.retryable));
    assert.deepEqual(rig.harness.manager.queueStatus().queuedConversationIds, [c.id]);
    assert.equal(rig.stateOf(c.id), "queued");
    rig.finish(a.id);
    await rig.until(() => rig.stateOf(c.id) === "working", "c roda");
    assert.equal(rig.entries.has(b.id), false);
  } finally {
    await rig.harness.close();
  }
});

test("fila: apagar na fila remove o item e apagar o que roda drena", async () => {
  const rig = await createQueueRig(1);
  try {
    const [a, b, c] = [rig.create(), rig.create(), rig.create()];
    await rig.harness.manager.send(a.id, "a");
    await rig.harness.manager.send(b.id, "b");
    await rig.harness.manager.send(c.id, "c");
    assert.equal(await rig.harness.manager.remove(b.id), true);
    assert.deepEqual(rig.harness.manager.queueStatus().queuedConversationIds, [c.id]);
    assert.equal(await rig.harness.manager.remove(a.id), true);
    await rig.until(() => rig.stateOf(c.id) === "working", "c roda depois de apagar a");
    assert.equal(rig.entries.has(b.id), false);
  } finally {
    await rig.harness.close();
  }
});

test("fila: apagar todas limpa a fila", async () => {
  const rig = await createQueueRig(1);
  try {
    const [a, b] = [rig.create(), rig.create()];
    await rig.harness.manager.send(a.id, "a");
    await rig.harness.manager.send(b.id, "b");
    await rig.harness.manager.deleteAll();
    assert.deepEqual(rig.harness.manager.queueStatus(), {
      limit: 1,
      running: 0,
      queuedConversationIds: [],
    });
  } finally {
    await rig.harness.close();
  }
});

test("fila: reiniciar o serviço deixa a mensagem da fila interrompida e nada roda", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "karont-fila-restart-"));
  const dbPath = path.join(root, "karont.db");
  let db = openDatabase(dbPath);
  const conversation = createConversationRecord(db, {
    agent: "claude",
    title: "Na fila",
    cwd: os.tmpdir(),
    mode: "edit",
  });
  updateConversation(db, { ...conversation, state: "queued" });
  const now = new Date().toISOString();
  addMessage(db, {
    id: "queued-message",
    conversationId: conversation.id,
    author: "agent",
    status: "streaming",
    parts: [],
    createdAt: now,
    updatedAt: now,
  });
  db.close();
  db = openDatabase(dbPath);
  let factoryCalls = 0;
  const manager = new ConversationManager({
    db,
    env: { ...process.env, KARONT_DISABLE_AGENT_DETECTION: "1" },
    broadcast: async () => undefined,
    adapterFactory: () => {
      factoryCalls += 1;
      throw new Error("não deve rodar");
    },
  });
  try {
    assert.equal(manager.get(conversation.id)?.conversation.state, "idle");
    const message = getMessage(db, "queued-message");
    assert.equal(message?.status, "interrupted");
    assert.ok(message?.parts.some((part) => part.type === "error" && part.retryable));
    assert.deepEqual(manager.queueStatus().queuedConversationIds, []);
    assert.equal(factoryCalls, 0);
  } finally {
    await manager.close();
    db.close();
    await rm(root, { recursive: true, force: true });
  }
});

test("fila: aumentar o limite drena na hora e limite inválido vale 4", async () => {
  const rig = await createQueueRig(1);
  try {
    const [a, b, c] = [rig.create(), rig.create(), rig.create()];
    await rig.harness.manager.send(a.id, "a");
    await rig.harness.manager.send(b.id, "b");
    await rig.harness.manager.send(c.id, "c");
    setSetting(rig.harness.db, "agents.maxConcurrent", 2);
    rig.harness.manager.applyConcurrencyLimit();
    await rig.until(() => rig.stateOf(b.id) === "working", "b roda com limite 2");
    assert.equal(rig.stateOf(c.id), "queued");
    for (const invalid of ["muitos", 0, -1, 17, 2.5, null, true]) {
      setSetting(rig.harness.db, "agents.maxConcurrent", invalid);
      assert.equal(rig.harness.manager.queueStatus().limit, 4, `valor ${String(invalid)}`);
    }
  } finally {
    await rig.harness.close();
  }
});

test("fila: startedAt é zerado ao sair da fila", async () => {
  const rig = await createQueueRig(1);
  try {
    const [a, b] = [rig.create(), rig.create()];
    await rig.harness.manager.send(a.id, "a");
    const sentB = await rig.harness.manager.send(b.id, "b");
    const queuedStartedAt = sentB.agentMessage.startedAt as number;
    await new Promise<void>((resolve) => setTimeout(resolve, 25));
    rig.finish(a.id);
    await rig.until(() => rig.stateOf(b.id) === "working", "b sai da fila");
    const stored = getMessage(rig.harness.db, sentB.agentMessage.id);
    assert.ok((stored?.startedAt ?? 0) >= queuedStartedAt + 20);
    const event = rig.harness.events.find(
      (item) =>
        item.event === "conversation.stateChanged" &&
        "messageId" in item.payload &&
        item.payload.messageId === sentB.agentMessage.id &&
        item.payload.conversation.state === "working",
    );
    assert.ok(
      event?.event === "conversation.stateChanged" &&
        "messageStartedAt" in event.payload &&
        (event.payload.messageStartedAt ?? 0) >= queuedStartedAt + 20,
    );
  } finally {
    await rig.harness.close();
  }
});

test("fila: queue.changed não repete payload igual e bate com queueStatus", async () => {
  const rig = await createQueueRig(1);
  try {
    const [a, b, c] = [rig.create(), rig.create(), rig.create()];
    await rig.harness.manager.send(a.id, "a");
    await rig.harness.manager.send(b.id, "b");
    await rig.harness.manager.send(c.id, "c");
    rig.finish(a.id);
    await rig.until(() => rig.stateOf(b.id) === "working", "b roda");
    rig.finish(b.id);
    await rig.until(() => rig.stateOf(c.id) === "working", "c roda");
    await new Promise<void>((resolve) => setTimeout(resolve, 30));
    const payloads = rig.harness.events.flatMap((event) =>
      event.event === "queue.changed" ? [JSON.stringify(event.payload)] : [],
    );
    assert.ok(payloads.length >= 3);
    for (let index = 1; index < payloads.length; index += 1)
      assert.notEqual(payloads[index], payloads[index - 1]);
    assert.equal(payloads.at(-1), JSON.stringify(rig.harness.manager.queueStatus()));
  } finally {
    await rig.harness.close();
  }
});

test("fila: mandar mensagem, tentar de novo e ramificar numa conversa na fila dão erro", async () => {
  const rig = await createQueueRig(1);
  try {
    const [a, b] = [rig.create(), rig.create()];
    await rig.harness.manager.send(a.id, "a");
    const sentB = await rig.harness.manager.send(b.id, "b");
    assert.equal(rig.stateOf(b.id), "queued");
    await assert.rejects(rig.harness.manager.send(b.id, "de novo"), /em andamento/);
    await assert.rejects(rig.harness.manager.retry(b.id), /em andamento/);
    await assert.rejects(rig.harness.manager.branch(b.id, sentB.agentMessage.id), /Espere/);
    await assert.rejects(rig.harness.manager.setOptions(b.id, { mode: "full" }), /parada/);
  } finally {
    await rig.harness.close();
  }
});

// ---------------------------------------------------------------------------
// Pontos de restauração (M3-B2a)
// ---------------------------------------------------------------------------

function cleanGitEnv(): NodeJS.ProcessEnv {
  const env = { ...process.env };
  for (const name of [
    "GIT_DIR",
    "GIT_WORK_TREE",
    "GIT_INDEX_FILE",
    "GIT_PREFIX",
    "GIT_COMMON_DIR",
    "GIT_OBJECT_DIRECTORY",
  ])
    delete env[name];
  return env;
}

function git(cwd: string, ...args: string[]): string {
  return execFileSync("git", args, { cwd, env: cleanGitEnv(), encoding: "utf8" });
}

async function createTestRepo(withCommit = true): Promise<string> {
  const root = await realpath(await mkdtemp(path.join(os.tmpdir(), "karont-rp-repo-")));
  git(root, "init", "-q", "-b", "main");
  git(root, "config", "user.name", "Teste");
  git(root, "config", "user.email", "teste@example.com");
  if (withCommit) {
    await writeFile(path.join(root, "base.txt"), "base\n");
    git(root, "add", "-A");
    git(root, "commit", "-q", "-m", "inicial");
  }
  return root;
}

type RestoreCall = { phase: "before" | "after"; messageId: string; conversationId: string };

type RestoreRigOptions = {
  restoreSnapshot?: (request: RestoreSnapshotRequest) => Promise<RestoreSnapshotOutcome>;
  homeDir?: string;
  env?: NodeJS.ProcessEnv;
  limit?: number;
  onSend?: (conversationId: string) => Promise<void> | void;
  compact?: boolean;
};

async function createRestoreRig(options: RestoreRigOptions = {}) {
  const entries = new Map<
    string,
    { emit: (event: AdapterEvent) => void; starts: number; sends: number; interrupts: number }
  >();
  const order: string[] = [];
  const harness = await createHarness("texto", options.env ?? {}, {
    ...(options.homeDir ? { homeDir: options.homeDir } : {}),
    ...(options.restoreSnapshot ? { restoreSnapshot: options.restoreSnapshot } : {}),
    adapterFactory: (conversation, emit) => {
      const entry = { emit, starts: 0, sends: 0, interrupts: 0 };
      entries.set(conversation.id, entry);
      return {
        start: async () => {
          entry.starts += 1;
        },
        send: async () => {
          entry.sends += 1;
          order.push("send");
          await options.onSend?.(conversation.id);
          emit({ kind: "state", state: "working" });
        },
        ...(options.compact
          ? {
              compact: async () => {
                order.push("compact");
                emit({ kind: "state", state: "working" });
              },
            }
          : {}),
        respond: async () => undefined,
        interrupt: async () => {
          entry.interrupts += 1;
          emit({
            kind: "turn-end",
            status: "interrupted",
            error: { type: "interrupted", text: "Interrompida." },
          });
        },
        dispose: async () => undefined,
      };
    },
  });
  if (options.limit !== undefined) setSetting(harness.db, "agents.maxConcurrent", options.limit);
  const create = (cwd: string) =>
    harness.manager.create({ agent: "claude", title: "Conversa de teste", cwd, mode: "edit" });
  const until = async (predicate: () => boolean, label: string, attempts = 300) => {
    for (let attempt = 0; attempt < attempts; attempt += 1) {
      if (predicate()) return;
      await new Promise<void>((resolve) => setTimeout(resolve, 10));
    }
    throw new Error(`Timeout esperando: ${label}`);
  };
  const finish = (id: string, status: "done" | "error" = "done") =>
    entries
      .get(id)
      ?.emit(
        status === "error"
          ? { kind: "turn-end", status, error: { type: "failed", text: "falhou" } }
          : { kind: "turn-end", status },
      );
  const stateOf = (id: string) => harness.manager.get(id)?.conversation.state;
  return { harness, entries, order, create, until, finish, stateOf };
}

/** Foto simulada: guarda as chamadas e devolve um commit falso por fase/mensagem. */
function recordingSnapshot(
  calls: RestoreCall[],
  repoRoot: string | ((request: RestoreSnapshotRequest) => string) = "/repo-falso",
  hooks: { gate?: (request: RestoreSnapshotRequest) => Promise<void> | undefined } = {},
) {
  return async (request: RestoreSnapshotRequest): Promise<RestoreSnapshotOutcome> => {
    calls.push({
      phase: request.phase,
      messageId: request.messageId,
      conversationId: request.conversationId,
    });
    await hooks.gate?.(request);
    const root = typeof repoRoot === "function" ? repoRoot(request) : repoRoot;
    return { repoRoot: root, commit: `${request.phase}-${request.messageId}`, head: null };
  };
}

async function withDeadline<T>(promise: Promise<T>, ms: number, label: string): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([
      promise,
      new Promise<never>((_, reject) => {
        timer = setTimeout(() => reject(new Error(`Preso: ${label}`)), ms);
      }),
    ]);
  } finally {
    if (timer) clearTimeout(timer);
  }
}

test("restauração: pasta sem Git grava no-git e a mensagem segue", async () => {
  const rig = await createRestoreRig();
  try {
    const cwd = await mkdtemp(path.join(os.tmpdir(), "karont-rp-nogit-"));
    const conversation = rig.create(cwd);
    const { agentMessage } = await rig.harness.manager.send(conversation.id, "oi");
    assert.equal(rig.entries.get(conversation.id)?.sends, 1);
    const row = getRestorePoint(rig.harness.db, agentMessage.id);
    assert.equal(row?.unavailableReason, "no-git");
    assert.equal(row?.repoRoot, null);
    assert.equal(row?.beforeCommit, null);
  } finally {
    await rig.harness.close();
  }
});

test("restauração: raiz na pasta pessoal grava home, sem criar ref, e a mensagem segue", async () => {
  const repo = await createTestRepo();
  const rig = await createRestoreRig({ homeDir: repo });
  try {
    const conversation = rig.create(repo);
    const { agentMessage } = await rig.harness.manager.send(conversation.id, "oi");
    assert.equal(rig.entries.get(conversation.id)?.sends, 1);
    assert.equal(getRestorePoint(rig.harness.db, agentMessage.id)?.unavailableReason, "home");
    rig.finish(conversation.id);
    await rig.until(() => rig.stateOf(conversation.id) === "idle", "turno termina");
    assert.equal(git(repo, "for-each-ref", "refs/karont").trim(), "");
  } finally {
    await rig.harness.close();
  }
});

test("restauração: foto que falha ou estoura o tempo não impede a mensagem e guarda o motivo", async () => {
  const failing = await createRestoreRig({
    restoreSnapshot: async () => {
      throw new Error("git quebrou");
    },
  });
  try {
    const conversation = failing.create(os.tmpdir());
    const { agentMessage } = await failing.harness.manager.send(conversation.id, "oi");
    assert.equal(failing.entries.get(conversation.id)?.sends, 1);
    assert.equal(getRestorePoint(failing.harness.db, agentMessage.id)?.unavailableReason, "failed");
  } finally {
    await failing.harness.close();
  }

  const hanging = await createRestoreRig({
    env: { KARONT_RESTORE_TIMEOUT_MS: "60" },
    restoreSnapshot: () => new Promise<RestoreSnapshotOutcome>(() => undefined),
  });
  try {
    const conversation = hanging.create(os.tmpdir());
    const { agentMessage } = await withDeadline(
      hanging.harness.manager.send(conversation.id, "oi"),
      3_000,
      "send com foto travada",
    );
    assert.equal(hanging.entries.get(conversation.id)?.sends, 1);
    assert.equal(
      getRestorePoint(hanging.harness.db, agentMessage.id)?.unavailableReason,
      "timeout",
    );
  } finally {
    await hanging.harness.close();
  }
});

test("restauração: parar durante a foto devolve true, interrompe e nunca inicia o adaptador", async () => {
  let started: () => void = () => undefined;
  const snapshotStarted = new Promise<void>((resolve) => {
    started = resolve;
  });
  let sawAbort = false;
  const rig = await createRestoreRig({
    restoreSnapshot: (request) =>
      new Promise<RestoreSnapshotOutcome>((resolve) => {
        started();
        request.signal.addEventListener("abort", () => {
          sawAbort = true;
          resolve({ repoRoot: null, unavailable: "failed" });
        });
      }),
  });
  try {
    const conversation = rig.create(os.tmpdir());
    const sending = rig.harness.manager.send(conversation.id, "oi");
    await snapshotStarted;
    assert.equal(await rig.harness.manager.stop(conversation.id), true);
    const { agentMessage } = await sending;
    assert.equal(sawAbort, true);
    const stored = rig.harness.manager.get(conversation.id);
    const message = stored?.messages.find((item) => item.id === agentMessage.id);
    assert.equal(message?.status, "interrupted");
    assert.equal(stored?.conversation.state, "idle");
    const errorPart = message?.parts.find((part) => part.type === "error");
    assert.equal(errorPart?.type === "error" ? errorPart.errorType : "", "interrupted");
    assert.equal(rig.entries.has(conversation.id), false);
    assert.equal(getRestorePoint(rig.harness.db, agentMessage.id), null);
  } finally {
    await rig.harness.close();
  }
});

test("restauração: remove e deleteAll durante a foto não ficam presos", async () => {
  for (const mode of ["remove", "deleteAll"] as const) {
    let started: () => void = () => undefined;
    const snapshotStarted = new Promise<void>((resolve) => {
      started = resolve;
    });
    const rig = await createRestoreRig({
      // Ignora o sinal de propósito: o serviço não pode depender da boa vontade da foto.
      restoreSnapshot: () => {
        started();
        return new Promise<RestoreSnapshotOutcome>(() => undefined);
      },
    });
    try {
      const conversation = rig.create(os.tmpdir());
      const sending = rig.harness.manager.send(conversation.id, "oi");
      await snapshotStarted;
      if (mode === "remove") {
        assert.equal(
          await withDeadline(rig.harness.manager.remove(conversation.id), 3_000, "remove"),
          true,
        );
      } else {
        assert.equal(await withDeadline(rig.harness.manager.deleteAll(), 3_000, "deleteAll"), 1);
      }
      await withDeadline(sending, 3_000, "send depois de apagar");
      assert.equal(rig.entries.has(conversation.id), false);
      assert.equal(rig.harness.manager.get(conversation.id), null);
    } finally {
      await rig.harness.close();
    }
  }
});

test("restauração: before antes de adapter.send, after no fim, também em erro e em parar", async () => {
  const calls: RestoreCall[] = [];
  const rig = await createRestoreRig({
    restoreSnapshot: async (request) => {
      rig.order.push(request.phase);
      return recordingSnapshot(calls)(request);
    },
  });
  try {
    const conversation = rig.create(os.tmpdir());
    const first = await rig.harness.manager.send(conversation.id, "um");
    assert.deepEqual(rig.order, ["before", "send"]);
    rig.finish(conversation.id);
    await rig.until(() => rig.order.length === 3, "after do primeiro turno");
    assert.deepEqual(rig.order, ["before", "send", "after"]);
    await rig.until(
      () => getRestorePoint(rig.harness.db, first.agentMessage.id)?.afterCommit !== null,
      "after gravado",
    );
    const row = getRestorePoint(rig.harness.db, first.agentMessage.id);
    assert.equal(row?.beforeCommit, `before-${first.agentMessage.id}`);
    assert.equal(row?.afterCommit, `after-${first.agentMessage.id}`);

    // Erro do turno.
    const second = await rig.harness.manager.send(conversation.id, "dois");
    rig.finish(conversation.id, "error");
    await rig.until(
      () => getRestorePoint(rig.harness.db, second.agentMessage.id)?.afterCommit !== null,
      "after depois de erro",
    );

    // Parar durante o turno.
    const third = await rig.harness.manager.send(conversation.id, "três");
    assert.equal(await rig.harness.manager.stop(conversation.id), true);
    await rig.until(
      () => getRestorePoint(rig.harness.db, third.agentMessage.id)?.afterCommit !== null,
      "after depois de parar",
    );
  } finally {
    await rig.harness.close();
  }
});

test("restauração: after também roda quando o adaptador falha ao iniciar", async () => {
  const calls: RestoreCall[] = [];
  const harness = await createHarness(
    "texto",
    {},
    {
      restoreSnapshot: recordingSnapshot(calls),
      adapterFactory: () => ({
        start: async () => {
          throw new Error("falha ao iniciar");
        },
        send: async () => undefined,
        respond: async () => undefined,
        interrupt: async () => undefined,
        dispose: async () => undefined,
      }),
    },
  );
  try {
    const conversation = createConversation(harness.manager);
    const { agentMessage } = await harness.manager.send(conversation.id, "oi");
    for (let attempt = 0; attempt < 200; attempt += 1) {
      if (getRestorePoint(harness.db, agentMessage.id)?.afterCommit) break;
      await new Promise<void>((resolve) => setTimeout(resolve, 10));
    }
    assert.equal(harness.manager.get(conversation.id)?.conversation.state, "error");
    assert.equal(
      getRestorePoint(harness.db, agentMessage.id)?.afterCommit,
      `after-${agentMessage.id}`,
    );
  } finally {
    await harness.close();
  }
});

test("restauração: plano pendente não tira after; compactar e mensagem tirada da fila não criam linha", async () => {
  const calls: RestoreCall[] = [];
  const rig = await createRestoreRig({
    restoreSnapshot: recordingSnapshot(calls),
    limit: 1,
    compact: true,
  });
  try {
    const first = rig.create(os.tmpdir());
    const { agentMessage } = await rig.harness.manager.send(first.id, "planeje");
    rig.entries.get(first.id)?.emit({
      kind: "part",
      part: { id: "plano-1", type: "plan", markdown: "1. Ler", state: "pending" },
    });
    rig.finish(first.id);
    await rig.until(() => rig.stateOf(first.id) === "waiting", "plano aguardando");
    await new Promise<void>((resolve) => setTimeout(resolve, 80));
    assert.deepEqual(
      calls.map((call) => call.phase),
      ["before"],
    );
    assert.equal(getRestorePoint(rig.harness.db, agentMessage.id)?.afterCommit, null);

    // Mensagem tirada da fila: sem linha. O plano pendente não ocupa vaga, então ocupa-se uma.
    const second = rig.create(os.tmpdir());
    const running = await rig.harness.manager.send(second.id, "ocupa a vaga");
    const third = rig.create(os.tmpdir());
    const queued = await rig.harness.manager.send(third.id, "na fila");
    assert.equal(rig.stateOf(third.id), "queued");
    assert.equal(await rig.harness.manager.stop(third.id), true);
    assert.equal(getRestorePoint(rig.harness.db, queued.agentMessage.id), null);
    assert.equal(listRestorePoints(rig.harness.db, third.id).length, 0);
    rig.finish(second.id);
    await rig.until(
      () => getRestorePoint(rig.harness.db, running.agentMessage.id)?.afterCommit !== null,
      "after da vaga",
    );

    // Compactar não cria ponto.
    setAgentSession(rig.harness.db, second.id, "sessao-1");
    const before = calls.length;
    await rig.harness.manager.compact(second.id);
    assert.equal(calls.length, before);
    assert.equal(listRestorePoints(rig.harness.db, second.id).length, 1);
    assert.equal(rig.order.includes("compact"), true);
  } finally {
    await rig.harness.close();
  }
});

test("restauração: a segunda mensagem espera a foto after da primeira", async () => {
  const calls: RestoreCall[] = [];
  let release: () => void = () => undefined;
  const gate = new Promise<void>((resolve) => {
    release = resolve;
  });
  const rig = await createRestoreRig({
    restoreSnapshot: recordingSnapshot(calls, "/repo-falso", {
      gate: (request) => (request.phase === "after" ? gate : undefined),
    }),
  });
  try {
    const conversation = rig.create(os.tmpdir());
    await rig.harness.manager.send(conversation.id, "um");
    rig.finish(conversation.id);
    await rig.until(() => calls.some((call) => call.phase === "after"), "after começou");
    await rig.until(() => rig.stateOf(conversation.id) === "idle", "conversa livre");
    const second = rig.harness.manager.send(conversation.id, "dois");
    await new Promise<void>((resolve) => setTimeout(resolve, 100));
    assert.deepEqual(
      calls.map((call) => call.phase),
      ["before", "after"],
    );
    release();
    await second;
    assert.deepEqual(
      calls.map((call) => call.phase),
      ["before", "after", "before"],
    );
    assert.equal(rig.entries.get(conversation.id)?.sends, 2);
  } finally {
    release();
    await rig.harness.close();
  }
});

test("restauração: dois turnos no mesmo repositório marcam concurrent; repositórios diferentes não", async () => {
  const calls: RestoreCall[] = [];
  const rig = await createRestoreRig({
    restoreSnapshot: recordingSnapshot(calls, (request) =>
      request.cwd.endsWith("-b") ? "/repo-b" : "/repo-a",
    ),
  });
  try {
    const cwdA = path.join(os.tmpdir(), "proj-a");
    const cwdA2 = path.join(os.tmpdir(), "proj-a2");
    const cwdB = path.join(os.tmpdir(), "proj-b");
    const [one, two, other] = [rig.create(cwdA), rig.create(cwdA2), rig.create(cwdB)];
    const a = await rig.harness.manager.send(one.id, "a");
    assert.equal(getRestorePoint(rig.harness.db, a.agentMessage.id)?.concurrent, false);
    const c = await rig.harness.manager.send(other.id, "c");
    assert.equal(getRestorePoint(rig.harness.db, c.agentMessage.id)?.concurrent, false);
    assert.equal(getRestorePoint(rig.harness.db, a.agentMessage.id)?.concurrent, false);
    const b = await rig.harness.manager.send(two.id, "b");
    assert.equal(getRestorePoint(rig.harness.db, a.agentMessage.id)?.concurrent, true);
    assert.equal(getRestorePoint(rig.harness.db, b.agentMessage.id)?.concurrent, true);
    assert.equal(getRestorePoint(rig.harness.db, c.agentMessage.id)?.concurrent, false);

    // Depois que os dois terminam, um turno novo no mesmo repositório começa limpo.
    rig.finish(one.id);
    rig.finish(two.id);
    await rig.until(
      () =>
        getRestorePoint(rig.harness.db, a.agentMessage.id)?.afterCommit !== null &&
        getRestorePoint(rig.harness.db, b.agentMessage.id)?.afterCommit !== null,
      "afters",
    );
    const d = await rig.harness.manager.send(one.id, "d");
    assert.equal(getRestorePoint(rig.harness.db, d.agentMessage.id)?.concurrent, false);
  } finally {
    await rig.harness.close();
  }
});

test("restauração: plano aprovado volta a contar como turno no mesmo repositório", async () => {
  const calls: RestoreCall[] = [];
  const rig = await createRestoreRig({
    restoreSnapshot: recordingSnapshot(calls, () => "/repo-a"),
  });
  try {
    const planner = rig.create(path.join(os.tmpdir(), "proj-plano"));
    const { agentMessage: planned } = await rig.harness.manager.send(planner.id, "planeje");
    rig.entries.get(planner.id)?.emit({
      kind: "part",
      part: { id: "plano-2", type: "plan", markdown: "1. Editar", state: "pending" },
    });
    rig.finish(planner.id);
    await rig.until(() => rig.stateOf(planner.id) === "waiting", "plano aguardando");

    // A aprovação retoma a mesma mensagem: é nessa fase que o agente escreve.
    rig.entries.get(planner.id)?.emit({ kind: "state", state: "working" });
    await rig.until(() => rig.stateOf(planner.id) === "working", "plano aprovado");

    const other = rig.create(path.join(os.tmpdir(), "proj-outro"));
    const { agentMessage: running } = await rig.harness.manager.send(other.id, "outro agente");
    assert.equal(getRestorePoint(rig.harness.db, planned.id)?.concurrent, true);
    assert.equal(getRestorePoint(rig.harness.db, running.id)?.concurrent, true);
  } finally {
    await rig.harness.close();
  }
});

test("restauração com Git de verdade: fotos antes e depois, limite de 50 e limpeza das refs", async () => {
  const repo = await createTestRepo();
  const rig = await createRestoreRig({
    onSend: async () => {
      await writeFile(path.join(repo, "novo.txt"), `${Math.random()}\n`);
    },
  });
  try {
    const conversation = rig.create(repo);
    const ids: string[] = [];
    for (let index = 0; index < 52; index += 1) {
      const { agentMessage } = await rig.harness.manager.send(conversation.id, `m${index}`);
      ids.push(agentMessage.id);
      rig.finish(conversation.id);
      await rig.until(
        () => getRestorePoint(rig.harness.db, agentMessage.id)?.afterCommit !== null,
        `after ${index}`,
        500,
      );
      if (index === 0) {
        const row = getRestorePoint(rig.harness.db, agentMessage.id);
        assert.equal(row?.repoRoot, repo);
        const headNow = git(repo, "rev-parse", "HEAD").trim();
        assert.equal(row?.headBefore, headNow);
        assert.equal(row?.headAfter, headNow);
        const before = git(repo, "ls-tree", "-r", "--name-only", row?.beforeCommit ?? "").split(
          "\n",
        );
        const after = git(repo, "ls-tree", "-r", "--name-only", row?.afterCommit ?? "").split("\n");
        assert.equal(before.includes("novo.txt"), false);
        assert.equal(after.includes("novo.txt"), true);
      }
    }
    await rig.until(
      () => listRestorePoints(rig.harness.db, conversation.id).length === 50,
      "50 pontos",
      500,
    );
    const refs = () =>
      git(repo, "for-each-ref", "--format=%(refname)", "refs/karont").split("\n").filter(Boolean);
    await rig.until(() => refs().length === 100, "100 refs", 500);
    const remaining = new Set(
      listRestorePoints(rig.harness.db, conversation.id).map((p) => p.messageId),
    );
    assert.equal(remaining.has(ids[0] as string), false);
    assert.equal(remaining.has(ids[1] as string), false);
    assert.equal(remaining.has(ids[51] as string), true);
    for (const old of ids.slice(0, 2)) {
      assert.equal(
        refs().some((ref) => ref.includes(old)),
        false,
      );
    }
    assert.equal(await rig.harness.manager.remove(conversation.id), true);
    await rig.until(() => refs().length === 0, "refs apagadas com a conversa", 500);
  } finally {
    await rig.harness.close();
  }
});

// ---------------------------------------------------------------------------
// Ver mudanças e desfazer (M3-B2b)
// ---------------------------------------------------------------------------

type RestoreChangedEvent = Extract<AnyEvent, { event: "restore.changed" }>;

function restoreEvents(rig: { harness: Harness }): RestoreChangedEvent["payload"][] {
  return rig.harness.events
    .filter((event): event is RestoreChangedEvent => event.event === "restore.changed")
    .map((event) => event.payload);
}

async function pathExists(target: string): Promise<boolean> {
  return stat(target).then(
    () => true,
    () => false,
  );
}

/** Turno completo com o agente falso mexendo em arquivos; devolve quando o ponto está pronto. */
async function runUndoableTurn(
  rig: Awaited<ReturnType<typeof createRestoreRig>>,
  conversationId: string,
  text = "mexe nos arquivos",
) {
  const { agentMessage } = await rig.harness.manager.send(conversationId, text);
  rig.finish(conversationId);
  await rig.until(
    () => rig.harness.manager.restoreList(conversationId).points.at(-1)?.state === "ready",
    "ponto pronto",
    500,
  );
  await rig.until(() => rig.stateOf(conversationId) === "idle", "conversa parada");
  return agentMessage.id;
}

test("desfazer: lista, diff, prévia e desfazer em repositório real, com eventos", async () => {
  const repo = await createTestRepo();
  await writeFile(path.join(repo, "modificado.txt"), "guardado\n");
  git(repo, "add", "-A");
  git(repo, "commit", "-q", "-m", "mais arquivos");
  await writeFile(path.join(repo, "modificado.txt"), "guardado\n");
  await writeFile(path.join(repo, "apagado.txt"), "apagado\n");
  await writeFile(path.join(repo, "com espaço.txt"), "espaço\n");
  await writeFile(path.join(repo, "estrela*.txt"), "estrela\n");
  await writeFile(path.join(repo, "binario.bin"), Buffer.from([0, 1, 2, 0]));
  git(repo, "add", "-A");
  git(repo, "commit", "-q", "-m", "arquivos");
  await writeFile(path.join(repo, "base.txt"), "guardado no stash\n");
  git(repo, "stash", "push", "-q", "-m", "do usuário");
  const before = {
    status: git(repo, "status", "--porcelain"),
    head: git(repo, "rev-parse", "HEAD"),
    heads: git(repo, "for-each-ref", "refs/heads"),
    stash: git(repo, "stash", "list"),
    index: git(repo, "ls-files", "--stage"),
  };
  const originals = new Map<string, Buffer>();
  for (const name of [
    "modificado.txt",
    "apagado.txt",
    "com espaço.txt",
    "estrela*.txt",
    "binario.bin",
  ])
    originals.set(name, await readFile(path.join(repo, name)));

  const rig = await createRestoreRig({
    onSend: async () => {
      await rm(path.join(repo, "apagado.txt"));
      await rename(path.join(repo, "com espaço.txt"), path.join(repo, "novo espaço.txt"));
      await writeFile(path.join(repo, "modificado.txt"), "do agente\n");
      await writeFile(path.join(repo, "estrela*.txt"), "estrela do agente\n");
      await writeFile(path.join(repo, "binario.bin"), Buffer.from([7, 0, 7]));
      await mkdir(path.join(repo, "pasta", "funda"), { recursive: true });
      await writeFile(path.join(repo, "pasta", "funda", "novo.txt"), "novo\n");
    },
  });
  try {
    const conversation = rig.create(repo);
    const messageId = await runUndoableTurn(rig, conversation.id);
    const { manager } = rig.harness;

    const listed = manager.restoreList(conversation.id).points;
    assert.deepEqual(listed, [
      { messageId, state: "ready", changedFiles: 6, concurrent: false, headMoved: false },
    ]);
    const events = restoreEvents(rig);
    assert.equal(events.at(-1)?.conversationId, conversation.id);
    assert.deepEqual(events.at(-1)?.point, listed[0]);

    const changes = await manager.restoreChanges(conversation.id, messageId);
    assert.equal(changes.truncated, false);
    assert.deepEqual(changes.files.map((file) => file.path).sort(), [
      "apagado.txt",
      "binario.bin",
      "estrela*.txt",
      "modificado.txt",
      "novo espaço.txt",
      "pasta/funda/novo.txt",
    ]);
    assert.equal(changes.files.find((file) => file.path === "binario.bin")?.binary, true);
    const renamed = changes.files.find((file) => file.path === "novo espaço.txt");
    assert.equal(renamed?.status, "renamed");
    assert.equal(renamed?.oldPath, "com espaço.txt");
    const diff = await manager.restoreDiff(conversation.id, messageId, "estrela*.txt");
    assert.match(diff.patch, /^\+estrela do agente$/m);
    await assert.rejects(
      manager.restoreDiff(conversation.id, messageId, "base.txt"),
      (error: unknown) => error instanceof ServiceError && error.code === "invalid_request",
    );
    await assert.rejects(
      manager.restoreChanges(conversation.id, "mensagem-que-nao-existe"),
      (error: unknown) => error instanceof ServiceError && error.code === "invalid_request",
    );

    // O usuário mexe num dos arquivos do ponto e num que não é do ponto.
    await writeFile(path.join(repo, "modificado.txt"), "do usuário depois\n");
    await writeFile(path.join(repo, "base.txt"), "base mexida pelo usuário\n");
    const preview = await manager.undoPreview(conversation.id, messageId);
    assert.deepEqual(preview, {
      files: 7,
      userChanged: ["modificado.txt"],
      headMoved: false,
      concurrent: false,
      submodulesSkipped: [],
    });
    const eventsBefore = restoreEvents(rig).length;
    const result = await manager.undo(conversation.id, messageId);
    assert.deepEqual(result, { restored: 5, removed: 2 });

    for (const [name, content] of originals) {
      assert.deepEqual(await readFile(path.join(repo, name)), content, name);
    }
    assert.equal(await readFile(path.join(repo, "base.txt"), "utf8"), "base mexida pelo usuário\n");
    assert.equal(await pathExists(path.join(repo, "pasta")), false);
    assert.equal(await pathExists(path.join(repo, "novo espaço.txt")), false);
    assert.deepEqual(
      {
        head: git(repo, "rev-parse", "HEAD"),
        heads: git(repo, "for-each-ref", "refs/heads"),
        stash: git(repo, "stash", "list"),
        index: git(repo, "ls-files", "--stage"),
      },
      { head: before.head, heads: before.heads, stash: before.stash, index: before.index },
    );
    assert.equal(git(repo, "status", "--porcelain"), " M base.txt\n");

    const row = getRestorePoint(rig.harness.db, messageId);
    assert.ok(row?.undoneAt);
    assert.ok(row?.undoCommit);
    const undoRefName = `refs/karont/restore/${conversation.id}/${messageId}/undo`;
    assert.equal(git(repo, "rev-parse", undoRefName).trim(), row?.undoCommit);
    assert.equal(git(repo, "show", `${undoRefName}:modificado.txt`), "do usuário depois\n");
    assert.equal(manager.restoreList(conversation.id).points[0]?.state, "undone");
    const emitted = restoreEvents(rig);
    assert.equal(emitted.length, eventsBefore + 1);
    assert.equal(emitted.at(-1)?.point.state, "undone");

    await assert.rejects(manager.undo(conversation.id, messageId), /já foi desfeita/);
    await assert.rejects(manager.undoPreview(conversation.id, messageId), /já foi desfeita/);

    // Apagar a conversa apaga as três refs, inclusive a do desfazer.
    assert.equal(await manager.remove(conversation.id), true);
    const refs = () =>
      git(repo, "for-each-ref", "--format=%(refname)", "refs/karont").split("\n").filter(Boolean);
    await rig.until(() => refs().length === 0, "refs apagadas com a conversa", 500);
  } finally {
    await rig.harness.close();
  }
});

test("desfazer: restore.list só lê o banco e ponto sem mudança tem changedFiles 0", async () => {
  const repo = await createTestRepo();
  const rig = await createRestoreRig();
  try {
    const conversation = rig.create(repo);
    const messageId = await runUndoableTurn(rig, conversation.id, "só conversa");
    assert.deepEqual(rig.harness.manager.restoreList(conversation.id).points, [
      { messageId, state: "ready", changedFiles: 0, concurrent: false, headMoved: false },
    ]);
    const changes = await rig.harness.manager.restoreChanges(conversation.id, messageId);
    assert.deepEqual(changes, { files: [], truncated: false });
    // Sem o repositório, a lista continua saindo do banco; só ler as mudanças falha.
    await rm(repo, { recursive: true, force: true });
    assert.equal(rig.harness.manager.restoreList(conversation.id).points.length, 1);
    await assert.rejects(rig.harness.manager.restoreChanges(conversation.id, messageId), Error);
    assert.throws(() => rig.harness.manager.restoreList("conversa-inexistente"), /não encontrada/);
  } finally {
    await rig.harness.close();
  }
});

test("desfazer: estados unavailable (com motivo), incomplete e undone bloqueiam o desfazer", async () => {
  const plain = await mkdtemp(path.join(os.tmpdir(), "karont-undo-nogit-"));
  const repo = await createTestRepo();
  const rig = await createRestoreRig({
    restoreSnapshot: async (request) => {
      if (request.phase === "after") return { repoRoot: request.repoRoot, unavailable: "failed" };
      return takeRestorePoint(request);
    },
  });
  try {
    const noGit = rig.create(plain);
    const first = await rig.harness.manager.send(noGit.id, "oi");
    assert.deepEqual(rig.harness.manager.restoreList(noGit.id).points, [
      {
        messageId: first.agentMessage.id,
        state: "unavailable",
        reason: "no-git",
        changedFiles: 0,
        concurrent: false,
        headMoved: false,
      },
    ]);
    assert.equal(restoreEvents(rig).at(-1)?.point.state, "unavailable");
    assert.equal(restoreEvents(rig).at(-1)?.point.reason, "no-git");
    await assert.rejects(
      rig.harness.manager.undo(noGit.id, first.agentMessage.id),
      /não tem ponto/,
    );
    await assert.rejects(
      rig.harness.manager.restoreChanges(noGit.id, first.agentMessage.id),
      /não tem ponto/,
    );

    const gitted = rig.create(repo);
    const second = await rig.harness.manager.send(gitted.id, "oi");
    rig.finish(gitted.id);
    await rig.until(() => rig.stateOf(gitted.id) === "idle", "parada");
    await new Promise<void>((resolve) => setTimeout(resolve, 100));
    assert.equal(rig.harness.manager.restoreList(gitted.id).points[0]?.state, "incomplete");
    await assert.rejects(
      rig.harness.manager.undo(gitted.id, second.agentMessage.id),
      /por completo/,
    );
    await assert.rejects(
      rig.harness.manager.undoPreview(gitted.id, second.agentMessage.id),
      /por completo/,
    );
  } finally {
    await rig.harness.close();
  }
});

test("desfazer: agente que fez commit marca headMoved e o commit continua na branch", async () => {
  const repo = await createTestRepo();
  const rig = await createRestoreRig({
    onSend: async () => {
      await writeFile(path.join(repo, "base.txt"), "commitada pelo agente\n");
      await writeFile(path.join(repo, "extra.txt"), "extra\n");
      git(repo, "add", "-A");
      git(repo, "commit", "-q", "-m", "do agente");
    },
  });
  try {
    const conversation = rig.create(repo);
    const messageId = await runUndoableTurn(rig, conversation.id);
    const head = git(repo, "rev-parse", "HEAD");
    const point = rig.harness.manager.restoreList(conversation.id).points[0];
    assert.equal(point?.headMoved, true);
    assert.equal(
      (await rig.harness.manager.undoPreview(conversation.id, messageId)).headMoved,
      true,
    );
    await rig.harness.manager.undo(conversation.id, messageId);
    assert.equal(await readFile(path.join(repo, "base.txt"), "utf8"), "base\n");
    assert.equal(await pathExists(path.join(repo, "extra.txt")), false);
    assert.equal(git(repo, "rev-parse", "HEAD"), head);
    assert.match(git(repo, "log", "--format=%s", "main"), /do agente/);
  } finally {
    await rig.harness.close();
  }
});

test("desfazer: bloqueado com conversa ocupada, turno no mesmo repositório e durante outro desfazer", async () => {
  const repo = await createTestRepo();
  const rig = await createRestoreRig({
    onSend: async () => {
      await writeFile(path.join(repo, "base.txt"), `${Math.random()}\n`);
    },
  });
  try {
    const a = rig.create(repo);
    const b = rig.create(repo);
    const messageId = await runUndoableTurn(rig, a.id);
    const { manager } = rig.harness;

    // Conversa ocupada.
    const second = await manager.send(a.id, "outra");
    await assert.rejects(manager.undo(a.id, messageId), /Espere a conversa terminar/);
    await assert.rejects(manager.undoPreview(a.id, messageId), /Espere a conversa terminar/);

    // Outra conversa do mesmo repositório começa enquanto a primeira ainda trabalha.
    await manager.send(b.id, "trabalhando");
    rig.finish(a.id);
    await rig.until(() => rig.stateOf(a.id) === "idle", "a parada");
    await rig.until(
      () => manager.restoreList(a.id).points.every((point) => point.state === "ready"),
      "a pronta",
      500,
    );
    await assert.rejects(manager.undo(a.id, messageId), /trabalhando neste repositório/);
    await assert.rejects(manager.undoPreview(a.id, messageId), /trabalhando neste repositório/);
    rig.finish(b.id);
    await rig.until(() => rig.stateOf(b.id) === "idle", "b parada");
    await rig.until(
      () => manager.restoreList(b.id).points.every((point) => point.state === "ready"),
      "b pronta",
      500,
    );
    // Os dois turnos se sobrepuseram: o aviso de concorrência chega na prévia.
    const preview = await manager.undoPreview(a.id, second.agentMessage.id);
    assert.equal(preview.concurrent, true);
    assert.equal(manager.restoreList(a.id).points[1]?.concurrent, true);
    assert.equal(manager.restoreList(a.id).points[0]?.concurrent, false);

    // Durante o desfazer: um filtro lento do Git segura a foto de segurança.
    await writeFile(path.join(repo, ".gitattributes"), "*.lento filter=lento\n");
    await writeFile(path.join(repo, "x.lento"), "lento\n");
    git(repo, "config", "filter.lento.clean", "sleep 1; cat");
    const undoing = manager.undo(a.id, messageId);
    await assert.rejects(manager.send(a.id, "durante"), /Espere o desfazer terminar/);
    await assert.rejects(manager.retry(a.id), /Espere o desfazer terminar/);
    await assert.rejects(manager.undo(a.id, messageId), /desfazer em andamento/);
    await undoing;
    assert.equal(manager.restoreList(a.id).points[0]?.state, "undone");
    await manager.send(a.id, "depois"); // liberado de novo
    rig.finish(a.id);
  } finally {
    await rig.harness.close();
  }
});

async function finalWorkspaceAfterMove(
  move: (harness: Harness, conversation: Conversation) => string,
  options: { inProject?: boolean } = {},
): Promise<{ emitted: Array<string | undefined>; expected: string; stored: string }> {
  // O envio segura o objeto da conversa enquanto a mensagem é emitida: movemos nesse intervalo.
  let announceMessage!: () => void;
  let releaseMessage!: () => void;
  const messageCreated = new Promise<void>((resolve) => {
    announceMessage = resolve;
  });
  const messageEmission = new Promise<void>((resolve) => {
    releaseMessage = resolve;
  });
  // A 2ª mensagem criada é a do agente: o envio já leu a conversa e segura esse objeto.
  const adapterFactory: AdapterFactory = (_conversation, emit) => ({
    start: async () => undefined,
    send: async () => emit({ kind: "turn-end", status: "done" }),
    respond: async () => undefined,
    interrupt: async () => undefined,
    dispose: async () => undefined,
  });
  const harness = await createHarness(
    "texto",
    {},
    {
      adapterFactory,
      messageCreatedGate: { started: announceMessage, released: messageEmission, onlyNth: 2 },
    },
  );
  try {
    const other = createWorkspace(harness.db, { name: "Outro", icon: "folder" });
    const project = options.inProject
      ? createProject(harness.db, {
          name: "P",
          icon: "folder",
          path: "/tmp/ws-move-project",
          workspaceId: other.id,
        })
      : null;
    const conversation = harness.manager.create({
      agent: "claude",
      title: "Em andamento",
      cwd: os.tmpdir(),
      mode: "edit",
      workspaceId: other.id,
      ...(project ? { projectId: project.id } : {}),
    });
    assert.equal(conversation.workspaceId, other.id);
    const sending = harness.manager.send(conversation.id, "Trabalhe.");
    await messageCreated;
    const expected = move(harness, conversation);
    harness.events.length = 0;
    releaseMessage();
    await sending;
    await waitForState(harness, conversation.id, "idle");
    const emitted = harness.events.flatMap((event) =>
      event.event === "conversation.stateChanged" &&
      event.payload.conversation.id === conversation.id
        ? [event.payload.conversation.workspaceId]
        : [],
    );
    return {
      emitted,
      expected,
      stored: (
        harness.db
          .prepare("SELECT workspace_id FROM conversations WHERE id=?")
          .get(conversation.id) as { workspace_id: string }
      ).workspace_id,
    };
  } finally {
    releaseMessage();
    await harness.close();
  }
}

test("turno ativo: apagar o workspace durante o turno emite e grava o workspace novo", async () => {
  const result = await finalWorkspaceAfterMove((harness, conversation) => {
    const target = removeWorkspace(harness.db, conversation.workspaceId);
    assert.equal(typeof target, "string");
    return target as string;
  });
  assert.ok(result.emitted.length > 0);
  assert.deepEqual(new Set(result.emitted), new Set([result.expected]));
  assert.equal(result.stored, result.expected);
});

test("turno ativo: mover o projeto durante o turno emite e grava o workspace novo", async () => {
  const result = await finalWorkspaceAfterMove(
    (harness, conversation) => {
      const destination = createWorkspace(harness.db, { name: "Destino", icon: "folder" });
      updateProject(harness.db, conversation.projectId as string, {
        workspaceId: destination.id,
      });
      return destination.id;
    },
    { inProject: true },
  );
  assert.ok(result.emitted.length > 0);
  assert.deepEqual(new Set(result.emitted), new Set([result.expected]));
  assert.equal(result.stored, result.expected);
});

// ---------------------------------------------------------------------------
// Caixa de entrada (M4-B3)
// ---------------------------------------------------------------------------

type InboxPayload = PayloadOfInbox;
type PayloadOfInbox = Extract<AnyEvent, { event: "inbox.changed" }>["payload"];

async function createInboxRig() {
  const rig = await createQueueRig(8);
  const emitFor = (id: string) => {
    const entry = rig.entries.get(id);
    if (!entry) throw new Error("Adaptador ainda não iniciado.");
    return entry.emit;
  };
  const inboxEvents = (): InboxPayload[] =>
    rig.harness.events.flatMap((event) => (event.event === "inbox.changed" ? [event.payload] : []));
  const settle = () => new Promise<void>((resolve) => setTimeout(resolve, 30));
  const list = () => rig.harness.manager.inboxList();
  // Conversa com mensagem enviada e adaptador de pé.
  const started = async () => {
    const conversation = rig.create();
    await rig.harness.manager.send(conversation.id, "faça");
    await rig.until(() => rig.stateOf(conversation.id) === "working", "trabalhando");
    return conversation;
  };
  const permission = (id: string, state: "pending" | "allowed" = "pending"): MessagePart => ({
    id,
    type: "permission",
    tool: "Bash",
    summary: `rodar ${id}`,
    options: ["allow", "always", "deny"],
    state,
  });
  const question = (id: string): MessagePart => ({
    id,
    type: "question",
    questions: [
      {
        question: "Qual?",
        options: [{ label: "A" }, { label: "B" }],
        multiSelect: false,
        freeText: true,
      },
    ],
    state: "pending",
  });
  const waitFor = (predicate: () => boolean, label: string) => rig.until(predicate, label);
  return { rig, emitFor, inboxEvents, settle, list, started, permission, question, waitFor };
}

test("caixa: permissão, pergunta, plano e erro viram itens com a parte do chat", async () => {
  const { rig, emitFor, list, started, permission, question, waitFor } = await createInboxRig();
  try {
    assert.deepEqual(list(), { items: [], total: 0 });
    const a = await started();
    emitFor(a.id)({ kind: "state", state: "waiting" });
    emitFor(a.id)({ kind: "part", part: permission("perm-1") });
    await waitFor(() => list().total === 1, "permissão");
    const [perm] = list().items;
    assert.equal(perm?.kind, "permission");
    assert.equal(perm?.id, "permission:perm-1");
    assert.equal(perm?.partId, "perm-1");
    assert.equal(perm?.conversationId, a.id);
    assert.equal(perm?.conversationTitle, "Conversa de teste");
    assert.equal(perm?.agent, "claude");
    assert.equal(perm?.workspaceId, a.workspaceId);
    assert.equal(perm?.messageId, rig.harness.manager.get(a.id)?.messages.at(-1)?.id);
    assert.equal(perm?.kind === "permission" ? perm.part.summary : "", "rodar perm-1");
    assert.equal(methods["inbox.list"].result.safeParse(list()).success, true);

    const b = await started();
    emitFor(b.id)({ kind: "state", state: "waiting" });
    emitFor(b.id)({ kind: "part", part: question("perg-1") });
    await waitFor(() => list().total === 2, "pergunta");
    assert.deepEqual(
      list().items.map((item) => item.kind),
      ["permission", "question"],
    );

    // Plano: o turno acaba e a conversa fica aguardando aprovação.
    const c = await started();
    emitFor(c.id)({
      kind: "part",
      part: { id: "plano-1", type: "plan", markdown: "# P", state: "pending" },
    });
    rig.finish(c.id);
    await waitFor(() => rig.stateOf(c.id) === "waiting" && list().total === 3, "plano");
    const plan = list().items.find((item) => item.kind === "plan");
    assert.equal(plan?.id, "plan:plano-1");
    assert.equal(plan?.kind === "plan" ? plan.part.markdown : "", "# P");

    // Erro: aparece com o texto do chat e se dá para tentar de novo.
    const d = await started();
    rig.finish(d.id, "error");
    await waitFor(() => rig.stateOf(d.id) === "error" && list().total === 4, "erro");
    const error = list().items.find((item) => item.kind === "error");
    assert.equal(error?.conversationId, d.id);
    assert.equal(error?.kind === "error" ? error.part.retryable : undefined, true);
    assert.equal(error?.kind === "error" ? error.part.text : "", "falhou");
    assert.equal(methods["inbox.list"].result.safeParse(list()).success, true);
  } finally {
    await rig.harness.close();
  }
});

test("caixa: duas permissões na mesma conversa são dois itens; resolver uma deixa a outra", async () => {
  const { rig, emitFor, list, inboxEvents, settle, started, permission, waitFor } =
    await createInboxRig();
  try {
    const a = await started();
    emitFor(a.id)({ kind: "state", state: "waiting" });
    emitFor(a.id)({ kind: "part", part: permission("p1") });
    await settle();
    assert.equal(inboxEvents().length, 1);
    // Segunda permissão com a conversa já em waiting.
    emitFor(a.id)({ kind: "part", part: permission("p2") });
    await waitFor(() => list().total === 2, "segunda permissão");
    await settle();
    assert.equal(inboxEvents().length, 2);
    assert.deepEqual(
      list().items.map((item) => item.partId),
      ["p1", "p2"],
    );
    assert.equal(list().items[0]?.id, "permission:p1");
    // Resolver uma, com a outra ainda aberta, também gera evento.
    emitFor(a.id)({ kind: "part", part: permission("p1", "allowed") });
    await waitFor(() => list().total === 1, "uma resolvida");
    await settle();
    assert.equal(inboxEvents().length, 3);
    assert.deepEqual(
      inboxEvents()
        .at(-1)
        ?.items.map((item) => item.partId),
      ["p2"],
    );
    emitFor(a.id)({ kind: "part", part: permission("p2", "allowed") });
    emitFor(a.id)({ kind: "state", state: "working" });
    await waitFor(() => list().total === 0, "todas resolvidas");
    await settle();
    assert.equal(inboxEvents().length, 4);
    assert.deepEqual(inboxEvents().at(-1), { items: [], total: 0 });
  } finally {
    await rig.harness.close();
  }
});

test("caixa: ordem dos mais antigos, arquivada fora, apagada some, título renomeado gera evento", async () => {
  const { rig, emitFor, list, inboxEvents, settle, started, permission, waitFor } =
    await createInboxRig();
  try {
    const a = await started();
    emitFor(a.id)({ kind: "state", state: "waiting" });
    emitFor(a.id)({ kind: "part", part: permission("pa") });
    await waitFor(() => list().total === 1, "a");
    await new Promise<void>((resolve) => setTimeout(resolve, 5));
    const b = await started();
    emitFor(b.id)({ kind: "state", state: "waiting" });
    emitFor(b.id)({ kind: "part", part: permission("pb") });
    await waitFor(() => list().total === 2, "b");
    assert.deepEqual(
      list().items.map((item) => item.conversationId),
      [a.id, b.id],
    );

    await settle();
    const before = inboxEvents().length;
    await rig.harness.manager.rename(a.id, "Outro nome");
    await settle();
    assert.equal(inboxEvents().length, before + 1);
    assert.equal(inboxEvents().at(-1)?.items[0]?.conversationTitle, "Outro nome");

    await rig.harness.manager.setArchived(a.id, true);
    await settle();
    assert.deepEqual(
      list().items.map((item) => item.conversationId),
      [b.id],
    );
    assert.deepEqual(
      inboxEvents()
        .at(-1)
        ?.items.map((item) => item.conversationId),
      [b.id],
    );
    await rig.harness.manager.setArchived(a.id, false);
    await settle();
    assert.equal(list().total, 2);

    await rig.harness.manager.remove(b.id);
    await settle();
    assert.deepEqual(
      list().items.map((item) => item.conversationId),
      [a.id],
    );
    assert.deepEqual(
      inboxEvents()
        .at(-1)
        ?.items.map((item) => item.conversationId),
      [a.id],
    );
  } finally {
    await rig.harness.close();
  }
});

test("caixa: dispensar erro tira da lista sem mexer na conversa; erro novo volta; tentar de novo e nova mensagem tiram", async () => {
  const { rig, list, inboxEvents, settle, started, waitFor } = await createInboxRig();
  try {
    const a = await started();
    rig.finish(a.id, "error");
    await waitFor(() => rig.stateOf(a.id) === "error" && list().total === 1, "erro");
    const firstId = list().items[0]?.id;
    assert.equal(firstId?.startsWith("error:"), true);
    const messagesBefore = JSON.stringify(rig.harness.manager.get(a.id)?.messages);
    assert.equal(rig.harness.manager.dismissInboxError(a.id), true);
    await settle();
    assert.deepEqual(list(), { items: [], total: 0 });
    assert.deepEqual(inboxEvents().at(-1), { items: [], total: 0 });
    assert.equal(rig.harness.manager.dismissInboxError(a.id), false);
    // O chat e o estado continuam como estavam.
    assert.equal(rig.stateOf(a.id), "error");
    assert.equal(JSON.stringify(rig.harness.manager.get(a.id)?.messages), messagesBefore);

    // Nova mensagem que falha de novo: erro novo, id novo, volta a aparecer.
    await rig.harness.manager.send(a.id, "de novo");
    // Mandar nova mensagem já tira o erro antigo da lista.
    assert.equal(list().total, 0);
    rig.finish(a.id, "error");
    await waitFor(() => rig.stateOf(a.id) === "error" && list().total === 1, "erro novo");
    assert.notEqual(list().items[0]?.id, firstId);
    await settle();

    // Tentar de novo tira o erro (a conversa volta a trabalhar).
    await rig.harness.manager.retry(a.id);
    await waitFor(() => list().total === 0, "retry tira");
    await settle();
    assert.deepEqual(inboxEvents().at(-1), { items: [], total: 0 });
    rig.finish(a.id);
    await waitFor(() => rig.stateOf(a.id) === "idle", "terminou");

    // Erro sem dispensar sai ao apagar a conversa.
    const b = await started();
    rig.finish(b.id, "error");
    await waitFor(() => list().total === 1, "erro de b");
    await rig.harness.manager.remove(b.id);
    await settle();
    assert.equal(list().total, 0);
    // Dispensar o que não é erro devolve false.
    assert.equal(rig.harness.manager.dismissInboxError(a.id), false);
    assert.equal(rig.harness.manager.dismissInboxError("nao-existe"), false);
  } finally {
    await rig.harness.close();
  }
});

test("caixa: limite de 100 itens com total real, do mais antigo ao mais novo", async () => {
  const { rig, list } = await createInboxRig();
  try {
    const db = rig.harness.db;
    const ids: string[] = [];
    for (let index = 0; index < 105; index += 1) {
      const conversation = createConversationRecord(db, {
        agent: "codex",
        title: `Erro ${index}`,
        cwd: os.tmpdir(),
        mode: "edit",
      });
      conversation.state = "error";
      updateConversation(db, conversation);
      const stamp = new Date(Date.UTC(2026, 0, 1, 0, 0, index)).toISOString();
      addMessage(db, {
        id: `msg-${index}`,
        conversationId: conversation.id,
        author: "agent",
        status: "error",
        parts: [
          {
            id: `err-${index}`,
            type: "error",
            errorType: "failed",
            text: "falhou",
            retryable: true,
            startedAt: Date.parse(stamp),
            endedAt: Date.parse(stamp),
          },
        ],
        createdAt: stamp,
        updatedAt: stamp,
      });
      ids.push(conversation.id);
    }
    const result = list();
    assert.equal(result.items.length, 100);
    assert.equal(result.total, 105);
    assert.equal(result.items[0]?.conversationId, ids[0]);
    assert.equal(result.items[99]?.conversationId, ids[99]);
    assert.equal(methods["inbox.list"].result.safeParse(result).success, true);
  } finally {
    await rig.harness.close();
  }
});

test("caixa: texto chegando não gera evento e rajadas saem agrupadas", async () => {
  const { rig, emitFor, inboxEvents, settle, started, permission, list, waitFor } =
    await createInboxRig();
  try {
    const a = await started();
    await settle();
    const before = inboxEvents().length;
    for (let index = 0; index < 20; index += 1) {
      emitFor(a.id)({
        kind: "text-delta",
        partId: "t1",
        partType: "text",
        delta: `trecho ${index} `,
      });
    }
    await settle();
    await new Promise<void>((resolve) => setTimeout(resolve, 80));
    assert.equal(inboxEvents().length, before);
    // Três permissões em sequência: um evento só, com as três.
    emitFor(a.id)({ kind: "state", state: "waiting" });
    for (const id of ["r1", "r2", "r3"]) emitFor(a.id)({ kind: "part", part: permission(id) });
    await waitFor(() => list().total === 3, "três");
    await settle();
    assert.equal(inboxEvents().length, before + 1);
    assert.equal(inboxEvents().at(-1)?.total, 3);
    // Mudança que não altera a lista (conversa de outro estado) não emite.
    const other = rig.create();
    await rig.harness.manager.rename(other.id, "Sem pendência");
    await settle();
    assert.equal(inboxEvents().length, before + 1);
  } finally {
    await rig.harness.close();
  }
});

test("caixa: depois de reiniciar o serviço não sobra pendência respondível, só erro", async () => {
  const { rig, emitFor, list, started, permission, waitFor } = await createInboxRig();
  const dbPath = rig.harness.db.prepare("PRAGMA database_list").all() as Array<{ file: string }>;
  const file = dbPath.find((entry) => entry.file)?.file;
  assert.ok(file);
  const failed = await started();
  const waiting = await started();
  const planning = await started();
  try {
    rig.finish(failed.id, "error");
    emitFor(waiting.id)({ kind: "state", state: "waiting" });
    emitFor(waiting.id)({ kind: "part", part: permission("morre") });
    emitFor(planning.id)({
      kind: "part",
      part: { id: "plano-morre", type: "plan", markdown: "P", state: "pending" },
    });
    rig.finish(planning.id);
    await waitFor(() => list().total === 3, "três pendências");
    // Reinicia: fecha o serviço antigo e abre outro sobre o mesmo banco.
    await rig.harness.manager.close();
    const reopened = openDatabase(file);
    const manager = new ConversationManager({
      db: reopened,
      broadcast: async () => undefined,
      env: { ...process.env, KARONT_DISABLE_AGENT_DETECTION: "1" },
    });
    try {
      assert.equal(manager.get(waiting.id)?.conversation.state, "idle");
      assert.equal(manager.get(planning.id)?.conversation.state, "idle");
      const after = manager.inboxList();
      assert.deepEqual(
        after.items.map((item) => item.kind),
        ["error"],
      );
      assert.equal(after.items[0]?.conversationId, failed.id);
      // Responder à permissão que morreu é recusado.
      await assert.rejects(
        manager.respond(waiting.id, "morre", {
          responseType: "permission",
          decision: "allow",
        }),
        /não está aguardando/,
      );
    } finally {
      await manager.close();
      reopened.close();
    }
  } finally {
    try {
      rig.harness.db.close();
    } catch {
      // Já fechado.
    }
  }
});

test("Claude publica e guarda o uso das janelas sem alterar as partes da mensagem", async () => {
  const harness = await createHarness("texto");
  try {
    const conversation = createConversation(harness.manager);
    await harness.manager.send(conversation.id, "Gere uma resposta.");
    await waitForState(harness, conversation.id, "idle");

    const updates = harness.events.filter((event) => event.event === "usage.updated");
    assert.equal(updates.length, 1);
    const payload = updates[0]?.payload as { observedAt: string } | undefined;
    assert.deepEqual(payload, {
      agent: "claude",
      windows: [
        { id: "five_hour", usedPercent: 3, resetsAt: new Date(1793507400 * 1000).toISOString() },
        { id: "weekly", usedPercent: 44, resetsAt: new Date(1793908800 * 1000).toISOString() },
      ],
      observedAt: payload?.observedAt,
    });
    assert.deepEqual(
      harness.manager
        .get(conversation.id)
        ?.messages.at(-1)
        ?.parts.map((part) => part.type),
      ["text"],
    );
  } finally {
    await harness.close();
  }
});

const DOT_FLAG = "--append-system-prompt";

function dotFlagValue(args: string[] | undefined): string | undefined {
  const index = args?.indexOf(DOT_FLAG) ?? -1;
  return index >= 0 ? args?.[index + 1] : undefined;
}

test("Dot ligado passa a instrução ao Claude em conversa nova e em --resume", async () => {
  const harness = await createHarness("texto");
  try {
    updateDot(harness.db, { name: "Caronte", enabled: true });
    const conversation = createConversation(harness.manager);
    await harness.manager.send(conversation.id, "Oi.");
    await waitForState(harness, conversation.id, "idle");
    assert.ok(dotFlagValue(harness.spawnArgs[0])?.includes("Caronte"));
    assert.ok(harness.spawnArgs[0]?.includes("--session-id"));
  } finally {
    await harness.close();
  }
  const resumed = await createHarness("continuar");
  try {
    updateDot(resumed.db, { name: "Caronte", enabled: true });
    const conversation = createConversation(resumed.manager);
    setAgentSession(resumed.db, conversation.id, "00000000-0000-4000-8000-000000000003");
    await resumed.manager.send(conversation.id, "Continue.");
    await waitForState(resumed, conversation.id, "idle");
    assert.ok(resumed.spawnArgs[0]?.includes("--resume"));
    assert.ok(dotFlagValue(resumed.spawnArgs[0])?.includes("Caronte"));
  } finally {
    await resumed.close();
  }
});

test("Dot desligado não passa a flag ao Claude", async () => {
  const harness = await createHarness("texto");
  try {
    updateDot(harness.db, { enabled: false });
    const conversation = createConversation(harness.manager);
    await harness.manager.send(conversation.id, "Oi.");
    await waitForState(harness, conversation.id, "idle");
    assert.equal(harness.spawnArgs[0]?.includes(DOT_FLAG), false);
  } finally {
    await harness.close();
  }
});

test("o reinício interno do Claude mantém a instrução do Dot", async () => {
  const harness = await createHarness("texto", {}, { exitAfterResult: true });
  try {
    updateDot(harness.db, { name: "Caronte", enabled: true });
    const conversation = createConversation(harness.manager);
    await harness.manager.send(conversation.id, "Primeira.");
    await waitForState(harness, conversation.id, "idle");
    await new Promise((resolve) => setTimeout(resolve, 20));
    await harness.manager.send(conversation.id, "Segunda.");
    await waitForState(harness, conversation.id, "idle");
    assert.equal(harness.spawnArgs.length, 2);
    assert.ok(harness.spawnArgs[1]?.includes("--resume"));
    assert.equal(dotFlagValue(harness.spawnArgs[1]), dotFlagValue(harness.spawnArgs[0]));
    assert.ok(dotFlagValue(harness.spawnArgs[1])?.includes("Caronte"));
  } finally {
    await harness.close();
  }
});

test("mudar o Dot não reinicia o adapter ativo; o próximo adapter usa o valor novo", async () => {
  const harness = await createHarness("texto");
  try {
    updateDot(harness.db, { name: "Caronte", enabled: true });
    const first = createConversation(harness.manager);
    await harness.manager.send(first.id, "Oi.");
    await waitForState(harness, first.id, "idle");
    const before = dotFlagValue(harness.spawnArgs[0]);
    updateDot(harness.db, { name: "Ferry" });
    assert.equal(harness.spawnArgs.length, 1);
    assert.equal(dotFlagValue(harness.spawnArgs[0]), before);
    const second = createConversation(harness.manager);
    await harness.manager.send(second.id, "Oi.");
    await waitForState(harness, second.id, "idle");
    assert.equal(harness.spawnArgs.length, 2);
    assert.ok(dotFlagValue(harness.spawnArgs[1])?.includes("Ferry"));
  } finally {
    await harness.close();
  }
});
