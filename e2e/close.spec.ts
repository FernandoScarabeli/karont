import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { type ElectronApplication, _electron as electron, expect, test } from "@playwright/test";

const mainEntry = path.resolve("packages/desktop/dist/main.js");

function isAlive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}

async function waitForExit(pid: number, timeoutMs = 5_000): Promise<boolean> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (!isAlive(pid)) return true;
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  return !isAlive(pid);
}

type NativeWindow = {
  karontNative: {
    request: (m: string, p: unknown) => Promise<{ ok: boolean; result?: Record<string, unknown> }>;
  };
};

async function launch(env: Record<string, string>) {
  const app = await electron.launch({ args: [mainEntry], env, chromiumSandbox: true });
  const window = await app.firstWindow();
  await expect(window.getByText("Serviço conectado")).toBeVisible();
  const info = await window.evaluate(() =>
    (globalThis as unknown as NativeWindow).karontNative.request("system.info", {}),
  );
  return { app, window, servicePid: info.result?.pid as number };
}

// Troca o diálogo nativo por uma resposta pronta e conta quantas vezes ele foi aberto.
async function stubDialog(app: ElectronApplication, response: number, checkboxChecked: boolean) {
  await app.evaluate(
    ({ dialog }, answer) => {
      const state = globalThis as unknown as { karontDialogCalls: number };
      state.karontDialogCalls = 0;
      dialog.showMessageBox = (async () => {
        state.karontDialogCalls += 1;
        return answer;
      }) as typeof dialog.showMessageBox;
    },
    { response, checkboxChecked },
  );
}

async function closeMainWindow(app: ElectronApplication) {
  await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0]?.close());
}

test("fechar a janela: segundo plano mantém tudo; fechar tudo encerra o serviço e lembra a escolha", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "kclose-"));
  const env: Record<string, string> = {
    ...(process.env as Record<string, string>),
    KARONT_RUNTIME_DIR: path.join(root, "run"),
    KARONT_DATA_DIR: path.join(root, "data"),
    KARONT_DISABLE_AGENT_DETECTION: "1",
  };
  const pids: number[] = [];

  try {
    // 1) "Deixar rodando em segundo plano", sem lembrar.
    const first = await launch(env);
    pids.push(first.servicePid);
    await stubDialog(first.app, 0, false);
    await closeMainWindow(first.app);
    await expect
      .poll(() =>
        first.app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0]?.isVisible()),
      )
      .toBe(false);
    expect(isAlive(first.servicePid)).toBe(true);
    expect(
      await first.app.evaluate(
        () => (globalThis as unknown as { karontDialogCalls: number }).karontDialogCalls,
      ),
    ).toBe(1);

    // 2) Volta a janela e escolhe "Fechar tudo" lembrando a escolha.
    await first.app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0]?.show());
    await stubDialog(first.app, 1, true);
    const exited = new Promise<void>((resolve) =>
      first.app.process().once("exit", () => resolve()),
    );
    await closeMainWindow(first.app);
    await exited;
    expect(await waitForExit(first.servicePid)).toBe(true);

    // 3) Reabrindo, a preferência "quit" foi guardada e o diálogo não aparece mais.
    const second = await launch(env);
    pids.push(second.servicePid);
    const stored = await second.window.evaluate(() =>
      (globalThis as unknown as NativeWindow).karontNative.request("settings.get", {
        key: "app.closeBehavior",
      }),
    );
    expect(stored.result?.value).toBe("quit");
    await stubDialog(second.app, 0, false);
    const exitedAgain = new Promise<void>((resolve) =>
      second.app.process().once("exit", () => resolve()),
    );
    await closeMainWindow(second.app);
    await exitedAgain;
    expect(await waitForExit(second.servicePid)).toBe(true);
  } finally {
    for (const pid of pids) if (isAlive(pid)) process.kill(pid, "SIGTERM");
    await rm(root, { recursive: true, force: true });
  }
});
