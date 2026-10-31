import assert from "node:assert/strict";
import { mkdtemp } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { test } from "node:test";
import { type AnyEvent, type ParsedRequest, parseRequest } from "@karont/contract";
import { openDatabase } from "./db.ts";
import type { HandlerConnection } from "./handlers.ts";
import { createHandlers, ServiceError } from "./handlers.ts";

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
