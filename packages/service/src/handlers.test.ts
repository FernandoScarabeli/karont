import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import {
  access,
  chmod,
  mkdir,
  mkdtemp,
  readdir,
  readFile,
  realpath,
  rm,
  stat,
  writeFile,
} from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { test } from "node:test";
import {
  type AnyEvent,
  type Conversation,
  type ParsedRequest,
  parseRequest,
  parseResult,
} from "@karont/contract";
import type { AdapterFactory, AgentAdapter, AgentAdapterRegistration } from "./agents/adapter.ts";
import type { AgentDetectionFs } from "./agents/detect.ts";
import { addMessage, openDatabase, recordRecentFolder, setSetting } from "./db.ts";
import type { HandlerConnection } from "./handlers.ts";
import { createHandlers, ServiceError } from "./handlers.ts";
import type { TerminalPty } from "./terminals/manager.ts";
import { createFakeCliDir } from "./testing/fake-clis.ts";

function request(method: string, params: unknown): ParsedRequest {
  const parsed = parseRequest({ type: "request", id: "1", method, params });
  if (!parsed.ok) throw new Error(parsed.error.message);
  return parsed.request;
}

function connection(
  events: AnyEvent[],
  afterResponse: Array<() => void | Promise<void>> = [],
): HandlerConnection {
  return {
    emit: async (event) => {
      events.push(event);
    },
    afterResponse: (task) => afterResponse.push(task),
    isOpen: () => true,
  };
}

test("service.shutdown agenda o encerramento depois da resposta", async (context) => {
  const root = await mkdtemp(path.join(os.tmpdir(), "ks-"));
  context.after(() => rm(root, { recursive: true, force: true }));
  const db = openDatabase(path.join(root, "karont.db"));
  let shutdownCount = 0;
  const handlers = createHandlers({
    db,
    startedAt: new Date().toISOString(),
    dev: false,
    emit: async () => undefined,
    shutdown: async () => {
      shutdownCount += 1;
    },
    env: { PATH: "" },
    homeDir: root,
  });
  const afterResponse: Array<() => void | Promise<void>> = [];
  const result = await handlers.handle(
    request("service.shutdown", {}),
    connection([], afterResponse),
  );
  assert.deepEqual(result, { ok: true });
  assert.equal(shutdownCount, 0);
  await afterResponse[0]?.();
  assert.equal(shutdownCount, 1);
  db.close();
});

test("ping, info e settings usam contrato e banco", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "ks-"));
  const db = openDatabase(path.join(root, "karont.db"));
  const testAgentRegistration: AgentAdapterRegistration = {
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
  };
  const handlers = createHandlers({
    db,
    startedAt: "2026-10-31T00:00:00.000Z",
    dev: false,
    emit: async () => undefined,
    env: { PATH: "" },
    homeDir: root,
    agentRegistrations: { teste: testAgentRegistration },
  });
  const conn = connection([]);
  const ping = (await handlers.handle(request("system.ping", {}), conn)) as {
    pong: boolean;
    at: string;
  };
  assert.equal(ping.pong, true);
  assert.equal(Number.isNaN(Date.parse(ping.at)), false);
  const info = (await handlers.handle(request("system.info", {}), conn)) as {
    serviceVersion: string;
    contractVersion: number;
    startedAt: string;
    homeDir: string;
  };
  assert.equal(info.serviceVersion, "0.0.0");
  assert.equal(info.contractVersion, 1);
  assert.equal(info.startedAt, "2026-10-31T00:00:00.000Z");
  assert.equal(info.homeDir, root);
  const userName = (await handlers.handle(request("system.userName", {}), conn)) as {
    name: string | null;
  };
  assert.ok(userName.name === null || typeof userName.name === "string");
  assert.deepEqual(
    await handlers.handle(request("settings.set", { key: "test.value", value: [1, "two"] }), conn),
    {
      key: "test.value",
      value: [1, "two"],
    },
  );
  assert.deepEqual(await handlers.handle(request("settings.get", { key: "test.value" }), conn), {
    key: "test.value",
    value: [1, "two"],
  });
  const capabilities = (await handlers.handle(
    request("agent.capabilities", { agent: "teste" }),
    conn,
  )) as { capabilities: AgentAdapterRegistration["capabilities"] };
  assert.deepEqual(capabilities, {
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
  assert.deepEqual(
    await handlers.handle(request("composer.skills", { agent: "teste", cwd: root }), conn),
    { skills: [] },
  );
  db.close();
});

test("conversation.rename persiste o título e emite conversation.stateChanged", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "ks-"));
  const db = openDatabase(path.join(root, "karont.db"));
  const events: AnyEvent[] = [];
  const handlers = createHandlers({
    db,
    startedAt: new Date().toISOString(),
    dev: false,
    emit: async () => undefined,
    broadcast: async (event) => {
      events.push(event);
    },
    env: { PATH: "" },
    homeDir: root,
  });
  const created = (await handlers.handle(
    request("conversation.create", { agent: "claude", cwd: root }),
    connection([]),
  )) as { conversation: { id: string } };
  const result = (await handlers.handle(
    request("conversation.rename", { id: created.conversation.id, title: "  Revisar o fluxo  " }),
    connection(events),
  )) as { conversation: { title: string } };

  assert.equal(result.conversation.title, "Revisar o fluxo");
  assert.ok(
    events.some(
      (event) =>
        event.event === "conversation.stateChanged" &&
        event.payload.conversation.title === "Revisar o fluxo",
    ),
  );
  db.close();
});

test("conversation.create rejeita pasta que não existe ou não é diretório", async (context) => {
  const root = await mkdtemp(path.join(os.tmpdir(), "ks-create-conversation-folder-"));
  context.after(() => rm(root, { recursive: true, force: true }));
  const db = openDatabase(path.join(root, "karont.db"));
  const handlers = createHandlers({
    db,
    startedAt: new Date().toISOString(),
    dev: false,
    emit: async () => undefined,
    env: { PATH: "" },
    homeDir: root,
  });

  try {
    const missingPath = path.join(root, "apagada");
    await assert.rejects(
      handlers.handle(
        request("conversation.create", { agent: "claude", cwd: missingPath }),
        connection([]),
      ),
      (error: unknown) =>
        error instanceof ServiceError &&
        error.code === "invalid_request" &&
        error.message === `A pasta do projeto não existe: ${missingPath}`,
    );

    const filePath = path.join(root, "arquivo.txt");
    await writeFile(filePath, "conteúdo");
    await assert.rejects(
      handlers.handle(
        request("conversation.create", { agent: "claude", cwd: filePath }),
        connection([]),
      ),
      (error: unknown) =>
        error instanceof ServiceError &&
        error.code === "invalid_request" &&
        error.message === `O caminho do projeto não é uma pasta: ${filePath}`,
    );
  } finally {
    db.close();
  }
});

test("conversation.markSeen limpa uma vez, persiste e não emite ao repetir", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "ks-conversation-mark-seen-"));
  const db = openDatabase(path.join(root, "karont.db"));
  const events: AnyEvent[] = [];
  const handlers = createHandlers({
    db,
    startedAt: new Date().toISOString(),
    dev: false,
    emit: async () => undefined,
    broadcast: async (event) => {
      events.push(event);
    },
    env: { PATH: "" },
    homeDir: root,
  });

  try {
    const created = (await handlers.handle(
      request("conversation.create", { agent: "claude", cwd: root }),
      connection([]),
    )) as { conversation: { id: string; updatedAt: string } };
    events.length = 0;
    const unreadAt = "2026-11-01T12:00:00.000Z";
    db.prepare("UPDATE conversations SET unread_at=? WHERE id=?").run(
      unreadAt,
      created.conversation.id,
    );
    db.exec(
      "CREATE TABLE unread_write_count (count INTEGER NOT NULL); INSERT INTO unread_write_count VALUES (0); CREATE TRIGGER count_unread_clears AFTER UPDATE OF unread_at ON conversations WHEN OLD.unread_at IS NOT NULL AND NEW.unread_at IS NULL BEGIN UPDATE unread_write_count SET count=count+1; END;",
    );

    const first = (await handlers.handle(
      request("conversation.markSeen", { id: created.conversation.id }),
      connection(events),
    )) as { conversation: { unreadAt: string | null; updatedAt: string } };
    assert.equal(first.conversation.unreadAt, null);
    assert.equal(first.conversation.updatedAt, created.conversation.updatedAt);
    assert.equal(
      (db.prepare("SELECT count FROM unread_write_count").get() as { count: number }).count,
      1,
    );
    assert.equal(events.filter((event) => event.event === "conversation.stateChanged").length, 1);

    events.length = 0;
    const second = (await handlers.handle(
      request("conversation.markSeen", { id: created.conversation.id }),
      connection(events),
    )) as { conversation: { unreadAt: string | null } };
    assert.equal(second.conversation.unreadAt, null);
    assert.equal(
      (db.prepare("SELECT count FROM unread_write_count").get() as { count: number }).count,
      1,
    );
    assert.equal(events.length, 0);
  } finally {
    db.close();
  }
});

