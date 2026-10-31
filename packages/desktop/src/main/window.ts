import { readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { app, BrowserWindow, protocol } from "electron";
import { resolveProtocolPath } from "./protocol-path.ts";

const distributionDirectory = path.dirname(fileURLToPath(import.meta.url));
const uiDistributionDirectory = path.resolve(distributionDirectory, "../../ui/dist");
const contentSecurityPolicy =
  "default-src 'none'; script-src 'self'; style-src 'self'; font-src 'self' data:; img-src 'self' data:; connect-src 'self'; base-uri 'none'; form-action 'none'; frame-ancestors 'none'; object-src 'none'";

const mimeTypes: Record<string, string> = {
  ".css": "text/css; charset=utf-8",
  ".html": "text/html; charset=utf-8",
  ".ico": "image/x-icon",
  ".jpeg": "image/jpeg",
  ".jpg": "image/jpeg",
  ".js": "text/javascript; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".png": "image/png",
  ".svg": "image/svg+xml",
  ".txt": "text/plain; charset=utf-8",
  ".wasm": "application/wasm",
  ".webp": "image/webp",
  ".woff": "font/woff",
  ".woff2": "font/woff2",
};

export function registerAppScheme(): void {
  protocol.registerSchemesAsPrivileged([
    { scheme: "karont", privileges: { standard: true, secure: true } },
  ]);
}

export function registerAppProtocol(): void {
  protocol.handle("karont", async (request) => {
    const filePath = await resolveProtocolPath(request.url, uiDistributionDirectory);
    if (!filePath) return protocolResponse("Not found", 404, "text/plain; charset=utf-8");

    try {
      const content = await readFile(filePath);
      const contentType =
        mimeTypes[path.extname(filePath).toLowerCase()] ?? "application/octet-stream";
      return protocolResponse(content, 200, contentType);
    } catch {
      return protocolResponse("Not found", 404, "text/plain; charset=utf-8");
    }
  });
}

export function createMainWindow(): BrowserWindow {
  const mainWindow = new BrowserWindow({
    width: 1280,
    height: 800,
    minWidth: 960,
    minHeight: 600,
    backgroundColor: "#0F0F10",
    title: "Karont",
    show: false,
    webPreferences: {
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      preload: path.join(distributionDirectory, "preload.cjs"),
      webSecurity: true,
      allowRunningInsecureContent: false,
      spellcheck: false,
    },
  });

  const contents = mainWindow.webContents;
  contents.setWindowOpenHandler(() => ({ action: "deny" }));
  contents.on("will-navigate", (event, url) => {
    if (!isAppUrl(url)) event.preventDefault();
  });
  contents.on("will-redirect", (event, url) => {
    if (!isAppUrl(url)) event.preventDefault();
  });
  contents.on("before-input-event", (event, input) => {
    if (!input.control || !input.shift || input.key.toLowerCase() !== "i") return;
    event.preventDefault();
    if (!app.isPackaged) contents.toggleDevTools();
  });

  contents.session.setPermissionRequestHandler((_webContents, _permission, callback) => {
    callback(false);
  });
  contents.session.setPermissionCheckHandler(() => false);

  mainWindow.once("ready-to-show", () => mainWindow.show());
  return mainWindow;
}

export function loadMainWindow(mainWindow: BrowserWindow): Promise<void> {
  return mainWindow.loadURL("karont://app/").then(() => undefined);
}

function isAppUrl(url: string): boolean {
  return url.startsWith("karont://app/");
}

function protocolResponse(body: string | Buffer, status: number, contentType: string): Response {
  const responseBody: string | ArrayBuffer =
    typeof body === "string" ? body : bufferToArrayBuffer(body);
  return new Response(responseBody, {
    status,
    headers: {
      "Content-Type": contentType,
      "Content-Security-Policy": contentSecurityPolicy,
      "X-Content-Type-Options": "nosniff",
    },
  });
}

function bufferToArrayBuffer(buffer: Buffer): ArrayBuffer {
  const copy = new ArrayBuffer(buffer.byteLength);
  new Uint8Array(copy).set(buffer);
  return copy;
}
