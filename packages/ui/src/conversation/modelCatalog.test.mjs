import assert from "node:assert/strict";
import test from "node:test";
import { defaultModel, findModelByIdOrAlias, resolveModelId } from "./modelCatalog.ts";

const models = {
  models: [
    { id: "default", name: "Opus 5.5", aliases: ["opus"], isDefault: true },
    { id: "sonnet", name: "Sonnet 5.5" },
  ],
};

test("resolve a preferência antiga para o modelo padrão sem expor um alias duplicado", () => {
  assert.equal(findModelByIdOrAlias(models, "opus")?.id, "default");
  assert.equal(resolveModelId(models, "opus"), "default");
  assert.equal(
    models.models.some((model) => model.id === "opus"),
    false,
  );
});

test("modelo removido da lista cai no padrão disponível", () => {
  assert.equal(resolveModelId(models, "modelo-removido"), "default");
  assert.equal(defaultModel(models)?.id, "default");
});

test("usa o primeiro modelo se a lista não marcar um padrão", () => {
  const catalog = { models: [{ id: "sonnet", name: "Sonnet" }] };
  assert.equal(defaultModel(catalog)?.id, "sonnet");
  assert.equal(resolveModelId(catalog, "modelo-removido"), "sonnet");
});
