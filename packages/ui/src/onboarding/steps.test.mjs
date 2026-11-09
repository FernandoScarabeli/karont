import assert from "node:assert/strict";
import test from "node:test";
import {
  findProjectByPath,
  groupOtherAgents,
  initialChoice,
  isAbsolutePath,
  projectNameFromPath,
  trimTrailingSeparators,
  validChoice,
} from "./steps.ts";

const agent = (id, found, structured = true) => ({
  id,
  name: id,
  kind: "known",
  structured,
  found,
});

test("escolha inicial: primeiro agente de chat encontrado, senão Terminal", () => {
  assert.equal(initialChoice([agent("claude", true), agent("codex", true)]), "claude");
  assert.equal(initialChoice([agent("claude", false), agent("codex", true)]), "codex");
  assert.equal(initialChoice([agent("gemini", true, false)]), "terminal");
  assert.equal(initialChoice([]), "terminal");
});

test("escolha que sumiu da lista volta ao padrão; Terminal sempre vale", () => {
  const agents = [agent("claude", true)];
  assert.equal(validChoice("terminal", agents), "terminal");
  assert.equal(validChoice("claude", agents), "claude");
  assert.equal(validChoice("codex", agents), "claude");
  assert.equal(validChoice("codex", []), "terminal");
});

test("agrupa as CLIs sem chat encontradas e as não encontradas", () => {
  const groups = groupOtherAgents([
    agent("claude", true),
    agent("gemini", true, false),
    agent("codex", false),
    agent("amp", false, false),
  ]);
  assert.deepEqual(
    groups.foundWithoutChat.map((item) => item.id),
    ["gemini"],
  );
  assert.deepEqual(
    groups.missing.map((item) => item.id),
    ["codex", "amp"],
  );
});

test("nome do projeto vem do último pedaço do caminho", () => {
  assert.equal(projectNameFromPath("/home/ana/meu-app"), "meu-app");
  assert.equal(projectNameFromPath("/home/ana/meu-app/"), "meu-app");
  assert.equal(projectNameFromPath("/home/ana/meu-app///"), "meu-app");
  assert.equal(projectNameFromPath("C:\\Users\\ana\\app\\"), "app");
  assert.equal(projectNameFromPath("/"), "");
});

test("nome do projeto é cortado a 80 caracteres", () => {
  const long = "a".repeat(120);
  assert.equal(projectNameFromPath(`/x/${long}`).length, 80);
});

test("barras finais saem, mas a raiz fica", () => {
  assert.equal(trimTrailingSeparators("/a/b/"), "/a/b");
  assert.equal(trimTrailingSeparators("/"), "/");
});

test("acha o projeto pela pasta, com ou sem barra final", () => {
  const projects = [
    { id: "1", path: "/a/b" },
    { id: "2", path: "/c/d/" },
  ];
  assert.equal(findProjectByPath(projects, "/a/b/")?.id, "1");
  assert.equal(findProjectByPath(projects, "/c/d")?.id, "2");
  assert.equal(findProjectByPath(projects, "/c"), undefined);
});

test("reconhece caminho absoluto", () => {
  assert.equal(isAbsolutePath("/home/ana"), true);
  assert.equal(isAbsolutePath("C:\\Users\\ana"), true);
  assert.equal(isAbsolutePath("\\\\servidor\\pasta"), true);
  assert.equal(isAbsolutePath("projeto"), false);
  assert.equal(isAbsolutePath("~/projeto"), false);
});
