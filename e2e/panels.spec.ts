import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { _electron as electron, expect, type Locator, type Page, test } from "@playwright/test";

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
    const second = window.locator("textarea").last();
    await second.fill("echo painel-dois");
    await second.press("Enter");

    const rows = window.locator(".xterm-rows");
    await expect(rows).toHaveCount(2);
    await rows.nth(1).scrollIntoViewIfNeeded();
    await expect(rows.nth(1)).toContainText("painel-dois");
    await expect(
      window.getByRole("separator", { name: "Redimensionar painéis lado a lado" }),
    ).toHaveCount(1);

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

type SettingsReply = { result?: { value?: unknown } };

async function launchEmpty() {
  const root = await mkdtemp(path.join(os.tmpdir(), "ksidebar-"));
  const env: Record<string, string> = {
    ...(process.env as Record<string, string>),
    KARONT_RUNTIME_DIR: path.join(root, "run"),
    KARONT_DATA_DIR: path.join(root, "data"),
    KARONT_DISABLE_AGENT_DETECTION: "1",
  };
  const app = await electron.launch({ args: [mainEntry], env, chromiumSandbox: true });
  const window = await app.firstWindow();
  await expect(window.getByText("Serviço conectado")).toBeVisible();
  return { app, window, root };
}

async function stopService(window: Page) {
  const info = await window.evaluate(() =>
    (globalThis as unknown as NativeWindow).karontNative.request("system.info", {}),
  );
  const pid = info.result?.pid as number | undefined;
  if (!pid) return;
  try {
    process.kill(pid, "SIGTERM");
  } catch {
    // já saiu
  }
}

test("Dividir abre à direita num clique; arrastar para o lado atual não muda nada nem mostra destaque", async () => {
  const { app, window, root } = await launchEmpty();
  try {
    await window.getByRole("button", { name: "Nova conversa", exact: true }).click();
    const regions = window.locator('[role="region"][data-active]');
    await expect(regions).toHaveCount(1);

    // Um clique, sem menu: o painel novo nasce à direita.
    await window.getByRole("button", { name: "Dividir" }).first().click();
    await expect(regions).toHaveCount(2);
    await expect(window.locator("[data-splitting]")).toHaveCount(0);
    await expect(window.getByRole("menu")).toHaveCount(0);
    await expect(window.getByRole("button", { name: "Dividir à direita" })).toHaveCount(0);
    const left = regions.nth(0);
    const right = regions.nth(1);
    const boxOf = async (locator: Locator) => {
      const box = await locator.boundingBox();
      if (!box) throw new Error("painel sem caixa");
      return box;
    };
    expect((await boxOf(left)).x).toBeLessThan((await boxOf(right)).x);

    // Marca os painéis: se o layout mudasse, eles seriam remontados e perderiam a marca.
    await left.evaluate((element) => element.setAttribute("data-mark", "esquerdo"));
    await right.evaluate((element) => element.setAttribute("data-mark", "direito"));
    const marked = (name: string) => window.locator(`[data-mark="${name}"]`);
    const zone = window.locator("[data-drop-zone]");

    // Arrasta o painel esquerdo até a borda esquerda do direito: continua A | B, sem destaque.
    const handle = left.locator('[draggable="true"]').first();
    const handleBox = await boxOf(handle);
    const rightBox = await boxOf(marked("direito"));
    const middleY = rightBox.y + rightBox.height / 2;
    await window.mouse.move(handleBox.x + handleBox.width / 2, handleBox.y + handleBox.height / 2);
    await window.mouse.down();
    await window.mouse.move(rightBox.x + 80, middleY, { steps: 8 });
    await window.mouse.move(rightBox.x + 12, middleY, { steps: 4 });
    await expect(zone).toHaveCount(0);

    // Na borda direita do mesmo painel a troca vale: o destaque aparece.
    await window.mouse.move(rightBox.x + rightBox.width - 80, middleY, { steps: 8 });
    await window.mouse.move(rightBox.x + rightBox.width - 12, middleY, { steps: 4 });
    await expect(zone).toHaveCount(1);
    await expect(zone).toHaveAttribute("data-drop-zone", "right");

    // De volta ao lado atual, o destaque some e soltar não faz nada.
    await window.mouse.move(rightBox.x + 80, middleY, { steps: 8 });
    await window.mouse.move(rightBox.x + 12, middleY, { steps: 4 });
    await expect(zone).toHaveCount(0);
    await window.mouse.up();
    await expect(marked("esquerdo")).toHaveCount(1);
    await expect(marked("direito")).toHaveCount(1);
    expect((await boxOf(marked("esquerdo"))).x).toBeLessThan((await boxOf(marked("direito"))).x);

    // Soltar na borda que muda a ordem troca os painéis.
    const handleAgain = await boxOf(marked("esquerdo").locator('[draggable="true"]').first());
    const target = await boxOf(marked("direito"));
    await window.mouse.move(
      handleAgain.x + handleAgain.width / 2,
      handleAgain.y + handleAgain.height / 2,
    );
    await window.mouse.down();
    await window.mouse.move(target.x + target.width - 80, target.y + target.height / 2, {
      steps: 8,
    });
    await window.mouse.move(target.x + target.width - 12, target.y + target.height / 2, {
      steps: 4,
    });
    await expect(zone).toHaveCount(1);
    await window.mouse.up();
    await expect(zone).toHaveCount(0);
    await expect(window.locator('[role="region"][data-active]')).toHaveCount(2);
    const order = await window
      .locator('[role="region"][data-active]')
      .evaluateAll((elements) => elements.map((element) => element.getBoundingClientRect().x));
    expect(order[0]).toBeLessThan(order[1] ?? 0);
    // Os painéis foram remontados na nova ordem: as marcas antigas não existem mais.
    await expect(window.locator("[data-mark]")).toHaveCount(0);
  } finally {
    await stopService(window).catch(() => {});
    await app.close();
    await rm(root, { recursive: true, force: true });
  }
});

