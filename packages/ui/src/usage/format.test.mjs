import assert from "node:assert/strict";
import test from "node:test";
import { formatAgoShort, formatDuration, formatResetShort, windowView } from "./format.ts";

const SEC = 1000;
const MIN = 60 * SEC;
const HOUR = 60 * MIN;
const DAY = 24 * HOUR;

test("formatDuration: limites de minuto", () => {
  assert.equal(formatDuration(0), "menos de 1 min");
  assert.equal(formatDuration(59 * SEC), "menos de 1 min");
  assert.equal(formatDuration(60 * SEC), "1 min");
  assert.equal(formatDuration(37 * MIN), "37 min");
  assert.equal(formatDuration(59 * MIN + 59 * SEC), "59 min");
});

test("formatDuration: horas sem zeros soltos", () => {
  assert.equal(formatDuration(60 * MIN), "1h");
  assert.equal(formatDuration(2 * HOUR), "2h");
  assert.equal(formatDuration(4 * HOUR + 17 * MIN), "4h 17min");
  assert.equal(formatDuration(23 * HOUR + 59 * MIN), "23h 59min");
});

test("formatDuration: dias sem zeros soltos", () => {
  assert.equal(formatDuration(24 * HOUR), "1d");
  assert.equal(formatDuration(3 * DAY), "3d");
  assert.equal(formatDuration(3 * DAY + 2 * HOUR), "3d 2h");
  assert.equal(formatDuration(3 * DAY + 59 * MIN), "3d");
});

test("formatDuration: valor inválido ou negativo não quebra", () => {
  assert.equal(formatDuration(-5), "menos de 1 min");
  assert.equal(formatDuration(Number.NaN), "menos de 1 min");
});

test("formatResetShort: limites", () => {
  assert.equal(formatResetShort(0), "<1 min");
  assert.equal(formatResetShort(59 * SEC), "<1 min");
  assert.equal(formatResetShort(60 * SEC), "1 min");
  assert.equal(formatResetShort(20 * MIN), "20 min");
  assert.equal(formatResetShort(59 * MIN + 59 * SEC), "59 min");
  assert.equal(formatResetShort(60 * MIN), "1h");
  assert.equal(formatResetShort(4 * HOUR + 17 * MIN), "4h");
  assert.equal(formatResetShort(23 * HOUR + 59 * MIN), "23h");
  assert.equal(formatResetShort(24 * HOUR), "1d");
  assert.equal(formatResetShort(3 * DAY + 59 * MIN), "3d");
  assert.equal(formatResetShort(3 * DAY + 5 * HOUR + 40 * MIN), "3d 5h");
  assert.equal(formatResetShort(-5), "<1 min");
  assert.equal(formatResetShort(Number.NaN), "<1 min");
});

test("formatAgoShort: limites", () => {
  const now = Date.parse("2026-11-09T12:00:00.000Z");
  const ago = (ms) => new Date(now - ms).toISOString();
  assert.equal(formatAgoShort(ago(0), now), "agora");
  assert.equal(formatAgoShort(ago(59 * SEC), now), "agora");
  assert.equal(formatAgoShort(ago(60 * SEC), now), "há 1 min");
  assert.equal(formatAgoShort(ago(5 * MIN), now), "há 5 min");
  assert.equal(formatAgoShort(ago(59 * MIN + 59 * SEC), now), "há 59 min");
  assert.equal(formatAgoShort(ago(60 * MIN), now), "há 1h");
  assert.equal(formatAgoShort(ago(2 * HOUR + 40 * MIN), now), "há 2h");
  assert.equal(formatAgoShort(ago(24 * HOUR), now), "há 1d");
  assert.equal(formatAgoShort(ago(3 * DAY + 5 * HOUR), now), "há 3d");
  assert.equal(formatAgoShort(new Date(now + 10 * MIN).toISOString(), now), "agora");
});

test("windowView: janela em andamento", () => {
  const now = Date.parse("2026-11-09T12:00:00.000Z");
  const resetsAt = new Date(now + 4 * HOUR + 17 * MIN).toISOString();
  assert.deepEqual(windowView({ id: "five_hour", usedPercent: 27, resetsAt }, now), {
    expired: false,
    percent: 27,
    resetsIn: 4 * HOUR + 17 * MIN,
  });
});

test("windowView: resetsAt nulo mostra a porcentagem sem prazo", () => {
  const now = Date.parse("2026-11-09T12:00:00.000Z");
  assert.deepEqual(windowView({ id: "weekly", usedPercent: 65, resetsAt: null }, now), {
    expired: false,
    percent: 65,
    resetsIn: null,
  });
});

test("windowView: janela vencida esconde a porcentagem antiga", () => {
  const now = Date.parse("2026-11-09T12:00:00.000Z");
  const past = new Date(now - MIN).toISOString();
  assert.deepEqual(windowView({ id: "five_hour", usedPercent: 90, resetsAt: past }, now), {
    expired: true,
    percent: null,
    resetsIn: null,
  });
  // No instante exato do reset a janela já zerou.
  const exact = new Date(now).toISOString();
  assert.equal(
    windowView({ id: "five_hour", usedPercent: 90, resetsAt: exact }, now).expired,
    true,
  );
  // Um segundo antes ainda vale.
  const soon = new Date(now + SEC).toISOString();
  assert.deepEqual(windowView({ id: "five_hour", usedPercent: 90, resetsAt: soon }, now), {
    expired: false,
    percent: 90,
    resetsIn: SEC,
  });
});
