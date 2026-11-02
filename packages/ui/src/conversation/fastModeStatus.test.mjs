import assert from "node:assert/strict";
import { test } from "node:test";
import { fastUnavailableMessage } from "./fastModeStatus.ts";

test("informa quando a conta Claude não tem uso extra ativado", () => {
  assert.equal(
    fastUnavailableMessage("extra_usage_disabled"),
    "Modo rápido indisponível: sua conta do Claude não tem uso extra ativado.",
  );
});

test("usa aviso genérico para outros motivos sem expor o código", () => {
  assert.equal(
    fastUnavailableMessage("service_tier_not_applied"),
    "Modo rápido indisponível neste momento.",
  );
  assert.equal(fastUnavailableMessage(undefined), undefined);
});
