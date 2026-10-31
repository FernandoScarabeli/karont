import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { _electron as electron, expect, test } from "@playwright/test";

const mainEntry = path.resolve("packages/desktop/dist/main.js");

type NativeWindow = {
  karontNative: { request: (m: string, p: unknown) => Promise<{ result?: { pid?: number } }> };
};

test("Nova conversa → Terminal: abre um shell de verdade, sem violar a CSP; Configurações lista os agentes", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "kterm-"));
  const env: Record<string, string> = {
    ...(process.env as Record<string, string>),
    KARONT_RUNTIME_DIR: path.join(root, "run"),
    KARONT_DATA_DIR: path.join(root, "data"),
    // Os testes não podem depender das CLIs instaladas na máquina.
    KARONT_DISABLE_AGENT_DETECTION: "1",
  };
  let servicePid: number | undefined;

  try {
    const app = await electron.launch({ args: [mainEntry], env, chromiumSandbox: true });
    const window = await app.firstWindow();
    const cspViolations: string[] = [];
    window.on("console", (message) => {
      if (/Content Security Policy/i.test(message.text())) cspViolations.push(message.text());
    });

    await expect(window.getByText("Serviço conectado")).toBeVisible();
    const info = await window.evaluate(() =>
      (globalThis as unknown as NativeWindow).karontNative.request("system.info", {}),
    );
    servicePid = info.result?.pid;

    // Configurações › Agentes: com a detecção desligada, nada é encontrado (dado real, não inventado).
    await window.getByRole("button", { name: "Configurações" }).click();
    await window
      .getByRole("link", { name: "Agentes" })
      .or(window.getByRole("button", { name: "Agentes" }))
      .first()
      .click();
    await expect(window.getByText("0 de 10 encontrados")).toBeVisible();

    // Nova conversa → Terminal.
    await window.getByRole("button", { name: "Nova conversa", exact: true }).click();
    await window.getByRole("button", { name: "Abrir terminal" }).click();
    const rows = window.locator(".xterm-rows");
    await expect(rows).toBeVisible();
    await window.keyboard.type("echo karont-$((40+2))\n");
    // O xterm só desenha o que está visível: garanta a área na tela antes de ler o texto.
    await rows.scrollIntoViewIfNeeded();
    await expect(rows).toContainText("karont-42");

    // O terminal aparece na seção Conversas da sidebar.
    await expect(
      window
        .getByRole("navigation", { name: "Navegação principal" })
        .getByRole("button", { name: /bash|sh|zsh/ })
        .first(),
    ).toBeVisible();

    expect(cspViolations).toEqual([]);
    await app.close();
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
