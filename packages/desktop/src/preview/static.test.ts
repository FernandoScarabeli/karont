import assert from "node:assert/strict";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { test } from "node:test";
import { createProductionPreviewHandler, injectBridgeToken } from "./static.ts";

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

class FakeRequest {
  method = "GET";
  url = "/";
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
