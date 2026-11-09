import { execFile } from "node:child_process";
import { chmod, mkdir, mkdtemp, readFile, rm, stat, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { promisify } from "node:util";
import { _electron as electron, expect, test } from "@playwright/test";

const run = promisify(execFile);
const mainEntry = path.resolve("packages/desktop/dist/main.js");

type NativeWindow = {
  karontNative: {
    request: (
      m: string,
      p: unknown,
    ) => Promise<{ ok: boolean; result?: Record<string, unknown>; error?: { message: string } }>;
  };
};

/**
 * Imita o protocolo `stream-json` do Claude Code (ver `PROTOCOLO.md`): responde ao
 * `initialize`, e a cada mensagem do usuário responde um texto e fecha o turno com
 * `result`. Se a mensagem pedir "mexa", mexe na pasta: cria, apaga, renomeia e altera.
 */
const FAKE_CLAUDE = `#!/usr/bin/env node
const fs = require("node:fs");
const readline = require("node:readline");
const args = process.argv.slice(2);
const flag = (name) => args[args.indexOf(name) + 1];
const sessionId = flag("--session-id") || flag("--resume") || "00000000-0000-4000-8000-000000000001";
const send = (value) => process.stdout.write(JSON.stringify(value) + "\\n");
let turn = 0;

function touchFiles() {
  fs.writeFileSync("novo.txt", "linha nova\\n");
  fs.rmSync("apagar.txt");
  fs.renameSync("renomear.txt", "renomeado.txt");
  fs.writeFileSync("editar.txt", "linha 1\\nlinha 2 mudada pelo agente\\nlinha 3\\n");
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
  if (text.includes("mexa")) touchFiles();
  const reply = "Recebi: " + text;
  send({ type: "system", subtype: "init", cwd: process.cwd(), session_id: sessionId, tools: [] });
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

test("mudanças: ver, avisar do que o usuário mexeu e desfazer; sem Git avisa uma vez", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "krestore-"));
  const repo = path.join(root, "repo");
  const plain = path.join(root, "sem-git");
  const fakeCli = path.join(root, "claude-falso.js");
  const env: Record<string, string> = {
    ...(process.env as Record<string, string>),
    KARONT_RUNTIME_DIR: path.join(root, "run"),
    KARONT_DATA_DIR: path.join(root, "data"),
    KARONT_DISABLE_AGENT_DETECTION: "1",
    KARONT_CLAUDE_CLI: fakeCli,
  };
  let servicePid: number | undefined;
  const conversationIds: string[] = [];
  let request:
    | ((
        method: string,
        params: unknown,
      ) => Promise<{ ok: boolean; result?: Record<string, unknown> }>)
    | undefined;

  try {
    await mkdir(repo, { recursive: true });
    await mkdir(plain, { recursive: true });
    await writeFile(fakeCli, FAKE_CLAUDE);
    await chmod(fakeCli, 0o755);

    // Repositório com os quatro tipos de mudança e um stash do usuário que não pode mudar.
    await git(repo, "init", "-q", "-b", "main");
    await writeFile(path.join(repo, "apagar.txt"), "vai embora\nsegunda linha\n");
    await writeFile(
      path.join(repo, "renomear.txt"),
      "conteúdo bem comprido para o Git reconhecer o renome\nsegunda linha\nterceira linha\n",
    );
    await writeFile(path.join(repo, "editar.txt"), "linha 1\nlinha 2\nlinha 3\n");
    await writeFile(path.join(repo, "guardado.txt"), "versão commitada\n");
    await git(repo, "add", "-A");
    await git(repo, "commit", "-q", "-m", "inicial");
    await writeFile(path.join(repo, "guardado.txt"), "versão guardada no stash\n");
    await git(repo, "stash", "push", "-q", "-m", "stash do usuário");
    const before = {
      head: await git(repo, "rev-parse", "HEAD"),
      status: await git(repo, "status", "--porcelain"),
      stash: await git(repo, "stash", "list"),
    };
    expect(before.status).toBe("");
    expect(before.stash).toContain("stash do usuário");

    const app = await electron.launch({ args: [mainEntry], env, chromiumSandbox: true });
    const window = await app.firstWindow();
    await expect(window.getByText("Serviço conectado")).toBeVisible();
    request = (method: string, params: unknown) =>
      window.evaluate(
        ([m, p]) => (globalThis as unknown as NativeWindow).karontNative.request(m as string, p),
        [method, params] as const,
      );
    servicePid = (await request("system.info", {})).result?.pid as number;

    try {
      for (const [title, cwd] of [
        ["Conversa Git", repo],
        ["Conversa sem Git", plain],
      ] as const) {
        const created = await request("conversation.create", { agent: "claude", cwd, title });
        expect(created.ok).toBe(true);
        const conversation = created.result?.conversation as { id: string } | undefined;
        expect(conversation?.id).toBeTruthy();
        conversationIds.push(conversation?.id ?? "");
      }
      // O serviço não emite evento ao criar pela ponte: recarrega para ler a lista.
      await window.reload();
      await expect(window.getByText("Serviço conectado")).toBeVisible();
      const navigation = window.getByRole("navigation", { name: "Navegação principal" });
      const composer = window.locator("textarea").first();

      // --- Pasta com Git ---
      await navigation.getByRole("button", { name: "Conversa Git", exact: true }).click();
      await composer.fill("mexa nos arquivos");
      await composer.press("Enter");
      // Criou 1, apagou 1, renomeou 1 (conta como 1) e alterou 1: 4 arquivos.
      await expect(window.getByText("4 arquivos alterados", { exact: true })).toBeVisible();

      const viewChanges = window.getByRole("button", { name: "Ver mudanças", exact: true });
      await viewChanges.click();
      const panel = window.getByRole("complementary", { name: "Mudanças desta resposta" });
      await expect(panel).toBeVisible();
      const files = panel.getByRole("list", { name: "Arquivos alterados" });
      await expect(files.getByRole("listitem")).toHaveCount(4);
      await expect(files.getByRole("button", { name: /novo\.txt.*novo/ })).toBeVisible();
      await expect(files.getByRole("button", { name: /apagar\.txt.*apagado/ })).toBeVisible();
      await expect(
        files.getByRole("button", { name: /renomear\.txt → renomeado\.txt.*renomeado/ }),
      ).toBeVisible();
      await expect(files.getByRole("button", { name: /editar\.txt.*alterado/ })).toBeVisible();
      await expect(
        panel.getByText("Arquivos ignorados pelo .gitignore não aparecem aqui."),
      ).toBeVisible();

      // O diff de um arquivo sai sob demanda.
      const editFile = files.getByRole("button", { name: /editar\.txt/ });
      await editFile.click();
      await expect(editFile).toHaveAttribute("aria-expanded", "true");
      await expect(panel.getByText("linha 2 mudada pelo agente")).toBeVisible();

      // Esc fecha o painel e o foco volta ao botão que abriu.
      await window.keyboard.press("Escape");
      await expect(panel).toBeHidden();
      await expect(viewChanges).toBeFocused();

      // O usuário mexe num arquivo da resposta; a confirmação avisa.
      await writeFile(path.join(repo, "editar.txt"), "linha 1\nlinha 2 do usuário\nlinha 3\n");
      const undo = window.getByRole("button", { name: "Desfazer", exact: true });
      await expect(undo).toBeEnabled();
      await undo.click();
      const dialog = window.getByRole("dialog", { name: "Desfazer as mudanças desta resposta?" });
      await expect(dialog).toBeVisible();
      await expect(
        dialog.getByText(
          // A mesma conta da linha de resumo: o renomeado vale 1.
          "4 arquivos voltam a como estavam antes desta mensagem. Sua branch e seu stash não mudam.",
        ),
      ).toBeVisible();
      await expect(dialog.getByText("Você alterou estes arquivos depois:")).toBeVisible();
      await expect(
        dialog.getByRole("list", { name: "Arquivos que você alterou depois" }),
      ).toContainText("editar.txt");
      await expect(
        dialog.getByText("A versão atual será substituída, mas fica guardada no Git."),
      ).toBeVisible();
      await expect(
        dialog.getByText("Arquivos ignorados pelo .gitignore não são restaurados."),
      ).toBeVisible();
      await expect(dialog.getByRole("button", { name: "Cancelar" })).toBeFocused();
      await dialog.getByRole("button", { name: "Desfazer", exact: true }).click();

      await expect(window.getByText("Mudanças desfeitas", { exact: true })).toBeVisible();
      await expect(dialog).toBeHidden();
      await expect(window.getByText("4 arquivos alterados")).toHaveCount(0);

      // No disco tudo voltou; branch, HEAD e stash são os de antes.
      expect(await exists(path.join(repo, "novo.txt"))).toBe(false);
      expect(await readFile(path.join(repo, "apagar.txt"), "utf8")).toBe(
        "vai embora\nsegunda linha\n",
      );
      expect(await exists(path.join(repo, "renomeado.txt"))).toBe(false);
      expect(await exists(path.join(repo, "renomear.txt"))).toBe(true);
      expect(await readFile(path.join(repo, "editar.txt"), "utf8")).toBe(
        "linha 1\nlinha 2\nlinha 3\n",
      );
      expect(await git(repo, "status", "--porcelain")).toBe(before.status);
      expect(await git(repo, "rev-parse", "HEAD")).toBe(before.head);
      expect(await git(repo, "stash", "list")).toBe(before.stash);
      expect((await git(repo, "branch", "--show-current")).trim()).toBe("main");

      // --- Pasta sem Git: o aviso aparece uma vez, mesmo depois de duas mensagens ---
      await navigation.getByRole("button", { name: "Conversa sem Git", exact: true }).click();
      await composer.fill("primeira");
      await composer.press("Enter");
      await expect(window.getByText("Recebi: primeira")).toBeVisible();
      const notice = window.getByText(
        "Esta pasta não usa Git, então não dá para desfazer o que o agente alterar.",
      );
      await expect(notice).toBeVisible();
      await composer.fill("segunda");
      await composer.press("Enter");
      await expect(window.getByText("Recebi: segunda")).toBeVisible();
      await expect
        .poll(async () => {
          const listed = await request?.("restore.list", { conversationId: conversationIds[1] });
          return (listed?.result?.points as unknown[] | undefined)?.length;
        })
        .toBe(2);
      await expect(notice).toHaveCount(1);
      await expect(window.getByRole("button", { name: "Desfazer", exact: true })).toHaveCount(0);
    } finally {
      for (const id of conversationIds) {
        await request?.("conversation.stop", { id }).catch(() => undefined);
      }
      await app.close();
    }
  } finally {
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
