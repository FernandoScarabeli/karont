import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { _electron as electron, expect, test } from "@playwright/test";

const mainEntry = path.resolve("packages/desktop/dist/main.js");

type NativeWindow = {
  karontNative: {
    request: (
      method: string,
      params: unknown,
    ) => Promise<{ ok: boolean; result?: { pid: number } }>;
  };
};

function isAlive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}

test("bloco de uso: oculto sem dados, valores reais e janela vencida", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "ke2e-"));
  const env: Record<string, string> = {
    ...(process.env as Record<string, string>),
    KARONT_RUNTIME_DIR: path.join(root, "run"),
    KARONT_SKIP_ONBOARDING: "1",
    KARONT_DISABLE_AGENT_DETECTION: "1",
    KARONT_DATA_DIR: path.join(root, "data"),
  };
  let servicePid: number | undefined;

  try {
    const app = await electron.launch({ args: [mainEntry], env, chromiumSandbox: true });
    const window = await app.firstWindow();
    await expect(window.getByRole("heading", { name: "Início", level: 1 })).toBeVisible();

    const info = await window.evaluate(() =>
      (globalThis as unknown as NativeWindow).karontNative.request("system.info", {}),
    );
    servicePid = info.result?.pid;

    const block = window.getByRole("region", { name: "Uso", exact: true });

    // Sem dados: o bloco nem aparece.
    await expect(block).toHaveCount(0);

    // Uma janela futura (27%) e uma vencida (91%, que não pode aparecer).
    const now = Date.now();
    const value = {
      agent: "codex",
      windows: [
        { id: "five_hour", usedPercent: 27, resetsAt: new Date(now + 4 * 3_600_000).toISOString() },
        { id: "weekly", usedPercent: 91, resetsAt: new Date(now - 60_000).toISOString() },
      ],
      observedAt: new Date(now - 5 * 60_000).toISOString(),
    };
    const saved = await window.evaluate(
      (payload) =>
        (globalThis as unknown as NativeWindow).karontNative.request("settings.set", {
          key: "usage.latest.codex",
          value: payload,
        }),
      value,
    );
    expect(saved.ok).toBe(true);

    await window.reload();
    await expect(window.getByRole("heading", { name: "Início", level: 1 })).toBeVisible();

    await expect(block).toBeVisible();
    await expect(block.getByText("27%")).toBeVisible();
    await expect(block.getByText("zerou")).toBeVisible();
    await expect(block.getByText("91%")).toHaveCount(0);
    await expect(block.getByText("—")).toBeVisible();
    await expect(block.getByText("Semana")).toBeVisible();
    await expect(block.getByText("há 5 min")).toBeVisible();
    await expect(
      block.getByRole("progressbar", { name: /5 horas: 27% usado, zera em 3h/ }),
    ).toBeVisible();

    // Atualizar não quebra o bloco (sem CLI, a leitura falha em silêncio e o valor fica).
    await block.getByRole("button", { name: "Atualizar uso" }).click();
    await expect(block.getByRole("button", { name: "Atualizar uso" })).toBeEnabled();
    await expect(block.getByText("27%")).toBeVisible();

    await app.close();
  } finally {
    if (servicePid && isAlive(servicePid)) process.kill(servicePid, "SIGTERM");
    await rm(root, { recursive: true, force: true });
  }
});
