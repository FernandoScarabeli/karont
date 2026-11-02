import assert from "node:assert/strict";
import { test } from "node:test";
import { MAX_EXTERNAL_URL_BYTES, validateExternalUrl } from "./external-url.ts";

test("external URL aceita HTTP, HTTPS e mailto e normaliza a URL", () => {
  assert.equal(validateExternalUrl("https://example.com/path"), "https://example.com/path");
  assert.equal(validateExternalUrl("http://example.com"), "http://example.com/");
  assert.equal(validateExternalUrl("mailto:pessoa@example.com"), "mailto:pessoa@example.com");
});

test("external URL recusa esquemas, formatos e tamanhos não permitidos", () => {
  for (const url of [
    "",
    "javascript:alert(1)",
    "file:///etc/passwd",
    "https://",
    " https://example.com",
    "mailto:",
    "https://example.com\n",
  ]) {
    assert.equal(validateExternalUrl(url), null, url);
  }
  assert.equal(
    validateExternalUrl(`https://example.com/${"x".repeat(MAX_EXTERNAL_URL_BYTES)}`),
    null,
  );
  assert.equal(validateExternalUrl({ url: "https://example.com" }), null);
});
