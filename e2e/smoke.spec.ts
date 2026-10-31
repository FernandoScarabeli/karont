import { mkdtemp, readdir, readlink, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { _electron as electron, expect, test } from "@playwright/test";

const mainEntry = path.resolve("packages/desktop/dist/main.js");

function isAlive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}

test("app abre, mostra a moldura e conversa com o serviço", async () => {
  // Pastas curtas e temporárias: nunca as do usuário (e o socket Unix tem limite de tamanho).
  const root = await mkdtemp(path.join(os.tmpdir(), "ke2e-"));
  const env: Record<string, string> = {
    ...(process.env as Record<string, string>),
    KARONT_RUNTIME_DIR: path.join(root, "run"),
    KARONT_DATA_DIR: path.join(root, "data"),
  };
  let servicePid: number | undefined;

  try {
    // chromiumSandbox: o Playwright passa --no-sandbox por padrão; o Karont nunca roda assim.
    const app = await electron.launch({ args: [mainEntry], env, chromiumSandbox: true });
    const window = await app.firstWindow();

    await expect(window.getByRole("heading", { name: "Início", level: 1 })).toBeVisible();
    await expect(window.getByRole("navigation", { name: "Navegação principal" })).toBeVisible();
    await expect(window.getByText("Serviço conectado")).toBeVisible();

    // A interface não tem acesso a Node.
    const sandboxed = await window.evaluate(
      () =>
        typeof (globalThis as { require?: unknown }).require === "undefined" &&
        typeof (globalThis as { process?: unknown }).process === "undefined",
    );
    expect(sandboxed).toBe(true);

    // Ida e volta pela ponte de canal único.
    const info = await window.evaluate(async () => {
      const native = (
        window as unknown as {
          karontNative: {
            request: (m: string, p: unknown) => Promise<{ ok: boolean; result?: { pid: number } }>;
          };
        }
      ).karontNative;
      return native.request("system.info", {});
    });
    expect(info.ok).toBe(true);
    servicePid = info.result?.pid;
    expect(typeof servicePid).toBe("number");

    // Método desconhecido é barrado no main.
    const denied = await window.evaluate(async () => {
      const native = (
        window as unknown as {
          karontNative: {
            request: (m: string, p: unknown) => Promise<{ ok: boolean; error?: { code: string } }>;
          };
        }
      ).karontNative;
      return native.request("fs.readFile", { path: "/etc/passwd" });
    });
    expect(denied).toMatchObject({ ok: false, error: { code: "unknown_method" } });

    // O serviço destacado não herda descritores do Electron (caches da GPU, sockets do Chromium…).
    if (servicePid && process.platform === "linux") {
      const fdDir = `/proc/${servicePid}/fd`;
      const targets = await Promise.all(
        (await readdir(fdDir)).map((fd) => readlink(`${fdDir}/${fd}`).catch(() => "")),
      );
      expect(targets.filter((target) => /Electron|GPUCache|Dawn/.test(target))).toEqual([]);
    }

    await app.close();

    // O serviço continua rodando com a janela fechada.
    expect(servicePid && isAlive(servicePid)).toBe(true);
  } finally {
    if (servicePid && isAlive(servicePid)) process.kill(servicePid, "SIGTERM");
    await rm(root, { recursive: true, force: true });
  }
});
