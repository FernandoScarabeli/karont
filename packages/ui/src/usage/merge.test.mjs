import assert from "node:assert/strict";
import test from "node:test";
import { mergeListed, upsertUsage } from "./merge.ts";

const usage = (agent, observedAt, usedPercent = 10) => ({
  agent,
  windows: [{ id: "five_hour", usedPercent, resetsAt: null }],
  observedAt,
});

test("upsertUsage troca a linha do agente e mantém a ordem", () => {
  const list = [
    usage("claude", "2026-11-09T10:00:00.000Z"),
    usage("codex", "2026-11-09T10:00:00.000Z"),
  ];
  const next = upsertUsage(list, usage("claude", "2026-11-09T11:00:00.000Z", 50));
  assert.deepEqual(
    next.map((item) => item.agent),
    ["claude", "codex"],
  );
  assert.equal(next[0].windows[0].usedPercent, 50);
});

test("upsertUsage acrescenta agente novo", () => {
  const next = upsertUsage(
    [usage("claude", "2026-11-09T10:00:00.000Z")],
    usage("codex", "2026-11-09T10:00:00.000Z"),
  );
  assert.deepEqual(
    next.map((item) => item.agent),
    ["claude", "codex"],
  );
});

test("mergeListed mantém o evento mais novo que a lista", () => {
  const current = [usage("claude", "2026-11-09T11:00:00.000Z", 70)];
  const listed = [
    usage("claude", "2026-11-09T10:00:00.000Z", 20),
    usage("codex", "2026-11-09T10:00:00.000Z"),
  ];
  const merged = mergeListed(current, listed);
  assert.equal(merged.find((item) => item.agent === "claude").windows[0].usedPercent, 70);
  assert.equal(merged.length, 2);
});

test("mergeListed prefere a lista quando ela é mais nova", () => {
  const current = [usage("claude", "2026-11-09T09:00:00.000Z", 5)];
  const listed = [usage("claude", "2026-11-09T10:00:00.000Z", 20)];
  assert.equal(mergeListed(current, listed)[0].windows[0].usedPercent, 20);
});
