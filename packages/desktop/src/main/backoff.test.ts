import assert from "node:assert/strict";
import test from "node:test";
import { backoffDelay } from "./backoff.ts";

test("gera espera crescente e limita as tentativas a dez segundos", () => {
  assert.deepEqual(
    Array.from({ length: 9 }, (_, attempt) => backoffDelay(attempt)),
    [100, 200, 400, 800, 1_600, 3_200, 6_400, 10_000, 10_000],
  );
  assert.throws(() => backoffDelay(-1), RangeError);
});
