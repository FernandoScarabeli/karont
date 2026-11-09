import { chmod, mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { _electron as electron, expect, test } from "@playwright/test";

const mainEntry = path.resolve("packages/desktop/dist/main.js");

type NativeWindow = {
  karontNative: {
    request: (
      m: string,
      p: unknown,
    ) => Promise<{ ok: boolean; result?: Record<string, unknown>; error?: { message: string } }>;
  };
};

test("fila: limite 1 nas Configurações, segunda conversa espera, Parar tira da fila e aumentar o limite libera", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "kqueue-"));
  const projectFolder = path.join(root, "pasta");
  const fakeCli = path.join(root, "claude-falso.sh");
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
    await mkdir(projectFolder, { recursive: true });
    // CLI falsa: o turno fica em andamento sem nenhuma CLI real.
    await writeFile(fakeCli, "#!/bin/sh\nexec sleep 300\n");
    await chmod(fakeCli, 0o755);

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
      // Limite 1 pela tela de Configurações (o padrão é 4).
      await window.getByRole("button", { name: "Configurações" }).click();
      const decrease = window.getByRole("button", { name: "Diminuir limite" });
      const increase = window.getByRole("button", { name: "Aumentar limite" });
      const limitValue = window.getByRole("status").filter({ hasText: /agentes?$/ });
      await expect(limitValue).toHaveText("4 agentes");
      await decrease.click();
      await decrease.click();
      await decrease.click();
      await expect(limitValue).toHaveText("1 agente");
      await expect(decrease).toBeDisabled();

      // Duas conversas; a primeira ocupa a única vaga.
      for (const title of ["Conversa A", "Conversa B"]) {
        const created = await request("conversation.create", {
          agent: "claude",
          cwd: projectFolder,
          title,
        });
        expect(created.ok).toBe(true);
        const conversation = created.result?.conversation as { id: string } | undefined;
        expect(conversation?.id).toBeTruthy();
        conversationIds.push(conversation?.id ?? "");
      }
      const [idA, idB] = conversationIds as [string, string];
      // `conversation.send` só responde quando o turno termina: dispara sem esperar.
      const send = (id: string, text: string) => {
        void request?.("conversation.send", { id, text }).catch(() => undefined);
      };
      const queueStatus = async () => (await request?.("queue.status", {}))?.result;
      send(idA, "primeira");
      await expect.poll(queueStatus).toMatchObject({ limit: 1, running: 1 });
      send(idB, "segunda");
      await expect
        .poll(queueStatus)
        .toMatchObject({ limit: 1, running: 1, queuedConversationIds: [idB] });

      // O serviço não emite evento ao criar pela ponte: recarrega para ler a lista.
      await window.reload();
      await expect(window.getByText("Serviço conectado")).toBeVisible();
      const navigation = window.getByRole("navigation", { name: "Navegação principal" });
      const rowA = navigation.getByRole("button", { name: "Conversa A", exact: true });
      const rowB = navigation.getByRole("button", { name: "Conversa B", exact: true });
      await expect(rowB).toHaveAccessibleDescription(/Na fila/);
      await expect(rowB).toHaveAttribute("title", /Na fila/);
      await expect(rowA).not.toHaveAccessibleDescription(/Na fila/);

      // Abrindo a conversa na fila: aviso, sem indicador de trabalhando, botão Parar.
      await rowB.click();
      const notice = window
        .getByRole("status")
        .filter({ hasText: "Na fila: 1 agente trabalhando" });
      await expect(notice).toBeVisible();
      await expect(window.getByRole("button", { name: "Ajustar limite" })).toBeVisible();
      await expect(window.getByText("Pensando", { exact: true })).toHaveCount(0);
      const stop = window.getByRole("button", { name: "Parar", exact: true });
      await expect(stop).toBeVisible();

      // Parar tira da fila: o aviso some e a conversa volta a ficar parada.
      await stop.click();
      await expect(notice).toBeHidden();
      await expect(rowB).not.toHaveAccessibleDescription(/Na fila/);
      await expect.poll(queueStatus).toMatchObject({ queuedConversationIds: [] });

      // Manda de novo, volta a esperar e aumenta o limite para 2 pelas Configurações.
      send(idB, "de novo");
      await expect(notice).toBeVisible();
      await window.getByRole("button", { name: "Ajustar limite" }).click();
      await expect(limitValue).toHaveText("1 agente");
      await increase.click();
      await expect(limitValue).toHaveText("2 agentes");
      await expect(rowB).not.toHaveAccessibleDescription(/Na fila/);
      await expect(rowB).toHaveAccessibleDescription(/Trabalhando/);
      await expect
        .poll(queueStatus)
        .toMatchObject({ limit: 2, running: 2, queuedConversationIds: [] });
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
