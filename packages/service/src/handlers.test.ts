import assert from "node:assert/strict";
import { access, chmod, mkdtemp, readdir, rm, stat, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { test } from "node:test";
import { type AnyEvent, type ParsedRequest, parseRequest } from "@karont/contract";
import type { AgentDetectionFs } from "./agents/detect.ts";
import { openDatabase } from "./db.ts";
import type { HandlerConnection } from "./handlers.ts";
import { createHandlers, ServiceError } from "./handlers.ts";
import { createFakeCliDir } from "./testing/fake-clis.ts";

function request(method: string, params: unknown): ParsedRequest {
  const parsed = parseRequest({ type: "request", id: "1", method, params });
  if (!parsed.ok) throw new Error(parsed.error.message);
  return parsed.request;
}

function connection(events: AnyEvent[], afterResponse: Array<() => void> = []): HandlerConnection {
  return {
    emit: async (event) => {
      events.push(event);
    },
    afterResponse: (task) => afterResponse.push(task),
    isOpen: () => true,
  };
}

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
  };
  assert.equal(info.serviceVersion, "0.0.0");
  assert.equal(info.contractVersion, 1);
  assert.equal(info.startedAt, "2026-10-31T00:00:00.000Z");
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
