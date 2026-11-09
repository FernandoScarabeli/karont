import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { _electron as electron, expect, type Page, test } from "@playwright/test";

const mainEntry = path.resolve("packages/desktop/dist/main.js");

type Reply = { ok: boolean; result?: Record<string, unknown>; error?: { message: string } };
type NativeWindow = { karontNative: { request: (m: string, p: unknown) => Promise<Reply> } };

function request(window: Page, method: string, params: unknown): Promise<Reply> {
  return window.evaluate(
    ([name, payload]) =>
      (globalThis as unknown as NativeWindow).karontNative.request(name as string, payload),
    [method, params] as const,
  );
}

test("primeira abertura: passa pelos passos, termina na Nova conversa, não volta sozinha e reabre pelas Configurações", async () => {
  // Pastas curtas e temporárias; sem KARONT_SKIP_ONBOARDING, de propósito.
  const root = await mkdtemp(path.join(os.tmpdir(), "konb-"));
  const env: Record<string, string> = {
    ...(process.env as Record<string, string>),
    KARONT_RUNTIME_DIR: path.join(root, "run"),
    KARONT_DATA_DIR: path.join(root, "data"),
    // Os testes não podem depender das CLIs instaladas na máquina.
    KARONT_DISABLE_AGENT_DETECTION: "1",
  };
  let servicePid: number | undefined;

  try {
    // chromiumSandbox: o Playwright passa --no-sandbox por padrão; o Karont nunca roda assim.
    const first = await electron.launch({ args: [mainEntry], env, chromiumSandbox: true });
    const window = await first.firstWindow();
    const screen = window.getByRole("dialog", { name: "Primeira abertura" });

    // Boas-vindas, sem Fechar, e o resto do app parado.
    await expect(
      screen.getByRole("heading", { name: "Bem-vindo ao Karont", level: 1 }),
    ).toBeVisible();
    await expect(screen.getByText("Passo 1 de 4")).toBeVisible();
    await expect(screen.getByRole("button", { name: "Fechar" })).toHaveCount(0);
    await expect(window.getByRole("navigation", { name: "Navegação principal" })).toHaveCount(0);
    await window.keyboard.press("Control+K");
    await expect(window.getByRole("dialog", { name: "Buscar" })).toHaveCount(0);
    const info = await request(window, "system.info", {});
    servicePid = info.result?.pid as number | undefined;

    // Agentes: sem nenhum, segue pelo Terminal.
    await screen.getByRole("button", { name: "Começar" }).click();
    const agentsTitle = screen.getByRole("heading", { name: "Agentes encontrados" });
    await expect(agentsTitle).toBeFocused();
    await expect(screen.getByText("O login é feito na própria CLI.")).toBeVisible();
    await expect(
      screen.getByText("Nenhum agente encontrado. Você pode começar pelo Terminal."),
    ).toBeVisible();
    await expect(screen.getByRole("radio", { name: "Terminal" })).toBeChecked();
    await screen.getByRole("button", { name: "Continuar" }).click();

    // Você: muda o nome.
    await expect(screen.getByRole("heading", { name: "Você" })).toBeFocused();
    await screen.getByLabel("Como te chamar").fill("Ana E2E");
    await screen.getByRole("button", { name: "Continuar" }).click();

    // Voltar funciona e guarda o que foi feito.
    await expect(screen.getByRole("heading", { name: "Primeiro projeto" })).toBeVisible();
    await screen.getByRole("button", { name: "Voltar" }).click();
    await expect(screen.getByLabel("Como te chamar")).toHaveValue("Ana E2E");
    await screen.getByRole("button", { name: "Continuar" }).click();

    // Primeiro projeto: pula e conversa na pasta pessoal.
    await screen.getByRole("button", { name: "Pular e conversar na pasta pessoal" }).click();
    await expect(screen).toHaveCount(0);
    await expect(window.getByRole("heading", { name: "Nova conversa" })).toBeVisible();
    await expect(window.getByRole("navigation", { name: "Navegação principal" })).toBeVisible();

    const home = (await request(window, "system.info", {})).result?.homeDir;
    const lastAgent = await request(window, "settings.get", { key: "newConversation.lastAgent" });
    const lastFolder = await request(window, "settings.get", { key: "newConversation.lastFolder" });
    const completed = await request(window, "settings.get", { key: "onboarding.completedAt" });
    const userName = await request(window, "settings.get", { key: "profile.userNameOverride" });
    expect(lastAgent.result?.value).toBe("terminal");
    expect(lastFolder.result?.value).toBe(home);
    expect(typeof completed.result?.value).toBe("string");
    expect(userName.result?.value).toBe("Ana E2E");

    // Fecha e abre o app de novo: a primeira abertura não volta.
    await first.close();
    const second = await electron.launch({ args: [mainEntry], env, chromiumSandbox: true });
    const again = await second.firstWindow();
    await expect(again.getByText("Serviço conectado")).toBeVisible();
    await expect(again.getByRole("navigation", { name: "Navegação principal" })).toBeVisible();
    await expect(again.getByRole("dialog", { name: "Primeira abertura" })).toHaveCount(0);

    // Configurações › Geral › Abrir de novo: mostra de novo, com Fechar.
    await again.getByRole("button", { name: "Configurações" }).click();
    await again.getByRole("button", { name: "Abrir de novo" }).click();
    const reopened = again.getByRole("dialog", { name: "Primeira abertura" });
    await expect(
      reopened.getByRole("heading", { name: "Bem-vindo ao Karont", level: 1 }),
    ).toBeVisible();
    await expect(reopened.getByText("Passo 1 de 4")).toBeVisible();

    // Fechar sai sem mudar nada.
    await reopened.getByRole("button", { name: "Fechar" }).click();
    await expect(reopened).toHaveCount(0);
    await expect(again.getByRole("button", { name: "Abrir de novo" })).toBeVisible();
    const after = await request(again, "settings.get", { key: "onboarding.completedAt" });
    expect(after.result?.value).toBe(completed.result?.value);
    const nameAfter = await request(again, "settings.get", { key: "profile.userNameOverride" });
    expect(nameAfter.result?.value).toBe("Ana E2E");

    // Esc também fecha.
    await again.getByRole("button", { name: "Abrir de novo" }).click();
    await expect(reopened).toBeVisible();
    await again.keyboard.press("Escape");
    await expect(reopened).toHaveCount(0);

    await second.close();
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
