import { type ChildProcess, spawn } from "node:child_process";
import { randomBytes } from "node:crypto";
import { createServer as createHttpServer, type Server as HttpServer } from "node:http";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { connectService, resolvePaths, type ServiceClient } from "@karont/service";
import { createServer as createViteServer, type ViteDevServer } from "vite";
import { createPreviewBridge } from "./bridge.ts";

const here = path.dirname(fileURLToPath(import.meta.url));
const packagesDir = path.resolve(here, "../../..");
const uiRoot = path.join(packagesDir, "ui");
const serviceEntry = path.join(packagesDir, "service", "src", "main.ts");
const previewHost = "127.0.0.1";
const previewPort = 5173;

let ownedService: ChildProcess | undefined;
let client: ServiceClient | undefined;
let bridge: ReturnType<typeof createPreviewBridge> | undefined;
let httpServer: HttpServer | undefined;
let vite: ViteDevServer | undefined;
let shuttingDown = false;
let shutdownRequested = false;
let startupFinished = false;

const onSignal = (): void => {
  shutdownRequested = true;
  if (ownedService && ownedService.exitCode === null && ownedService.signalCode === null) {
    ownedService.kill("SIGTERM");
  }
  if (startupFinished) void shutdown();
};

process.once("SIGINT", onSignal);
process.once("SIGTERM", onSignal);

try {
  const paths = resolvePaths();
  try {
    client = await connectService({ paths, timeoutMs: 2_000 });
  } catch {
    ensureNotStopping();
    ownedService = spawn(process.execPath, [serviceEntry], {
      env: { ...process.env, KARONT_DEV: "1" },
      stdio: ["ignore", "ignore", "pipe"],
    });
    await waitForServiceReady(ownedService, 10_000);
    ownedService.stderr?.on("data", () => undefined);
    client = await connectService({ paths, timeoutMs: 10_000 });
  }

  ensureNotStopping();
  const token = randomBytes(32).toString("hex");
  const bridgePort = await listenBridge();
  ensureNotStopping();
  const allowedHosts = new Set(["127.0.0.1:5173", "localhost:5173"]);
  const allowedOrigins = new Set(["http://127.0.0.1:5173", "http://localhost:5173"]);
  if (!client) throw new Error("O cliente do serviço não foi iniciado.");
  bridge = createPreviewBridge({
    client,
    connect: () => connectService({ paths, timeoutMs: 10_000 }),
    token,
    allowedHosts,
    allowedOrigins,
  });

  const bridgePortForProxy = bridgePort;
  vite = await createViteServer({
    root: uiRoot,
    configFile: path.join(uiRoot, "vite.config.ts"),
    server: {
      host: previewHost,
      port: previewPort,
      strictPort: true,
      proxy: {
        "/__karont": {
          target: `http://${previewHost}:${bridgePortForProxy}`,
          changeOrigin: false,
        },
      },
    },
    plugins: [
      {
        name: "karont-preview-bridge-token",
        transformIndexHtml(html) {
          const meta = `<meta name="karont-dev-bridge" content="${token}">`;
          return html.replace("<head>", `<head>\n    ${meta}`);
        },
      },
    ],
  });
  ensureNotStopping();
  await vite.listen();
  ensureNotStopping();
  process.stdout.write(`Preview: http://${previewHost}:${previewPort}/\n`);
  startupFinished = true;
} catch (error) {
  if (!shutdownRequested) {
    process.stderr.write(`Falha ao iniciar o preview web: ${errorMessage(error)}\n`);
    process.exitCode = 1;
  }
  startupFinished = true;
  await shutdown();
}

async function listenBridge(): Promise<number> {
  // The bridge binds to loopback only; the OS chooses an available port.
  const server = createHttpServer((request, response) => {
    if (bridge) bridge.handler(request, response);
    else response.writeHead(503).end();
  });
  httpServer = server;
  await new Promise<void>((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, previewHost, () => {
      server.off("error", reject);
      resolve();
    });
  });
  const address = server.address();
  if (!address || typeof address === "string")
    throw new Error("Não foi possível obter a porta da ponte HTTP.");
  return address.port;
}

function waitForServiceReady(child: ChildProcess, timeoutMs: number): Promise<void> {
  return new Promise((resolve, reject) => {
    let settled = false;
    let stderr = "";
    const finish = (error?: Error): void => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      child.stderr?.off("data", onData);
      child.off("error", onError);
      child.off("exit", onExit);
      if (error) reject(error);
      else resolve();
    };
    const onData = (chunk: Buffer): void => {
      stderr = `${stderr}${chunk.toString("utf8")}`.slice(-4_000);
      if (stderr.includes("karont-service ready")) finish();
    };
    const onError = (error: Error): void => finish(error);
    const onExit = (code: number | null, signal: NodeJS.Signals | null): void => {
      const detail = stderr.trim();
      finish(
        new Error(
          `O serviço encerrou antes de ficar pronto (código ${code ?? signal ?? "desconhecido"})${detail ? `: ${detail}` : "."}`,
        ),
      );
    };
    const timer = setTimeout(() => {
      finish(new Error(`O serviço não ficou pronto em ${timeoutMs / 1_000} segundos.`));
    }, timeoutMs);
    child.stderr?.on("data", onData);
    child.once("error", onError);
    child.once("exit", onExit);
  });
}

async function shutdown(): Promise<void> {
  if (shuttingDown) return;
  shuttingDown = true;
  await vite?.close().catch(() => undefined);
  bridge?.close();
  if (httpServer?.listening) {
    await new Promise<void>((resolve) => httpServer?.close(() => resolve()));
  }
  if (!bridge) client?.close();
  if (ownedService && ownedService.exitCode === null && ownedService.signalCode === null) {
    ownedService.kill("SIGTERM");
    await new Promise<void>((resolve) => {
      const timer = setTimeout(() => {
        ownedService?.off("close", onClose);
        resolve();
      }, 2_000);
      const onClose = (): void => {
        clearTimeout(timer);
        resolve();
      };
      ownedService?.once("close", onClose);
    });
  }
}

function ensureNotStopping(): void {
  if (shutdownRequested) throw new Error("Inicialização interrompida.");
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
