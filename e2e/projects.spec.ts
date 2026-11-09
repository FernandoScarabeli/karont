import { mkdir, mkdtemp, rm, stat } from "node:fs/promises";
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

test("projetos: criar, agrupar conversas, fechar o grupo, remover e erro de pasta repetida", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "kproj-"));
  const projectFolder = path.join(root, "meu-projeto");
  const env: Record<string, string> = {
    ...(process.env as Record<string, string>),
    KARONT_RUNTIME_DIR: path.join(root, "run"),
    KARONT_SKIP_ONBOARDING: "1",
    KARONT_DATA_DIR: path.join(root, "data"),
    KARONT_DISABLE_AGENT_DETECTION: "1",
  };
  let servicePid: number | undefined;

  try {
    await mkdir(projectFolder, { recursive: true });

    const app = await electron.launch({ args: [mainEntry], env, chromiumSandbox: true });
    const window = await app.firstWindow();
    await expect(window.getByText("Serviço conectado")).toBeVisible();
    const request = (method: string, params: unknown) =>
      window.evaluate(
        ([m, p]) => (globalThis as unknown as NativeWindow).karontNative.request(m as string, p),
        [method, params] as const,
      );
    servicePid = (await request("system.info", {})).result?.pid as number;

    const navigation = window.getByRole("navigation", { name: "Navegação principal" });
    await expect(navigation.getByText("Nenhum projeto ainda")).toBeVisible();

    // Cria o projeto digitando o caminho da pasta.
    await navigation.getByRole("button", { name: "Novo projeto", exact: true }).click();
    const dialog = window.getByRole("dialog", { name: "Novo projeto" });
    await expect(dialog.getByLabel("Nome")).toBeFocused();
    await dialog.getByLabel("Nome").fill("Projeto Teste");
    // O menu de ícones: Esc fecha só o menu, e clicar escolhe e fecha.
    const iconTrigger = dialog.getByRole("button", { name: /^Ícone: / });
    const rocket = dialog.getByRole("radio", { name: "Foguete" });
    await iconTrigger.click();
    await expect(rocket).toBeVisible();
    await window.keyboard.press("Escape");
    await expect(rocket).toBeHidden();
    await expect(dialog).toBeVisible();
    await expect(iconTrigger).toBeFocused();
    await iconTrigger.click();
    await rocket.click();
    await expect(rocket).toBeHidden();
    await expect(iconTrigger).toHaveAccessibleName("Ícone: Foguete");
    await dialog.getByRole("textbox", { name: "Pasta", exact: true }).fill(projectFolder);
    await dialog.getByRole("button", { name: "Criar projeto" }).click();
    await expect(dialog).toBeHidden();

    // O projeto aparece na sidebar e a nova conversa mostra o nome dele na faixa.
    const projectRow = navigation.getByRole("button", { name: "Projeto Teste", exact: true });
    await expect(projectRow).toBeVisible();
    await expect(projectRow).toHaveAttribute("aria-expanded", "true");
    await expect(
      window.getByRole("group", { name: /Projeto Projeto Teste, pasta / }),
    ).toBeVisible();
    await expect(navigation.getByText("Nenhuma conversa", { exact: true })).toBeVisible();

    // Pasta repetida mostra o erro dentro do diálogo.
    await navigation.getByRole("button", { name: "Novo projeto", exact: true }).click();
    await dialog.getByLabel("Nome").fill("Outro");
    await dialog.getByRole("textbox", { name: "Pasta", exact: true }).fill(projectFolder);
    await dialog.getByRole("button", { name: "Criar projeto" }).click();
    await expect(dialog.getByRole("alert")).toContainText(
      "Esta pasta já pertence a outro projeto.",
    );
    await dialog.getByRole("button", { name: "Cancelar" }).click();
    await expect(dialog).toBeHidden();

    // Uma conversa criada com projectId pela ponte aparece dentro do grupo.
    const listed = await request("projects.list", {});
    const projectId = ((listed.result?.projects ?? []) as { id: string }[])[0]?.id;
    expect(projectId).toBeTruthy();
    const created = await request("conversation.create", {
      agent: "claude",
      cwd: projectFolder,
      projectId,
      title: "Conversa do projeto",
    });
    expect(created.ok).toBe(true);
    // O serviço não emite evento ao criar pela ponte (a tela do app faz o upsert sozinha),
    // então recarregamos para ler a lista nova do serviço.
    await window.reload();
    await expect(window.getByText("Serviço conectado")).toBeVisible();
    const group = navigation.getByRole("list", { name: "Conversas de Projeto Teste" });
    await expect(
      group.getByRole("button", { name: "Conversa do projeto", exact: true }),
    ).toBeVisible();
    const looseList = navigation.getByRole("list", { name: "Conversas com agentes" });
    await expect(looseList).toHaveCount(0);

    // Fechar o grupo esconde a conversa; abrir de novo mostra.
    await projectRow.click();
    await expect(projectRow).toHaveAttribute("aria-expanded", "false");
    await expect(group).toHaveCount(0);
    await projectRow.click();
    await expect(
      group.getByRole("button", { name: "Conversa do projeto", exact: true }),
    ).toBeVisible();

    // Editar troca o nome, e a pasta fica só para leitura.
    await projectRow.hover();
    await navigation.getByRole("button", { name: "Ações de Projeto Teste" }).click();
    await window.getByRole("menuitem", { name: "Editar" }).click();
    const editDialog = window.getByRole("dialog", { name: "Editar projeto" });
    await expect(
      editDialog.getByRole("textbox", { name: "Pasta", exact: true }),
    ).not.toBeEditable();
    await editDialog.getByLabel("Nome").fill("Projeto Editado");
    await editDialog.getByRole("button", { name: "Salvar" }).click();
    await expect(editDialog).toBeHidden();
    const renamedRow = navigation.getByRole("button", { name: "Projeto Editado", exact: true });
    await expect(renamedRow).toBeVisible();

    // Remover o projeto leva a conversa para as soltas; a pasta continua existindo.
    await renamedRow.hover();
    await navigation.getByRole("button", { name: "Ações de Projeto Editado" }).click();
    await window.getByRole("menuitem", { name: "Remover" }).click();
    const removeDialog = window.getByRole("dialog", { name: "Remover Projeto Editado?" });
    await expect(removeDialog.getByRole("button", { name: "Cancelar" })).toBeFocused();
    await expect(removeDialog).toContainText("A pasta e os arquivos não são apagados");
    await removeDialog.getByRole("button", { name: "Remover projeto" }).click();
    await expect(removeDialog).toBeHidden();
    await expect(renamedRow).toHaveCount(0);
    await expect(
      navigation
        .getByRole("list", { name: "Conversas com agentes" })
        .getByRole("button", { name: "Conversa do projeto", exact: true }),
    ).toBeVisible();
    expect((await stat(projectFolder)).isDirectory()).toBe(true);

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