test("conversation.deleteAll remove conversas e dados, para o agente e preserva terminais", async (context) => {
  const root = await mkdtemp(path.join(os.tmpdir(), "ks-delete-all-conversations-"));
  const db = openDatabase(path.join(root, "karont.db"));
  const events: AnyEvent[] = [];
  let interrupted = false;
  let disposed = false;
  const adapterFactory: AdapterFactory = (_conversation, emit) => {
    const adapter: AgentAdapter = {
      start: async () => undefined,
      send: async () => emit({ kind: "state", state: "working" }),
      respond: async () => undefined,
      interrupt: async () => {
        interrupted = true;
        emit({ kind: "turn-end", status: "interrupted" });
      },
      dispose: async () => {
        disposed = true;
      },
    };
    return adapter;
  };
  const handlers = createHandlers({
    db,
    startedAt: new Date().toISOString(),
    dev: false,
    emit: async () => undefined,
    broadcast: async (event) => void events.push(event),
    ptyFactory: () => new TestPty(),
    adapterFactory,
    env: { PATH: "", SHELL: "/bin/bash" },
    homeDir: root,
  });
  context.after(async () => {
    await handlers.closeAgents();
    await handlers.closeTerminals();
    db.close();
    await rm(root, { recursive: true, force: true });
  });

  const create = async (title: string) => {
    const result = (await handlers.handle(
      request("conversation.create", { agent: "claude", cwd: root, title }),
      connection([]),
    )) as { conversation: Conversation };
    return result.conversation;
  };
  const conversations = [
    await create("Em andamento"),
    await create("Arquivada"),
    await create("Fixada"),
  ];
  await handlers.handle(
    request("conversation.setArchived", { id: conversations[1]?.id, archived: true }),
    connection([]),
  );
  await handlers.handle(
    request("conversation.setPinned", { id: conversations[2]?.id, pinned: true }),
    connection([]),
  );
  for (const conversation of conversations) {
    db.prepare(
      "INSERT INTO messages (id,conversation_id,author,status,parts,created_at,updated_at) VALUES (?,?,?,?,?,?,?)",
    ).run(
      `message-${conversation.id}`,
      conversation.id,
      "user",
      "done",
      "[]",
      conversation.createdAt,
      conversation.updatedAt,
    );
    db.prepare(
      "INSERT INTO agent_sessions (conversation_id,session_id,updated_at) VALUES (?,?,?)",
    ).run(conversation.id, `session-${conversation.id}`, conversation.updatedAt);
  }
  const terminal = (await handlers.handle(
    request("terminals.open", { cwd: root, cols: 80, rows: 24 }),
    connection([]),
  )) as { terminal: { id: string } };
  await handlers.handle(
    request("conversation.send", { id: conversations[0]?.id, text: "Trabalhe" }),
    connection([]),
  );

  assert.deepEqual(await handlers.handle(request("conversation.count", {}), connection([])), {
    count: conversations.length,
  });
  const result = await handlers.handle(request("conversation.deleteAll", {}), connection([]));

  assert.deepEqual(result, { deleted: conversations.length });
  assert.equal(interrupted, true);
  assert.equal(disposed, true);
  assert.equal(
    (db.prepare("SELECT COUNT(*) AS count FROM conversations").get() as { count: number }).count,
    0,
  );
  assert.equal(
    (db.prepare("SELECT COUNT(*) AS count FROM messages").get() as { count: number }).count,
    0,
  );
  assert.equal(
    (db.prepare("SELECT COUNT(*) AS count FROM agent_sessions").get() as { count: number }).count,
    0,
  );
  assert.deepEqual(
    (
      (await handlers.handle(request("terminals.list", {}), connection([]))) as {
        terminals: { id: string }[];
      }
    ).terminals.map(({ id }) => id),
    [terminal.terminal.id],
  );
  const deletedEvent = events.find((event) => event.event === "conversation.deletedAll");
  assert.ok(deletedEvent);
  if (deletedEvent?.event === "conversation.deletedAll") {
    assert.deepEqual(deletedEvent.payload, { deleted: conversations.length });
  }
});

test("conversation.setPinned e setArchived persistem, notificam e arquivam sem parar a conversa", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "ks-conversation-actions-"));
  const db = openDatabase(path.join(root, "karont.db"));
  const events: AnyEvent[] = [];
  const handlers = createHandlers({
    db,
    startedAt: new Date().toISOString(),
    dev: false,
    emit: async () => undefined,
    broadcast: async (event) => {
      events.push(event);
    },
    env: { PATH: "" },
    homeDir: root,
  });
  const created = (await handlers.handle(
    request("conversation.create", { agent: "claude", cwd: root }),
    connection([]),
  )) as { conversation: { id: string; updatedAt: string } };

  const pinned = (await handlers.handle(
    request("conversation.setPinned", { id: created.conversation.id, pinned: true }),
    connection(events),
  )) as {
    conversation: { pinnedAt: string | null; archivedAt: string | null; updatedAt: string };
  };
  assert.ok(pinned.conversation.pinnedAt);
  assert.equal(pinned.conversation.archivedAt, null);
  assert.equal(pinned.conversation.updatedAt, created.conversation.updatedAt);
  const pinnedList = (await handlers.handle(
    request("conversation.list", { limit: 20 }),
    connection([]),
  )) as { conversations: Array<{ pinnedAt: string | null }> };
  assert.equal(pinnedList.conversations[0]?.pinnedAt, pinned.conversation.pinnedAt);
  assert.ok(
    events.some(
      (event) =>
        event.event === "conversation.stateChanged" &&
        event.payload.conversation.pinnedAt === pinned.conversation.pinnedAt,
    ),
  );

  db.prepare("UPDATE conversations SET state='working' WHERE id=?").run(created.conversation.id);
  const archived = (await handlers.handle(
    request("conversation.setArchived", { id: created.conversation.id, archived: true }),
    connection(events),
  )) as {
    conversation: {
      pinnedAt: string | null;
      archivedAt: string | null;
      state: string;
      updatedAt: string;
    };
  };
  assert.equal(archived.conversation.pinnedAt, null);
  assert.ok(archived.conversation.archivedAt);
  assert.equal(archived.conversation.state, "working");
  assert.equal(archived.conversation.updatedAt, created.conversation.updatedAt);
  assert.deepEqual(
    (
      (await handlers.handle(request("conversation.list", { limit: 20 }), connection([]))) as {
        conversations: unknown[];
      }
    ).conversations,
    [],
  );
  const archivedList = (await handlers.handle(
    request("conversation.list", { archived: true, limit: 20 }),
    connection([]),
  )) as {
    conversations: Array<{
      id: string;
      state: string;
      pinnedAt: string | null;
      archivedAt: string | null;
    }>;
  };
  assert.deepEqual(
    archivedList.conversations.map((conversation) => conversation.id),
    [created.conversation.id],
  );
  assert.equal(archivedList.conversations[0]?.state, "working");
  assert.equal(archivedList.conversations[0]?.pinnedAt, null);
  assert.ok(archivedList.conversations[0]?.archivedAt);
  assert.ok(
    events.some(
      (event) =>
        event.event === "conversation.stateChanged" &&
        event.payload.conversation.archivedAt === archived.conversation.archivedAt,
    ),
  );

  const unarchived = (await handlers.handle(
    request("conversation.setArchived", { id: created.conversation.id, archived: false }),
    connection(events),
  )) as { conversation: { archivedAt: string | null; state: string } };
  assert.equal(unarchived.conversation.archivedAt, null);
  assert.equal(unarchived.conversation.state, "working");
  const unpinned = (await handlers.handle(
    request("conversation.setPinned", { id: created.conversation.id, pinned: false }),
    connection(events),
  )) as { conversation: { pinnedAt: string | null; updatedAt: string } };
  assert.equal(unpinned.conversation.pinnedAt, null);
  assert.equal(unpinned.conversation.updatedAt, created.conversation.updatedAt);
  db.close();
});

test("conversation.get usa 40 mensagens por padrão e aceita cursores anteriores", async (context) => {
  const root = await mkdtemp(path.join(os.tmpdir(), "ks-conversation-get-page-"));
  const db = openDatabase(path.join(root, "karont.db"));
  context.after(async () => {
    db.close();
    await rm(root, { recursive: true, force: true });
  });
  const handlers = createHandlers({
    db,
    startedAt: new Date().toISOString(),
    dev: false,
    emit: async () => undefined,
    env: { PATH: "" },
    homeDir: root,
  });
  const created = (await handlers.handle(
    request("conversation.create", { agent: "claude", cwd: root }),
    connection([]),
  )) as { conversation: { id: string } };
  for (let index = 0; index < 45; index += 1) {
    const timestamp = new Date(Date.UTC(2026, 0, 1, 0, index)).toISOString();
    addMessage(db, {
      id: `message-${index}`,
      conversationId: created.conversation.id,
      author: "user",
      status: "done",
      parts: [{ id: `part-${index}`, type: "text", markdown: `Mensagem ${index}` }],
      createdAt: timestamp,
      updatedAt: timestamp,
    });
  }

  const latest = (await handlers.handle(
    request("conversation.get", { id: created.conversation.id }),
    connection([]),
  )) as { messages: Array<{ id: string }>; hasOlderMessages: boolean };
  assert.equal(latest.messages.length, 40);
  assert.equal(latest.messages[0]?.id, "message-5");
  assert.equal(latest.messages.at(-1)?.id, "message-44");
  assert.equal(latest.hasOlderMessages, true);

  const older = (await handlers.handle(
    request("conversation.get", {
      id: created.conversation.id,
      before: latest.messages[0]?.id,
    }),
    connection([]),
  )) as { messages: Array<{ id: string }>; hasOlderMessages: boolean };
  assert.deepEqual(
    older.messages.map((message) => message.id),
    ["message-0", "message-1", "message-2", "message-3", "message-4"],
  );
  assert.equal(older.hasOlderMessages, false);
});

test("dev.streamTest é indisponível fora do modo dev", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "ks-"));
  const db = openDatabase(path.join(root, "karont.db"));
  const handlers = createHandlers({
    db,
    startedAt: new Date().toISOString(),
    dev: false,
    emit: async () => undefined,
    env: { PATH: "" },
    homeDir: root,
  });
  await assert.rejects(
    handlers.handle(request("dev.streamTest", { chunks: 1, chunkSize: 1 }), connection([])),
    ServiceError,
  );
  db.close();
});

test("dev.streamTest coalesce texto em ordem e termina com totais", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "ks-"));
  const db = openDatabase(path.join(root, "karont.db"));
  const afterResponse: Array<() => void> = [];
  const emitted: AnyEvent[] = [];
  const conn = connection(emitted, afterResponse);
  const handlers = createHandlers({
    db,
    startedAt: new Date().toISOString(),
    dev: true,
    emit: async (event, activeConnection) => {
      await activeConnection.emit(event);
    },
    env: { PATH: "" },
    homeDir: root,
  });
  const result = (await handlers.handle(
    request("dev.streamTest", { chunks: 12, chunkSize: 50 }),
    conn,
  )) as { streamId: string };
  assert.equal(typeof result.streamId, "string");
  assert.equal(afterResponse.length, 1);
  afterResponse[0]?.();
  await new Promise<void>((resolve) => {
    const check = (): void => {
      if (emitted.at(-1)?.event === "dev.streamTest.done") resolve();
      else setTimeout(check, 0);
    };
    check();
  });

  const deltas = emitted.filter((event) => event.event === "dev.streamTest.delta");
  assert.deepEqual(
    deltas.map((event) => event.payload.seq),
    deltas.map((_, index) => index),
  );
  assert.equal(
    deltas.map((event) => event.payload.text).join(""),
    Array.from({ length: 12 }, (_, index) => String(index % 10).repeat(50)).join(""),
  );
  assert.deepEqual(emitted.at(-1), {
    event: "dev.streamTest.done",
    payload: { streamId: result.streamId, totalChunks: 12, totalBytes: 600 },
  });
  db.close();
});

