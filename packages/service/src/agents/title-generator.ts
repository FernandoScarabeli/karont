import { type ChildProcess, spawn as nodeSpawn } from "node:child_process";
import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { resolveAgentCommand } from "./detect.ts";

const DEFAULT_TIMEOUT_MS = 30_000;
const MAX_TITLE_OUTPUT = 4_096;
const TITLE_RESPONSE_LENGTH = 1_200;
const CODEX_TITLE_MODEL = "gpt-5.1-codex-mini";

type SpawnFunction = typeof nodeSpawn;
export type TitleGeneratorOptions = {
  env?: NodeJS.ProcessEnv;
  timeoutMs?: number;
  spawn?: SpawnFunction;
  homeDir?: string;
  platform?: NodeJS.Platform;
};

export async function generateConversationTitle(
  agent: "claude" | "codex",
  userMessage: string,
  agentResponse: string,
  options: TitleGeneratorOptions = {},
): Promise<string | null> {
  const env = options.env ?? process.env;
  const spawn = options.spawn ?? nodeSpawn;
  const homeDir = options.homeDir ?? os.homedir();
  const platform = options.platform ?? process.platform;
  const executable =
    env[agent === "claude" ? "KARONT_CLAUDE_CLI" : "KARONT_CODEX_CLI"] ||
    (await resolveAgentCommand(agent, { env, homeDir, platform }));
  if (!executable) return null;

  let workingDirectory: string | undefined;
  try {
    workingDirectory = await mkdtemp(path.join(os.tmpdir(), "karont-title-"));
    const prompt = buildTitlePrompt(userMessage, agentResponse);
    const args = buildTitleArgs(agent, workingDirectory, prompt);
    return await runTitleCommand(executable, args, workingDirectory, env, spawn, options.timeoutMs);
  } catch {
    return null;
  } finally {
    if (workingDirectory)
      await rm(workingDirectory, { recursive: true, force: true }).catch(() => {});
  }
}

export function buildTitlePrompt(userMessage: string, agentResponse: string): string {
  return [
    "Dê um título curto para esta conversa: 3 a 6 palavras, em português do Brasil, sem ponto final.",
    "Responda somente com o título.",
    "Primeira mensagem do usuário:",
    userMessage.slice(0, 1_000),
    "Começo da resposta do agente:",
    agentResponse.slice(0, TITLE_RESPONSE_LENGTH),
  ].join("\n\n");
}

export function buildTitleArgs(
  agent: "claude" | "codex",
  workingDirectory: string,
  prompt: string,
): string[] {
  if (agent === "claude") {
    return [
      "-p",
      "--model",
      "haiku",
      "--effort",
      "low",
      "--tools",
      "",
      "--disable-slash-commands",
      "--output-format",
      "text",
      prompt,
    ];
  }
  return [
    "exec",
    "--ephemeral",
    "--ignore-user-config",
    "--skip-git-repo-check",
    "--sandbox",
    "read-only",
    "--cd",
    workingDirectory,
    "--model",
    CODEX_TITLE_MODEL,
    "--config",
    'model_reasoning_effort="low"',
    "--color",
    "never",
    prompt,
  ];
}

async function runTitleCommand(
  executable: string,
  args: string[],
  cwd: string,
  env: NodeJS.ProcessEnv,
  spawn: SpawnFunction,
  timeoutMs = DEFAULT_TIMEOUT_MS,
): Promise<string | null> {
  return new Promise((resolve) => {
    let child: ChildProcess;
    try {
      child = spawn(executable, args, {
        cwd,
        env,
        stdio: ["ignore", "pipe", "pipe"],
      });
    } catch {
      resolve(null);
      return;
    }

    let output = "";
    let settled = false;
    const finish = (title: string | null) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      resolve(title);
    };
    const timer = setTimeout(
      () => {
        child.kill("SIGKILL");
        finish(null);
      },
      Math.max(1, timeoutMs),
    );
    timer.unref?.();

    child.stdout?.setEncoding("utf8");
    child.stdout?.on("data", (chunk: string) => {
      if (output.length >= MAX_TITLE_OUTPUT) return;
      output += chunk.slice(0, MAX_TITLE_OUTPUT - output.length);
    });
    child.stderr?.on("data", () => undefined);
    child.once("error", () => finish(null));
    child.once("close", (code) => {
      finish(code === 0 ? parseTitle(output) : null);
    });
  });
}

function parseTitle(output: string): string | null {
  const title = output
    .split(/\r?\n/)
    .map((line) => line.trim())
    .find(Boolean)
    ?.replace(/^["'“”]+|["'“”]+$/g, "")
    .replace(/[.\s]+$/u, "")
    .trim();
  if (!title || /[\p{Cc}]/u.test(title)) return null;
  const words = title.split(/\s+/u);
  return words.length >= 3 && words.length <= 6 ? title.slice(0, 240) : null;
}
