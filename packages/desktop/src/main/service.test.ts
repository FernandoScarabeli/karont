import assert from "node:assert/strict";
import test from "node:test";
import type { ServiceClient } from "@karont/service";
import { createServiceManager } from "./service.ts";

test("não reconecta nem reinicia o serviço após service.shutdown", async () => {
  let connections = 0;
  let shutdownRequested = false;
  const closeListeners = new Set<() => void>();
  const client = {
    request: async (method: string) => {
      if (method === "service.shutdown") {
        shutdownRequested = true;
        for (const listener of closeListeners) listener();
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
  const manager = createServiceManager(() => undefined, {
    connect: async () => {
      connections += 1;
      return client;
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

test("segue após o prazo quando service.shutdown não responde", async () => {
  const client = {
    request: () => new Promise(() => undefined),
    onEvent: () => () => undefined,
    onClose: () => () => undefined,
    close: () => undefined,
  } as unknown as ServiceClient;
  const manager = createServiceManager(() => undefined, {
    connect: async () => client,
  });
  await manager.start();

  await manager.shutdown(5);
  manager.close();
});
