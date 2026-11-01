import assert from "node:assert/strict";
import { mkdtemp } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { test } from "node:test";
import type { Conversation } from "@karont/contract";
import { openDatabase } from "../db.ts";
import type { AdapterEvent, AdapterFactory, AgentAdapter } from "./adapter.ts";
import { ConversationManager } from "./conversation-manager.ts";

test("a mensagem é gravada com debounce no streaming e imediatamente ao concluir", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "karont-message-save-"));
  const db = openDatabase(path.join(root, "karont.db"));
  db.exec(
    "CREATE TABLE message_save_count (count INTEGER NOT NULL); INSERT INTO message_save_count VALUES (0); CREATE TRIGGER count_message_saves AFTER UPDATE ON messages BEGIN UPDATE message_save_count SET count=count+1; END;",
  );

  let releaseTurn!: () => void;
  let announceFirstBatch!: () => void;
  const firstBatch = new Promise<void>((resolve) => {
    announceFirstBatch = resolve;
  });
  const continueTurn = new Promise<void>((resolve) => {
    releaseTurn = resolve;
  });
  const adapterFactory: AdapterFactory = (_conversation, emit) => {
    return new PersistenceTestAdapter(emit, firstBatch, continueTurn, announceFirstBatch);
  };
  const manager = new ConversationManager({
    db,
    env: { ...process.env, KARONT_MESSAGE_SAVE_DEBOUNCE_MS: "1000" },
    broadcast: async () => undefined,
    adapterFactory,
  });
  const conversation = manager.create({
    agent: "claude",
    title: "Streaming longo",
    cwd: os.tmpdir(),
    mode: "edit",
  });

  try {
    const sending = manager.send(conversation.id, "Responda aos poucos.");
    await firstBatch;
    await new Promise((resolve) => setTimeout(resolve, 300));
    assert.equal(messageSaveCount(db), 0);

    await new Promise((resolve) => setTimeout(resolve, 900));
    assert.equal(messageSaveCount(db), 1);
    const snapshot = manager.get(conversation.id);
    assert.equal(snapshot?.conversation.state, "working");
    assert.ok(
      snapshot?.messages
        .at(-1)
        ?.parts.some((part) => part.type === "text" && part.markdown.length > 8),
    );

    releaseTurn();
    await sending;
    await waitForState(manager, conversation.id, "idle");
    assert.equal(messageSaveCount(db), 2);
  } finally {
    releaseTurn();
    await manager.close();
    db.close();
  }
});

test("parar e encerrar o serviço gravam o texto pendente imediatamente", async (t) => {
  await t.test("parar", async () => {
    const harness = await createLifecycleHarness();
    try {
      const conversation = harness.manager.create({
        agent: "claude",
        title: "Parada",
        cwd: os.tmpdir(),
        mode: "edit",
      });
      const sending = harness.manager.send(conversation.id, "Pare durante o streaming.");
      await harness.started;
      assert.equal(messageSaveCount(harness.db), 0);
      assert.equal(await harness.manager.stop(conversation.id), true);
      await sending;
      await waitForState(harness.manager, conversation.id, "idle");
      assert.equal(messageSaveCount(harness.db), 2);
      assert.equal(harness.manager.get(conversation.id)?.messages.at(-1)?.status, "interrupted");
    } finally {
      await harness.manager.close();
      harness.db.close();
    }
  });

  await t.test("encerrar serviço", async () => {
    const harness = await createLifecycleHarness();
    const conversation = harness.manager.create({
      agent: "claude",
      title: "Encerrada",
      cwd: os.tmpdir(),
      mode: "edit",
    });
    const sending = harness.manager.send(conversation.id, "Salve antes de encerrar.");
    await harness.started;
    await harness.manager.close();
    await sending;
    assert.equal(messageSaveCount(harness.db), 1);
    const message = harness.manager.get(conversation.id)?.messages.at(-1);
    assert.equal(message?.status, "streaming");
    assert.ok(message?.parts.some((part) => part.type === "text" && part.markdown === "rascunho"));
    harness.db.close();
  });
});

function messageSaveCount(db: ReturnType<typeof openDatabase>): number {
  const row = db.prepare("SELECT count FROM message_save_count").get() as { count: number };
  return row.count;
}