test("agents.add valida CLIs e agents.list mantém catálogo antes das personalizadas", async (context) => {
  const root = await mkdtemp(path.join(os.tmpdir(), "ks-"));
  const fakeCliDir = await createFakeCliDir(["simple-agent", "absolute-agent"]);
  context.after(async () => {
    await Promise.all([rm(root, { recursive: true }), rm(fakeCliDir, { recursive: true })]);
  });
  const db = openDatabase(path.join(root, "karont.db"));
  const handlers = createHandlers({
    db,
    startedAt: new Date().toISOString(),
    dev: false,
    emit: async () => undefined,
    env: { PATH: fakeCliDir },
    homeDir: root,
    platform: process.platform,
    agentFs: tempFs([root, fakeCliDir]),
  });
  const conn = connection([]);

  const simple = (await handlers.handle(
    request("agents.add", { name: "Agente Local", command: "simple-agent" }),
    conn,
  )) as { agent: { id: string; kind: string; found: boolean; command: string; path: string } };
  assert.equal(simple.agent.kind, "custom");
  assert.equal(simple.agent.found, true);
  assert.equal(simple.agent.command, "simple-agent");
  assert.equal(simple.agent.path, path.join(fakeCliDir, "simple-agent"));

  const absoluteCommand = path.join(fakeCliDir, "absolute-agent");
  const absolute = (await handlers.handle(
    request("agents.add", { name: "Agente Absoluto", command: absoluteCommand }),
    conn,
  )) as { agent: { path: string; command: string } };
  assert.equal(absolute.agent.path, absoluteCommand);
  assert.equal(absolute.agent.command, absoluteCommand);

  await assert.rejects(
    handlers.handle(request("agents.add", { name: "Inexistente", command: "missing-cli" }), conn),
    (error: unknown) => error instanceof ServiceError && error.code === "invalid_request",
  );
  await assert.rejects(
    handlers.handle(
      request("agents.add", { name: "Agente Local", command: "absolute-agent" }),
      conn,
    ),
    (error: unknown) => error instanceof ServiceError && error.code === "invalid_request",
  );
  await assert.rejects(
    handlers.handle(request("agents.add", { name: "cOdEx", command: "absolute-agent" }), conn),
    (error: unknown) => error instanceof ServiceError && error.code === "invalid_request",
  );
  await assert.rejects(
    handlers.handle(request("agents.remove", { id: "claude" }), conn),
    (error: unknown) => error instanceof ServiceError && error.code === "invalid_request",
  );
  await assert.rejects(
    handlers.handle(request("agents.remove", { id: "custom-missing" }), conn),
    (error: unknown) => error instanceof ServiceError && error.code === "invalid_request",
  );

  const result = (await handlers.handle(request("agents.list", {}), conn)) as {
    agents: { id: string; kind: string; found: boolean; name: string }[];
    detectedAt: string;
  };
  assert.equal(Number.isNaN(Date.parse(result.detectedAt)), false);
  assert.deepEqual(
    result.agents.slice(0, 10).map((agent) => agent.id),
    [
      "claude",
      "codex",
      "gemini",
      "opencode",
      "aider",
      "cursor-agent",
      "qwen",
      "goose",
      "amp",
      "crush",
    ],
  );
  assert.deepEqual(
    result.agents.slice(10).map((agent) => agent.name),
    ["Agente Local", "Agente Absoluto"],
  );
  assert.equal(result.agents[10]?.found, true);

  const knownBinaryPath = path.join(fakeCliDir, "claude");
  await writeFile(knownBinaryPath, "#!/bin/sh\nexit 0\n", { mode: 0o755 });
  await chmod(knownBinaryPath, 0o755);
  const cached = (await handlers.handle(request("agents.list", {}), conn)) as typeof result;
  assert.equal(cached.agents[0]?.found, false);
  const refreshed = (await handlers.handle(request("agents.detect", {}), conn)) as typeof result;
  assert.equal(refreshed.agents[0]?.found, true);

  assert.deepEqual(await handlers.handle(request("agents.remove", { id: simple.agent.id }), conn), {
    removed: true,
  });
  db.close();
});

test("folders.validate normaliza caminho e distingue diretório, arquivo e inexistente", async (context) => {
  const root = await mkdtemp(path.join(os.tmpdir(), "ks-folders-"));
  context.after(() => rm(root, { recursive: true, force: true }));
  const directory = path.join(root, "projeto");
  const file = path.join(root, "arquivo.txt");
  await mkdir(directory);
  await writeFile(file, "conteúdo");
  const db = openDatabase(path.join(root, "karont.db"));
  const handlers = createHandlers({
    db,
    startedAt: new Date().toISOString(),
    dev: false,
    emit: async () => undefined,
    env: { PATH: "" },
    homeDir: root,
  });
  const conn = connection([]);

  assert.deepEqual(
    await handlers.handle(
      request("folders.validate", { path: path.join(root, "projeto", "..", "projeto") }),
      conn,
    ),
    { path: directory, exists: true, isDirectory: true },
  );
  assert.deepEqual(await handlers.handle(request("folders.validate", { path: file }), conn), {
    path: file,
    exists: true,
    isDirectory: false,
  });
  assert.deepEqual(
    await handlers.handle(request("folders.validate", { path: path.join(root, "apagada") }), conn),
    { path: path.join(root, "apagada"), exists: false, isDirectory: false },
  );
  db.close();
});

test("folders.recent ordena, limita a oito e oculta pastas que não existem", async (context) => {
  const root = await mkdtemp(path.join(os.tmpdir(), "ks-recent-"));
  context.after(() => rm(root, { recursive: true, force: true }));
  const homeDir = path.join(root, "home");
  await mkdir(homeDir);
  const validFolders: string[] = [];
  for (let index = 0; index < 9; index += 1) {
    const folder = path.join(root, `projeto-${index}`);
    await mkdir(folder);
    validFolders.push(folder);
  }
  validFolders.push(homeDir);
  const db = openDatabase(path.join(root, "karont.db"));
  for (const [index, folder] of validFolders.entries()) {
    recordRecentFolder(db, {
      path: folder,
      usedAt: `2026-01-01T00:${String(index).padStart(2, "0")}:00.000Z`,
    });
  }
  recordRecentFolder(db, {
    path: path.join(root, "apagada"),
    usedAt: "2026-01-01T01:00:00.000Z",
  });
  const handlers = createHandlers({
    db,
    startedAt: new Date().toISOString(),
    dev: false,
    emit: async () => undefined,
    env: { PATH: "" },
    homeDir,
  });

  const result = (await handlers.handle(request("folders.recent", {}), connection([]))) as {
    folders: { path: string; name: string; usedAt: string }[];
  };
  assert.equal(result.folders.length, 8);
  assert.equal(
    result.folders.some((folder) => folder.path.endsWith("apagada")),
    false,
  );
  assert.deepEqual(
    result.folders.map((folder) => folder.usedAt),
    [...result.folders.map((folder) => folder.usedAt)].sort().reverse(),
  );
  assert.equal(result.folders.find((folder) => folder.path === homeDir)?.name, "~");
  db.close();
});

test("terminals.open responde antes de armazenar a pasta e emitir folders.changed", async (context) => {
  const root = await mkdtemp(path.join(os.tmpdir(), "ks-open-recent-"));
  context.after(() => rm(root, { recursive: true, force: true }));
  const db = openDatabase(path.join(root, "karont.db"));
  const emitted: AnyEvent[] = [];
  const afterResponse: Array<() => void | Promise<void>> = [];
  const handlers = createHandlers({
    db,
    startedAt: new Date().toISOString(),
    dev: false,
    emit: async () => undefined,
    broadcast: async (event) => void emitted.push(event),
    ptyFactory: () => new TestPty(),
    env: { SHELL: "/bin/bash" },
    homeDir: root,
  });

  const result = (await handlers.handle(
    request("terminals.open", { cwd: root, cols: 80, rows: 24 }),
    connection([], afterResponse),
  )) as { terminal: { id: string } };
  assert.ok(result.terminal.id);
  assert.equal(afterResponse.length, 1);
  assert.equal(db.prepare("SELECT path FROM recent_folders WHERE path = ?").get(root), undefined);
  await afterResponse[0]?.();
  const saved = db.prepare("SELECT path, used_at FROM recent_folders WHERE path = ?").get(root) as
    | { path: string; used_at: string }
    | undefined;
  assert.equal(saved?.path, root);
  assert.equal(Number.isNaN(Date.parse(saved?.used_at ?? "")), false);
  const changed = emitted.find((event) => event.event === "folders.changed");
  assert.ok(changed);
  assert.deepEqual(changed.payload.folders[0], {
    path: root,
    name: "~",
    usedAt: saved?.used_at,
  });
  await handlers.closeTerminals();
  db.close();
});

test("falha ao gravar pasta recente não transforma terminals.open em erro", async (context) => {
  const root = await mkdtemp(path.join(os.tmpdir(), "ks-open-recent-failure-"));
  context.after(() => rm(root, { recursive: true, force: true }));
  const db = openDatabase(path.join(root, "karont.db"));
  const handlers = createHandlers({
    db,
    startedAt: new Date().toISOString(),
    dev: false,
    emit: async () => undefined,
    ptyFactory: () => new TestPty(),
    env: { SHELL: "/bin/bash" },
    homeDir: root,
  });
  const afterResponse: Array<() => void | Promise<void>> = [];

  const result = (await handlers.handle(
    request("terminals.open", { cwd: root, cols: 80, rows: 24 }),
    connection([], afterResponse),
  )) as { terminal: { id: string } };
  db.close();
  assert.ok(result.terminal.id);
  await assert.rejects(Promise.resolve().then(() => afterResponse[0]?.()));
  await handlers.closeTerminals();
});

function projectHandlers(root: string, events: AnyEvent[]) {
  const db = openDatabase(path.join(root, "karont.db"));
  const handlers = createHandlers({
    db,
    startedAt: new Date().toISOString(),
    dev: false,
    emit: async () => undefined,
    broadcast: async (event) => void events.push(event),
    env: { PATH: "" },
    homeDir: root,
  });
  return { db, handlers };
}

