import assert from "node:assert/strict";
import test from "node:test";
import { buildDayLine, localDayKey, startOfLocalDay, statusItems } from "./overviewSummary.ts";

const base = { activeToday: 0, working: 0, queued: 0, waiting: 0, error: 0 };

test("linha do dia com tudo zero", () => {
  assert.equal(buildDayLine(base), "Nenhuma conversa hoje");
});

test("linha do dia mostra só as partes diferentes de zero", () => {
  assert.equal(
    buildDayLine({ ...base, activeToday: 3, working: 1, waiting: 1 }),
    "3 conversas hoje · 1 trabalhando · 1 precisa de você",
  );
  assert.equal(buildDayLine({ ...base, activeToday: 1 }), "1 conversa hoje");
  assert.equal(
    buildDayLine({ ...base, activeToday: 2, waiting: 2 }),
    "2 conversas hoje · 2 precisam de você",
  );
});

test("linha do dia com fila e erro", () => {
  assert.equal(
    buildDayLine({ ...base, activeToday: 5, working: 2, queued: 1, error: 3 }),
    "5 conversas hoje · 2 trabalhando · 1 na fila · 3 com erro",
  );
  assert.equal(buildDayLine({ ...base, error: 1 }), "1 com erro");
});

test("trabalhando sem conversa ativa hoje não vira 'nenhuma conversa'", () => {
  assert.equal(buildDayLine({ ...base, working: 1 }), "1 trabalhando");
});

test("statusItems ignora zeros e campos ausentes", () => {
  assert.deepEqual(statusItems({ working: 0, waiting: 0 }), []);
  assert.deepEqual(
    statusItems({ working: 2, waiting: 1 }).map((item) => [item.tone, item.count]),
    [
      ["working", 2],
      ["waiting", 1],
    ],
  );
});

test("início do dia local", () => {
  const now = new Date(2026, 10, 9, 17, 14, 5);
  const start = new Date(startOfLocalDay(now));
  assert.equal(start.getFullYear(), 2026);
  assert.equal(start.getMonth(), 10);
  assert.equal(start.getDate(), 9);
  assert.equal(start.getHours(), 0);
  assert.equal(start.getMinutes(), 0);
  assert.notEqual(localDayKey(now), localDayKey(new Date(2026, 10, 10, 0, 1)));
  assert.equal(localDayKey(now), localDayKey(new Date(2026, 10, 9, 0, 0)));
});
