import assert from "node:assert/strict";
import test from "node:test";
import { defaultModel, findModelByIdOrAlias, resolveModelId } from "./modelCatalog.ts";

const models = {
  models: [
    { id: "opus", name: "Opus 5.5", aliases: ["default"], isDefault: true },
    { id: "sonnet", name: "Sonnet 5.5" },
  ],
};

test("resolve a preferência default para o modelo explícito marcado como padrão", () => {
  assert.equal(findModelByIdOrAlias(models, "default")?.id, "opus");
  assert.equal(resolveModelId(models, "default"), "opus");
  assert.equal(
    models.models.some((model) => model.id === "default"),
    false,
  );
});

test("preserva um modelo salvo que não está na lista atual", () => {
  assert.equal(resolveModelId(models, "claude-opus-4-8"), "claude-opus-4-8");
  assert.equal(defaultModel(models)?.id, "opus");
});

test("só usa o primeiro modelo quando não há preferência salva", () => {
  const catalog = { models: [{ id: "sonnet", name: "Sonnet" }] };
  assert.equal(defaultModel(catalog)?.id, "sonnet");
  assert.equal(resolveModelId(catalog, ""), "sonnet");
  assert.equal(resolveModelId(catalog, "modelo-removido"), "modelo-removido");
});