test("projects: CRUD, pasta duplicada, pasta inexistente e evento projects.changed", async (context) => {
  const root = await mkdtemp(path.join(os.tmpdir(), "ks-projects-"));
  context.after(() => rm(root, { recursive: true, force: true }));
  const folder = path.join(root, "app");
  await mkdir(folder);
  const file = path.join(root, "arquivo.txt");
  await writeFile(file, "x");
  const events: AnyEvent[] = [];
  const { db, handlers } = projectHandlers(root, events);
  context.after(() => db.close());

  const created = (await handlers.handle(
    request("projects.create", { name: "App", icon: "folder", path: `${folder}/../app` }),
    connection([]),
  )) as { project: { id: string; path: string; defaultAgent: string | null } };
  assert.equal(created.project.path, folder);
  assert.equal(created.project.defaultAgent, null);
  assert.deepEqual(
    events.map((event) => event.event),
    ["projects.changed"],
  );

  await assert.rejects(
    handlers.handle(
      request("projects.create", { name: "Outro", icon: "x", path: folder }),
      connection([]),
    ),
    (error) =>
      error instanceof ServiceError &&
      error.code === "invalid_request" &&
      error.message === "Esta pasta já pertence a outro projeto.",
  );
  await assert.rejects(
    handlers.handle(
      request("projects.create", { name: "Sumiu", icon: "x", path: path.join(root, "nada") }),
      connection([]),
    ),
    (error) => error instanceof ServiceError && error.code === "invalid_request",
  );
  await assert.rejects(
    handlers.handle(
      request("projects.create", { name: "Arquivo", icon: "x", path: file }),
      connection([]),
    ),
    (error) => error instanceof ServiceError && error.code === "invalid_request",
  );
  assert.equal(events.length, 1);

  const updated = (await handlers.handle(
    request("projects.update", { id: created.project.id, name: "App 2", defaultAgent: "codex" }),
    connection([]),
  )) as { project: { name: string; path: string; defaultAgent: string | null } };
  assert.equal(updated.project.name, "App 2");
  assert.equal(updated.project.defaultAgent, "codex");
  assert.equal(updated.project.path, folder);
  assert.equal(events.length, 2);
  const changed = events.at(-1);
  assert.equal(changed?.event === "projects.changed" && changed.payload.projects[0]?.name, "App 2");

  const withPath = parseRequest({
    type: "request",
    id: "1",
    method: "projects.update",
    params: { id: created.project.id, path: root },
  });
  assert.equal(withPath.ok, false);
  await assert.rejects(
    handlers.handle(request("projects.update", { id: "nao-existe", name: "x" }), connection([])),
    (error) => error instanceof ServiceError && error.code === "invalid_request",
  );
  assert.equal(events.length, 2);

  const listed = (await handlers.handle(request("projects.list", {}), connection([]))) as {
    projects: unknown[];
  };
  assert.equal(listed.projects.length, 1);

  assert.deepEqual(
    await handlers.handle(request("projects.remove", { id: created.project.id }), connection([])),
    { removed: true },
  );
  assert.equal(events.length, 3);
  const afterRemove = events.at(-1);
  assert.deepEqual(afterRemove?.event === "projects.changed" && afterRemove.payload.projects, []);
  assert.equal((await stat(folder)).isDirectory(), true);
  await assert.rejects(
    handlers.handle(request("projects.remove", { id: created.project.id }), connection([])),
    (error) => error instanceof ServiceError && error.code === "invalid_request",
  );
});

test("conversation.create valida projectId; branch preserva; remover projeto solta a conversa", async (context) => {
  const root = await mkdtemp(path.join(os.tmpdir(), "ks-project-conv-"));
  context.after(() => rm(root, { recursive: true, force: true }));
  const folder = path.join(root, "app");
  const elsewhere = path.join(root, "worktree");
  await mkdir(folder);
  await mkdir(elsewhere);
  const events: AnyEvent[] = [];
  const { db, handlers } = projectHandlers(root, events);
  context.after(() => db.close());

  const { project } = (await handlers.handle(
    request("projects.create", { name: "App", icon: "folder", path: folder }),
    connection([]),
  )) as { project: { id: string } };

  await assert.rejects(
    handlers.handle(
      request("conversation.create", { agent: "claude", cwd: folder, projectId: "nao-existe" }),
      connection([]),
    ),
    (error) => error instanceof ServiceError && error.code === "invalid_request",
  );

  const { conversation } = (await handlers.handle(
    request("conversation.create", { agent: "claude", cwd: elsewhere, projectId: project.id }),
    connection([]),
  )) as { conversation: Conversation };
  assert.equal(conversation.projectId, project.id);
  assert.equal(conversation.cwd, elsewhere);

  const now = new Date().toISOString();
  addMessage(db, {
    id: "agent-1",
    conversationId: conversation.id,
    author: "agent",
    status: "done",
    parts: [{ id: "p1", type: "text", markdown: "Oi" }],
    createdAt: now,
    updatedAt: now,
  });
  db.prepare(
    "INSERT INTO agent_sessions (conversation_id,session_id,updated_at) VALUES (?,?,?)",
  ).run(conversation.id, "sessao-1", now);

  const branched = (await handlers.handle(
    request("conversation.branch", { id: conversation.id, messageId: "agent-1" }),
    connection([]),
  )) as { conversation: Conversation };
  assert.equal(branched.conversation.projectId, project.id);

  await handlers.handle(request("projects.remove", { id: project.id }), connection([]));
  for (const id of [conversation.id, branched.conversation.id]) {
    const got = (await handlers.handle(request("conversation.get", { id }), connection([]))) as {
      conversation: Conversation;
      messages: unknown[];
    };
    assert.equal("projectId" in got.conversation, false);
    assert.equal(got.messages.length, 1);
  }
  const session = db
    .prepare("SELECT session_id FROM agent_sessions WHERE conversation_id=?")
    .get(conversation.id) as { session_id: string } | undefined;
  assert.equal(session?.session_id, "sessao-1");
  await handlers.closeAgents();
});

type WorkspaceLike = { id: string; name: string; icon: string; position: number };

async function callWs<T>(
  handlers: ReturnType<typeof createHandlers>,
  method: string,
  params: unknown,
): Promise<T> {
  return (await handlers.handle(request(method, params), connection([]))) as T;
}

async function ws2(
  handlers: ReturnType<typeof createHandlers>,
  name: string,
): Promise<WorkspaceLike> {
  return (await callWs<{ workspace: WorkspaceLike }>(handlers, "workspaces.create", { name }))
    .workspace;
}

function rejectsInvalid(promise: Promise<unknown>) {
  return assert.rejects(
    promise,
    (error) => error instanceof ServiceError && error.code === "invalid_request",
  );
}

test("workspaces: Pessoal padrão, CRUD, nome aparado, nomes repetidos e eventos", async (context) => {
  const root = await mkdtemp(path.join(os.tmpdir(), "ks-ws-crud-"));
  context.after(() => rm(root, { recursive: true, force: true }));
  const events: AnyEvent[] = [];
  const { db, handlers } = projectHandlers(root, events);
  context.after(() => db.close());

  const first = await callWs<{ workspaces: WorkspaceLike[] }>(handlers, "workspaces.list", {});
  assert.equal(first.workspaces.length, 1);
  assert.equal(first.workspaces[0]?.name, "Pessoal");
  assert.equal(first.workspaces[0]?.position, 0);

  const work = await ws2(handlers, "  Trabalho  ");
  assert.equal(work.name, "Trabalho");
  assert.equal(work.position, 1);
  const twin = await ws2(handlers, "Trabalho");
  assert.equal(twin.name, "Trabalho");
  assert.notEqual(twin.id, work.id);
  assert.equal(events.filter((event) => event.event === "workspaces.changed").length, 2);

  const blank = parseRequest({
    type: "request",
    id: "1",
    method: "workspaces.update",
    params: { id: work.id, name: "   " },
  });
  assert.equal(blank.ok, false);
  await rejectsInvalid(callWs(handlers, "workspaces.update", { id: "nao-existe", name: "x" }));
  const renamed = await callWs<{ workspace: WorkspaceLike }>(handlers, "workspaces.update", {
    id: work.id,
    name: " Casa ",
    icon: "briefcase",
  });
  assert.equal(renamed.workspace.name, "Casa");
  assert.equal(renamed.workspace.icon, "briefcase");
  const last = events.at(-1);
  assert.equal(last?.event === "workspaces.changed" && last.payload.workspaces.length, 3);
});

test("workspaces.reorder exige todos os ids, sem repetir nem inventar", async (context) => {
  const root = await mkdtemp(path.join(os.tmpdir(), "ks-ws-reorder-"));
  context.after(() => rm(root, { recursive: true, force: true }));
  const events: AnyEvent[] = [];
  const { db, handlers } = projectHandlers(root, events);
  context.after(() => db.close());
  const [pessoal] = (await callWs<{ workspaces: WorkspaceLike[] }>(handlers, "workspaces.list", {}))
    .workspaces;
  assert.ok(pessoal);
  const b = await ws2(handlers, "B");
  const c = await ws2(handlers, "C");
  events.length = 0;

  await rejectsInvalid(callWs(handlers, "workspaces.reorder", { ids: [pessoal.id, b.id] }));
  await rejectsInvalid(callWs(handlers, "workspaces.reorder", { ids: [pessoal.id, b.id, b.id] }));
  await rejectsInvalid(
    callWs(handlers, "workspaces.reorder", { ids: [pessoal.id, b.id, "nao-existe"] }),
  );
  assert.equal(events.length, 0);

  const done = await callWs<{ workspaces: WorkspaceLike[] }>(handlers, "workspaces.reorder", {
    ids: [c.id, pessoal.id, b.id],
  });
  assert.deepEqual(
    done.workspaces.map((workspace) => [workspace.id, workspace.position]),
    [
      [c.id, 0],
      [pessoal.id, 1],
      [b.id, 2],
    ],
  );
  assert.equal(events.filter((event) => event.event === "workspaces.changed").length, 1);
  // O padrão para coisas novas passa a ser o de menor position.
  const folder = path.join(root, "app");
  await mkdir(folder);
  const { project } = await callWs<{ project: { workspaceId: string } }>(
    handlers,
    "projects.create",
    { name: "App", icon: "folder", path: folder },
  );
  assert.equal(project.workspaceId, c.id);
});

test("workspaces: padrões, projeto manda na conversa, ramo herda e workspace inexistente é recusado", async (context) => {
  const root = await mkdtemp(path.join(os.tmpdir(), "ks-ws-defaults-"));
  context.after(() => rm(root, { recursive: true, force: true }));
  const folder = path.join(root, "app");
  await mkdir(folder);
  const events: AnyEvent[] = [];
  const { db, handlers } = projectHandlers(root, events);
  context.after(() => db.close());
  const [pessoal] = (await callWs<{ workspaces: WorkspaceLike[] }>(handlers, "workspaces.list", {}))
    .workspaces;
  assert.ok(pessoal);
  const trabalho = await ws2(handlers, "Trabalho");

  await rejectsInvalid(
    callWs(handlers, "conversation.create", { agent: "claude", cwd: root, workspaceId: "nope" }),
  );
  await rejectsInvalid(
    callWs(handlers, "projects.create", {
      name: "App",
      icon: "folder",
      path: folder,
      workspaceId: "nope",
    }),
  );

  type Conv = { conversation: Conversation };
  const loose = await callWs<Conv>(handlers, "conversation.create", { agent: "claude", cwd: root });
  assert.equal(loose.conversation.workspaceId, pessoal.id);
  const looseWork = await callWs<Conv>(handlers, "conversation.create", {
    agent: "claude",
    cwd: root,
    workspaceId: trabalho.id,
  });
  assert.equal(looseWork.conversation.workspaceId, trabalho.id);

  const { project } = await callWs<{ project: { id: string; workspaceId: string } }>(
    handlers,
    "projects.create",
    { name: "App", icon: "folder", path: folder, workspaceId: trabalho.id },
  );
  assert.equal(project.workspaceId, trabalho.id);
  const inProject = await callWs<Conv>(handlers, "conversation.create", {
    agent: "claude",
    cwd: folder,
    projectId: project.id,
  });
  assert.equal(inProject.conversation.workspaceId, trabalho.id);
  const conflicting = await callWs<Conv>(handlers, "conversation.create", {
    agent: "claude",
    cwd: folder,
    projectId: project.id,
    workspaceId: pessoal.id,
  });
  assert.equal(conflicting.conversation.workspaceId, trabalho.id);

  const now = new Date().toISOString();
  addMessage(db, {
    id: "agent-ws",
    conversationId: looseWork.conversation.id,
    author: "agent",
    status: "done",
    parts: [{ id: "p1", type: "text", markdown: "Oi" }],
    createdAt: now,
    updatedAt: now,
  });
  const branched = await callWs<Conv>(handlers, "conversation.branch", {
    id: looseWork.conversation.id,
    messageId: "agent-ws",
  });
  assert.equal(branched.conversation.workspaceId, trabalho.id);
});

