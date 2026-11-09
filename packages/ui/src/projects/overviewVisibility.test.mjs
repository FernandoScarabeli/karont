import assert from "node:assert/strict";
import test from "node:test";
import {
  hasOpenContent,
  isOverviewVisible,
  overrideAfterActiveTabClick,
  shouldClearOverrideOnLayoutChange,
} from "./overviewVisibility.ts";

const pane = (id, view) => ({ type: "pane", id, view });
const empty = pane("pane-1", { kind: "new-conversation" });
const chat = pane("pane-2", { kind: "chat", conversationId: "c1" });
const terminal = pane("pane-3", { kind: "terminal", terminalId: "t1" });
const split = (...children) => ({
  type: "split",
  id: "split-1",
  direction: "row",
  children,
  sizes: children.map(() => 100 / children.length),
});

test("conteúdo aberto: conversa ou terminal, em qualquer painel", () => {
  assert.equal(hasOpenContent(empty), false);
  assert.equal(hasOpenContent(pane("p", { kind: "new-conversation", projectId: "x" })), false);
  assert.equal(hasOpenContent(chat), true);
  assert.equal(hasOpenContent(terminal), true);
  assert.equal(hasOpenContent(split(empty, empty)), false);
  assert.equal(hasOpenContent(split(empty, split(empty, terminal))), true);
});

test("a tela aparece sem conteúdo, salvo nova conversa limpa pedida", () => {
  assert.equal(isOverviewVisible(false, undefined), true);
  assert.equal(isOverviewVisible(true, undefined), false);
  assert.equal(isOverviewVisible(false, "hide"), false);
  assert.equal(isOverviewVisible(true, "show"), true);
});

test("clique na aba em que já se está", () => {
  // Com conversas abertas e a tela à vista, volta para elas.
  assert.equal(overrideAfterActiveTabClick(true, true), undefined);
  // Com conversas abertas e painéis à vista, mostra a tela.
  assert.equal(overrideAfterActiveTabClick(true, false), "show");
  // Sem conversas, em nova conversa limpa, mostra a tela; já à vista, continua.
  assert.equal(overrideAfterActiveTabClick(false, false), "show");
  assert.equal(overrideAfterActiveTabClick(false, true), "show");
});

test("fechar o último painel com conteúdo limpa a escolha; só painéis vazios, não", () => {
  assert.equal(shouldClearOverrideOnLayoutChange(true, false), true);
  assert.equal(shouldClearOverrideOnLayoutChange(true, true), true);
  assert.equal(shouldClearOverrideOnLayoutChange(false, true), true);
  assert.equal(shouldClearOverrideOnLayoutChange(false, false), false);
});
