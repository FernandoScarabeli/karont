import { chmod, mkdtemp, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import {
  type ElectronApplication,
  _electron as electron,
  expect,
  type Page,
  test,
} from "@playwright/test";

const mainEntry = path.resolve("packages/desktop/dist/main.js");

type NativeWindow = {
  karontNative: {
    request: (m: string, p: unknown) => Promise<{ ok: boolean; result?: Record<string, unknown> }>;
  };
};

const request = (window: Page, method: string, params: unknown) =>
  window.evaluate(
    ([m, p]) => (globalThis as unknown as NativeWindow).karontNative.request(m as string, p),
    [method, params] as const,
  );

/** Imita o `stream-json` do Claude Code: responde ao initialize e, a cada mensagem, devolve um texto. */
const FAKE_CLAUDE = `#!/usr/bin/env node
const readline = require("node:readline");
const args = process.argv.slice(2);
const flag = (name) => args[args.indexOf(name) + 1];
const sessionId = flag("--session-id") || flag("--resume") || "00000000-0000-4000-8000-000000000001";
const send = (value) => process.stdout.write(JSON.stringify(value) + "\\n");
let turn = 0;
readline.createInterface({ input: process.stdin }).on("line", (line) => {
  let value;
  try {
    value = JSON.parse(line);
  } catch {
    return;
  }
  if (value.type === "control_request") {
    send({ type: "control_response", response: { subtype: "success", request_id: value.request_id, response: { commands: [], models: [] } } });
    return;
  }
  if (value.type !== "user") return;
  turn += 1;
  const reply = "Resposta do agente falso";
  send({ type: "system", subtype: "init", cwd: process.cwd(), session_id: sessionId, tools: [] });
  send({ type: "stream_event", session_id: sessionId, parent_tool_use_id: null, event: { type: "content_block_start", index: 0, content_block: { type: "text", text: "" } } });
  send({ type: "stream_event", session_id: sessionId, parent_tool_use_id: null, event: { type: "content_block_delta", index: 0, delta: { type: "text_delta", text: reply } } });
  send({ type: "assistant", session_id: sessionId, parent_tool_use_id: null, message: { id: "msg_" + turn, type: "message", role: "assistant", model: "claude-fake", content: [{ type: "text", text: reply }], usage: {} } });
  send({ type: "stream_event", session_id: sessionId, parent_tool_use_id: null, event: { type: "content_block_stop", index: 0 } });
  send({ type: "result", subtype: "success", is_error: false, session_id: sessionId, stop_reason: "end_turn", terminal_reason: "completed", permission_denials: [] });
});
`;

async function launch(root: string, fakeCli?: string) {
  const app = await electron.launch({
    args: [mainEntry],
    chromiumSandbox: true,
    env: {
      ...(process.env as Record<string, string>),
      KARONT_RUNTIME_DIR: path.join(root, "run"),
      KARONT_DATA_DIR: path.join(root, "data"),
      KARONT_SKIP_ONBOARDING: "1",
      KARONT_DISABLE_AGENT_DETECTION: "1",
      ...(fakeCli ? { KARONT_CLAUDE_CLI: fakeCli } : {}),
    },
  });
  const window = await app.firstWindow();
  await expect(window.getByText("Serviço conectado")).toBeVisible();
  const pid = (await request(window, "system.info", {})).result?.pid as number;
  return { app, window, pid };
}

const sidebar = (window: Page) => window.getByRole("navigation", { name: "Navegação principal" });
const nameField = (window: Page) => window.getByRole("main").getByLabel("Nome");
const discardDialog = (window: Page) =>
  window.getByRole("dialog", { name: "Descartar alterações?" });

async function openDot(window: Page) {
  await sidebar(window).getByRole("button", { name: "Dots", exact: true }).click();
  await expect(nameField(window)).toBeVisible();
}

async function shutDown(app: ElectronApplication, pid: number | undefined) {
  await app.close().catch(() => undefined);
  if (!pid) return;
  try {
    process.kill(pid, "SIGTERM");
  } catch {
    // o serviço já saiu
  }
}

test("Dot: salvar, cor digitada, descartar na mesma seção e abrir ao lado com edição pendente", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "kdot-"));
  const { app, window, pid } = await launch(root);
  try {
    const created = await request(window, "conversation.create", {
      agent: "claude",
      cwd: root,
      title: "Conversa do Dot",
    });
    expect(created.ok).toBe(true);
    await window.reload();
    await expect(window.getByText("Serviço conectado")).toBeVisible();
    await openDot(window);

    await nameField(window).fill("Caronte");
    await window.getByRole("button", { name: "Salvar" }).click();
    await expect(window.getByText("Salvo", { exact: true })).toBeVisible();
    expect((await request(window, "dot.get", {})).result?.name).toBe("Caronte");

    // A cor digitada vale mesmo sem Enter, ao clicar fora.
    await window.getByRole("button", { name: /^Cor do Dot,/ }).click();
    await window.getByLabel("Cor em hexadecimal").fill("#ff0000");
    await window.getByRole("heading", { name: "Dots", exact: true }).click();
    await expect(window.getByRole("button", { name: "Cor do Dot, #ff0000" })).toBeVisible();
    await window.getByRole("button", { name: "Cancelar" }).click();

    // Descartar na própria seção volta o campo, e a proteção segue valendo para a próxima edição.
    await nameField(window).fill("Rascunho");
    await sidebar(window).getByRole("button", { name: "Dots", exact: true }).click();
    await discardDialog(window).getByRole("button", { name: "Descartar" }).click();
    await expect(nameField(window)).toHaveValue("Caronte");
    await nameField(window).fill("Outro rascunho");
    await sidebar(window).getByRole("button", { name: "Caixa de entrada" }).click();
    await expect(discardDialog(window)).toBeVisible();
    await discardDialog(window).getByRole("button", { name: "Continuar editando" }).click();

    // Abrir ao lado espera a confirmação, sem acusar limite de painéis.
    await sidebar(window)
      .getByRole("button", { name: "Conversa do Dot", exact: true })
      .click({ button: "right" });
    await window.getByRole("menuitem", { name: "Abrir ao lado" }).click();
    await expect(discardDialog(window)).toBeVisible();
    await expect(window.getByText("O limite de seis painéis foi atingido.")).toHaveCount(0);
  } finally {
    await shutDown(app, pid);
    await rm(root, { recursive: true, force: true });
  }
});

