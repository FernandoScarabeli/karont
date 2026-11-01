import assert from "node:assert/strict";
import test from "node:test";
import { getAllowedExternalUrl } from "./externalLinks.ts";

test("allows only absolute HTTP, HTTPS, and mailto links", () => {
  assert.equal(getAllowedExternalUrl("https://example.com/path"), "https://example.com/path");
  assert.equal(getAllowedExternalUrl("http://example.com"), "http://example.com/");
  assert.equal(getAllowedExternalUrl("mailto:dev@example.com"), "mailto:dev@example.com");
  assert.equal(getAllowedExternalUrl("javascript:alert(1)"), null);
  assert.equal(getAllowedExternalUrl("data:text/html,hello"), null);
  assert.equal(getAllowedExternalUrl("file:///etc/passwd"), null);
  assert.equal(getAllowedExternalUrl("/local/path"), null);
  assert.equal(getAllowedExternalUrl(undefined), null);
});
