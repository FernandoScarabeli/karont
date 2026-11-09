import assert from "node:assert/strict";
import test from "node:test";
import { createReloadScheduler, isOverviewReloadEvent } from "./overviewReload.ts";

function setup({ canRun = () => true } = {}) {
  let clock = 10_000;
  const timers = [];
  const loads = [];
  const scheduler = createReloadScheduler({
    load: () =>
      new Promise((resolve, reject) => {
        loads.push({ resolve, reject, at: clock });
      }),
    canRun,
    minIntervalMs: 1000,
    now: () => clock,
    setTimer: (callback, ms) => {
      const timer = { callback, at: clock + ms, cleared: false };
      timers.push(timer);
      return timer;
    },
    clearTimer: (timer) => {
      timer.cleared = true;
    },
  });
  const advance = (ms) => {
    clock += ms;
    for (const timer of timers.filter((item) => !item.cleared && item.at <= clock)) {
      timer.cleared = true;
      timer.callback();
    }
  };
  const flush = () => new Promise((resolve) => setImmediate(resolve));
  const pending = () => timers.filter((timer) => !timer.cleared).length;
  return { scheduler, loads, advance, flush, pending };
}

test("só estes eventos recarregam; delta de texto nunca", () => {
  for (const name of [
    "conversation.stateChanged",
    "projects.changed",
    "workspaces.changed",
    "conversations.workspaceMoved",
  ]) {
    assert.equal(isOverviewReloadEvent(name), true, name);
  }
  for (const name of [
    "conversation.partUpdated",
    "conversation.messageCreated",
    "terminal.output",
  ]) {
    assert.equal(isOverviewReloadEvent(name), false, name);
  }
});

test("a primeira carga sai na hora e não deixa timer", () => {
  const { scheduler, loads, pending } = setup();
  scheduler.markDirty();
  assert.equal(loads.length, 1);
  assert.equal(pending(), 0);
});

test("uma requisição por vez; vários eventos viram só mais uma ao terminar", async () => {
  const { scheduler, loads, advance, flush } = setup();
  scheduler.markDirty();
  scheduler.markDirty();
  scheduler.markDirty();
  assert.equal(loads.length, 1);
  advance(2000);
  assert.equal(loads.length, 1, "continua uma só enquanto a primeira não terminou");
  loads[0].resolve();
  await flush();
  assert.equal(loads.length, 2, "uma recarga final");
  loads[1].resolve();
  await flush();
  advance(5000);
  assert.equal(loads.length, 2, "sem polling depois que acalma");
});

test("recargas começam com pelo menos 1 s de intervalo", async () => {
  const { scheduler, loads, advance, flush, pending } = setup();
  scheduler.markDirty();
  loads[0].resolve();
  await flush();
  advance(300);
  scheduler.markDirty();
  assert.equal(loads.length, 1);
  assert.equal(pending(), 1);
  advance(600);
  assert.equal(loads.length, 1);
  advance(100);
  assert.equal(loads.length, 2);
});

test("evento durante a requisição respeita o intervalo ao terminar", async () => {
  const { scheduler, loads, advance, flush } = setup();
  scheduler.markDirty();
  advance(200);
  scheduler.markDirty();
  loads[0].resolve();
  await flush();
  assert.equal(loads.length, 1, "ainda dentro do intervalo");
  advance(800);
  assert.equal(loads.length, 2);
});

test("sem tela visível não carrega; ao voltar, faz a recarga pendente", () => {
  let visible = false;
  const { scheduler, loads } = setup({ canRun: () => visible });
  scheduler.markDirty();
  scheduler.markDirty();
  assert.equal(loads.length, 0);
  visible = true;
  scheduler.resume();
  assert.equal(loads.length, 1);
  scheduler.resume();
  assert.equal(loads.length, 1, "nada pendente, nada a fazer");
});

test("falha na requisição não trava as próximas", async () => {
  const { scheduler, loads, advance, flush } = setup();
  scheduler.markDirty();
  loads[0].reject(new Error("falhou"));
  await flush();
  advance(1000);
  scheduler.markDirty();
  assert.equal(loads.length, 2);
});

test("dispose cancela o timer pendente", async () => {
  const { scheduler, loads, advance, flush, pending } = setup();
  scheduler.markDirty();
  loads[0].resolve();
  await flush();
  scheduler.markDirty();
  assert.equal(pending(), 1);
  scheduler.dispose();
  assert.equal(pending(), 0);
  advance(5000);
  assert.equal(loads.length, 1);
});