test("barra lateral: arrastar muda a largura, recolher vira faixa de ícones e o estado volta ao recarregar", async () => {
  const { app, window, root } = await launchEmpty();
  try {
    const aside = window.getByRole("complementary", { name: "Barra lateral" });
    const widthOf = async () => (await aside.boundingBox())?.width ?? 0;
    const savedValue = async () => {
      const reply = (await window.evaluate(() =>
        (globalThis as unknown as NativeWindow).karontNative.request("settings.get", {
          key: "shell.sidebar",
        }),
      )) as SettingsReply;
      return reply.result?.value ?? null;
    };
    const handle = window.getByRole("separator", { name: "Largura da barra lateral" });
    const close = window.getByRole("button", { name: "Fechar barra lateral" });
    const open = window.getByRole("button", { name: "Abrir barra lateral" });
    // O bloco da marca tem a largura da sidebar mais a linha da alça, o tempo todo.
    const brand = window.locator("header > div").first();
    const brandMatches = async () => {
      const [asideBox, brandBox] = await Promise.all([aside.boundingBox(), brand.boundingBox()]);
      return Math.abs((brandBox?.width ?? 0) - ((asideBox?.width ?? 0) + 1)) <= 1;
    };

    // Largura padrão; nada foi salvo só por abrir.
    await expect.poll(widthOf).toBeCloseTo(232, 0);
    expect(await savedValue()).toBeNull();

    // Arrastar a borda muda a largura e só salva ao soltar.
    const box = await handle.boundingBox();
    if (!box) throw new Error("alça sem caixa");
    const y = box.y + box.height / 2;
    await window.mouse.move(box.x + box.width / 2, y);
    await window.mouse.down();
    await window.mouse.move(box.x + 40, y, { steps: 8 });
    await window.mouse.move(box.x + 60, y, { steps: 4 });
    expect(await savedValue()).toBeNull();
    await window.mouse.up();
    await expect.poll(widthOf).toBeCloseTo(292, -1);
    await expect.poll(brandMatches).toBe(true);
    await expect.poll(savedValue).toMatchObject({ collapsed: false });
    const draggedWidth = ((await savedValue()) as { width: number }).width;
    expect(draggedWidth).toBeGreaterThan(280);

    // Teclado: seta para a direita alarga.
    await handle.focus();
    await window.keyboard.press("ArrowRight");
    await expect.poll(widthOf).toBeGreaterThan(draggedWidth + 20);
    await expect
      .poll(async () => ((await savedValue()) as { width: number }).width)
      .toBeGreaterThan(draggedWidth + 20);
    const savedWidth = ((await savedValue()) as { width: number }).width;

    // Fechar: faixa de ícones, foco no botão de abrir, conteúdo fora do alcance.
    await close.click();
    // É o mesmo botão no topo: o foco continua nele, agora com o nome de abrir.
    await expect(open).toBeFocused();
    await expect.poll(widthOf).toBeCloseTo(48, 0);
    await expect.poll(brandMatches).toBe(true);
    await expect(window.getByText("karont", { exact: true })).toBeHidden();
    await expect(window.getByRole("heading", { name: "Projetos" })).toBeHidden();
    await expect(close).toBeHidden();
    await expect.poll(savedValue).toMatchObject({ collapsed: true });

    // A faixa faz o mesmo que a sidebar.
    const railNew = aside.getByRole("button", { name: "Nova conversa", exact: true });
    await railNew.click();
    await expect(railNew).toHaveAttribute("aria-current", "page");
    const railInbox = aside.getByRole("button", { name: "Caixa de entrada" });
    await railInbox.click();
    await expect(railInbox).toHaveAttribute("aria-current", "page");
    await expect(railNew).not.toHaveAttribute("aria-current", "page");
    await expect(aside.getByRole("button", { name: "Tarefas" })).toBeDisabled();
    const railSettings = aside.getByRole("button", { name: "Configurações" });
    await railSettings.click();
    await expect(railSettings).toHaveAttribute("aria-current", "page");
    await railNew.hover();
    await expect(aside.getByRole("tooltip", { includeHidden: true }).first()).toBeAttached();

    // Recarregar mantém recolhida, sem passar pela barra aberta.
    await window.reload();
    await expect(open).toBeVisible();
    await expect.poll(widthOf).toBeCloseTo(48, 0);

    // Abrir: volta à largura salva e o foco vai para o botão de fechar.
    await open.click();
    await expect(close).toBeFocused();
    await expect.poll(brandMatches).toBe(true);
    await expect(window.getByText("karont", { exact: true })).toBeVisible();
    await expect.poll(widthOf).toBeCloseTo(savedWidth, 0);
    await expect.poll(savedValue).toEqual({ width: savedWidth, collapsed: false });

    await window.reload();
    await expect(close).toBeVisible();
    await expect.poll(widthOf).toBeCloseTo(savedWidth, 0);

    // Duplo clique na alça recolhe e reabre.
    await handle.dblclick();
    await expect.poll(widthOf).toBeCloseTo(48, 0);
    await handle.dblclick();
    await expect.poll(widthOf).toBeCloseTo(savedWidth, 0);
  } finally {
    await stopService(window).catch(() => {});
    await app.close();
    await rm(root, { recursive: true, force: true });
  }
});

