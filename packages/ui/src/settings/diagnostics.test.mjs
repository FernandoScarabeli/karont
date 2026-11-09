import assert from "node:assert/strict";
import test from "node:test";
import { formatStartedAt, foundClis } from "./diagnostics.ts";

test("lista só CLIs encontradas e usa o caminho", () => {
  const result = foundClis([
    { id: "a", name: "A", kind: "known", structured: true, found: true, path: "/bin/a" },
    { id: "b", name: "B", kind: "known", structured: true, found: false },
  ]);
  assert.deepEqual(result, [{ id: "a", name: "A", location: "/bin/a" }]);
});

test("personalizada sem caminho mostra o comando", () => {
  const result = foundClis([
    { id: "c", name: "C", kind: "custom", structured: false, found: true, command: "minha-cli" },
  ]);
  assert.equal(result[0]?.location, "minha-cli");
});

test("sem nenhuma encontrada devolve lista vazia", () => {
  assert.deepEqual(foundClis([]), []);
});

test("formata data em pt-BR e mantém texto inválido", () => {
  assert.match(formatStartedAt("2026-01-02T03:04:05.000Z"), /\d{2}\/\d{2}\/\d{2,4}/);
  assert.equal(formatStartedAt("xx"), "xx");
});