test("conversation.create emite conversation.stateChanged com a conversa nova", async (context) => {
  const root = await mkdtemp(path.join(os.tmpdir(), "ks-ws-create-event-"));
  context.after(() => rm(root, { recursive: true, force: true }));
  const events: AnyEvent[] = [];
  const { db, handlers } = projectHandlers(root, events);
  context.after(() => db.close());
  const { conversation } = await callWs<{ conversation: Conversation }>(
    handlers,
    "conversation.create",
    { agent: "claude", cwd: root },
  );
  const changed = events.filter((event) => event.event === "conversation.stateChanged");
  assert.equal(changed.length, 1);
  const payload = changed[0]?.event === "conversation.stateChanged" ? changed[0].payload : null;
  assert.equal(payload?.conversation.id, conversation.id);
  assert.equal(payload?.conversation.workspaceId, conversation.workspaceId);
});

test("projects.update move o projeto e as conversas dele; remover projeto mantém o workspace", async (context) => {
  const root = await mkdtemp(path.join(os.tmpdir(), "ks-ws-move-"));
  context.after(() => rm(root, { recursive: true, force: true }));
  const folder = path.join(root, "app");
  await mkdir(folder);
  const events: AnyEvent[] = [];
  const { db, handlers } = projectHandlers(root, events);
  context.after(() => db.close());
  const [pessoal] = (await callWs<{ workspaces: WorkspaceLike[] }>(handlers, "workspaces.list", {}))
    .workspaces;
  assert.ok(pessoal);
  const trabalho = await ws2(handlers, "Trabalho");
  const { project } = await callWs<{ project: { id: string } }>(handlers, "projects.create", {
    name: "App",
    icon: "folder",
    path: folder,
  });
  type Conv = { conversation: Conversation };
  const inProject = await callWs<Conv>(handlers, "conversation.create", {
    agent: "claude",
    cwd: folder,
    projectId: project.id,
  });
  const loose = await callWs<Conv>(handlers, "conversation.create", { agent: "claude", cwd: root });

  await rejectsInvalid(
    callWs(handlers, "projects.update", { id: project.id, workspaceId: "nope" }),
  );
  const moved = await callWs<{ project: { workspaceId: string } }>(handlers, "projects.update", {
    id: project.id,
    workspaceId: trabalho.id,
  });
  assert.equal(moved.project.workspaceId, trabalho.id);
  const workspaceOf = (id: string) =>
    (
      db.prepare("SELECT workspace_id FROM conversations WHERE id=?").get(id) as {
        workspace_id: string;
      }
    ).workspace_id;
  assert.equal(workspaceOf(inProject.conversation.id), trabalho.id);
  assert.equal(workspaceOf(loose.conversation.id), pessoal.id);

  await callWs(handlers, "projects.remove", { id: project.id });
  const afterRemove = await callWs<Conv>(handlers, "conversation.get", {
    id: inProject.conversation.id,
  });
  assert.equal(afterRemove.conversation.projectId, undefined);
  assert.equal(afterRemove.conversation.workspaceId, trabalho.id);
  assert.equal((await stat(folder)).isDirectory(), true);
});

test("workspaces.remove move projetos e conversas para o de menor position e recusa o último", async (context) => {
  const root = await mkdtemp(path.join(os.tmpdir(), "ks-ws-remove-"));
  context.after(() => rm(root, { recursive: true, force: true }));
  const folder = path.join(root, "app");
  await mkdir(folder);
  const events: AnyEvent[] = [];
  const { db, handlers } = projectHandlers(root, events);
  context.after(() => db.close());
  const [pessoal] = (await callWs<{ workspaces: WorkspaceLike[] }>(handlers, "workspaces.list", {}))
    .workspaces;
  assert.ok(pessoal);
  const trabalho = await ws2(handlers, "Trabalho");
  const { project } = await callWs<{ project: { id: string } }>(handlers, "projects.create", {
    name: "App",
    icon: "folder",
    path: folder,
    workspaceId: trabalho.id,
  });
  type Conv = { conversation: Conversation };
  const inProject = await callWs<Conv>(handlers, "conversation.create", {
    agent: "claude",
    cwd: folder,
    projectId: project.id,
  });
  const loose = await callWs<Conv>(handlers, "conversation.create", {
    agent: "claude",
    cwd: root,
    workspaceId: trabalho.id,
  });
  events.length = 0;

  await rejectsInvalid(callWs(handlers, "workspaces.remove", { id: "nope" }));
  assert.deepEqual(await callWs(handlers, "workspaces.remove", { id: trabalho.id }), {
    removed: true,
  });
  assert.ok(events.some((event) => event.event === "workspaces.changed"));
  assert.ok(events.some((event) => event.event === "projects.changed"));
  const projects = await callWs<{ projects: Array<{ workspaceId: string }> }>(
    handlers,
    "projects.list",
    {},
  );
  assert.equal(projects.projects[0]?.workspaceId, pessoal.id);
  for (const id of [inProject.conversation.id, loose.conversation.id]) {
    const got = await callWs<Conv>(handlers, "conversation.get", { id });
    assert.equal(got.conversation.workspaceId, pessoal.id);
  }
  assert.equal(
    (await callWs<{ workspaces: unknown[] }>(handlers, "workspaces.list", {})).workspaces.length,
    1,
  );

  const error = await callWs(handlers, "workspaces.remove", { id: pessoal.id }).catch(
    (caught: unknown) => caught,
  );
  assert.ok(error instanceof ServiceError);
  assert.equal(error.code, "invalid_request");
  assert.equal(error.message, "Não dá para apagar o último workspace.");
});

test("terminals.open guarda projectId e workspaceId com as mesmas regras de padrão", async (context) => {
  const root = await mkdtemp(path.join(os.tmpdir(), "ks-ws-terminal-"));
  context.after(() => rm(root, { recursive: true, force: true }));
  const folder = path.join(root, "app");
  await mkdir(folder);
  const db = openDatabase(path.join(root, "karont.db"));
  context.after(() => db.close());
  const handlers = createHandlers({
    db,
    startedAt: new Date().toISOString(),
    dev: false,
    emit: async () => undefined,
    ptyFactory: () => new TestPty(),
    env: { SHELL: "/bin/bash" },
    homeDir: root,
  });
  context.after(() => handlers.closeTerminals());
  const [pessoal] = (await callWs<{ workspaces: WorkspaceLike[] }>(handlers, "workspaces.list", {}))
    .workspaces;
  assert.ok(pessoal);
  const trabalho = await ws2(handlers, "Trabalho");
  const { project } = await callWs<{ project: { id: string } }>(handlers, "projects.create", {
    name: "App",
    icon: "folder",
    path: folder,
    workspaceId: trabalho.id,
  });
  type Open = { terminal: { workspaceId: string; projectId?: string } };
  const open = (extra: object) =>
    callWs<Open>(handlers, "terminals.open", { cwd: root, cols: 80, rows: 24, ...extra });

  const plain = await open({});
  assert.equal(plain.terminal.workspaceId, pessoal.id);
  assert.equal(plain.terminal.projectId, undefined);
  const inWork = await open({ workspaceId: trabalho.id });
  assert.equal(inWork.terminal.workspaceId, trabalho.id);
  const inProject = await open({ projectId: project.id, workspaceId: pessoal.id });
  assert.equal(inProject.terminal.workspaceId, trabalho.id);
  assert.equal(inProject.terminal.projectId, project.id);
  await rejectsInvalid(open({ workspaceId: "nope" }));
  await rejectsInvalid(open({ projectId: "nope" }));
  const listed = await callWs<{ terminals: Array<{ workspaceId: string }> }>(
    handlers,
    "terminals.list",
    {},
  );
  assert.equal(listed.terminals.length, 3);
});

