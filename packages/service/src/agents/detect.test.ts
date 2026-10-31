import assert from "node:assert/strict";
import {
  access,
  chmod,
  mkdir,
  mkdtemp,
  readdir,
  rm,
  stat,
  symlink,
  writeFile,
} from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { test } from "node:test";
import { createFakeCliDir } from "../testing/fake-clis.ts";
import { agentCatalog } from "./catalog.ts";
import { type AgentDetectionFs, detectAgents } from "./detect.ts";

test("detecção respeita a ordem do PATH e exige arquivo executável", async (context) => {
  const firstDirectory = await createFakeCliDir(["claude"]);
  const secondDirectory = await createFakeCliDir(["claude"]);
  const homeDir = await mkdtemp(path.join(os.tmpdir(), "karont-agent-home-"));
  context.after(async () => {
    await Promise.all([
      rm(firstDirectory, { recursive: true }),
      rm(secondDirectory, { recursive: true }),
      rm(homeDir, { recursive: true }),
    ]);
  });

  const ignoredFile = path.join(firstDirectory, "codex");
  await writeFile(ignoredFile, "#!/bin/sh\nexit 0\n", { mode: 0o644 });
  await chmod(ignoredFile, 0o644);
  await mkdir(path.join(firstDirectory, "gemini"));

  const agents = await detectAgents({
    env: { PATH: [firstDirectory, secondDirectory].join(path.delimiter) },
    homeDir,
    platform: process.platform,
    fs: tempFs([firstDirectory, secondDirectory, homeDir]),
  });
  assert.deepEqual(
    agents.find((agent) => agent.id === "claude"),
    {
      id: "claude",
      name: "Claude Code",
      structured: true,
      found: true,
      path: path.join(firstDirectory, "claude"),
    },
  );
  assert.equal(agents.find((agent) => agent.id === "codex")?.found, false);
  assert.equal(agents.find((agent) => agent.id === "gemini")?.found, false);
});

test("detecção procura em ~/.local/bin", async (context) => {
  const homeDir = await mkdtemp(path.join(os.tmpdir(), "karont-agent-home-"));
  context.after(() => rm(homeDir, { recursive: true }));
  const localBin = path.join(homeDir, ".local", "bin");
  await mkdir(localBin, { recursive: true });
  await writeExecutable(path.join(localBin, "claude"));

  const agents = await detectAgents({
    env: { PATH: "" },
    homeDir,
    platform: process.platform,
    fs: tempFs([homeDir]),
  });
  assert.equal(agents.find((agent) => agent.id === "claude")?.path, path.join(localBin, "claude"));
});

test("dentro de ~/.claude/local só consulta o binário claude e não lista a pasta", async (context) => {
  const homeDir = await mkdtemp(path.join(os.tmpdir(), "karont-agent-home-"));
  context.after(() => rm(homeDir, { recursive: true }));
  const claudeLocal = path.join(homeDir, ".claude", "local");
  await mkdir(claudeLocal, { recursive: true });
  await writeExecutable(path.join(claudeLocal, "claude"));
  await writeExecutable(path.join(claudeLocal, "codex"));
  const checkedPaths: { access: string[]; readdir: string[] } = { access: [], readdir: [] };

  const agents = await detectAgents({
    env: { PATH: "" },
    homeDir,
    platform: process.platform,
    fs: tempFs([homeDir], checkedPaths),
  });
  assert.equal(
    agents.find((agent) => agent.id === "claude")?.path,
    path.join(claudeLocal, "claude"),
  );
  assert.equal(agents.find((agent) => agent.id === "codex")?.found, false);
  assert.equal(checkedPaths.access.includes(path.join(claudeLocal, "codex")), false);
  assert.equal(
    checkedPaths.readdir.some((directory) => directory.startsWith(path.join(homeDir, ".claude"))),
    false,
  );
});

test("detecção procura versões do NVM em ordem decrescente", async (context) => {
  const homeDir = await mkdtemp(path.join(os.tmpdir(), "karont-agent-home-"));
  context.after(() => rm(homeDir, { recursive: true }));
  const oldBin = path.join(homeDir, ".nvm", "versions", "node", "v20.9.0", "bin");
  const currentBin = path.join(homeDir, ".nvm", "versions", "node", "v24.1.0", "bin");
  await mkdir(oldBin, { recursive: true });
  await mkdir(currentBin, { recursive: true });
  await writeExecutable(path.join(oldBin, "codex"));
  await writeExecutable(path.join(currentBin, "codex"));

  const agents = await detectAgents({
    env: { PATH: "" },
    homeDir,
    platform: process.platform,
    fs: tempFs([homeDir]),
  });
  assert.equal(agents.find((agent) => agent.id === "codex")?.path, path.join(currentBin, "codex"));
});

test("symlink para arquivo executável conta como CLI instalada", async (context) => {
  const directory = await createFakeCliDir(["claude-real"]);
  const homeDir = await mkdtemp(path.join(os.tmpdir(), "karont-agent-home-"));
  context.after(async () => {
    await Promise.all([rm(directory, { recursive: true }), rm(homeDir, { recursive: true })]);
  });
  await symlink(path.join(directory, "claude-real"), path.join(directory, "claude"));

  const agents = await detectAgents({
    env: { PATH: directory },
    homeDir,
    platform: process.platform,
    fs: tempFs([directory, homeDir]),
  });
  assert.equal(agents.find((agent) => agent.id === "claude")?.path, path.join(directory, "claude"));
});

test("desligar detecção não consulta o filesystem", async () => {
  let calls = 0;
  const failingFs: AgentDetectionFs = {
    access: async () => {
      calls += 1;
      throw new Error("Não deveria consultar access");
    },
    stat: async () => {
      calls += 1;
      throw new Error("Não deveria consultar stat");
    },
    readdir: async () => {
      calls += 1;
      throw new Error("Não deveria consultar readdir");
    },
  };
  const agents = await detectAgents({
    env: { KARONT_DISABLE_AGENT_DETECTION: "1" },
    homeDir: "/home/test-user",
    platform: "linux",
    fs: failingFs,
  });
  assert.equal(calls, 0);
  assert.deepEqual(
    agents.map(({ id, found }) => ({ id, found })),
    agentCatalog.map(({ id }) => ({ id, found: false })),
  );
});

async function writeExecutable(filePath: string): Promise<void> {
  await writeFile(filePath, "#!/bin/sh\nexit 0\n", { mode: 0o755 });
  await chmod(filePath, 0o755);
}

function tempFs(
  allowedRoots: string[],
  trackedPaths?: { access: string[]; readdir: string[] },
): AgentDetectionFs {
  const roots = allowedRoots.map((root) => path.resolve(root));
  const assertTemporaryPath = (filePath: string): void => {
    const resolvedPath = path.resolve(filePath);
    if (
      !roots.some((root) => {
        const relativePath = path.relative(root, resolvedPath);
        return (
          relativePath === "" ||
          (!relativePath.startsWith(`..${path.sep}`) && relativePath !== "..")
        );
      })
    ) {
      throw new Error("O teste bloqueou um caminho fora das pastas temporárias.");
    }
  };
  return {
    access: async (filePath, mode) => {
      assertTemporaryPath(filePath);
      trackedPaths?.access.push(path.resolve(filePath));
      await access(filePath, mode);
    },
    stat: async (filePath) => {
      assertTemporaryPath(filePath);
      return stat(filePath);
    },
    readdir: async (directoryPath) => {
      assertTemporaryPath(directoryPath);
      trackedPaths?.readdir.push(path.resolve(directoryPath));
      return readdir(directoryPath);
    },
  };
}
