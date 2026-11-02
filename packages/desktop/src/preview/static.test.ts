import assert from "node:assert/strict";
import { test } from "node:test";
import { injectBridgeToken } from "./static.ts";

test("injeta o token de sessão no head do documento sem substituir o restante", () => {
  const html = "<!doctype html><html><head><title>Karont</title></head><body></body></html>";
  const result = injectBridgeToken(html, "token-de-teste");

  assert.match(result, /<head>\s*<meta name="karont-dev-bridge" content="token-de-teste">/);
  assert.match(result, /<title>Karont<\/title>/);
});