test("terminais abertos acompanham workspace apagado, projeto movido e projeto removido", async (context) => {
  const root = await mkdtemp(path.join(os.tmpdir(), "ks-ws-term-follow-"));
  context.after(() => rm(root, { recursive: true, force: true }));
  const folder = path.join(root, "app");
  await mkdir(folder);
  const events: AnyEvent[] = [];
  const db = openDatabase(path.join(root, "karont.db"));
  context.after(() => db.close());
  const handlers = createHandlers({
    db,
    startedAt: new Date().toISOString(),
    dev: false,
    emit: async () => undefined,
    broadcast: async (event) => void events.push(event),
    ptyFactory: () => new TestPty(),
    env: { SHELL: "/bin/bash" },
    homeDir: root,
  });
  context.after(() => handlers.closeTerminals());
  const [pessoal] = (await callWs<{ workspaces: WorkspaceLike[] }>(handlers, "workspaces.list", {}))
    .workspaces;
  assert.ok(pessoal);
  const a = await ws2(handlers, "A");
  const b = await ws2(handlers, "B");
  const { project } = await callWs<{ project: { id: string } }>(handlers, "projects.create", {
    name: "App",
    icon: "folder",
    path: folder,
    workspaceId: a.id,
  });
  type Open = { terminal: { id: string } };
  const open = (extra: object) =>
    callWs<Open>(handlers, "terminals.open", { cwd: root, cols: 80, rows: 24, ...extra });
  const inProject = await open({ projectId: project.id });
  const loose = await open({ workspaceId: b.id });
  const listTerminals = async () =>
    (
      await callWs<{
        terminals: Array<{ id: string; workspaceId: string; projectId?: string }>;
      }>(handlers, "terminals.list", {})
    ).terminals;
  const find = async (id: string) => (await listTerminals()).find((terminal) => terminal.id === id);
  const changedCount = () => events.filter((event) => event.event === "terminals.changed").length;
  const moved = () => events.filter((event) => event.event === "conversations.workspaceMoved");

  // Mover o projeto leva o terminal dele; o solto fica.
  events.length = 0;
  await callWs(handlers, "projects.update", { id: project.id, workspaceId: b.id });
  assert.equal((await find(inProject.terminal.id))?.workspaceId, b.id);
  assert.equal(changedCount(), 1);
  const movedProject = moved()[0];
  assert.deepEqual(movedProject?.payload, { workspaceId: b.id, projectId: project.id });
  // Sem mudança de workspace: nada de evento novo.
  events.length = 0;
  await callWs(handlers, "projects.update", { id: project.id, name: "Outro nome" });
  assert.equal(changedCount(), 0);
  assert.equal(moved().length, 0);

  // Apagar o workspace B move os dois terminais para o de menor position (Pessoal).
  events.length = 0;
  await callWs(handlers, "workspaces.remove", { id: b.id });
  assert.equal((await find(inProject.terminal.id))?.workspaceId, pessoal.id);
  assert.equal((await find(loose.terminal.id))?.workspaceId, pessoal.id);
  assert.equal(changedCount(), 1);
  assert.deepEqual(moved()[0]?.payload, { workspaceId: pessoal.id, fromWorkspaceId: b.id });
  const order = events.map((event) => event.event);
  assert.ok(order.indexOf("conversations.workspaceMoved") < order.indexOf("workspaces.changed"));

  // Remover o projeto tira o projectId e mantém o workspace.
  events.length = 0;
  await callWs(handlers, "projects.remove", { id: project.id });
  const afterRemove = await find(inProject.terminal.id);
  assert.equal(afterRemove?.projectId, undefined);
  assert.equal(afterRemove?.workspaceId, pessoal.id);
  assert.equal(changedCount(), 1);
  // Remover de novo algo sem terminais não emite terminals.changed.
  const { project: other } = await callWs<{ project: { id: string } }>(
    handlers,
    "projects.create",
    {
      name: "Vazio",
      icon: "folder",
      path: root,
    },
  );
  events.length = 0;
  await callWs(handlers, "projects.remove", { id: other.id });
  assert.equal(changedCount(), 0);
});

class TestPty implements TerminalPty {
  readonly #exitListeners: Array<(event: { exitCode: number; signal?: number }) => void> = [];

  onData(_listener: (data: string) => void): { dispose(): void } {
    return { dispose: () => undefined };
  }

  onExit(listener: (event: { exitCode: number; signal?: number }) => void): { dispose(): void } {
    this.#exitListeners.push(listener);
    return { dispose: () => undefined };
  }

  write(_data: string): void {}
  resize(_cols: number, _rows: number): void {}
  pause(): void {}
  resume(): void {}

