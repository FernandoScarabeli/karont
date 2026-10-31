import assert from "node:assert/strict";
import test from "node:test";
import { isAllowedSender } from "./sender.ts";

test("permite apenas o frame principal da janela e do protocolo do app", () => {
  const allowed = {
    url: "karont://app/",
    isMainFrame: true,
    belongsToOurWindow: true,
  };
  assert.equal(isAllowedSender(allowed), true);
  assert.equal(isAllowedSender({ ...allowed, isMainFrame: false }), false);
  assert.equal(isAllowedSender({ ...allowed, belongsToOurWindow: false }), false);
  assert.equal(isAllowedSender({ ...allowed, url: "https://karont://app/" }), false);
  assert.equal(isAllowedSender({ ...allowed, url: "karont://app.evil/" }), false);
});
