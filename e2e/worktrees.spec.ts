import { execFile } from "node:child_process";
import { chmod, mkdir, mkdtemp, readFile, rm, stat, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { promisify } from "node:util";
import { type ElectronApplication, _electron as electron, expect, test } from "@playwright/test";

const run = promisify(execFile);
const mainEntry = path.resolve("packages/desktop/dist/main.js");

type Reply = { ok: boolean; result?: Record<string, unknown>; error?: { message: string } };
type NativeWindow = { karontNative: { request: (m: string, p: unknown) => Promise<Reply> } };

/**
 * Imita o protocolo `stream-json` do Claude Code (ver `PROTOCOLO.md`). Se a mensagem
 * contiver "espere", o turno nunca termina. Se contiver "mexa", cria `novo.txt` e muda a
 * linha 2 de `a.txt`; se contiver "conflito", muda a linha 3 de `a.txt`. Sempre sem commit.
 */
const FAKE_CLAUDE = `#!/usr/bin/env node
const fs = require("node:fs");
const readline = require("node:readline");
const args = process.argv.slice(2);
const flag = (name) => args[args.indexOf(name) + 1];
const sessionId = flag("--session-id") || flag("--resume") || "00000000-0000-4000-8000-000000000001";
const send = (value) => process.stdout.write(JSON.stringify(value) + "\\n");
let turn = 0;

function replaceLine(file, line, text) {
  const lines = fs.readFileSync(file, "utf8").split("\\n");
  lines[line - 1] = text;
  fs.writeFileSync(file, lines.join("\\n"));
}

readline.createInterface({ input: process.stdin }).on("line", (line) => {
  let value;
  try {
    value = JSON.parse(line);
  } catch {
    return;
  }
  if (value.type === "control_request") {
    send({
      type: "control_response",
      response: { subtype: "success", request_id: value.request_id, response: { commands: [], models: [] } },
    });
    return;
  }
  if (value.type !== "user") return;
  turn += 1;
  const content = value.message.content;
  const text = typeof content === "string" ? content : JSON.stringify(content);
  send({ type: "system", subtype: "init", cwd: process.cwd(), session_id: sessionId, tools: [] });
  if (text.includes("espere")) return;
  if (text.includes("mexa")) {
    fs.writeFileSync("novo.txt", "linha nova\\n");
    replaceLine("a.txt", 2, "linha 2 do agente");
  }
  if (text.includes("conflito")) replaceLine("a.txt", 3, "linha 3 do agente");
  const reply = "Recebi: " + text;
  send({ type: "stream_event", session_id: sessionId, parent_tool_use_id: null, event: { type: "content_block_start", index: 0, content_block: { type: "text", text: "" } } });
  send({ type: "stream_event", session_id: sessionId, parent_tool_use_id: null, event: { type: "content_block_delta", index: 0, delta: { type: "text_delta", text: reply } } });
  send({ type: "assistant", session_id: sessionId, parent_tool_use_id: null, message: { id: "msg_" + turn, type: "message", role: "assistant", model: "claude-fake", content: [{ type: "text", text: reply }], usage: {} } });
  send({ type: "stream_event", session_id: sessionId, parent_tool_use_id: null, event: { type: "content_block_stop", index: 0 } });
  send({ type: "result", subtype: "success", is_error: false, session_id: sessionId, stop_reason: "end_turn", terminal_reason: "completed", permission_denials: [] });
});
`;

async function git(cwd: string, ...args: string[]) {
  const { stdout } = await run(
    "git",
    ["-c", "user.name=Teste", "-c", "user.email=teste@example.com", ...args],
    { cwd },
  );
  return stdout;
}

async function exists(file: string) {
  return stat(file).then(
    () => true,
    () => false,
  );
}

test("cópia separada: oferecer, trabalhar, trazer de volta, conflito e remover", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "kcopia-"));
  const repo = path.join(root, "repo");
  const home = path.join(root, "home");
  const bin = path.join(root, "bin");
  const fakeCli = path.join(bin, "claude");
  const env: Record<string, string> = {
    ...(process.env as Record<string, string>),
    HOME: home,
    PATH: `${bin}${path.delimiter}${process.env.PATH ?? ""}`,
    KARONT_RUNTIME_DIR: path.join(root, "run"),
    KARONT_SKIP_ONBOARDING: "1",
    KARONT_DATA_DIR: path.join(root, "data"),
    KARONT_CLAUDE_CLI: fakeCli,
  };
  let app: ElectronApplication | undefined;
  let servicePid: number | undefined;
  let request: ((method: string, params: unknown) => Promise<Reply>) | undefined;

  try {
    await mkdir(repo, { recursive: true });
    await mkdir(home, { recursive: true });
    await mkdir(bin, { recursive: true });
    await writeFile(fakeCli, FAKE_CLAUDE);
    await chmod(fakeCli, 0o755);

    await git(repo, "init", "-q", "-b", "main");
    await writeFile(path.join(repo, "a.txt"), "linha 1\nlinha 2\nlinha 3\n");
    await git(repo, "add", "-A");
    await git(repo, "commit", "-q", "-m", "inicial");
    const initialHead = (await git(repo, "rev-parse", "HEAD")).trim();

    app = await electron.launch({ args: [mainEntry], env, chromiumSandbox: true });
    const window = await app.firstWindow();
    await expect(window.getByText("Serviço conectado")).toBeVisible();
    const call = (method: string, params: unknown) =>
      window.evaluate(
        ([m, p]) => (globalThis as unknown as NativeWindow).karontNative.request(m as string, p),
        [method, params] as const,
      );
    request = call;
    servicePid = (await call("system.info", {})).result?.pid as number;

    const created = await call("projects.create", {
      name: "Projeto Cópias",
      icon: "folder",
      defaultAgent: "claude",
      path: repo,
    });
    expect(created.ok).toBe(true);
    const projectId = (created.result?.project as { id: string } | undefined)?.id ?? "";

    // Primeira conversa: ocupada na pasta do projeto (o turno nunca termina).
    const first = await call("conversation.create", {
      agent: "claude",
      cwd: repo,
      projectId,
      title: "Primeira",
    });
    expect(first.ok).toBe(true);
    const firstId = (first.result?.conversation as { id: string } | undefined)?.id ?? "";
    void call("conversation.send", { id: firstId, text: "espere" }).catch(() => undefined);
    const queueStatus = async () => (await call("queue.status", {})).result;
    await expect.poll(queueStatus).toMatchObject({ running: 1 });

    // O serviço não emite evento ao criar pela ponte: recarrega para ler a lista.
    await window.reload();
    await expect(window.getByText("Serviço conectado")).toBeVisible();
    const navigation = window.getByRole("navigation", { name: "Navegação principal" });
    await expect(
      navigation.getByRole("button", { name: "Primeira", exact: true }),
    ).toHaveAccessibleDescription(/Trabalhando/);

    // Nova conversa no projeto: a mensagem para e oferece a cópia separada.
    await navigation.getByRole("button", { name: "Projeto Cópias", exact: true }).hover();
    await navigation.getByRole("button", { name: "Nova conversa em Projeto Cópias" }).click();
    await expect(window.getByText("main", { exact: true })).toBeVisible();
    const composer = window.locator("textarea").first();
    await composer.fill("mexa nos arquivos");
    await expect(window.getByRole("button", { name: "Enviar mensagem" })).toBeEnabled();
    await composer.press("Enter");
    const offer = window.getByRole("dialog", { name: "Este projeto já tem um agente trabalhando" });
    await expect(offer).toBeVisible();
    await expect(offer).toContainText(
      "Dois agentes na mesma pasta podem alterar os mesmos arquivos.",
    );
    await expect(offer).toContainText("A cópia começa do último commit.");
    await expect(offer.getByRole("button", { name: "Usar cópia separada" })).toBeFocused();
    await expect(offer.getByRole("button", { name: "Continuar na mesma pasta" })).toBeVisible();

    // Cancelar mantém o texto no composer e não cria nada.
    await offer.getByRole("button", { name: "Cancelar" }).click();
    await expect(offer).toBeHidden();
    await expect(composer).toHaveValue("mexa nos arquivos");
    expect((await call("worktrees.list", { projectId })).result?.worktrees).toEqual([]);

    await composer.press("Enter");
    await expect(offer).toBeVisible();
    await offer.getByRole("button", { name: "Usar cópia separada" }).click();

    // A conversa abre na cópia; os arquivos mudaram só lá.
    const stripLabelText = "Cópia separada · ";
    const stripLabel = window.getByText(/^Cópia separada · /);
    await expect(stripLabel).toBeVisible();
    await expect(window.getByText("Recebi: mexa nos arquivos")).toBeVisible();
    const listed = (await call("worktrees.list", { projectId })).result?.worktrees as {
      id: string;
      path: string;
      branch: string;
    }[];
    expect(listed).toHaveLength(1);
    const copy = listed[0] as { id: string; path: string; branch: string };
    await expect(
      window.getByTitle(copy.branch, { exact: true }).filter({ hasText: stripLabelText }),
    ).toBeVisible();
    expect(await readFile(path.join(copy.path, "novo.txt"), "utf8")).toBe("linha nova\n");
    expect(await readFile(path.join(copy.path, "a.txt"), "utf8")).toContain("linha 2 do agente");
    expect(await exists(path.join(repo, "novo.txt"))).toBe(false);
    expect(await readFile(path.join(repo, "a.txt"), "utf8")).toBe("linha 1\nlinha 2\nlinha 3\n");
    expect(await git(repo, "status", "--porcelain")).toBe("");
    const copyRow = navigation
      .getByRole("list", { name: "Conversas de Projeto Cópias" })
      .getByRole("button", { name: "Nova conversa", exact: true });
    await expect(copyRow).toHaveAccessibleDescription(/Em cópia separada/);
    await expect(copyRow).toHaveAttribute("title", /Em cópia separada/);

    // Com a primeira conversa ainda ocupada, trazer mostra o bloqueio.
    const bringBack = window.getByRole("button", { name: "Trazer de volta", exact: true });
    await bringBack.click();
    // Bloqueada antes de ler a branch do projeto: o título não tem destino.
    const blocked = window.getByRole("dialog", { name: "Trazer de volta", exact: true });
    await expect(blocked).toContainText(
      "Há um agente trabalhando na pasta do projeto. Espere terminar.",
    );
    await expect(blocked.getByRole("button", { name: "Trazer", exact: true })).toHaveCount(0);
    await blocked.getByRole("button", { name: "Fechar" }).click();
    await expect(blocked).toBeHidden();
    await expect(bringBack).toBeFocused();

    // Parou a primeira: trazer funciona e os arquivos chegam na branch do projeto.
    await call("conversation.stop", { id: firstId });
    await expect.poll(queueStatus).toMatchObject({ running: 0 });
    await expect(
      navigation.getByRole("button", { name: "Primeira", exact: true }),
    ).not.toHaveAccessibleDescription(/Trabalhando/);
    await bringBack.click();
    const confirm = window.getByRole("dialog", { name: "Trazer de volta para main?" });
    await expect(confirm).toContainText("2 arquivos chegam em main.");
    await expect(confirm).toContainText(
      "2 arquivos ainda não salvos viram um commit na branch da cópia.",
    );
    await confirm.getByRole("button", { name: "Trazer", exact: true }).click();
    await expect(confirm).toBeHidden();
    await expect(
      window.getByRole("status").filter({ hasText: "Trazido para main." }),
    ).toBeVisible();
    expect(await readFile(path.join(repo, "novo.txt"), "utf8")).toBe("linha nova\n");
    expect(await readFile(path.join(repo, "a.txt"), "utf8")).toContain("linha 2 do agente");
    expect(await git(repo, "status", "--porcelain")).toBe("");
    expect((await git(repo, "branch", "--show-current")).trim()).toBe("main");
    const mergedHead = (await git(repo, "rev-parse", "HEAD")).trim();
    expect(mergedHead).not.toBe(initialHead);

    // Conflito: o mesmo arquivo muda nos dois lados.
    const second = (await call("worktrees.create", { projectId })).result?.worktree as {
      id: string;
      path: string;
    };
    const conflicting = await call("conversation.create", {
      agent: "claude",
      cwd: second.path,
      projectId,
      worktreeId: second.id,
      title: "Segunda",
    });
    expect(conflicting.ok).toBe(true);
    const secondId = (conflicting.result?.conversation as { id: string } | undefined)?.id ?? "";
    expect((await call("conversation.send", { id: secondId, text: "conflito" })).ok).toBe(true);
    await writeFile(path.join(repo, "a.txt"), "linha 1\nlinha 2 do agente\nlinha 3 do projeto\n");
    await git(repo, "commit", "-q", "-am", "mudança no projeto");
    const projectHead = (await git(repo, "rev-parse", "HEAD")).trim();

    await window.reload();
    await expect(window.getByText("Serviço conectado")).toBeVisible();
    const secondRow = navigation.getByRole("button", { name: "Segunda", exact: true });
    await expect(secondRow).toHaveAttribute("title", /Em cópia separada/);
    await secondRow.click();
    await expect(window.getByText(/^Cópia separada · /)).toBeVisible();
    await window.getByRole("button", { name: "Trazer de volta", exact: true }).click();
    const conflictDialog = window.getByRole("dialog", { name: "Trazer de volta para main?" });
    await expect(conflictDialog).toContainText(
      "Estes arquivos têm conflito com main. O Karont não resolve conflitos sozinho.",
    );
    await expect(conflictDialog.getByRole("list", { name: "Arquivos em conflito" })).toContainText(
      "a.txt",
    );
    await expect(conflictDialog.getByRole("button", { name: "Trazer", exact: true })).toHaveCount(
      0,
    );
    await conflictDialog.getByRole("button", { name: "Fechar" }).click();
    await expect(conflictDialog).toBeHidden();
    expect((await git(repo, "rev-parse", "HEAD")).trim()).toBe(projectHead);
    expect(await git(repo, "status", "--porcelain")).toBe("");
    expect(await readFile(path.join(repo, "a.txt"), "utf8")).toBe(
      "linha 1\nlinha 2 do agente\nlinha 3 do projeto\n",
    );

    // Remover o projeto avisa que as cópias continuam no disco.
    const projectRow = navigation.getByRole("button", { name: "Projeto Cópias", exact: true });
    await projectRow.hover();
    await navigation.getByRole("button", { name: "Ações de Projeto Cópias" }).click();
    await window.getByRole("menuitem", { name: "Remover" }).click();
    const removeProject = window.getByRole("dialog", { name: "Remover Projeto Cópias?" });
    await expect(removeProject).toContainText("As cópias separadas continuam no disco.");
    await removeProject.getByRole("button", { name: "Cancelar" }).click();
    await expect(removeProject).toBeHidden();

    // Remover a cópia avisa do que seria perdido, remove e a pasta some.
    await window.getByRole("button", { name: "Remover cópia", exact: true }).click();
    const removeCopy = window.getByRole("dialog", { name: "Remover esta cópia?" });
    await expect(removeCopy).toContainText("A pasta da cópia será apagada.");
    await expect(removeCopy).toContainText("1 arquivo com mudanças não salvas será perdido.");
    await expect(removeCopy.getByRole("button", { name: "Cancelar" })).toBeFocused();
    await removeCopy.getByRole("button", { name: "Remover cópia" }).click();
    await expect(removeCopy).toBeHidden();
    await expect(window.getByText(/^Cópia separada · /)).toHaveCount(0);
    expect(await exists(second.path)).toBe(false);
    await expect(secondRow).not.toHaveAttribute("title", /Em cópia separada/);
    expect(await git(repo, "status", "--porcelain")).toBe("");
  } finally {
    try {
      const all = await request?.("conversation.list", { archived: false, limit: 500 });
      for (const item of (all?.result?.conversations ?? []) as { id: string }[]) {
        await request?.("conversation.stop", { id: item.id }).catch(() => undefined);
      }
    } catch {
      // a janela pode já ter fechado
    }
    await app?.close().catch(() => undefined);
    if (servicePid) {
      try {
        process.kill(servicePid, "SIGTERM");
      } catch {
        // já saiu
      }
    }
    await rm(root, { recursive: true, force: true });
  }
});