async function waitForState(
  manager: ConversationManager,
  id: string,
  state: Conversation["state"],
): Promise<void> {
  if (manager.get(id)?.conversation.state === state) return;
  await new Promise<void>((resolve, reject) => {
    const check = () => {
      if (manager.get(id)?.conversation.state === state) {
        clearInterval(timer);
        resolve();
      }
    };
    const timer = setInterval(check, 5);
    setTimeout(() => {
      clearInterval(timer);
      reject(new Error(`Timeout esperando ${state}.`));
    }, 5_000).unref?.();
  });
}

async function createLifecycleHarness(): Promise<{
  manager: ConversationManager;
  db: ReturnType<typeof openDatabase>;
  started: Promise<void>;
}> {
  const root = await mkdtemp(path.join(os.tmpdir(), "karont-message-lifecycle-"));
  const db = openDatabase(path.join(root, "karont.db"));
  db.exec(
    "CREATE TABLE message_save_count (count INTEGER NOT NULL); INSERT INTO message_save_count VALUES (0); CREATE TRIGGER count_message_saves AFTER UPDATE ON messages BEGIN UPDATE message_save_count SET count=count+1; END;",
  );
  let announceStarted!: () => void;
  const started = new Promise<void>((resolve) => {
    announceStarted = resolve;
  });
  const manager = new ConversationManager({
    db,
    env: { ...process.env, KARONT_MESSAGE_SAVE_DEBOUNCE_MS: "1000" },
    broadcast: async () => undefined,
    adapterFactory: (_conversation, emit) => new LifecycleTestAdapter(emit, announceStarted),
  });
  return { manager, db, started };
}

class PersistenceTestAdapter implements AgentAdapter {
  readonly #emit: (event: AdapterEvent) => void;
  readonly #firstBatch: Promise<void>;
  readonly #continueTurn: Promise<void>;
  readonly #announceFirstBatch: () => void;

  constructor(
    emit: (event: AdapterEvent) => void,
    firstBatch: Promise<void>,
    continueTurn: Promise<void>,
    announceFirstBatch: () => void,
  ) {
    this.#emit = emit;
    this.#firstBatch = firstBatch;
    this.#continueTurn = continueTurn;
    this.#announceFirstBatch = announceFirstBatch;
  }

  async start(): Promise<void> {}

  async send(): Promise<void> {
    for (let index = 0; index < 8; index += 1)
      this.#emit({ kind: "text-delta", partType: "text", partId: "answer", delta: "a" });
    this.#announceFirstBatch();
    await this.#firstBatch;
    for (let index = 0; index < 15; index += 1) {
      await new Promise((resolve) => setTimeout(resolve, 75));
      this.#emit({ kind: "text-delta", partType: "text", partId: "answer", delta: "b" });
    }
    await this.#continueTurn;
    this.#emit({ kind: "text-delta", partType: "text", partId: "answer", delta: "done" });
    this.#emit({ kind: "turn-end", status: "done" });
  }

  async respond(): Promise<void> {}

  async interrupt(): Promise<void> {
    this.#emit({ kind: "turn-end", status: "interrupted" });
  }

  async dispose(): Promise<void> {}
}

class LifecycleTestAdapter implements AgentAdapter {
  readonly #emit: (event: AdapterEvent) => void;
  readonly #announceStarted: () => void;
  #releaseSend!: () => void;

  constructor(emit: (event: AdapterEvent) => void, announceStarted: () => void) {
    this.#emit = emit;
    this.#announceStarted = announceStarted;
  }

  async start(): Promise<void> {}

  async send(): Promise<void> {
    this.#emit({ kind: "text-delta", partType: "text", partId: "answer", delta: "rascunho" });
    this.#announceStarted();
    await new Promise<void>((resolve) => {
      this.#releaseSend = resolve;
    });
  }

  async respond(): Promise<void> {}

  async interrupt(): Promise<void> {
    this.#emit({
      kind: "turn-end",
      status: "interrupted",
      error: { type: "interrupted", text: "Resposta interrompida pelo usuário." },
    });
    this.#releaseSend();
  }

  async dispose(): Promise<void> {
    this.#releaseSend?.();
  }
}
