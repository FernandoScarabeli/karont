import assert from "node:assert/strict";
import { access, chmod, mkdir, mkdtemp, readdir, rm, stat, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { test } from "node:test";
import { type AnyEvent, type ParsedRequest, parseRequest } from "@karont/contract";
import type { AgentDetectionFs } from "./agents/detect.ts";
import { openDatabase, recordRecentFolder } from "./db.ts";
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
  const handlers = createHandlers({
    db,
    startedAt: "2026-10-31T00:00:00.000Z",
    dev: false,
    emit: async () => undefined,
    env: { PATH: "" },
    homeDir: root,
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
  db.close();
  const afterResponse: Array<() => void | Promise<void>> = [];

  const result = (await handlers.handle(
    request("terminals.open", { cwd: root, cols: 80, rows: 24 }),
    connection([], afterResponse),
  )) as { terminal: { id: string } };
  assert.ok(result.terminal.id);
  await assert.rejects(Promise.resolve().then(() => afterResponse[0]?.()));
  await handlers.closeTerminals();
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
