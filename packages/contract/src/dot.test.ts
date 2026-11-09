import assert from "node:assert/strict";
import test from "node:test";
import { dotFieldsSchema } from "./dot.ts";
import { parseEvent, parseRequest, parseResult } from "./validate.ts";

test("contrato Dot normaliza nome e cor e rejeita campos inválidos", () => {
  const fields = {
    name: " Dot ",
    color: "#FFAA00",
    enabled: true,
    personality: { explanation: 50, playfulness: 50, boldness: 50 },
  };
  const dot = dotFieldsSchema.parse(fields);
  assert.equal(dot.name, "Dot");
  assert.equal(dot.color, "#ffaa00");
  for (const invalid of [
    { ...fields, name: "" },
    { ...fields, color: "blue" },
    { ...fields, enabled: "true" },
    { ...fields, personality: { ...fields.personality, boldness: 0.5 } },
    { ...fields, unknown: 1 },
  ])
    assert.equal(dotFieldsSchema.safeParse(invalid).success, false);
  assert.ok(parseRequest({ type: "request", id: "1", method: "dot.get", params: {} }).ok);
  assert.ok(
    parseRequest({ type: "request", id: "2", method: "dot.update", params: { enabled: false } }).ok,
  );
  const record = {
    ...dot,
    id: "default",
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  };
  assert.ok(parseResult("dot.get", record).ok);
  assert.ok(parseEvent({ type: "event", event: "dot.updated", payload: record }).ok);
});
