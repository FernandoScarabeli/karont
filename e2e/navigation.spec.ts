import { chmod, mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import {
  type ElectronApplication,
  _electron as electron,
  expect,
  type Locator,
  type Page,
  test,
} from "@playwright/test";

const mainEntry = path.resolve("packages/desktop/dist/main.js");

type Reply = { ok: boolean; result?: Record<string, unknown>; error?: { message: string } };
type NativeWindow = { karontNative: { request: (m: string, p: unknown) => Promise<Reply> } };

/**
 * CLI falsa do Claude (protocolo `stream-json`, ver `PROTOCOLO.md`). Comportamento pelo texto:
 * - "permissao": pede permissão para rodar `echo karont-permitido` e só segue quando o host responde;
 * - "falhe-sempre": o turno termina com erro todas as vezes;
 * - "falhe-uma-vez": falha na primeira vez e funciona nas seguintes (marca em `__STATE__`);
 * - qualquer outro texto: responde "Recebi: <texto>".
 */
const FAKE_CLAUDE = `#!/usr/bin/env node
const fs = require("node:fs");
const readline = require("node:readline");
const args = process.argv.slice(2);
const flag = (name) => args[args.indexOf(name) + 1];
const sessionId = flag("--session-id") || flag("--resume") || "00000000-0000-4000-8000-000000000001";
const send = (value) => process.stdout.write(JSON.stringify(value) + "\\n");
const STATE = __STATE__;
let turn = 0;
const waiting = new Map();

function reply(text) {
  turn += 1;
  const base = { session_id: sessionId, parent_tool_use_id: null };
  send({ type: "stream_event", ...base, event: { type: "content_block_start", index: 0, content_block: { type: "text", text: "" } } });
  send({ type: "stream_event", ...base, event: { type: "content_block_delta", index: 0, delta: { type: "text_delta", text } } });
  send({ type: "assistant", ...base, message: { id: "msg_" + turn + "_" + Date.now(), type: "message", role: "assistant", model: "claude-fake", content: [{ type: "text", text }], usage: {} } });
  send({ type: "stream_event", ...base, event: { type: "content_block_stop", index: 0 } });
  send({ type: "result", subtype: "success", is_error: false, session_id: sessionId, stop_reason: "end_turn", terminal_reason: "completed", permission_denials: [] });
}

function fail() {
  send({ type: "result", subtype: "error_during_execution", is_error: true, session_id: sessionId, errors: ["Falha simulada pela CLI falsa."], permission_denials: [] });
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
      response: { subtype: "success", request_id: value.request_id, response: { commands: [], models: [{ value: "gpt-6-luna", displayName: "GPT-6-Luna", supportsEffort: true, supportedEffortLevels: ["low", "medium", "high"] }] } },
    });
    return;
  }
  if (value.type === "control_response") {
    const id = value.response && value.response.request_id;
    const done = waiting.get(id);
    if (done) {
      waiting.delete(id);
      done(value.response.response || {});
    }
    return;
  }
  if (value.type !== "user") return;
  const content = value.message.content;
  const text = typeof content === "string" ? content : JSON.stringify(content);
  send({ type: "system", subtype: "init", cwd: process.cwd(), session_id: sessionId, tools: [] });
  if (text.includes("permissao")) {
    const requestId = "perm-" + Date.now();
    waiting.set(requestId, (answer) => {
      reply(answer.behavior === "allow" ? "Comando liberado e rodado." : "Comando negado.");
    });
    send({
      type: "control_request",
      request_id: requestId,
      request: {
        subtype: "can_use_tool",
        tool_name: "Bash",
        input: { command: "echo karont-permitido", description: "Imprime uma palavra" },
        permission_suggestions: [],
      },
    });
    return;
  }
  if (text.includes("falhe-sempre")) return fail();
  if (text.includes("falhe-uma-vez")) {
    if (!fs.existsSync(STATE)) {
      fs.writeFileSync(STATE, "falhou");
      return fail();
    }
    return reply("Funcionou na segunda tentativa.");
  }
  reply("Recebi: " + text);
});
`;

type App = {
  app: ElectronApplication;
  window: Page;
  root: string;
  request: (method: string, params: unknown) => Promise<Reply>;
  /** Cria uma pasta nova dentro da pasta temporária do teste. */
  folder: (name: string) => Promise<string>;
  /** O serviço não emite evento ao criar pela ponte: recarrega para ler as listas. */
  reload: () => Promise<void>;
  close: () => Promise<void>;
};

async function launch(): Promise<App> {
  const root = await mkdtemp(path.join(os.tmpdir(), "knav-"));
  const fakeCli = path.join(root, "claude-falso.js");
  const env: Record<string, string> = {
    ...(process.env as Record<string, string>),
    KARONT_RUNTIME_DIR: path.join(root, "run"),
    KARONT_DATA_DIR: path.join(root, "data"),
    // Os testes não podem depender das CLIs instaladas na máquina.
    KARONT_DISABLE_AGENT_DETECTION: "1",
    KARONT_CLAUDE_CLI: fakeCli,
  };
  await writeFile(
    fakeCli,
    FAKE_CLAUDE.replace("__STATE__", JSON.stringify(path.join(root, "falhou.txt"))),
  );
  await chmod(fakeCli, 0o755);

  const app = await electron.launch({ args: [mainEntry], env, chromiumSandbox: true });
  const window = await app.firstWindow();
  await expect(window.getByText("Serviço conectado")).toBeVisible();
  const request = (method: string, params: unknown) =>
    window.evaluate(
      ([m, p]) => (globalThis as unknown as NativeWindow).karontNative.request(m as string, p),
      [method, params] as const,
    );
  const servicePid = (await request("system.info", {})).result?.pid as number;

  return {
    app,
    window,
    root,
    request,
    folder: async (name) => {
      const folder = path.join(root, name);
      await mkdir(folder, { recursive: true });
      return folder;
    },
    reload: async () => {
      await window.reload();
      await expect(window.getByText("Serviço conectado")).toBeVisible();
    },
    close: async () => {
      try {
        const all = await request("conversation.list", { archived: false, limit: 500 });
        for (const item of (all.result?.conversations ?? []) as { id: string }[]) {
          await request("conversation.stop", { id: item.id }).catch(() => undefined);
        }
      } catch {
        // a janela pode já ter fechado
      }
      await app.close().catch(() => undefined);
      if (servicePid) {
        try {
          process.kill(servicePid, "SIGTERM");
        } catch {
          // já saiu
        }
      }
      await rm(root, { recursive: true, force: true });
    },
  };
}

async function ok<T = Record<string, unknown>>(reply: Promise<Reply>): Promise<T> {
  const value = await reply;
  expect(value.ok, JSON.stringify(value.error)).toBe(true);
  return value.result as T;
}

type Created = { id: string };

async function createWorkspace(kit: App, name: string): Promise<Created> {
  return (await ok<{ workspace: Created }>(kit.request("workspaces.create", { name }))).workspace;
}

async function createProject(
  kit: App,
  name: string,
  workspaceId?: string,
): Promise<Created & { path: string }> {
  const folder = await kit.folder(`projeto-${name.toLowerCase().replace(/\W+/g, "-")}`);
  const result = await ok<{ project: Created }>(
    kit.request("projects.create", {
      name,
      icon: "folder",
      defaultAgent: "claude",
      path: folder,
      ...(workspaceId ? { workspaceId } : {}),
    }),
  );
  return { ...result.project, path: folder };
}

async function createConversation(
  kit: App,
  title: string,
  options: { workspaceId?: string; projectId?: string; cwd: string },
): Promise<Created> {
  return (
    await ok<{ conversation: Created }>(
      kit.request("conversation.create", { agent: "claude", title, ...options }),
    )
  ).conversation;
}

/** `conversation.send` só responde quando o turno termina: dispara sem esperar. */
function sendWithoutWaiting(kit: App, id: string, text: string) {
  void kit.request("conversation.send", { id, text }).catch(() => undefined);
}

async function defaultWorkspaceId(kit: App): Promise<string> {
  const list = await ok<{ workspaces: { id: string; name: string }[] }>(
    kit.request("workspaces.list", {}),
  );
  const first = list.workspaces[0];
  expect(first?.name).toBe("Pessoal");
  return first?.id ?? "";
}

function areas(window: Page) {
  return window.getByRole("navigation", { name: "Áreas" });
}

function tab(window: Page, name: string): Locator {
  return areas(window).getByRole("button", { name, exact: true });
}

function sidebar(window: Page) {
  return window.getByRole("navigation", { name: "Navegação principal" });
}

function sidebarItem(window: Page, name: string | RegExp): Locator {
  return sidebar(window).getByRole(
    "button",
    typeof name === "string" ? { name, exact: true } : { name },
  );
}

async function openTabMenu(window: Page, workspaceName: string, item: string) {
  await tab(window, workspaceName).hover();
  await window.getByRole("button", { name: `Ações do workspace ${workspaceName}` }).click();
  await window.getByRole("menuitem", { name: item, exact: true }).click();
}

test("workspaces: criar, renomear, separar conteúdo, manter terminal vivo, mover projeto e apagar", async () => {
  const kit = await launch();
  const { window } = kit;
  try {
    // Primeira abertura: abre no Início, e a única aba é "Pessoal".
    await expect(tab(window, "Pessoal")).toBeVisible();
    await expect(window.getByRole("button", { name: "Início", exact: true })).toHaveAttribute(
      "aria-current",
      "page",
    );
    await expect(areas(window).getByRole("button", { name: /^Ações do workspace/ })).toHaveCount(1);

    // "+" cria "Trabalho" e já ativa a aba nova.
    await window.getByRole("button", { name: "Novo workspace" }).click();
    const createDialog = window.getByRole("dialog", { name: "Novo workspace" });
    await createDialog.getByRole("textbox", { name: "Nome" }).fill("Trabalho");
    await createDialog.getByRole("button", { name: "Criar", exact: true }).click();
    await expect(createDialog).toBeHidden();
    await expect(tab(window, "Trabalho")).toHaveAttribute("aria-current", "page");
    await expect(tab(window, "Pessoal")).not.toHaveAttribute("aria-current", "page");

    // Renomear pelo menu da aba.
    await openTabMenu(window, "Trabalho", "Renomear");
    const renameDialog = window.getByRole("dialog", { name: "Renomear workspace" });
    const nameField = renameDialog.getByRole("textbox", { name: "Nome" });
    await expect(nameField).toHaveValue("Trabalho");
    await nameField.fill("Clientes");
    await renameDialog.getByRole("button", { name: "Salvar" }).click();
    await expect(renameDialog).toBeHidden();
    await expect(tab(window, "Clientes")).toBeVisible();
    await expect(tab(window, "Trabalho")).toHaveCount(0);

    // Uma conversa, um terminal e um projeto em cada workspace.
    const personalId = await defaultWorkspaceId(kit);
    const clientsId = (
      await ok<{ workspaces: { id: string; name: string }[] }>(kit.request("workspaces.list", {}))
    ).workspaces.find((item) => item.name === "Clientes")?.id;
    expect(clientsId).toBeTruthy();
    const personalFolder = await kit.folder("terminal-pessoal");
    const clientsFolder = await kit.folder("terminal-clientes");
    await createConversation(kit, "Conversa pessoal", {
      workspaceId: personalId,
      cwd: personalFolder,
    });
    await createConversation(kit, "Conversa de clientes", {
      workspaceId: clientsId,
      cwd: clientsFolder,
    });
    const size = { cols: 80, rows: 24 };
    await ok(
      kit.request("terminals.open", {
        ...size,
        cwd: personalFolder,
        command: "echo saida-pessoal-$((6*7))",
        workspaceId: personalId,
      }),
    );
    await ok(
      kit.request("terminals.open", {
        ...size,
        cwd: clientsFolder,
        command: "echo saida-clientes",
        workspaceId: clientsId,
      }),
    );
    const projectMoved = await createProject(kit, "Projeto Viajante", personalId);
    await createProject(kit, "Projeto Fixo", clientsId);
    await kit.reload();

    const personalTerminal = sidebarItem(window, /^bash · terminal-pessoal, rodando$/);
    const clientsTerminal = sidebarItem(window, /^bash · terminal-clientes, rodando$/);

    // A sidebar mostra só o conteúdo do workspace ativo.
    await tab(window, "Pessoal").click();
    await expect(tab(window, "Pessoal")).toHaveAttribute("aria-current", "page");
    await expect(sidebarItem(window, "Conversa pessoal")).toBeVisible();
    await expect(personalTerminal).toBeVisible();
    await expect(sidebarItem(window, "Projeto Viajante")).toBeVisible();
    await expect(sidebarItem(window, "Conversa de clientes")).toHaveCount(0);
    await expect(clientsTerminal).toHaveCount(0);
    await expect(sidebarItem(window, "Projeto Fixo")).toHaveCount(0);

    await tab(window, "Clientes").click();
    await expect(sidebarItem(window, "Conversa de clientes")).toBeVisible();
    await expect(clientsTerminal).toBeVisible();
    await expect(sidebarItem(window, "Projeto Fixo")).toBeVisible();
    await expect(sidebarItem(window, "Conversa pessoal")).toHaveCount(0);
    await expect(personalTerminal).toHaveCount(0);
    await expect(sidebarItem(window, "Projeto Viajante")).toHaveCount(0);

    // Terminal vivo: abre, troca de aba, volta e ele continua mostrando a saída e respondendo.
    await tab(window, "Pessoal").click();
    await personalTerminal.click();
    const rows = window.locator(".xterm-rows");
    await expect(rows).toBeVisible();
    // O xterm só desenha o que está visível: garanta a área na tela antes de ler o texto.
    await rows.scrollIntoViewIfNeeded();
    await expect(rows).toContainText("saida-pessoal-42");
    await tab(window, "Clientes").click();
    await expect(sidebarItem(window, "Conversa de clientes")).toBeVisible();
    await tab(window, "Pessoal").click();
    await expect(personalTerminal).toHaveAttribute("aria-current", "page");
    const visibleRows = window.locator(".xterm-rows:visible");
    await visibleRows.scrollIntoViewIfNeeded();
    await expect(visibleRows).toContainText("saida-pessoal-42");
    await window.locator(".xterm:visible .xterm-screen").click();
    await window.keyboard.type("echo ainda-vivo-$((20+1))");
    await window.keyboard.press("Enter");
    await expect(visibleRows).toContainText("ainda-vivo-21");

    // Mover um projeto pelo menu do projeto.
    const projectRow = sidebarItem(window, "Projeto Viajante");
    await projectRow.hover();
    await sidebar(window).getByRole("button", { name: "Ações de Projeto Viajante" }).click();
    await window.getByRole("menuitem", { name: "Mover para Clientes" }).click();
    await expect(sidebarItem(window, "Projeto Viajante")).toHaveCount(0);
    await tab(window, "Clientes").click();
    await expect(sidebarItem(window, "Projeto Viajante")).toBeVisible();
    await expect(sidebarItem(window, "Projeto Fixo")).toBeVisible();
    const moved = await ok<{ projects: { id: string; workspaceId: string }[] }>(
      kit.request("projects.list", {}),
    );
    expect(moved.projects.find((item) => item.id === projectMoved.id)?.workspaceId).toBe(clientsId);

    // Apagar "Clientes": a confirmação diz para onde vai o conteúdo.
    await openTabMenu(window, "Clientes", "Apagar");
    const removeDialog = window.getByRole("dialog", { name: "Apagar o workspace Clientes?" });
    await expect(removeDialog).toContainText(
      "Os projetos, conversas e terminais de Clientes passam para Pessoal.",
    );
    await removeDialog.getByRole("button", { name: "Apagar workspace" }).click();
    await expect(removeDialog).toBeHidden();
    await expect(tab(window, "Clientes")).toHaveCount(0);
    await expect(tab(window, "Pessoal")).toHaveAttribute("aria-current", "page");
    await expect(sidebarItem(window, "Conversa de clientes")).toBeVisible();
    await expect(sidebarItem(window, "Conversa pessoal")).toBeVisible();
    await expect(clientsTerminal).toBeVisible();
    await expect(personalTerminal).toBeVisible();
    await expect(sidebarItem(window, "Projeto Viajante")).toBeVisible();
    await expect(sidebarItem(window, "Projeto Fixo")).toBeVisible();

    // Com um único workspace, Apagar fica desabilitado.
    await tab(window, "Pessoal").hover();
    await window.getByRole("button", { name: "Ações do workspace Pessoal" }).click();
    await expect(window.getByRole("menuitem", { name: "Apagar", exact: true })).toBeDisabled();
    await window.keyboard.press("Escape");
  } finally {
    await kit.close();
  }
});

test("tela do workspace e Início: linha do dia, cartões de projeto e de workspace", async () => {
  const kit = await launch();
  const { window } = kit;
  try {
    const personalId = await defaultWorkspaceId(kit);
    const other = await createWorkspace(kit, "Estudos");
    const project = await createProject(kit, "Projeto Cartão", personalId);
    await createProject(kit, "Projeto Estudo", other.id);
    const conversation = await createConversation(kit, "Conversa do dia", {
      workspaceId: personalId,
      projectId: project.id,
      cwd: project.path,
    });
    await kit.reload();

    // Sem conversa aberta: tela do workspace, com o nome no heading e sem número inventado.
    await tab(window, "Pessoal").click();
    await expect(window.getByRole("heading", { level: 1, name: "Pessoal" })).toBeVisible();
    await expect(window.getByText("Nenhuma conversa hoje")).toBeVisible();

    // Depois de uma mensagem para a CLI falsa, a linha do dia traz o número real.
    await ok(kit.request("conversation.send", { id: conversation.id, text: "oi do dia" }));
    await kit.reload();
    await tab(window, "Pessoal").click();
    await expect(window.getByRole("heading", { level: 1, name: "Pessoal" })).toBeVisible();
    await expect(window.getByText("1 conversa hoje", { exact: true })).toBeVisible();

    // O cartão do projeto abre uma conversa nova, limpa, nesse projeto.
    const projectCard = window.getByRole("button", {
      name: /^Projeto Cartão/,
      description: "Abre uma conversa nova neste projeto",
    });
    await expect(projectCard).toContainText("1 conversa");
    await projectCard.click();
    await expect(window.getByRole("heading", { level: 1, name: "Pessoal" })).toHaveCount(0);
    await expect(projectCard).toHaveCount(0);
    await expect(
      window.getByRole("button", { name: /^Pasta:|Projeto Cartão/ }).first(),
    ).toBeVisible();

    // Clicar de novo na aba alterna para a tela do workspace e de volta.
    await tab(window, "Pessoal").click();
    await expect(window.getByRole("heading", { level: 1, name: "Pessoal" })).toBeVisible();

    // "Nova conversa" abre limpa: sem cartões de projeto e sem a tela do workspace.
    await sidebar(window).getByRole("button", { name: "Nova conversa", exact: true }).click();
    await expect(window.getByRole("heading", { level: 1, name: "Pessoal" })).toHaveCount(0);
    await expect(projectCard).toHaveCount(0);

    // Início: um cartão por workspace; clicar abre a aba.
    await window.getByRole("button", { name: "Início", exact: true }).click();
    const workspaceCards = window.getByRole("button", { description: "Abre este workspace" });
    await expect(workspaceCards).toHaveCount(2);
    await expect(workspaceCards.filter({ hasText: "Pessoal" })).toContainText(
      "1 conversa · 1 hoje",
    );
    await workspaceCards.filter({ hasText: "Estudos" }).click();
    await expect(tab(window, "Estudos")).toHaveAttribute("aria-current", "page");
    await expect(window.getByRole("heading", { level: 1, name: "Estudos" })).toBeVisible();
  } finally {
    await kit.close();
  }
});

test("caixa de entrada: permissão resolve direto, erro dispensa ou tenta de novo e vazia avisa", async () => {
  const kit = await launch();
  const { window } = kit;
  try {
    const personalId = await defaultWorkspaceId(kit);
    const folder = await kit.folder("caixa");
    const inboxButton = sidebar(window).getByRole("button", { name: "Caixa de entrada" });

    // Sem pendência: vazia.
    await inboxButton.click();
    await expect(window.getByText("Nada precisa de você")).toBeVisible();

    // Permissão: a conversa fica esperando e a contagem aparece na sidebar.
    const asking = await createConversation(kit, "Pede permissão", {
      workspaceId: personalId,
      cwd: folder,
    });
    await kit.reload();
    sendWithoutWaiting(kit, asking.id, "preciso de permissao");
    await expect(inboxButton).toHaveAccessibleDescription("1 item esperando");
    await expect(inboxButton).toContainText("1");

    // Início: aparece "Precisa de você" com o comando.
    await window.getByRole("button", { name: "Início", exact: true }).click();
    const homeList = window.getByRole("list", { name: "Precisa de você" });
    await expect(homeList).toContainText("Pede permissão");
    await expect(homeList).toContainText("echo karont-permitido");

    // Caixa de entrada: o mesmo item, com Permitir, que resolve direto.
    await inboxButton.click();
    const inboxList = window.getByRole("list", { name: "Caixa de entrada" });
    await expect(inboxList).toContainText("echo karont-permitido");
    await expect(inboxList).toContainText("Pede permissão");
    await inboxList.getByRole("button", { name: "Permitir", exact: true }).click();
    await expect(window.getByText("Nada precisa de você")).toBeVisible();
    await expect(inboxList).toHaveCount(0);
    await expect(inboxButton).not.toHaveAccessibleDescription(/item/);

    // A resposta segue na conversa.
    await sidebarItem(window, "Pede permissão").click();
    await expect(window.getByText("Comando liberado e rodado.")).toBeVisible();

    // Erro que só dá para dispensar: o erro aparece e Dispensar não muda o chat.
    const broken = await createConversation(kit, "Sempre falha", {
      workspaceId: personalId,
      cwd: folder,
    });
    await kit.reload();
    sendWithoutWaiting(kit, broken.id, "falhe-sempre");
    await expect(inboxButton).toHaveAccessibleDescription("1 item esperando");
    await inboxButton.click();
    const errorList = window.getByRole("list", { name: "Caixa de entrada" });
    await expect(errorList).toContainText("Sempre falha");
    await expect(errorList.getByRole("button", { name: "Tentar de novo" })).toBeVisible();
    await errorList.getByRole("button", { name: "Dispensar" }).click();
    await expect(window.getByText("Nada precisa de você")).toBeVisible();
    const before = await ok<{ messages: unknown[] }>(
      kit.request("conversation.get", { id: broken.id }),
    );
    await sidebarItem(window, "Sempre falha").click();
    await expect(window.getByText("falhe-sempre")).toBeVisible();
    const after = await ok<{ messages: unknown[] }>(
      kit.request("conversation.get", { id: broken.id }),
    );
    expect(after.messages.length).toBe(before.messages.length);

    // Erro que melhora na segunda vez: Tentar de novo funciona e o item some.
    const flaky = await createConversation(kit, "Falha uma vez", {
      workspaceId: personalId,
      cwd: folder,
    });
    await kit.reload();
    sendWithoutWaiting(kit, flaky.id, "falhe-uma-vez");
    await inboxButton.click();
    const retryList = window.getByRole("list", { name: "Caixa de entrada" });
    await expect(retryList).toContainText("Falha uma vez");
    await retryList.getByRole("button", { name: "Tentar de novo" }).click();
    await expect(window.getByText("Nada precisa de você")).toBeVisible();
    await sidebarItem(window, "Falha uma vez").click();
    await expect(window.getByText("Funcionou na segunda tentativa.")).toBeVisible();
  } finally {
    await kit.close();
  }
});

test("busca: Ctrl K, acento, destaque, setas, outro workspace, terminal e entrada estranha", async () => {
  const kit = await launch();
  const { window } = kit;
  try {
    const personalId = await defaultWorkspaceId(kit);
    const other = await createWorkspace(kit, "Estudos");
    const project = await createProject(kit, "Projeto Girassol", personalId);
    const personal = await createConversation(kit, "Plano de viagem", {
      workspaceId: personalId,
      projectId: project.id,
      cwd: project.path,
    });
    const studyFolder = await kit.folder("estudos");
    const study = await createConversation(kit, "Caderno de estudos", {
      workspaceId: other.id,
      cwd: studyFolder,
    });
    await ok(
      kit.request("conversation.send", { id: personal.id, text: "preciso de uma ação rápida" }),
    );
    await ok(kit.request("conversation.send", { id: study.id, text: "anotação sobre matemática" }));
    await ok(
      kit.request("terminals.open", {
        cols: 80,
        rows: 24,
        cwd: studyFolder,
        workspaceId: personalId,
      }),
    );
    await kit.reload();
    await tab(window, "Pessoal").click();

    const search = window.getByRole("dialog", { name: "Buscar" });
    const input = search.getByRole("combobox", {
      name: "Buscar em conversas, projetos e mensagens",
    });

    // Ctrl K abre com foco no campo e fecha de novo.
    await window.keyboard.press("Control+k");
    await expect(search).toBeVisible();
    await expect(input).toBeFocused();
    await window.keyboard.press("Control+k");
    await expect(search).toBeHidden();

    // O botão "Buscar" também abre.
    await window.getByRole("button", { name: "Buscar", exact: true }).click();
    await expect(search).toBeVisible();

    // Sem digitar o acento: "acao" acha "ação", com o trecho destacado.
    await input.fill("acao");
    const messageOption = search
      .getByRole("option")
      .filter({ hasText: "preciso de uma ação rápida" })
      .first();
    await expect(messageOption).toBeVisible();
    await expect(messageOption.locator("mark")).toHaveText(/a[cç][aã]o/i);

    // Título e projeto também são achados.
    await input.fill("viagem");
    await expect(
      search
        .getByRole("group", { name: "Conversas" })
        .getByRole("option", { name: /Plano de viagem/ }),
    ).toBeVisible();
    await input.fill("girassol");
    const projectOption = search
      .getByRole("group", { name: "Projetos" })
      .getByRole("option", { name: /Projeto Girassol/ });
    await expect(projectOption).toBeVisible();

    // Enter no projeto (único resultado): abre uma conversa nova nele.
    await input.press("Enter");
    await expect(search).toBeHidden();
    await expect(
      window.getByRole("group", { name: /^Projeto Projeto Girassol, pasta / }),
    ).toBeVisible();

    // Seta para baixo escolhe o segundo resultado antes do Enter.
    const options = search.getByRole("option");
    await window.keyboard.press("Control+k");
    await input.fill("a");
    await expect(options.nth(1)).toBeVisible();
    await input.press("ArrowDown");
    await expect(options.nth(1)).toHaveAttribute("aria-selected", "true");
    await expect(options.first()).toHaveAttribute("aria-selected", "false");
    await input.press("Escape");
    await expect(search).toBeHidden();

    // Resultado de outro workspace ativa a aba certa.
    await expect(tab(window, "Pessoal")).toHaveAttribute("aria-current", "page");
    await window.keyboard.press("Control+k");
    await input.fill("matematica");
    const remote = search
      .getByRole("option")
      .filter({ hasText: "anotação sobre matemática" })
      .first();
    await expect(remote).toBeVisible();
    await expect(remote).toContainText("Estudos");
    await input.press("Enter");
    await expect(search).toBeHidden();
    await expect(tab(window, "Estudos")).toHaveAttribute("aria-current", "page");
    await expect(window.getByText("anotação sobre matemática").first()).toBeVisible();

    // Com o foco dentro do terminal, Ctrl K é do terminal e não abre a busca.
    await tab(window, "Pessoal").click();
    await sidebarItem(window, /^bash · estudos, rodando$/).click();
    const rows = window.locator(".xterm-rows:visible");
    await expect(rows).toBeVisible();
    await window.locator(".xterm:visible .xterm-screen").click();
    await window.keyboard.press("Control+k");
    await expect(search).toBeHidden();
    await expect(window.locator(".xterm-helper-textarea:focus")).toHaveCount(1);
    // O botão "Buscar" continua funcionando.
    await window.getByRole("button", { name: "Buscar", exact: true }).click();
    await expect(search).toBeVisible();

    // Entrada com sintaxe de busca: sem erro, só "Nada encontrado".
    await input.fill(" AND (*");
    await expect(search.getByText("Nada encontrado")).toBeVisible();
    await expect(search.getByText("Não foi possível buscar.")).toHaveCount(0);
  } finally {
    await kit.close();
  }
});

test("composer em painel estreito: nada se sobrepõe nem sai do cartão, e o enviar fica na primeira linha", async () => {
  const kit = await launch();
  const { window } = kit;
  try {
    const folder = await kit.folder("projeto-estreito");
    await ok(
      kit.request("conversation.create", {
        agent: "claude",
        title: "Conversa estreita",
        cwd: folder,
        mode: "full",
        model: "gpt-6-luna",
      }),
    );
    await kit.reload();
    await sidebarItem(window, "Conversa estreita").click();
    const form = window
      .locator("form")
      .filter({ has: window.locator("textarea") })
      .first();
    const submit = form.getByRole("button", { name: /Enviar/ });
    await expect(submit).toBeVisible();
    await expect(form.getByRole("button", { name: /Acesso total/ })).toBeVisible();

    for (const width of [180, 260, 340, 420, 520, 640, 800, 1200]) {
      await form.evaluate((element, value) => {
        const wrapper = (element as unknown as { parentElement: { style: { width: string } } })
          .parentElement;
        wrapper.style.width = `${value}px`;
      }, width);
      await window.evaluate("new Promise((resolve) => requestAnimationFrame(resolve))");

      const card = await form.boundingBox();
      if (!card) throw new Error("composer sem caixa");
      const buttons = form.getByRole("button");
      const count = await buttons.count();
      const boxes: { name: string; x: number; y: number; width: number; height: number }[] = [];
      for (let index = 0; index < count; index += 1) {
        const button = buttons.nth(index);
        const box = await button.boundingBox();
        if (!box || box.width === 0) continue;
        boxes.push({ name: (await button.getAttribute("aria-label")) ?? "", ...box });
      }
      expect(boxes.length, `controles visíveis a ${width}px`).toBeGreaterThanOrEqual(5);

      // Nenhum controle passa da borda do cartão nem se sobrepõe a outro.
      for (const box of boxes) {
        expect(box.x, `${box.name} a ${width}px`).toBeGreaterThanOrEqual(card.x - 1);
        expect(box.x + box.width, `${box.name} a ${width}px`).toBeLessThanOrEqual(
          card.x + card.width + 1,
        );
      }
      for (const [index, first] of boxes.entries()) {
        for (const second of boxes.slice(index + 1)) {
          const overlapX =
            Math.min(first.x + first.width, second.x + second.width) - Math.max(first.x, second.x);
          const overlapY =
            Math.min(first.y + first.height, second.y + second.height) -
            Math.max(first.y, second.y);
          expect(
            overlapX > 1 && overlapY > 1,
            `${first.name} sobrepõe ${second.name} a ${width}px`,
          ).toBe(false);
        }
      }

      // O enviar está na primeira linha dos controles, à direita de todos nela.
      const send = boxes.find((box) => /Enviar/.test(box.name));
      if (!send) throw new Error("sem botão enviar");
      const topRow = Math.min(...boxes.map((box) => box.y));
      expect(
        Math.abs(send.y + send.height / 2 - (topRow + 18)),
        `enviar a ${width}px`,
      ).toBeLessThan(8);
      for (const box of boxes) {
        if (box !== send && Math.abs(box.y - send.y) < 20) {
          expect(
            box.x + box.width,
            `${box.name} à esquerda do enviar a ${width}px`,
          ).toBeLessThanOrEqual(send.x + 1);
        }
      }
    }

    // Mesmo no menor painel, o nome acessível diz agente, modelo e acesso.
    await expect(form.getByRole("button", { name: /Modelo: GPT-6-Luna/ })).toBeVisible();
    await expect(form.getByRole("button", { name: /Acesso total/ })).toBeVisible();
    await expect(form.getByText("Claude Code", { exact: true })).toBeAttached();
    await expect(form.getByText("Agente: Claude Code")).toBeAttached();
  } finally {
    await kit.close();
  }
});
