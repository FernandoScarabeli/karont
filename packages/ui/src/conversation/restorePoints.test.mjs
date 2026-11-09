import assert from "node:assert/strict";
import test from "node:test";
import { createRestoreStore, restoreSummaryModel } from "./restorePoints.ts";

const point = (messageId, overrides = {}) => ({
  messageId,
  state: "ready",
  changedFiles: 1,
  concurrent: false,
  headMoved: false,
  ...overrides,
});

/** Ponte falsa: `restore.list` só responde quando o teste manda. */
function fakeBridge() {
  const listeners = [];
  const lists = [];
  return {
    bridge: {
      onEvent: (listener) => {
        listeners.push(listener);
        return () => {};
      },
      request: (method, params) => {
        assert.equal(method, "restore.list");
        return new Promise((resolve) => lists.push({ params, resolve }));
      },
    },
    emit: (conversationId, summary) => {
      for (const listener of listeners) {
        listener({ event: "restore.changed", payload: { conversationId, point: summary } });
      }
    },
    answerList: (index, points) => lists[index].resolve({ points }),
    listCount: () => lists.length,
  };
}

const flush = () => new Promise((resolve) => setImmediate(resolve));

test("resposta atrasada do restore.list não sobrescreve evento mais novo", async () => {
  const fake = fakeBridge();
  const store = createRestoreStore(() => fake.bridge);
  store.subscribe("c1", "m1", () => {});
  store.subscribe("c1", "m2", () => {});
  assert.equal(fake.listCount(), 1);

  fake.emit("c1", point("m1", { state: "undone", changedFiles: 3 }));
  fake.answerList(0, [point("m1", { changedFiles: 3 }), point("m2", { changedFiles: 2 })]);
  await flush();

  assert.equal(store.getView("c1", "m1").point.state, "undone");
  assert.equal(store.getView("c1", "m2").point.changedFiles, 2);
});

test("evento de mensagem nova que chega antes da lista fica depois dela na ordem", async () => {
  const fake = fakeBridge();
  const store = createRestoreStore(() => fake.bridge);
  store.subscribe("c1", "m3", () => {});
  fake.emit("c1", point("m3", { state: "unavailable", reason: "no-git", changedFiles: 0 }));
  fake.answerList(0, [
    point("m1", { state: "unavailable", reason: "no-git", changedFiles: 0 }),
    point("m2", { state: "unavailable", reason: "no-git", changedFiles: 0 }),
  ]);
  await flush();
  for (const id of ["m1", "m2", "m3"]) {
    assert.equal(restoreSummaryModel(store.getView("c1", id)), null);
  }
});

test("a lista é pedida uma vez por conversa", () => {
  const fake = fakeBridge();
  const store = createRestoreStore(() => fake.bridge);
  store.subscribe("c1", "m1", () => {});
  store.subscribe("c1", "m2", () => {});
  store.subscribe("c2", "m9", () => {});
  assert.equal(fake.listCount(), 2);
});

test("sem Git e pasta pessoal não mostram aviso nenhum", async () => {
  const fake = fakeBridge();
  const store = createRestoreStore(() => fake.bridge);
  store.subscribe("c1", "m1", () => {});
  fake.answerList(0, [
    point("m1", { state: "unavailable", reason: "no-git", changedFiles: 0 }),
    point("m2", { state: "unavailable", reason: "no-git", changedFiles: 0 }),
    point("m3", { state: "unavailable", reason: "home", changedFiles: 0 }),
  ]);
  await flush();
  const models = ["m1", "m2", "m3"].map((id) => restoreSummaryModel(store.getView("c1", id)));
  assert.equal(models[0], null);
  assert.equal(models[1], null);
  assert.equal(models[2], null);
});

test("só a linha da mensagem que mudou é avisada", async () => {
  const fake = fakeBridge();
  const store = createRestoreStore(() => fake.bridge);
  let m1 = 0;
  let m2 = 0;
  store.subscribe("c1", "m1", () => {
    m1 += 1;
  });
  store.subscribe("c1", "m2", () => {
    m2 += 1;
  });
  fake.answerList(0, [point("m1"), point("m2")]);
  await flush();
  m1 = 0;
  m2 = 0;
  fake.emit("c1", point("m2", { changedFiles: 5 }));
  assert.equal(m1, 0);
  assert.equal(m2, 1);
});

test("a visão não muda de identidade quando nada mudou", async () => {
  const fake = fakeBridge();
  const store = createRestoreStore(() => fake.bridge);
  store.subscribe("c1", "m1", () => {});
  fake.answerList(0, [point("m1"), point("m2")]);
  await flush();
  const before = store.getView("c1", "m1");
  fake.emit("c1", point("m2", { changedFiles: 9 }));
  assert.equal(store.getView("c1", "m1"), before);
});

test("textos de singular e plural", () => {
  const view = (changedFiles) => ({ point: point("m1", { changedFiles }) });
  assert.equal(restoreSummaryModel(view(1)).text, "1 arquivo alterado");
  assert.equal(restoreSummaryModel(view(4)).text, "4 arquivos alterados");
  assert.equal(restoreSummaryModel(view(0)), null);
});

test("estados: desfeito, incompleto e sem ponto guardado", () => {
  const with_ = (overrides) => restoreSummaryModel({ point: point("m1", overrides) });
  assert.deepEqual(with_({ state: "undone" }), { kind: "undone", text: "Mudanças desfeitas" });
  assert.equal(
    with_({ state: "incomplete" }).text,
    "Não foi possível registrar as mudanças desta resposta. Não há desfazer.",
  );
  for (const reason of ["timeout", "failed"]) {
    assert.equal(
      with_({ state: "unavailable", reason }).text,
      "Não foi possível guardar o ponto de restauração. Não há desfazer para esta resposta.",
    );
  }
  assert.equal(restoreSummaryModel({ point: null }), null);
});
