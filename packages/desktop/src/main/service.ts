import { spawn } from "node:child_process";
import { existsSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import type { AnyEvent } from "@karont/contract";
import { connectService, resolvePaths, type ServiceClient } from "@karont/service";
import { backoffDelay } from "./backoff.ts";

const serviceEntry = path.join(path.dirname(fileURLToPath(import.meta.url)), "service.js");
const initialConnectTimeoutMs = 1_000;
const reconnectTimeoutMs = 2_000;
const startupRetryWindowMs = 10_000;

// O Chromium deixa vários descritores abertos sem CLOEXEC (caches da GPU, sockets internos,
// canais do processo pai). Um serviço destacado herdaria todos e os seguraria por horas.
// O Node não tem "closefrom" no spawn, então um bash mínimo fecha tudo acima de 2 e faz exec.
// (O dash, /bin/sh do Ubuntu, não aceita descritores com dois dígitos.)
const CLOSE_INHERITED_FDS_AND_EXEC = `for p in /proc/$$/fd/*; do n=\${p##*/}; [ "$n" -gt 2 ] 2>/dev/null && eval "exec $n>&-"; done; exec "$0" "$@"`;

export function detachedServiceCommand(
  platform: NodeJS.Platform = process.platform,
  hasBash: boolean = existsSync("/bin/bash") && existsSync("/proc/self/fd"),
): { command: string; args: string[] } {
  if (platform === "linux" && hasBash) {
    return {
      command: "/bin/bash",
      args: ["-c", CLOSE_INHERITED_FDS_AND_EXEC, process.execPath, serviceEntry],
    };
  }
  return { command: process.execPath, args: [serviceEntry] };
}

export type ServiceManager = {
  start(): Promise<void>;
  getClient(): ServiceClient | null;
  getStatus(): "connecting" | "connected" | "disconnected";
  publishCurrentStatus(): void;
  shutdown(timeoutMs?: number): Promise<void>;
  close(): void;
};

export function createServiceManager(
  publish: (event: AnyEvent) => void,
  options: { connect?: (timeoutMs: number) => Promise<ServiceClient> } = {},
): ServiceManager {
  const paths = resolvePaths();
  let client: ServiceClient | null = null;
  let state: "connecting" | "connected" | "disconnected" = "connecting";
  let retryTimer: ReturnType<typeof setTimeout> | undefined;
  let retryAttempt = 0;
  let spawnAttemptedForOutage = false;
  let removeClientListeners: (() => void) | undefined;
  let closed = false;
  let shuttingDown = false;
  let shutdownPromise: Promise<void> | undefined;

  function publishStatus(nextState: typeof state): void {
    state = nextState;
    publish({ event: "bridge.status", payload: { state: nextState } });
  }

  function attach(nextClient: ServiceClient): void {
    if (closed || shuttingDown) {
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
    if (!shuttingDown) scheduleReconnect();
  }

  async function connect(timeoutMs: number): Promise<ServiceClient> {
    if (options.connect) return options.connect(timeoutMs);
    return connectService({ paths, timeoutMs });
  }

  function startDetachedService(): void {
    if (spawnAttemptedForOutage || closed || shuttingDown) return;
    spawnAttemptedForOutage = true;
    try {
      const { command, args } = detachedServiceCommand();
      const child = spawn(command, args, {
        env: { ...process.env, ELECTRON_RUN_AS_NODE: "1" },
        cwd: "/",
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
    if (closed || shuttingDown || client) return;
    try {
      attach(await connect(reconnectTimeoutMs));
    } catch {
      startDetachedService();
      publishStatus("disconnected");
      scheduleReconnect();
    }
  }

  function scheduleReconnect(): void {
    if (closed || shuttingDown || client || retryTimer !== undefined) return;
    const delayMs = backoffDelay(retryAttempt);
    retryAttempt += 1;
    retryTimer = setTimeout(() => {
      retryTimer = undefined;
      void reconnect();
    }, delayMs);
  }

  return {
    async start(): Promise<void> {
      if (closed || shuttingDown) return;
      try {
        attach(await connect(initialConnectTimeoutMs));
        return;
      } catch {
        publishStatus("connecting");
        startDetachedService();
      }

      const deadline = Date.now() + startupRetryWindowMs;
      let attempt = 0;
      while (!closed && !shuttingDown && Date.now() < deadline) {
        const remainingMs = deadline - Date.now();
        await delay(Math.min(backoffDelay(attempt), remainingMs));
        attempt += 1;
        const connectTimeRemaining = deadline - Date.now();
        if (closed || shuttingDown || connectTimeRemaining <= 0) break;
        try {
          attach(await connect(Math.min(reconnectTimeoutMs, connectTimeRemaining)));
          return;
        } catch {
          // Tenta novamente até o prazo de inicialização e depois mantém a reconexão ativa.
        }
      }

      if (closed || shuttingDown) return;
      retryAttempt = attempt;
      publishStatus("disconnected");
      scheduleReconnect();
    },
    getClient: () => client,
    getStatus: () => state,
    publishCurrentStatus(): void {
      publishStatus(state);
    },
    shutdown(timeoutMs = 3_000): Promise<void> {
      if (shutdownPromise) return shutdownPromise;
      shuttingDown = true;
      if (retryTimer !== undefined) clearTimeout(retryTimer);
      retryTimer = undefined;
      const activeClient = client;
      if (!activeClient) {
        shutdownPromise = Promise.resolve();
        return shutdownPromise;
      }

      shutdownPromise = settleWithin(
        Promise.resolve().then(() => activeClient.request("service.shutdown", {})),
        timeoutMs,
      );
      return shutdownPromise;
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

function settleWithin(promise: Promise<unknown>, timeoutMs: number): Promise<void> {
  return new Promise((resolve) => {
    const timeout = setTimeout(resolve, timeoutMs);
    promise.then(
      () => {
        clearTimeout(timeout);
        resolve();
      },
      () => {
        clearTimeout(timeout);
        resolve();
      },
    );
  });
}

function delay(milliseconds: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, milliseconds));
}
