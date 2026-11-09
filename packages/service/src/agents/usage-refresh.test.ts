import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { after, test } from "node:test";
import type { AgentUsage, AnyEvent, UsageWindow } from "@karont/contract";
import { openDatabase } from "../db.ts";
import type { AgentAdapterRegistration, UsageReadOptions } from "./adapter.ts";
import { readStoredUsage } from "./usage.ts";
import { UsageRefresher } from "./usage-refresh.ts";

const tempRoot = mkdtempSync(path.join(os.tmpdir(), "karont-usage-refresh-"));
after(() => rmSync(tempRoot, { recursive: true, force: true }));
let tempDatabases = 0;
const openTempDatabase = () => openDatabase(path.join(tempRoot, `${++tempDatabases}.db`));

type Reader = (options: UsageReadOptions) => Promise<UsageWindow[]>;

const window = (percent: number): UsageWindow => ({
  id: "five_hour",
  usedPercent: percent,
  resetsAt: null,
});

function setup(readers: Record<string, Reader | undefined>, found = Object.keys(readers)) {
  const db = openTempDatabase();
  const events: AnyEvent[] = [];
  const clock = { now: Date.parse("2026-11-09T12:00:00.000Z") };
  const registrations = new Map(
    Object.entries(readers).map(([agent, readUsage]) => [
      agent,
      { readUsage } as unknown as AgentAdapterRegistration,
    ]),
  );
  const refresher = new UsageRefresher({
    db,
    dataDir: tempRoot,
    foundAgents: async () => found,
    registrations: () => registrations,
    emit: async (event) => void events.push(event),
    list: () => Object.keys(readers).flatMap((agent) => readStoredUsage(db, agent) ?? []),
    now: () => clock.now,
  });
  return { db, events, clock, refresher };
}

test("lê um agente por vez, grava e publica usage.updated", async () => {
  let running = 0;
  let maxRunning = 0;
  const order: string[] = [];
  const reader =
    (agent: string, percent: number): Reader =>
    async () => {
      running++;
      maxRunning = Math.max(maxRunning, running);
      order.push(agent);
      await new Promise((resolve) => setTimeout(resolve, 5));
      running--;
      return [window(percent)];
    };
  const { events, refresher, db } = setup({
    claude: reader("claude", 10),
    codex: reader("codex", 20),
  });
  const usage = await refresher.refresh();
  assert.equal(maxRunning, 1);
  assert.deepEqual(order, ["claude", "codex"]);
  assert.deepEqual(
    usage.map((item: AgentUsage) => [item.agent, item.windows[0]?.usedPercent]),
    [
      ["claude", 10],
      ["codex", 20],
    ],
  );
  assert.deepEqual(
    events.map((event) => event.event),
    ["usage.updated", "usage.updated"],
  );
  db.close();
});

test("chamada durante outra devolve a mesma promessa", async () => {
  let calls = 0;
  const { refresher, db } = setup({
    claude: async () => {
      calls++;
      await new Promise((resolve) => setTimeout(resolve, 10));
      return [window(5)];
    },
  });
  const first = refresher.refresh();
  const second = refresher.refresh({ force: true });
  assert.equal(first, second);
  await first;
  assert.equal(calls, 1);
  db.close();
});

test("sem force espera 120 s; com force, 5 s", async () => {
  let calls = 0;
  const { refresher, clock, db } = setup({
    claude: async () => {
      calls++;
      return [window(calls)];
    },
  });
  await refresher.refresh();
  assert.equal(calls, 1);
  clock.now += 119_000;
  const cached = await refresher.refresh();
  assert.equal(calls, 1);
  assert.equal(cached[0]?.windows[0]?.usedPercent, 1);
  clock.now = clock.now - 119_000 + 4_000;
  await refresher.refresh({ force: true });
  assert.equal(calls, 1);
  clock.now += 2_000;
  await refresher.refresh({ force: true });
  assert.equal(calls, 2);
  clock.now += 119_000;
  await refresher.refresh();
  assert.equal(calls, 2);
  clock.now += 2_000;
  await refresher.refresh();
  assert.equal(calls, 3);
  db.close();
});

test("só lê agentes encontrados e com leitor", async () => {
  const called: string[] = [];
  const { refresher, db } = setup(
    {
      claude: async () => {
        called.push("claude");
        return [window(1)];
      },
      codex: async () => {
        called.push("codex");
        return [window(2)];
      },
      outro: undefined,
    },
    ["codex", "outro"],
  );
  await refresher.refresh();
  assert.deepEqual(called, ["codex"]);
  db.close();
});

test("falha em um não impede o outro nem apaga o valor guardado", async () => {
  let claudeFails = false;
  const { refresher, db, clock } = setup({
    claude: async () => {
      if (claudeFails) throw new Error("quebrou");
      return [window(30)];
    },
    codex: async () => [window(40)],
  });
  await refresher.refresh();
  claudeFails = true;
  clock.now += 200_000;
  const usage = await refresher.refresh();
  assert.deepEqual(
    usage.map((item) => [item.agent, item.windows[0]?.usedPercent]),
    [
      ["claude", 30],
      ["codex", 40],
    ],
  );
  db.close();
});

test("leitura vazia mantém o valor guardado e não publica", async () => {
  let empty = false;
  const { refresher, db, clock, events } = setup({
    claude: async () => (empty ? [] : [window(30)]),
  });
  await refresher.refresh();
  empty = true;
  clock.now += 200_000;
  const usage = await refresher.refresh();
  assert.equal(usage[0]?.windows[0]?.usedPercent, 30);
  assert.equal(events.length, 1);
  db.close();
});

test("dispose aborta a leitura em curso e depois não abre outra", async () => {
  let aborted = false;
  let calls = 0;
  const { refresher, db } = setup({
    claude: ({ signal }) => {
      calls++;
      return new Promise<UsageWindow[]>((resolve) => {
        signal?.addEventListener("abort", () => {
          aborted = true;
          resolve([]);
        });
      });
    },
  });
  const pending = refresher.refresh();
  await new Promise((resolve) => setTimeout(resolve, 5));
  await refresher.dispose();
  await pending;
  assert.equal(aborted, true);
  await refresher.refresh({ force: true });
  assert.equal(calls, 1);
  db.close();
});
