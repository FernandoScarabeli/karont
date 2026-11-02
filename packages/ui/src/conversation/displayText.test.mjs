import assert from "node:assert/strict";
import test from "node:test";
import { cleanMarkdownPreview, formatConversationText, formatFolderPath } from "./displayText.ts";

test("converte caminhos dentro da conversa em caminhos relativos", () => {
  const result = formatConversationText(
    "Leu /home/ana/Área de trabalho/projeto/src/app.ts",
    "/home/ana/Área de trabalho/projeto",
  );

  assert.equal(result.text, "Leu src/app.ts");
  assert.equal(result.title, "Leu /home/ana/Área de trabalho/projeto/src/app.ts");
});

test("converte caminhos da pasta pessoal fora da conversa para ~", () => {
  const result = formatConversationText(
    "Leu /home/ana/.config/ferramenta/config.json",
    "/home/ana/projeto",
  );

  assert.equal(result.text, "Leu ~/.config/ferramenta/config.json");
});

test("não trata uma pasta irmã como se estivesse dentro da conversa", () => {
  const result = formatConversationText(
    "Leu /home/ana/projeto-antigo/src/app.ts",
    "/home/ana/projeto",
  );

  assert.equal(result.text, "Leu ~/projeto-antigo/src/app.ts");
});

test("encurta textos longos no meio e mantém o original no title", () => {
  const original = "Leu /home/ana/projeto/src/uma/pasta/muito/longa/app.ts";
  const result = formatConversationText(original, "/home/ana/projeto", 24);

  assert.equal(result.text.length, 24);
  assert.match(result.text, /…/u);
  assert.equal(result.title, original);
});

test("limpa marcação Markdown simples da prévia", () => {
  assert.equal(
    cleanMarkdownPreview(
      "## **Fase atual**\n- Leia `src/app.ts` e [confira](https://exemplo.test).",
    ),
    "Fase atual Leia src/app.ts e confira.",
  );
});

test("encurta a pasta exibida sem trocar o caminho completo acessível", () => {
  const result = formatFolderPath("/home/ana/Área de trabalho/projetos/karont", 18);

  assert.equal(result.text.length, 18);
  assert.match(result.text, /^~\//u);
  assert.equal(result.title, "/home/ana/Área de trabalho/projetos/karont");
});
