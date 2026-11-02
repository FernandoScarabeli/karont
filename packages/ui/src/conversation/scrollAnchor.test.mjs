import assert from "node:assert/strict";
import test from "node:test";
import { adjustScrollTopForAnchor } from "./scrollAnchor.ts";

test("compensa conteúdo inserido acima mantendo a âncora no mesmo ponto", () => {
  const scrollTop = 150;
  const anchorTopBefore = 220;
  const anchorTopAfter = 2368;
  const adjustedScrollTop = adjustScrollTopForAnchor(scrollTop, anchorTopBefore, anchorTopAfter);

  assert.equal(adjustedScrollTop, 2298);
  assert.equal(anchorTopAfter - (adjustedScrollTop - scrollTop), anchorTopBefore);
});

test("compensa também quando a âncora sobe após uma mudança de layout", () => {
  assert.equal(adjustScrollTopForAnchor(900, 400, 250), 750);
});