  kill(): void {
    for (const listener of this.#exitListeners) listener({ exitCode: 0, signal: 1 });
  }
}

function tempFs(allowedRoots: string[]): AgentDetectionFs {
  const roots = allowedRoots.map((allowedRoot) => path.resolve(allowedRoot));
  const assertTemporaryPath = (filePath: string): void => {
    const resolvedPath = path.resolve(filePath);
    if (
      !roots.some((root) => {
        const relativePath = path.relative(root, resolvedPath);
        return (
          relativePath === "" ||
          (!relativePath.startsWith(`..${path.sep}`) && relativePath !== "..")
        );
      })
    ) {
      throw new Error("O teste bloqueou um caminho fora das pastas temporárias.");
    }
  };
  return {
    access: async (filePath, mode) => {
      assertTemporaryPath(filePath);
      await access(filePath, mode);
    },
    stat: async (filePath) => {
      assertTemporaryPath(filePath);
      return stat(filePath);
    },
    readdir: async (directoryPath) => {
      assertTemporaryPath(directoryPath);
      return readdir(directoryPath);
    },
  };
}

test("fila: queue.status bate com queue.changed e settings.set do limite drena a fila", async (context) => {
  const root = await mkdtemp(path.join(os.tmpdir(), "ks-fila-"));
  context.after(() => rm(root, { recursive: true, force: true }));
  const events: AnyEvent[] = [];
  const db = openDatabase(path.join(root, "karont.db"));
  const adapterFactory: AdapterFactory = (_conversation, emit) => ({
    start: async () => undefined,
    send: async () => emit({ kind: "state", state: "working" }),
    respond: async () => undefined,
    interrupt: async () => undefined,
    dispose: async () => undefined,
  });
  const handlers = createHandlers({
    db,
    startedAt: new Date().toISOString(),
    dev: false,
    emit: async () => undefined,
    broadcast: async (event) => void events.push(event),
    env: { PATH: "", KARONT_DISABLE_AGENT_DETECTION: "1" },
    homeDir: root,
    adapterFactory,
  });
  context.after(async () => {
    await handlers.closeAgents();
    db.close();
  });
  const conn = connection([]);
  await handlers.handle(request("settings.set", { key: "agents.maxConcurrent", value: 1 }), conn);
  const ids: string[] = [];
  for (const title of ["A", "B"]) {
    const created = (await handlers.handle(
      request("conversation.create", { agent: "claude", cwd: root, mode: "edit", title }),
      conn,
    )) as { conversation: Conversation };
    ids.push(created.conversation.id);
    await handlers.handle(
      request("conversation.send", { id: created.conversation.id, text: title }),
      conn,
    );
  }
  const status = await handlers.handle(request("queue.status", {}), conn);
  assert.deepEqual(status, { limit: 1, running: 1, queuedConversationIds: [ids[1]] });
  const lastChanged = [...events].reverse().find((event) => event.event === "queue.changed");
  assert.deepEqual(lastChanged?.payload, status);

  await handlers.handle(request("settings.set", { key: "agents.maxConcurrent", value: 2 }), conn);
  assert.deepEqual(await handlers.handle(request("queue.status", {}), conn), {
    limit: 2,
    running: 2,
    queuedConversationIds: [],
  });
});

test("restore.*: lista, mudanças, diff, prévia e desfazer pelos métodos, com evento e erros claros", async (context) => {
  const root = await realpath(await mkdtemp(path.join(os.tmpdir(), "ks-restore-")));
  context.after(() => rm(root, { recursive: true, force: true }));
  const repo = path.join(root, "repo");
  await mkdir(repo);
  const git = (...args: string[]) => {
    const env = { ...process.env };
    for (const name of ["GIT_DIR", "GIT_WORK_TREE", "GIT_INDEX_FILE"]) delete env[name];
    return execFileSync("git", args, { cwd: repo, env, encoding: "utf8" });
  };
  git("init", "-q", "-b", "main");
  git("config", "user.name", "Teste");
  git("config", "user.email", "teste@example.com");
  await writeFile(path.join(repo, "antigo.txt"), "antigo\n");
  git("add", "-A");
  git("commit", "-q", "-m", "inicial");

  const events: AnyEvent[] = [];
  const db = openDatabase(path.join(root, "karont.db"));
  const emitters = new Map<string, Parameters<AdapterFactory>[1]>();
  let agentWrote = false;
  const adapterFactory: AdapterFactory = (conversation, emit) => {
    emitters.set(conversation.id, emit);
    return {
      start: async () => undefined,
      send: async () => {
        await writeFile(path.join(repo, "antigo.txt"), "mudado\n");
        await writeFile(path.join(repo, "criado.txt"), "criado\n");
        agentWrote = true;
        emit({ kind: "state", state: "working" });
      },
      respond: async () => undefined,
      interrupt: async () => undefined,
      dispose: async () => undefined,
    };
  };
  const handlers = createHandlers({
    db,
    startedAt: new Date().toISOString(),
    dev: false,
    emit: async () => undefined,
    broadcast: async (event) => void events.push(event),
    env: { PATH: process.env.PATH ?? "", KARONT_DISABLE_AGENT_DETECTION: "1" },
    homeDir: root,
    adapterFactory,
  });
  context.after(async () => {
    await handlers.closeAgents();
    db.close();
  });
  const conn = connection([]);
  const call = async <M extends Parameters<typeof parseResult>[0]>(method: M, params: unknown) => {
    const result = await handlers.handle(request(method, params), conn);
    const parsed = parseResult(method, result);
    assert.equal(parsed.ok, true, `${method} devolve o formato do contrato`);
    return result as never;
  };
  const created = (await handlers.handle(
    request("conversation.create", { agent: "claude", cwd: repo, mode: "edit", title: "R" }),
    conn,
  )) as { conversation: Conversation };
  const conversationId = created.conversation.id;
  const sent = (await handlers.handle(
    request("conversation.send", { id: conversationId, text: "mexa" }),
    conn,
  )) as { agentMessage: { id: string } };
  const messageId = sent.agentMessage.id;
  for (let attempt = 0; attempt < 300 && !agentWrote; attempt += 1) {
    await new Promise<void>((resolve) => setTimeout(resolve, 10));
  }
  assert.equal(agentWrote, true);
  emitters.get(conversationId)?.({ kind: "turn-end", status: "done" });
  for (let attempt = 0; attempt < 300; attempt += 1) {
    const listed = (await call("restore.list", { conversationId })) as {
      points: Array<{ state: string }>;
    };
    if (listed.points[0]?.state === "ready") break;
    await new Promise<void>((resolve) => setTimeout(resolve, 10));
  }
  const changedEvent = events.find((event) => event.event === "restore.changed");
  assert.equal(changedEvent?.payload.point.messageId, messageId);
  assert.equal(changedEvent?.payload.point.state, "ready");
  assert.equal(changedEvent?.payload.point.changedFiles, 2);

  const changes = (await call("restore.changes", { conversationId, messageId })) as {
    files: Array<{ path: string }>;
  };
  assert.deepEqual(changes.files.map((file) => file.path).sort(), ["antigo.txt", "criado.txt"]);
  const diff = (await call("restore.diff", {
    conversationId,
    messageId,
    path: "antigo.txt",
  })) as { patch: string };
  assert.match(diff.patch, /\+mudado/);
  await assert.rejects(
    handlers.handle(request("restore.diff", { conversationId, messageId, path: "fora.txt" }), conn),
    (error: unknown) => error instanceof ServiceError && error.code === "invalid_request",
  );
  await assert.rejects(
    handlers.handle(request("restore.changes", { conversationId, messageId: "nada" }), conn),
    (error: unknown) => error instanceof ServiceError && error.code === "invalid_request",
  );
  await assert.rejects(
    handlers.handle(request("restore.list", { conversationId: "nada" }), conn),
    (error: unknown) => error instanceof ServiceError && error.code === "unavailable",
  );
  const preview = await call("restore.undoPreview", { conversationId, messageId });
  assert.deepEqual(preview, {
    files: 2,
    userChanged: [],
    headMoved: false,
    concurrent: false,
    submodulesSkipped: [],
  });
  assert.deepEqual(await call("restore.undo", { conversationId, messageId }), {
    restored: 1,
    removed: 1,
  });
  assert.equal(await readFile(path.join(repo, "antigo.txt"), "utf8"), "antigo\n");
  assert.equal(
    await stat(path.join(repo, "criado.txt")).then(
      () => true,
      () => false,
    ),
    false,
  );
  const lastEvent = [...events].reverse().find((event) => event.event === "restore.changed");
  assert.equal(lastEvent?.payload.point.state, "undone");
  await assert.rejects(
    handlers.handle(request("restore.undo", { conversationId, messageId }), conn),
    (error: unknown) => error instanceof ServiceError && error.code === "unavailable",
  );
});

async function worktreeScenario(context: { after: (fn: () => Promise<void> | void) => void }) {
  const root = await realpath(await mkdtemp(path.join(os.tmpdir(), "ks-wt-h-")));
  const repo = path.join(root, "repo");
  const dataDir = path.join(root, "data");
  await mkdir(repo);
  const git = (cwd: string, ...args: string[]) => {
    const env = { ...process.env };
    for (const name of ["GIT_DIR", "GIT_WORK_TREE", "GIT_INDEX_FILE"]) delete env[name];
    return execFileSync("git", args, { cwd, env, encoding: "utf8" });
  };
  git(repo, "init", "-q", "-b", "main");
  git(repo, "config", "user.name", "Teste");
  git(repo, "config", "user.email", "teste@example.com");
  await writeFile(path.join(repo, "antigo.txt"), "antigo\n");
  git(repo, "add", "-A");
  git(repo, "commit", "-q", "-m", "inicial");

  const events: AnyEvent[] = [];
  const db = openDatabase(path.join(root, "karont.db"));
  const emitters = new Map<string, Parameters<AdapterFactory>[1]>();
  const writes: { cwd: string; wrote: boolean } = { cwd: "", wrote: false };
  const adapterFactory: AdapterFactory = (conversation, emit) => {
    emitters.set(conversation.id, emit);
    return {
      start: async () => undefined,
      send: async () => {
        await writeFile(path.join(conversation.cwd, "antigo.txt"), "mudado\n");
        await writeFile(path.join(conversation.cwd, "criado.txt"), "criado\n");
        writes.cwd = conversation.cwd;
        writes.wrote = true;
        emit({ kind: "state", state: "working" });
      },
      respond: async () => undefined,
      interrupt: async () => undefined,
      dispose: async () => undefined,
    };
  };
  const handlers = createHandlers({
    db,
    startedAt: new Date().toISOString(),
    dev: false,
    emit: async () => undefined,
    broadcast: async (event) => void events.push(event),
    env: { PATH: process.env.PATH ?? "", KARONT_DISABLE_AGENT_DETECTION: "1" },
    homeDir: root,
    dataDir,
    adapterFactory,
  });
  context.after(async () => {
    await handlers.closeAgents();
    db.close();
    await rm(root, { recursive: true, force: true });
  });
  const conn = connection([]);
  const call = async <M extends Parameters<typeof parseResult>[0]>(method: M, params: unknown) => {
    const result = await handlers.handle(request(method, params), conn);
    const parsed = parseResult(method, result);
    assert.equal(parsed.ok, true, `${method} devolve o formato do contrato`);
    return result as never;
  };
  const { project } = (await call("projects.create", {
    name: "Repo",
    icon: "folder",
    path: repo,
  })) as { project: { id: string } };
  return { root, repo, dataDir, git, events, db, handlers, conn, call, project, emitters, writes };
}

test("worktrees.*: métodos, eventos, vínculo da conversa e remoção mantém as mensagens", async (context) => {
  const { repo, dataDir, git, events, db, handlers, conn, call, project } =
    await worktreeScenario(context);
  const created = (await call("worktrees.create", { projectId: project.id })) as {
    worktree: { id: string; path: string; branch: string; projectId: string };
  };
  const { worktree } = created;
  assert.equal(path.dirname(worktree.path), path.join(dataDir, "worktrees"));
  const changedEvents = () => events.filter((event) => event.event === "worktrees.changed");
  assert.equal(changedEvents().length, 1);
  assert.equal(changedEvents()[0]?.payload.projectId, project.id);
  assert.deepEqual(
    changedEvents()[0]?.payload.worktrees.map((entry: { id: string }) => entry.id),
    [worktree.id],
  );
  const listed = (await call("worktrees.list", { projectId: project.id })) as {
    worktrees: { id: string }[];
  };
  assert.deepEqual(
    listed.worktrees.map((entry) => entry.id),
    [worktree.id],
  );
  assert.deepEqual(await call("worktrees.status", { id: worktree.id }), {
    dirtyFiles: 0,
    unmergedCommits: 0,
    busyConversations: 0,
    missing: false,
  });

  // cwd errado e cópia inexistente: invalid_request.
  for (const params of [
    { cwd: repo, worktreeId: worktree.id },
    { cwd: path.join(worktree.path, "."), worktreeId: "nao-existe" },
    { cwd: path.dirname(worktree.path), worktreeId: worktree.id },
  ]) {
    await assert.rejects(
      handlers.handle(
        request("conversation.create", { agent: "claude", mode: "edit", ...params }),
        conn,
      ),
      (error: unknown) => error instanceof ServiceError && error.code === "invalid_request",
    );
  }
  const { conversation } = (await call("conversation.create", {
    agent: "claude",
    cwd: worktree.path,
    worktreeId: worktree.id,
    projectId: project.id,
    mode: "edit",
  })) as { conversation: Conversation };
  assert.equal(conversation.worktreeId, worktree.id);
  assert.equal(conversation.cwd, worktree.path);

  const now = new Date().toISOString();
  addMessage(db, {
    id: "agent-1",
    conversationId: conversation.id,
    author: "agent",
    status: "done",
    parts: [{ id: "p1", type: "text", markdown: "Oi" }],
    createdAt: now,
    updatedAt: now,
  });
  const branched = (await call("conversation.branch", {
    id: conversation.id,
    messageId: "agent-1",
  })) as { conversation: Conversation };
  assert.equal(branched.conversation.worktreeId, worktree.id);
  assert.equal(branched.conversation.cwd, worktree.path);

  // Remover: conversas ficam sem vínculo e mantêm as mensagens.
  const removed = await call("worktrees.remove", { id: worktree.id });
  assert.deepEqual(removed, { removed: true, branchKept: false });
  assert.equal(changedEvents().length, 2);
  assert.deepEqual(changedEvents()[1]?.payload.worktrees, []);
  const after = (await call("conversation.get", { id: conversation.id })) as {
    conversation: Conversation;
    messages: unknown[];
  };
  assert.equal(after.conversation.worktreeId, undefined);
  assert.equal(after.messages.length, 1);
  const afterBranch = (await call("conversation.get", { id: branched.conversation.id })) as {
    conversation: Conversation;
    messages: unknown[];
  };
  assert.equal(afterBranch.conversation.worktreeId, undefined);
  assert.equal(afterBranch.messages.length, 1);
  assert.equal(git(repo, "worktree", "list").trim().split("\n").length, 1);
  assert.deepEqual(await call("worktrees.list", { projectId: project.id }), { worktrees: [] });

  await assert.rejects(
    handlers.handle(request("worktrees.remove", { id: worktree.id }), conn),
    (error: unknown) => error instanceof ServiceError && error.code === "invalid_request",
  );
});

test("worktrees.mergePreview e worktrees.merge: contrato, evento com merged_at e erro em português", async (context) => {
  const { repo, git, events, handlers, conn, call, project } = await worktreeScenario(context);
  const { worktree } = (await call("worktrees.create", { projectId: project.id })) as {
    worktree: { id: string; path: string };
  };
  const changedEvents = () => events.filter((event) => event.event === "worktrees.changed");

  const nothing = (await call("worktrees.mergePreview", { id: worktree.id })) as {
    blocked: string | null;
  };
  assert.equal(nothing.blocked, "nothing");
  await assert.rejects(
    handlers.handle(request("worktrees.merge", { id: worktree.id }), conn),
    (error: unknown) => error instanceof ServiceError && error.code === "invalid_request",
  );
  assert.equal(changedEvents().length, 1);

  await writeFile(path.join(worktree.path, "trazido.txt"), "trazido\n");
  const preview = await call("worktrees.mergePreview", { id: worktree.id });
  assert.deepEqual(preview, {
    targetBranch: "main",
    commits: 1,
    uncommittedFiles: 1,
    changedFiles: 1,
    conflicts: [],
    blocked: null,
    targetDirtyFiles: [],
  });
  assert.equal(changedEvents().length, 1, "a prévia não emite evento");

  const merged = (await call("worktrees.merge", { id: worktree.id })) as {
    merged: true;
    commit: string;
    targetBranch: string;
  };
  assert.equal(merged.targetBranch, "main");
  assert.equal(merged.commit, git(repo, "rev-parse", "HEAD").trim());
  assert.equal(await readFile(path.join(repo, "trazido.txt"), "utf8"), "trazido\n");
  assert.equal(changedEvents().length, 2);
  const listed = changedEvents()[1]?.payload.worktrees as { id: string; mergedAt: string | null }[];
  assert.notEqual(listed.find((entry) => entry.id === worktree.id)?.mergedAt, null);
  assert.equal(
    (
      (await call("worktrees.list", { projectId: project.id })) as {
        worktrees: { mergedAt: string | null }[];
      }
    ).worktrees[0]?.mergedAt,
    listed[0]?.mergedAt,
  );
  await assert.rejects(
    handlers.handle(request("worktrees.mergePreview", { id: "nada" }), conn),
    (error: unknown) => error instanceof ServiceError && error.code === "invalid_request",
  );
});

test("worktrees.remove: conversa ocupada bloqueia mesmo com force e erros chegam em português", async (context) => {
  const { db, handlers, conn, call, project } = await worktreeScenario(context);
  const { worktree } = (await call("worktrees.create", { projectId: project.id })) as {
    worktree: { id: string; path: string };
  };
  const { conversation } = (await call("conversation.create", {
    agent: "claude",
    cwd: worktree.path,
    worktreeId: worktree.id,
    mode: "edit",
  })) as { conversation: Conversation };
  db.prepare("UPDATE conversations SET state='working' WHERE id=?").run(conversation.id);
  await assert.rejects(
    handlers.handle(request("worktrees.remove", { id: worktree.id, force: true }), conn),
    (error: unknown) =>
      error instanceof ServiceError &&
      error.code === "invalid_request" &&
      /trabalhando/.test(error.message),
  );
  assert.equal(
    ((await call("worktrees.status", { id: worktree.id })) as { busyConversations: number })
      .busyConversations,
    1,
  );
  await assert.rejects(
    handlers.handle(request("worktrees.create", { projectId: "nada" }), conn),
    (error: unknown) => error instanceof ServiceError && error.code === "invalid_request",
  );
});

test("restore.*: numa conversa em cópia separada a raiz é a da cópia, não a do projeto", async (context) => {
  const { repo, events, handlers, conn, call, project, emitters, writes } =
    await worktreeScenario(context);
  const { worktree } = (await call("worktrees.create", { projectId: project.id })) as {
    worktree: { id: string; path: string };
  };
  const { conversation } = (await call("conversation.create", {
    agent: "claude",
    cwd: worktree.path,
    worktreeId: worktree.id,
    mode: "edit",
  })) as { conversation: Conversation };
  const sent = (await handlers.handle(
    request("conversation.send", { id: conversation.id, text: "mexa" }),
    conn,
  )) as { agentMessage: { id: string } };
  const messageId = sent.agentMessage.id;
  for (let attempt = 0; attempt < 300 && !writes.wrote; attempt += 1) {
    await new Promise<void>((resolve) => setTimeout(resolve, 10));
  }
  assert.equal(writes.cwd, worktree.path);
  emitters.get(conversation.id)?.({ kind: "turn-end", status: "done" });
  for (let attempt = 0; attempt < 300; attempt += 1) {
    const listed = (await call("restore.list", { conversationId: conversation.id })) as {
      points: Array<{ state: string }>;
    };
    if (listed.points[0]?.state === "ready") break;
    await new Promise<void>((resolve) => setTimeout(resolve, 10));
  }
  const changedEvent = events.find((event) => event.event === "restore.changed");
  assert.equal(changedEvent?.payload.point.state, "ready");
  assert.equal(changedEvent?.payload.point.changedFiles, 2);

  // O projeto não foi tocado, e a cópia mostra 2 arquivos sujos.
  assert.equal(await readFile(path.join(repo, "antigo.txt"), "utf8"), "antigo\n");
  assert.equal(
    ((await call("worktrees.status", { id: worktree.id })) as { dirtyFiles: number }).dirtyFiles,
    2,
  );
  const refs = execFileSync("git", ["for-each-ref", "refs/karont/restore"], {
    cwd: repo,
    encoding: "utf8",
  });
  assert.match(refs, new RegExp(conversation.id)); // refs vivem no repositório compartilhado

  assert.deepEqual(await call("restore.undo", { conversationId: conversation.id, messageId }), {
    restored: 1,
    removed: 1,
  });
  assert.equal(await readFile(path.join(worktree.path, "antigo.txt"), "utf8"), "antigo\n");
  assert.equal(await readFile(path.join(repo, "antigo.txt"), "utf8"), "antigo\n");
});

test("caixa: inbox.list e inbox.dismiss pelos métodos; workspace movido e apagado gera inbox.changed", async (context) => {
  const root = await mkdtemp(path.join(os.tmpdir(), "ks-caixa-"));
  context.after(() => rm(root, { recursive: true, force: true }));
  const folder = path.join(root, "app");
  await mkdir(folder);
  const events: AnyEvent[] = [];
  const db = openDatabase(path.join(root, "karont.db"));
  const emitters = new Map<string, Parameters<AdapterFactory>[1]>();
  const adapterFactory: AdapterFactory = (conversation, emit) => {
    emitters.set(conversation.id, emit);
    return {
      start: async () => undefined,
      send: async () => emit({ kind: "state", state: "working" }),
      respond: async () => undefined,
      interrupt: async () => undefined,
      dispose: async () => undefined,
    };
  };
  const handlers = createHandlers({
    db,
    startedAt: new Date().toISOString(),
    dev: false,
    emit: async () => undefined,
    broadcast: async (event) => void events.push(event),
    env: { PATH: "", KARONT_DISABLE_AGENT_DETECTION: "1" },
    homeDir: root,
    adapterFactory,
  });
  context.after(async () => {
    await handlers.closeAgents();
    db.close();
  });
  const settle = () => new Promise<void>((resolve) => setTimeout(resolve, 40));
  const inbox = () =>
    callWs<{
      items: Array<{ workspaceId: string; kind: string; conversationId: string }>;
      total: number;
    }>(handlers, "inbox.list", {});
  const inboxEvents = () =>
    events.flatMap((event) => (event.event === "inbox.changed" ? [event.payload] : []));
  const a = await ws2(handlers, "A");
  const b = await ws2(handlers, "B");
  const { project } = await callWs<{ project: { id: string } }>(handlers, "projects.create", {
    name: "App",
    icon: "folder",
    path: folder,
    workspaceId: a.id,
  });
  const { conversation } = await callWs<{ conversation: { id: string } }>(
    handlers,
    "conversation.create",
    { agent: "claude", cwd: folder, mode: "edit", projectId: project.id },
  );
  await callWs(handlers, "conversation.send", { id: conversation.id, text: "oi" });
  const emit = emitters.get(conversation.id);
  assert.ok(emit);
  emit({ kind: "state", state: "waiting" });
  emit({
    kind: "part",
    part: {
      id: "perm",
      type: "permission",
      tool: "Bash",
      summary: "ls",
      options: ["allow", "deny"],
      state: "pending",
    },
  });
  await settle();
  assert.equal((await inbox()).items[0]?.workspaceId, a.id);
  assert.equal(inboxEvents().at(-1)?.items[0]?.workspaceId, a.id);

  // Projeto movido: o workspaceId do item muda e sai evento.
  const countBefore = inboxEvents().length;
  await callWs(handlers, "projects.update", { id: project.id, workspaceId: b.id });
  await settle();
  assert.equal(inboxEvents().length, countBefore + 1);
  assert.equal(inboxEvents().at(-1)?.items[0]?.workspaceId, b.id);
  assert.equal((await inbox()).items[0]?.workspaceId, b.id);

  // Workspace apagado: o item vai para o workspace que recebeu o conteúdo.
  await callWs(handlers, "workspaces.remove", { id: b.id });
  await settle();
  assert.equal(inboxEvents().length, countBefore + 2);
  const last = inboxEvents().at(-1)?.items[0]?.workspaceId;
  assert.notEqual(last, b.id);
  assert.equal((await inbox()).items[0]?.workspaceId, last);

  // Projeto removido: a conversa fica solta, sem projectId no item, e sai evento.
  await callWs(handlers, "projects.remove", { id: project.id });
  await settle();
  assert.equal(inboxEvents().length, countBefore + 3);
  assert.equal("projectId" in (inboxEvents().at(-1)?.items[0] ?? {}), false);

  // inbox.dismiss: sem erro para dispensar, devolve false.
  assert.deepEqual(await callWs(handlers, "inbox.dismiss", { conversationId: conversation.id }), {
    dismissed: false,
  });
});

test("system.diagnostics traz caminhos reais, sem segredo, e respeita a detecção desligada", async (context) => {
  const root = await mkdtemp(path.join(os.tmpdir(), "ks-diag-"));
  context.after(() => rm(root, { recursive: true, force: true }));
  const db = openDatabase(path.join(root, "karont.db"));
  context.after(() => db.close());
  const paths = {
    runtimeDir: path.join(root, "run"),
    socketPath: path.join(root, "run", "service.sock"),
    secretPath: path.join(root, "run", "service.secret-SEGREDO"),
    dataDir: path.join(root, "data"),
    dbPath: path.join(root, "data", "karont.db"),
  };
  const handlers = createHandlers({
    db,
    startedAt: "2026-10-31T00:00:00.000Z",
    dev: false,
    emit: async () => undefined,
    env: { PATH: "", KARONT_DISABLE_AGENT_DETECTION: "1" },
    homeDir: root,
    paths,
  });
  const conn = connection([]);
  const result = await handlers.handle(request("system.diagnostics", {}), conn);
  const info = (await handlers.handle(request("system.info", {}), conn)) as {
    serviceVersion: string;
    contractVersion: number;
    pid: number;
    startedAt: string;
    nodeVersion: string;
    platform: string;
  };
  const parsed = parseResult("system.diagnostics", result);
  assert.equal(parsed.ok, true);
  const diagnostics = result as {
    paths: Record<string, string>;
    agents: { found: boolean }[];
    detectedAt: string;
  } & typeof info;
  assert.deepEqual(diagnostics.paths, {
    homeDir: root,
    dataDir: paths.dataDir,
    dbPath: paths.dbPath,
    runtimeDir: paths.runtimeDir,
    socketPath: paths.socketPath,
  });
  const serialized = JSON.stringify(result);
  assert.equal(serialized.includes("secretPath"), false);
  assert.equal(serialized.includes("SEGREDO"), false);
  for (const key of [
    "serviceVersion",
    "contractVersion",
    "pid",
    "startedAt",
    "nodeVersion",
    "platform",
  ] as const) {
    assert.equal(diagnostics[key], info[key]);
  }
  const listed = (await handlers.handle(request("agents.list", {}), conn)) as {
    agents: unknown[];
    detectedAt: string;
  };
  assert.deepEqual(diagnostics.agents, listed.agents);
  assert.equal(diagnostics.detectedAt, listed.detectedAt);
  assert.equal(
    diagnostics.agents.some((agent) => agent.found),
    false,
  );
});

test("usage.list devolve o uso guardado em ordem estável e ignora valor corrompido", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "ks-"));
  const db = openDatabase(path.join(root, "karont.db"));
  try {
    const handlers = createHandlers({
      db,
      startedAt: "2026-10-31T00:00:00.000Z",
      dev: false,
      emit: async () => undefined,
      env: { PATH: "" },
      homeDir: root,
    });
    const conn = connection([]);
    assert.deepEqual(await handlers.handle(request("usage.list", {}), conn), { usage: [] });
    const codex = {
      agent: "codex",
      windows: [{ id: "five_hour", usedPercent: 20, resetsAt: null }],
      observedAt: "2026-11-09T10:00:00.000Z",
    };
    const claude = {
      agent: "claude",
      windows: [{ id: "weekly", usedPercent: 44, resetsAt: "2026-11-09T12:00:00.000Z" }],
      observedAt: "2026-11-09T10:00:00.000Z",
    };
    setSetting(db, "usage.latest.codex", codex);
    setSetting(db, "usage.latest.claude", claude);
    setSetting(db, "usage.latest.quebrado", { agent: "quebrado", windows: "x" });
    setSetting(db, "outra.coisa", codex);
    assert.deepEqual(await handlers.handle(request("usage.list", {}), conn), {
      usage: [claude, codex],
    });
  } finally {
    db.close();
  }
});
