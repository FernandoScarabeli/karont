import { spawn } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";
import type { AnyEvent } from "@karont/contract";
import { connectService, resolvePaths, type ServiceClient } from "@karont/service";
import { backoffDelay } from "./backoff.ts";

const serviceEntry = path.join(path.dirname(fileURLToPath(import.meta.url)), "service.js");
const initialConnectTimeoutMs = 1_000;
const reconnectTimeoutMs = 2_000;
const startupRetryWindowMs = 10_000;

export type ServiceManager = {
  start(): Promise<void>;
  getClient(): ServiceClient | null;
  getStatus(): "connecting" | "connected" | "disconnected";
  publishCurrentStatus(): void;
  close(): void;
};

export function createServiceManager(publish: (event: AnyEvent) => void): ServiceManager {
  const paths = resolvePaths();
  let client: ServiceClient | null = null;
  let state: "connecting" | "connected" | "disconnected" = "connecting";
  let retryTimer: ReturnType<typeof setTimeout> | undefined;
  let retryAttempt = 0;
  let spawnAttemptedForOutage = false;
  let removeClientListeners: (() => void) | undefined;
  let closed = false;

  function publishStatus(nextState: typeof state): void {
    state = nextState;
    publish({ event: "bridge.status", payload: { state: nextState } });
  }

  function attach(nextClient: ServiceClient): void {
    if (closed) {
      nextClient.close();
      return;
    }
    detachListeners();
    client = nextClient;
    retryAttempt = 0;
    spawnAttemptedForOutage = false;
    const removeEventListener = nextClient.onEvent((event) => publish(event));
    const removeCloseListener = nextClient.onClose(() => handleClientClose(nextClient));
    removeClientListeners = () => {
      removeEventListener();
      removeCloseListener();
    };
    publishStatus("connected");
  }

  function detachListeners(): void {
    removeClientListeners?.();
    removeClientListeners = undefined;
  }

  function handleClientClose(closedClient: ServiceClient): void {
    if (closed || client !== closedClient) return;
    detachListeners();
    client = null;
    retryAttempt = 0;
    spawnAttemptedForOutage = false;
    publishStatus("disconnected");
    scheduleReconnect();
  }

  async function connect(timeoutMs: number): Promise<ServiceClient> {
    return connectService({ paths, timeoutMs });
  }

  function startDetachedService(): void {
    if (spawnAttemptedForOutage || closed) return;
    spawnAttemptedForOutage = true;
    try {
      const child = spawn(process.execPath, [serviceEntry], {
        env: { ...process.env, ELECTRON_RUN_AS_NODE: "1" },
        detached: true,
        stdio: "ignore",
      });
      const resetSpawnGuard = (): void => {
        if (!client) spawnAttemptedForOutage = false;
      };
      child.once("error", resetSpawnGuard);
      child.once("exit", resetSpawnGuard);
      child.unref();
    } catch {
      // A janela também pode funcionar como desconectada se o serviço não iniciar.
    }
  }

  async function reconnect(): Promise<void> {
    if (closed || client) return;
    try {
      attach(await connect(reconnectTimeoutMs));
    } catch {
      startDetachedService();
      publishStatus("disconnected");
      scheduleReconnect();
    }
  }

  function scheduleReconnect(): void {
    if (closed || client || retryTimer !== undefined) return;
    const delayMs = backoffDelay(retryAttempt);
    retryAttempt += 1;
    retryTimer = setTimeout(() => {
      retryTimer = undefined;
      void reconnect();
    }, delayMs);
  }

  return {
    async start(): Promise<void> {
      try {
        attach(await connect(initialConnectTimeoutMs));
        return;
      } catch {
        publishStatus("connecting");
        startDetachedService();
      }

      const deadline = Date.now() + startupRetryWindowMs;
      let attempt = 0;
      while (!closed && Date.now() < deadline) {
        const remainingMs = deadline - Date.now();
        await delay(Math.min(backoffDelay(attempt), remainingMs));
        attempt += 1;
        const connectTimeRemaining = deadline - Date.now();
        if (closed || connectTimeRemaining <= 0) break;
        try {
          attach(await connect(Math.min(reconnectTimeoutMs, connectTimeRemaining)));
          return;
        } catch {
          // Tenta novamente até o prazo de inicialização e depois mantém a reconexão ativa.
        }
      }

      if (closed) return;
      retryAttempt = attempt;
      publishStatus("disconnected");
      scheduleReconnect();
    },
    getClient: () => client,
    getStatus: () => state,
    publishCurrentStatus(): void {
      publishStatus(state);
    },
    close(): void {
      if (closed) return;
      closed = true;
      if (retryTimer !== undefined) clearTimeout(retryTimer);
      retryTimer = undefined;
      detachListeners();
      const activeClient = client;
      client = null;
      activeClient?.close();
    },
  };
}

function delay(milliseconds: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, milliseconds));
}
