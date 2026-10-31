import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { test } from "node:test";
import { openDatabase } from "../db.ts";
import type { AgentDetectionFs } from "./detect.ts";
import { AgentRegistry } from "./registry.ts";

test("sete list simultâneos compartilham uma única detecção", async (context) => {
  const root = await mkdtemp(path.join(os.tmpdir(), "karont-agent-registry-"));
  context.after(() => rm(root, { recursive: true, force: true }));
  const db = openDatabase(path.join(root, "karont.db"));
  context.after(() => db.close());

  let readdirCalls = 0;
  let accessCalls = 0;
  let releaseReaddir: (() => void) | undefined;
  const readdirGate = new Promise<void>((resolve) => {
    releaseReaddir = resolve;
  });
  const fs: AgentDetectionFs = {
    access: async () => {
      accessCalls += 1;
      throw new Error("arquivo ausente");
    },
    stat: async () => {
      throw new Error("arquivo ausente");
    },
    readdir: async () => {
      readdirCalls += 1;
      await readdirGate;
      throw new Error("NVM ausente");
    },
  };
  const registry = new AgentRegistry(db, {
    env: { PATH: "/bin" },
    homeDir: root,
    platform: "linux",
    fs,
  });

  const results = Array.from({ length: 7 }, () => registry.list());
  await waitUntil(() => readdirCalls === 1);
  releaseReaddir?.();
  await Promise.all(results);

  assert.equal(readdirCalls, 1);
  assert.ok(accessCalls > 0);
});

async function waitUntil(condition: () => boolean): Promise<void> {
  const deadline = Date.now() + 2_000;
  while (!condition() && Date.now() < deadline) {
    await new Promise<void>((resolve) => setTimeout(resolve, 5));
  }
  assert.equal(condition(), true);
}
