import assert from "node:assert/strict";
import test from "node:test";
import { dotFields, dotPatch, mergeDotDraft } from "./dotDraft.ts";

const original = {
  id: "default",
  name: "Dot",
  color: "#232325",
  enabled: true,
  personality: { explanation: 50, playfulness: 50, boldness: 50 },
  createdAt: "2026-11-09T12:00:00.000Z",
  updatedAt: "2026-11-09T12:00:00.000Z",
};
test("atualização remota preserva a edição local e incorpora campos não editados", () => {
  const draft = { ...dotFields(original), name: "Caronte" };
  const incoming = { ...original, color: "#ffffff", enabled: false };
  const merged = mergeDotDraft(original, draft, incoming);
  assert.equal(merged.name, "Caronte");
  assert.equal(merged.color, "#ffffff");
  assert.equal(merged.enabled, false);
  assert.deepEqual(dotPatch(dotFields(incoming), merged), { name: "Caronte" });
});
test("sem edição local acompanha outra janela; cancelar não compartilha a personalidade", () => {
  const incoming = { ...original, name: "Outro" };
  assert.deepEqual(mergeDotDraft(original, dotFields(original), incoming), dotFields(incoming));
  const draft = dotFields(original);
  draft.personality.explanation = 10;
  assert.equal(original.personality.explanation, 50);
  assert.deepEqual(dotPatch(dotFields(original), dotFields(original)), {});
});
