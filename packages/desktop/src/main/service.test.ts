import assert from "node:assert/strict";
import test from "node:test";
import type { ServiceClient, ServicePaths } from "@karont/service";
import { createServiceManager } from "./service.ts";

const paths: ServicePaths = {
  runtimeDir: "/tmp/karont-test-runtime",
  socketPath: "/tmp/karont-test-runtime/service.sock",
  secretPath: "/tmp/karont-test-runtime/service.secret",
  dataDir: "/tmp/karont-test-data",
  dbPath: "/tmp/karont-test-data/karont.db",
};

test("não reconecta depois de service.shutdown responder", async () => {
  let connections = 0;
  let shutdownRequested = false;
  let client: ReturnType<typeof fakeClient>;
  client = fakeClient({
    onShutdown: () => {
      shutdownRequested = true;
      client.closeConnection();
    },
  });
  const manager = createServiceManager(() => undefined, {
    paths,
    socketIdentity: async () => "socket-1",
    connect: async () => {
      connections += 1;
      return client.client;
    },
  });

  await manager.start();
  await manager.shutdown(50);
  await new Promise((resolve) => setTimeout(resolve, 150));

  assert.equal(shutdownRequested, true);
  assert.equal(connections, 1);
  assert.equal(manager.getStatus(), "disconnected");
  manager.close();
});

test("sem cliente tenta conectar por um segundo e envia service.shutdown", async () => {
  const firstClient = fakeClient();
  const reconnectClient = fakeClient();
  let connections = 0;
  const timeouts: number[] = [];
  let shutdownRequests = 0;
  reconnectClient.setOnShutdown(() => {
    shutdownRequests += 1;
  });
  const manager = createServiceManager(() => undefined, {
    paths,
    socketIdentity: async () => "socket-1",
    connect: async (timeoutMs) => {
      timeouts.push(timeoutMs);
      connections += 1;
      return connections === 1 ? firstClient.client : reconnectClient.client;
    },
  });

  await manager.start();
  firstClient.closeConnection();
  await manager.shutdown(50);

  assert.deepEqual(timeouts, [1_000, 1_000]);
  assert.equal(shutdownRequests, 1);
  manager.close();
});

test("usa SIGTERM pelo pid conhecido quando a conexão e o socket falham", async () => {
  const client = fakeClient();
  const signals: Array<[number, NodeJS.Signals]> = [];
  let connections = 0;
  const manager = createServiceManager(() => undefined, {
    paths,
    socketIdentity: async () => "socket-1",
    processExists: (pid) => pid === 4321,
    signalProcess: (pid, signal) => signals.push([pid, signal]),
    connect: async (_timeoutMs) => {
      connections += 1;
      if (connections === 1) return client.client;
      throw new Error("serviço desconectado");
    },
  });

  await manager.start();
  client.closeConnection();
  await manager.shutdown(50);

  assert.deepEqual(signals, [[4321, "SIGTERM"]]);
  manager.close();
});

test("não envia SIGTERM se o socket foi substituído", async () => {
  const client = fakeClient();
  const signals: number[] = [];
  let identity = "socket-1";
  let connections = 0;
  const manager = createServiceManager(() => undefined, {
    paths,
    socketIdentity: async () => identity,
    processExists: () => true,
    signalProcess: (pid) => signals.push(pid),
    connect: async (_timeoutMs) => {
      connections += 1;
      if (connections === 1) return client.client;
      throw new Error("sem conexão");
    },
  });

  await manager.start();
  client.closeConnection();
  identity = "socket-2";
  await manager.shutdown(50);

  assert.deepEqual(signals, []);
  manager.close();
});

test("usa SIGTERM se service.shutdown não responde no prazo", async () => {
  const client = fakeClient({ hangOnShutdown: true });
  const signals: Array<[number, NodeJS.Signals]> = [];
  const manager = createServiceManager(() => undefined, {
    paths,
    socketIdentity: async () => "socket-1",
    processExists: () => true,
    signalProcess: (pid, signal) => signals.push([pid, signal]),
    connect: async () => client.client,
  });
  await manager.start();

  await manager.shutdown(5);

  assert.deepEqual(signals, [[4321, "SIGTERM"]]);
  manager.close();
});

function fakeClient(options: { onShutdown?: () => void; hangOnShutdown?: boolean } = {}) {
  const closeListeners = new Set<() => void>();
  let onShutdown = options.onShutdown;
  const client = {
    request: async (method: string) => {
      if (method === "system.info") return { pid: 4321 };
      if (method === "service.shutdown") {
        onShutdown?.();
        if (options.hangOnShutdown) return new Promise(() => undefined);
      }
      return { ok: true };
    },
    onEvent: () => () => undefined,
    onClose: (listener: () => void) => {
      closeListeners.add(listener);
      return () => closeListeners.delete(listener);
    },
    close: () => undefined,
  } as unknown as ServiceClient;

  return {
    client,
    setOnShutdown: (callback: () => void) => {
      onShutdown = callback;
    },
    closeConnection: () => {
      for (const listener of closeListeners) listener();
    },
  };
}
