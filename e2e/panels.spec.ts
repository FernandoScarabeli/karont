import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { _electron as electron, expect, test } from "@playwright/test";

const mainEntry = path.resolve("packages/desktop/dist/main.js");

type NativeWindow = {
  karontNative: {
    request: (m: string, p: unknown) => Promise<{ result?: Record<string, unknown> }>;
  };
};

test("painéis: dois terminais lado a lado, sem violar a CSP; fechar o painel não encerra o terminal", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "kpanes-"));
  const env: Record<string, string> = {
    ...(process.env as Record<string, string>),
    KARONT_RUNTIME_DIR: path.join(root, "run"),
    KARONT_DATA_DIR: path.join(root, "data"),
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
    servicePid = info.result?.pid as number;

    // Primeiro terminal, já com comando.
    await window.getByRole("button", { name: "Nova conversa", exact: true }).click();
    const composer = window.locator("textarea").first();
    await composer.fill("echo painel-um");
    await composer.press("Enter");
    await expect(window.locator(".xterm-rows").first()).toContainText("painel-um");

    // Divide à direita e abre o segundo.
    await window.getByRole("button", { name: "Dividir" }).first().click();
    await window.getByText("Dividir à direita").click();
    const second = window.locator("textarea").last();
    await second.fill("echo painel-dois");
    await second.press("Enter");

    const rows = window.locator(".xterm-rows");
    await expect(rows).toHaveCount(2);
    await rows.nth(1).scrollIntoViewIfNeeded();
    await expect(rows.nth(1)).toContainText("painel-dois");
    await expect(window.locator('[role="separator"]')).toHaveCount(1);

    // Fechar o painel ativo: o terminal continua na sidebar e no serviço.
    await window.getByRole("button", { name: "Fechar painel" }).last().click();
    await expect(rows).toHaveCount(1);
    const list = await window.evaluate(() =>
      (globalThis as unknown as NativeWindow).karontNative.request("terminals.list", {}),
    );
    const terminals = (list.result?.terminals ?? []) as { exited: boolean }[];
    expect(terminals.filter((terminal) => !terminal.exited)).toHaveLength(2);

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
