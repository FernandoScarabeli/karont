import assert from "node:assert/strict";
import { createReadStream, type ReadStream } from "node:fs";
import { mkdir, mkdtemp, rm, truncate, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { Writable } from "node:stream";
import { test } from "node:test";
import {
  createBuiltPreviewHandler,
  createProductionPreviewHandler,
  injectBridgeToken,
} from "./static.ts";

test("injeta o token de sessão no head do documento sem substituir o restante", () => {
  const html = "<!doctype html><html><head><title>Karont</title></head><body></body></html>";
  const result = injectBridgeToken(html, "token-de-teste");

  assert.match(result, /<head>\s*<meta name="karont-dev-bridge" content="token-de-teste">/);
  assert.match(result, /<title>Karont<\/title>/);
});

test("preview de produção serve dist-preview, separado do dist do app", async () => {
  const uiRoot = await mkdtemp(path.join(os.tmpdir(), "karont-built-preview-"));
  const appDist = path.join(uiRoot, "dist");
  const previewDist = path.join(uiRoot, "dist-preview");
  await mkdir(appDist);
  await mkdir(previewDist);
  await Promise.all([
    writeFile(path.join(appDist, "index.html"), "app-sem-ponte"),
    writeFile(path.join(previewDist, "index.html"), "preview-com-ponte"),
  ]);

  try {
    const handler = createProductionPreviewHandler({
      uiRoot,
      token: "token-de-teste",
      bridgeHandler: () => undefined,
    });
    const response = new FakeResponse();
    handler(new FakeRequest() as never, response as never);
    await response.finished;

    assert.equal(response.statusCode, 200);
    assert.match(response.body, /preview-com-ponte/);
    assert.doesNotMatch(response.body, /app-sem-ponte/);
  } finally {
    await rm(uiRoot, { recursive: true, force: true });
  }
});

test("destrói o stream do arquivo quando o cliente aborta o download", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "karont-aborted-preview-"));
  const filePath = path.join(root, "bundle.js");
  await writeFile(filePath, "");
  await truncate(filePath, 64 * 1024 * 1024);

  let fileStream: ReadStream | undefined;
  const handler = createBuiltPreviewHandler({
    root,
    token: "token-de-teste",
    bridgeHandler: () => undefined,
    createFileStream: (file) => {
      fileStream = createReadStream(file);
      return fileStream;
    },
  });
  const response = new AbortingResponse();

  try {
    handler(new FakeRequest("/bundle.js") as never, response as never);
    await response.closeEvent;
    await new Promise<void>((resolve) => setImmediate(resolve));

    assert.ok(fileStream);
    assert.equal(fileStream.destroyed, true);
  } finally {
    fileStream?.destroy();
    await rm(root, { recursive: true, force: true });
  }
});

class FakeRequest {
  method = "GET";
  url: string;

  constructor(url = "/") {
    this.url = url;
  }
}

class AbortingResponse extends Writable {
  private resolveClosed!: () => void;
  readonly closeEvent = new Promise<void>((resolve) => {
    this.resolveClosed = resolve;
  });
  headersSent = false;
  statusCode: number | undefined;

  constructor() {
    super();
    this.once("close", () => this.resolveClosed());
  }

  writeHead(statusCode: number): this {
    this.statusCode = statusCode;
    this.headersSent = true;
    return this;
  }

  override _write(
    _chunk: Buffer,
    _encoding: BufferEncoding,
    callback: (error?: Error | null) => void,
  ): void {
    callback();
    this.destroy();
  }
}

class FakeResponse {
  statusCode: number | undefined;
  private resolveFinished!: () => void;
  readonly finished = new Promise<void>((resolve) => {
    this.resolveFinished = resolve;
  });
  body = "";

  writeHead(statusCode: number): this {
    this.statusCode = statusCode;
    return this;
  }

  end(chunk?: string | Buffer): this {
    if (chunk) this.body += chunk.toString();
    this.resolveFinished();
    return this;
  }
}
