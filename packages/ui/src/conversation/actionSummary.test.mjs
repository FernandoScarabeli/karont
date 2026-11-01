import assert from "node:assert/strict";
import { test } from "node:test";
import {
  categoryForAction,
  groupActionsByParentId,
  groupConsecutiveActions,
  summarizeAction,
  summarizeActionDiff,
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

test("resume subagente, MCP e geração de imagem", () => {
  const subagent = {
    ...action("subagent", "Pesquisar documentação"),
    title: "Pesquisar documentação",
  };
  const mcp = { ...action("mcp", "lookup"), server: "docs", tool: "lookup" };
  const image = action("image", "Gerou uma imagem");

  assert.equal(summarizeAction(subagent, "/repo"), "Subagente · Pesquisar documentação");
  assert.equal(summarizeAction(mcp, "/repo"), "docs · lookup");
  assert.equal(summarizeAction(action("mcp", "mcp__docs__lookup"), "/repo"), "docs · lookup");
  assert.equal(summarizeAction(image, "/repo"), "Gerou uma imagem");
  assert.deepEqual(
    groupConsecutiveActions([subagent, { ...subagent, id: "subagent-2" }]).map(
      (group) => group.actions.length,
    ),
    [1, 1],
  );
});

test("resume diff estruturado do Claude com caminho e contagem de linhas", () => {
  const edit = {
    ...action("edit", "Edit · /repo/app.ts", "/repo/app.ts"),
    output: JSON.stringify([
      {
        path: "/repo/app.ts",
        kind: { type: "update" },
        diff: "--- app.ts\n+++ app.ts\n@@ -1,2 +1,3 @@\n linha\n-antiga\n+nova\n+outra",
      },
    ]),
  };

  assert.equal(summarizeActionDiff(edit, "/repo"), "Editou app.ts +2 −1");
});

test("omite contagens de diff iguais a zero no resumo da ação", () => {
  const create = {
    ...action("write", "Write · /repo/a.txt", "/repo/a.txt"),
    output: JSON.stringify([
      {
        path: "/repo/a.txt",
        kind: "add",
        diff: "@@ -0,0 +1,3 @@\n+um\n+dois\n+três",
      },
    ]),
  };
  const remove = {
    ...action("edit", "Edit · /repo/a.txt", "/repo/a.txt"),
    output: JSON.stringify([
      {
        path: "/repo/a.txt",
        kind: "update",
        diff: "@@ -1,2 +0,0 @@\n-um\n-dois",
      },
    ]),
  };

  assert.equal(summarizeActionDiff(create, "/repo"), "Criou a.txt +3");
  assert.equal(summarizeActionDiff(remove, "/repo"), "Editou a.txt −2");
});

test("agrupa filhos do subagente e omite ações parentadas órfãs", () => {
  const parent = { ...action("subagent", "Revise o módulo"), id: "task-1" };
  const child = { ...action("read", "Read · src/app.ts"), id: "read-1", parentId: "task-1" };
  const orphan = { ...action("command", "npm test"), id: "orphan", parentId: "missing" };
  const standalone = action("edit", "Edit · src/ui.ts");

  assert.deepEqual(groupActionsByParentId([parent, child, orphan, standalone]), [
    { action: parent, children: [child] },
    { action: standalone, children: [] },
  ]);
});