test("Dot: Fechar tudo encerra o app mesmo com edição pendente", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "kdot-close-"));
  const { app, window, pid } = await launch(root);
  let exited = false;
  app.process().once("exit", () => {
    exited = true;
  });
  try {
    await openDot(window);
    await nameField(window).fill("Sem salvar");
    await app.evaluate(({ dialog }) => {
      dialog.showMessageBox = (async () => ({
        response: 1,
        checkboxChecked: false,
      })) as typeof dialog.showMessageBox;
    });
    await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0]?.close());
    await expect.poll(() => exited, { timeout: 15_000 }).toBe(true);
  } finally {
    if (!exited) {
      app.process().kill("SIGKILL");
      try {
        process.kill(pid, "SIGTERM");
      } catch {
        // o serviço já saiu
      }
    }
    await rm(root, { recursive: true, force: true });
  }
});

test('Dot no chat: nome e "via Claude Code" na resposta, e some com o Dot desligado', async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "kdot-chat-"));
  const fakeCli = path.join(root, "claude-falso.js");
  await writeFile(fakeCli, FAKE_CLAUDE);
  await chmod(fakeCli, 0o755);
  const { app, window, pid } = await launch(root, fakeCli);
  try {
    const renamed = await request(window, "dot.update", { name: "Caronte" });
    expect(renamed.ok).toBe(true);
    const created = await request(window, "conversation.create", {
      agent: "claude",
      cwd: root,
      title: "Conversa com Dot",
    });
    expect(created.ok).toBe(true);
    await window.reload();
    await expect(window.getByText("Serviço conectado")).toBeVisible();
    await sidebar(window).getByRole("button", { name: "Conversa com Dot", exact: true }).click();

    const composer = window.locator("textarea").first();
    await composer.fill("Oi");
    await composer.press("Enter");

    const answer = window.getByRole("article", { name: "Mensagem do agente" });
    await expect(answer.getByText("Resposta do agente falso")).toBeVisible();
    await expect(answer.getByText("Caronte", { exact: true })).toBeVisible();
    await expect(answer.getByText("via Claude Code", { exact: true })).toBeVisible();

    await request(window, "dot.update", { enabled: false });
    await expect(answer.getByText("Caronte", { exact: true })).toHaveCount(0);
    await expect(answer.getByText("via Claude Code", { exact: true })).toHaveCount(0);
    await expect(answer.getByText("Resposta do agente falso")).toBeVisible();
  } finally {
    await shutDown(app, pid);
    await rm(root, { recursive: true, force: true });
  }
});