for (const reducedMotion of [false, true]) {
  test(`Dividir ${reducedMotion ? "sem animação (movimento reduzido)" : "animado"}: no fim o painel novo está à direita, com metade da largura e o foco, mesmo com cliques seguidos`, async () => {
    const { app, window, root } = await launchEmpty();
    try {
      await window.emulateMedia({ reducedMotion: reducedMotion ? "reduce" : "no-preference" });
      await window.getByRole("button", { name: "Nova conversa", exact: true }).click();
      const regions = window.locator('[role="region"][data-active]');
      await expect(regions).toHaveCount(1);
      const splitting = window.locator("[data-splitting]");

      await window.getByRole("button", { name: "Dividir" }).first().click();
      await expect(regions).toHaveCount(2);
      // Termina o movimento: nada de largura fixa nem marca de animação sobrando.
      await expect(splitting).toHaveCount(0);
      const [left, right] = await Promise.all([
        regions.nth(0).boundingBox(),
        regions.nth(1).boundingBox(),
      ]);
      if (!left || !right) throw new Error("painéis sem caixa");
      expect(left.x).toBeLessThan(right.x);
      expect(Math.abs(left.width - right.width)).toBeLessThanOrEqual(2);
      await expect
        .poll(() => regions.nth(1).evaluate((element) => element.matches(":focus-within")))
        .toBe(true);

      // Dividir de novo, em seguida: três painéis, sem tamanho errado no fim.
      await window.getByRole("button", { name: "Dividir" }).nth(1).click();
      await window.getByRole("button", { name: "Dividir" }).nth(2).click();
      await expect(regions).toHaveCount(4);
      await expect(splitting).toHaveCount(0);
      const widths = await regions.evaluateAll((elements) =>
        elements.map((element) => element.getBoundingClientRect().width),
      );
      const total = widths.reduce((sum, width) => sum + width, 0);
      for (const width of widths) {
        expect(width).toBeGreaterThan(total * 0.12);
        expect(width).toBeLessThan(total * 0.6);
      }
    } finally {
      await stopService(window).catch(() => {});
      await app.close();
      await rm(root, { recursive: true, force: true });
    }
  });
}
