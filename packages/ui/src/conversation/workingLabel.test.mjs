import assert from "node:assert/strict";
import test from "node:test";
import {
  currentActionFiles,
  deriveWorkingLabel,
  getFinalRunningActions,
  lastThinkingSentence,
} from "./workingLabel.ts";

function action(id, actionType, title, input = "", state = "running") {
  return {
    id,
    type: "action",
    actionType,
    title,
    input,
    output: "",
    truncated: false,
    state,
    durationMs: null,
  };
}

test("usa rótulos de trabalho conforme a última parte e o estado", () => {
  assert.equal(deriveWorkingLabel(undefined, []), "Trabalhando");
  assert.equal(
    deriveWorkingLabel({ id: "text", type: "text", markdown: "Resposta parcial" }, []),
    "Respondendo",
  );
  assert.equal(
    deriveWorkingLabel({ id: "thinking", type: "thinking", text: "Vou conferir o fluxo." }, []),
    "Pensando",
  );

  const reading = action(
    "read",
    "read",
    "Read · /home/user/projeto/README.md",
    "/home/user/projeto/README.md",
  );
  assert.equal(deriveWorkingLabel(reading, [reading]), "Lendo README.md");
  assert.equal(
    deriveWorkingLabel(
      action(
        "edit",
        "edit",
        "Edit · /home/user/projeto/src/app.ts",
        "/home/user/projeto/src/app.ts",
      ),
      [
        action(
          "edit",
          "edit",
          "Edit · /home/user/projeto/src/app.ts",
          "/home/user/projeto/src/app.ts",
        ),
      ],
    ),
    "Editando app.ts",
  );

  const runningCommand = action("command", "command", "npm test", "npm test");
  assert.equal(deriveWorkingLabel(runningCommand, [runningCommand]), "Rodando npm test");
  assert.equal(
    deriveWorkingLabel(action("search", "search", "Buscou arquivos"), []),
    "Buscando arquivos",
  );
  assert.equal(deriveWorkingLabel(action("subagent", "subagent", "Task"), []), "Rodando subagente");
  assert.equal(
    deriveWorkingLabel({ ...action("mcp", "mcp", "lookup"), server: "docs", tool: "lookup" }, []),
    "Chamando docs · lookup",
  );
  assert.equal(
    deriveWorkingLabel(action("image", "image", "Gerou uma imagem"), []),
    "Gerando imagem",
  );
  assert.equal(deriveWorkingLabel(reading, [reading], true), "Parando");
  assert.equal(
    deriveWorkingLabel(action("done", "read", "Read · README.md", "", "ok"), []),
    "Trabalhando",
  );
});

test("coleta apenas arquivos das ações finais de leitura, edição e escrita", () => {
  const finishedRead = action("read-done", "read", "Read · /repo/antes.md", "/repo/antes.md", "ok");
  const currentRead = action("read-running", "read", "Read · /repo/README.md", "/repo/README.md");
  assert.deepEqual(getFinalRunningActions([finishedRead, currentRead]), [currentRead]);
  assert.deepEqual(currentActionFiles([currentRead]), ["README.md"]);

  const secondRead = action("read-next", "read", "Read · /repo/package.json", "/repo/package.json");
  const activeReads = getFinalRunningActions([finishedRead, currentRead, secondRead]);
  assert.equal(deriveWorkingLabel(secondRead, activeReads), "Lendo 2 arquivos");
  assert.deepEqual(currentActionFiles(activeReads), ["README.md", "package.json"]);

  const codexChange = action(
    "change",
    "edit",
    "Editou arquivos",
    "/home/user/projeto/src/app.ts\nsrc/styles.css",
  );
  assert.deepEqual(currentActionFiles([codexChange]), ["app.ts", "styles.css"]);

  const codexReadCommand = action("exec", "command", "cat README.md", "cat README.md");
  assert.deepEqual(currentActionFiles(getFinalRunningActions([codexReadCommand])), []);
  assert.equal(deriveWorkingLabel(codexReadCommand, [codexReadCommand]), "Rodando cat README.md");
});

test("mostra a última frase do raciocínio", () => {
  assert.equal(
    lastThinkingSentence({
      id: "thinking",
      type: "thinking",
      text: "Vou ler o arquivo. Depois, confiro a alteração final.",
    }),
    "Depois, confiro a alteração final.",
  );
  assert.equal(lastThinkingSentence(undefined), "");
});
