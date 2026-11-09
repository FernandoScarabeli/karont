import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { after, test } from "node:test";
import { openDatabase } from "../db.ts";
import {
  mergeUsageWindows,
  parseClaudeRateLimit,
  parseCodexRateLimits,
  readStoredUsage,
  recordUsage,
} from "./usage.ts";

const iso = (seconds: number) => new Date(seconds * 1000).toISOString();

// `openTempDatabase()` criaria um arquivo com esse nome na pasta atual.
const tempRoot = mkdtempSync(path.join(os.tmpdir(), "karont-usage-"));
after(() => rmSync(tempRoot, { recursive: true, force: true }));
let tempDatabases = 0;
const openTempDatabase = () => openDatabase(path.join(tempRoot, `${++tempDatabases}.db`));

const claudeEvent = {
  type: "rate_limit_event",
  rate_limit_info: {
    status: "allowed",
    resetsAt: 1793507400,
    rateLimitType: "five_hour",
    unifiedWindows: {
      five_hour: { utilization: 0.06, resetsAt: 1793507400, status: "allowed" },
      seven_day: { utilization: 0.44, resetsAt: 1793908800, status: "allowed" },
    },
  },
};

const codexParams = {
  rateLimits: {
    limitId: "codex",
    primary: { usedPercent: 20, windowDurationMins: 300, resetsAt: 1793508694 },
    secondary: { usedPercent: 32, windowDurationMins: 10080, resetsAt: 1793901203 },
  },
};

test("parseClaudeRateLimit lê as duas janelas do exemplo real", () => {
  assert.deepEqual(parseClaudeRateLimit(claudeEvent), [
    { id: "five_hour", usedPercent: 6, resetsAt: iso(1793507400) },
    { id: "weekly", usedPercent: 44, resetsAt: iso(1793908800) },
  ]);
});

test("parseClaudeRateLimit tolera entradas ruins", () => {
  assert.deepEqual(parseClaudeRateLimit(null), []);
  assert.deepEqual(parseClaudeRateLimit({ rate_limit_info: {} }), []);
  const only = {
    rate_limit_info: { unifiedWindows: { seven_day: { utilization: 0.5, resetsAt: "x" } } },
  };
  assert.deepEqual(parseClaudeRateLimit(only), [{ id: "weekly", usedPercent: 50, resetsAt: null }]);
  const over = {
    rate_limit_info: { unifiedWindows: { five_hour: { utilization: 1.7, resetsAt: 1793507400 } } },
  };
  assert.equal(parseClaudeRateLimit(over)[0]?.usedPercent, 100);
  const bad = { rate_limit_info: { unifiedWindows: { five_hour: { utilization: "0.1" } } } };
  assert.deepEqual(parseClaudeRateLimit(bad), []);
});

test("parseCodexRateLimits lê as duas janelas do exemplo real", () => {
  assert.deepEqual(parseCodexRateLimits(codexParams), [
    { id: "five_hour", usedPercent: 20, resetsAt: iso(1793508694) },
    { id: "weekly", usedPercent: 32, resetsAt: iso(1793901203) },
  ]);
});

test("parseCodexRateLimits identifica pela duração e ignora o que não é válido", () => {
  assert.deepEqual(parseCodexRateLimits(null), []);
  assert.deepEqual(
    parseCodexRateLimits({ rateLimits: { ...codexParams.rateLimits, limitId: "outro" } }),
    [],
  );
  const swapped = {
    rateLimits: {
      limitId: "codex",
      primary: { usedPercent: 40.4, windowDurationMins: 10080, resetsAt: 1793901203 },
      secondary: null,
    },
  };
  assert.deepEqual(parseCodexRateLimits(swapped), [
    { id: "weekly", usedPercent: 40, resetsAt: iso(1793901203) },
  ]);
  const unknown = {
    rateLimits: {
      limitId: "codex",
      primary: { usedPercent: 10, windowDurationMins: 60, resetsAt: 1 },
      secondary: { usedPercent: 250, windowDurationMins: 300, resetsAt: "x" },
    },
  };
  assert.deepEqual(parseCodexRateLimits(unknown), [
    { id: "five_hour", usedPercent: 100, resetsAt: null },
  ]);
});

test("mergeUsageWindows mantém a janela que não veio no evento", () => {
  const merged = mergeUsageWindows(
    [
      { id: "five_hour", usedPercent: 10, resetsAt: null },
      { id: "weekly", usedPercent: 30, resetsAt: null },
    ],
    [{ id: "five_hour", usedPercent: 12, resetsAt: null }],
  );
  assert.deepEqual(merged, [
    { id: "five_hour", usedPercent: 12, resetsAt: null },
    { id: "weekly", usedPercent: 30, resetsAt: null },
  ]);
});

test("recordUsage só regrava com mudança ou depois de 60 s", () => {
  const db = openTempDatabase();
  try {
    const t0 = "2026-11-09T10:00:00.000Z";
    const five = (usedPercent: number) => [
      { id: "five_hour" as const, usedPercent, resetsAt: null },
    ];
    const week = [{ id: "weekly" as const, usedPercent: 30, resetsAt: null }];
    assert.equal(recordUsage(db, "codex", [], t0), undefined);
    assert.equal(recordUsage(db, "codex", five(10), t0)?.observedAt, t0);
    assert.equal(recordUsage(db, "codex", five(10), "2026-11-09T10:00:30.000Z"), undefined);
    assert.equal(readStoredUsage(db, "codex")?.observedAt, t0);
    const changed = recordUsage(db, "codex", five(11), "2026-11-09T10:00:31.000Z");
    assert.equal(changed?.windows[0]?.usedPercent, 11);
    const later = "2026-11-09T10:01:32.000Z";
    assert.equal(recordUsage(db, "codex", five(11), later)?.observedAt, later);
    const merged = recordUsage(db, "codex", week, later);
    assert.deepEqual(
      merged?.windows.map((window) => window.id),
      ["five_hour", "weekly"],
    );
    assert.equal(readStoredUsage(db, "outro"), undefined);
  } finally {
    db.close();
  }
});

test("recordUsage não lança quando a gravação falha", () => {
  const db = openTempDatabase();
  db.close();
  assert.equal(
    recordUsage(
      db,
      "codex",
      [{ id: "five_hour", usedPercent: 1, resetsAt: null }],
      "2026-11-09T10:00:00.000Z",
    ),
    undefined,
  );
});
