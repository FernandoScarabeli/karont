import { createReadStream } from "node:fs";
import { readFile, stat } from "node:fs/promises";
import type { IncomingMessage, ServerResponse } from "node:http";
import path from "node:path";

type PreviewBridgeHandler = (request: IncomingMessage, response: ServerResponse) => void;
const productionPreviewDirectory = "dist-preview";

const contentTypes: Record<string, string> = {
  ".css": "text/css; charset=utf-8",
  ".html": "text/html; charset=utf-8",
  ".ico": "image/x-icon",
  ".js": "text/javascript; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".map": "application/json; charset=utf-8",
  ".png": "image/png",
  ".svg": "image/svg+xml",
  ".wasm": "application/wasm",
  ".webp": "image/webp",
  ".woff": "font/woff",
  ".woff2": "font/woff2",
};

export function injectBridgeToken(html: string, token: string): string {
  const meta = `<meta name="karont-dev-bridge" content="${token}">`;
  return html.replace("<head>", `<head>\n    ${meta}`);
}

export function createBuiltPreviewHandler({
  root,
  token,
  bridgeHandler,
}: {
  root: string;
  token: string;
  bridgeHandler: PreviewBridgeHandler;
}): (request: IncomingMessage, response: ServerResponse) => void {
  const absoluteRoot = path.resolve(root);

  return (request, response) => {
    if (request.url?.startsWith("/__karont")) {
      bridgeHandler(request, response);
      return;
    }
    void serveBuiltFile(request, response, absoluteRoot, token).catch(() => {
      if (response.headersSent) {
        response.destroy();
        return;
      }
      response.writeHead(500).end();
    });
  };
}

export function createProductionPreviewHandler({
  uiRoot,
  token,
  bridgeHandler,
}: {
  uiRoot: string;
  token: string;
  bridgeHandler: PreviewBridgeHandler;
}): (request: IncomingMessage, response: ServerResponse) => void {
  return createBuiltPreviewHandler({
    root: path.join(uiRoot, productionPreviewDirectory),
    token,
    bridgeHandler,
  });
}

async function serveBuiltFile(
  request: IncomingMessage,
  response: ServerResponse,
  root: string,
  token: string,
): Promise<void> {
  if (request.method !== "GET" && request.method !== "HEAD") {
    response.writeHead(405, { Allow: "GET, HEAD" }).end();
    return;
  }

  let pathname: string;
  try {
    pathname = decodeURIComponent(new URL(request.url ?? "/", "http://localhost").pathname);
  } catch {
    response.writeHead(400).end();
    return;
  }

  const requestedPath = path.resolve(root, `.${pathname}`);
  const rootPrefix = `${root}${path.sep}`;
  if (requestedPath !== root && !requestedPath.startsWith(rootPrefix)) {
    response.writeHead(404).end();
    return;
  }

  let filePath = requestedPath;
  let fileInfo = await statOrNull(filePath);
  if (fileInfo?.isDirectory()) {
    filePath = path.join(filePath, "index.html");
    fileInfo = await statOrNull(filePath);
  }
  if (!fileInfo?.isFile()) {
    if (path.extname(pathname)) {
      response.writeHead(404).end();
      return;
    }
    filePath = path.join(root, "index.html");
    fileInfo = await statOrNull(filePath);
  }
  if (!fileInfo?.isFile()) {
    response.writeHead(404).end();
    return;
  }

  const isIndex = path.resolve(filePath) === path.join(root, "index.html");
  const headers = {
    "Cache-Control": isIndex ? "no-store" : "public, max-age=31536000, immutable",
    "Content-Type": contentTypes[path.extname(filePath)] ?? "application/octet-stream",
  };
  if (isIndex) {
    const html = await readFile(filePath, "utf8");
    const body = Buffer.from(injectBridgeToken(html, token));
    response.writeHead(200, { ...headers, "Content-Length": body.byteLength });
    if (request.method === "HEAD") response.end();
    else response.end(body);
    return;
  }

  response.writeHead(200, { ...headers, "Content-Length": fileInfo.size });
  if (request.method === "HEAD") {
    response.end();
    return;
  }
  await new Promise<void>((resolve, reject) => {
    const stream = createReadStream(filePath);
    stream.once("error", reject);
    response.once("close", resolve);
    response.once("finish", resolve);
    stream.pipe(response);
  });
}

async function statOrNull(filePath: string) {
  try {
    return await stat(filePath);
  } catch {
    return null;
  }
}
