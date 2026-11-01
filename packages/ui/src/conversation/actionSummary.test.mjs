import assert from "node:assert/strict";
import { test } from "node:test";
import {
  categoryForAction,
  groupConsecutiveActions,
  summarizeAction,
  summarizeActionGroup,
} from "./actionSummary.ts";

function action(actionType, title, input = "") {
  return {
    id: `${actionType}-${title}`,
    type: "action",
    actionType,
    title,
    input,
    output: "saída de exemplo",
    truncated: false,
    state: "ok",
    durationMs: 12,
  };
}

test("resume leituras e edições pelo caminho relativo", () => {
  assert.equal(
    summarizeAction(
      action("read", "Read · /home/dev/app/docs/SPEC.md", "/home/dev/app/docs/SPEC.md"),
      "/home/dev/app",
    ),
    "Leu docs/SPEC.md",
  );
  assert.equal(
    summarizeAction(
      action("edit", "Edit · /home/dev/app/src/app.ts", "/home/dev/app/src/app.ts"),
      "/home/dev/app",
    ),
    "Editou src/app.ts",
  );
});

test("resume comandos comuns sem expor o comando", () => {
  const tests = action("command", "Bash · npm test", "npm test");
  const read = action("command", "Bash · sed", "sed -n '1,240p' docs/SPEC.md");
  const search = action("command", "Bash · rg", "rg -n 'login' src");
  const list = action("command", "Bash · rg", "rg --files");

  assert.equal(categoryForAction(tests), "test");
  assert.equal(summarizeAction(tests, "/home/dev/app"), "Rodou testes");
  assert.equal(summarizeAction(read, "/home/dev/app"), "Leu docs/SPEC.md");
  assert.equal(summarizeAction(search, "/home/dev/app"), "Procurou por 'login'");
  assert.equal(summarizeAction(list, "/home/dev/app"), "Listou arquivos");
});

test("agrupa apenas ações consecutivas do mesmo tipo", () => {
  const actions = [
    action("read", "Leu src/app.ts", "src/app.ts"),
    action("read", "Leu docs/SPEC.md", "docs/SPEC.md"),
    action("edit", "Editou src/app.ts", "src/app.ts"),
    action("read", "Leu README.md", "README.md"),
  ];
  const groups = groupConsecutiveActions(actions);

  assert.deepEqual(
    groups.map((group) => group.actions.length),
    [2, 1, 1],
  );
  assert.equal(summarizeActionGroup(groups[0], "/home/dev/app"), "Leu 2 arquivos");
  assert.equal(summarizeActionGroup(groups[1], "/home/dev/app"), "Editou src/app.ts");
});
