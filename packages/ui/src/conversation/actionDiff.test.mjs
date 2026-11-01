import assert from "node:assert/strict";
import test from "node:test";
import { countDiffLines, parseFileChanges } from "./actionDiff.ts";

test("lê alterações do Codex em lista e em changes", () => {
  const changes = [{ path: "src/app.ts", kind: "update", diff: "@@ -1 +1 @@\n-old\n+new" }];

  assert.deepEqual(parseFileChanges(JSON.stringify(changes)), [
    { path: "src/app.ts", kind: "update", diff: "@@ -1 +1 @@\n-old\n+new" },
  ]);
  assert.deepEqual(parseFileChanges(JSON.stringify({ changes })), [
    { path: "src/app.ts", kind: "update", diff: "@@ -1 +1 @@\n-old\n+new" },
  ]);
});

test("lê o mapa de alterações emitido pelo adaptador Codex", () => {
  assert.deepEqual(
    parseFileChanges(
      JSON.stringify({
        "src/app.ts": { type: "update", diff: "@@ -1 +1 @@\n-old\n+new" },
        "src/new.ts": { type: "add", diff: "@@ -0,0 +1 @@\n+new" },
      }),
    ),
    [
      { path: "src/app.ts", kind: "update", diff: "@@ -1 +1 @@\n-old\n+new" },
      { path: "src/new.ts", kind: "add", diff: "@@ -0,0 +1 @@\n+new" },
    ],
  );
});

test("conta linhas sem incluir os cabeçalhos do diff unificado", () => {
  assert.deepEqual(
    countDiffLines(
      ["--- antes", "+++ depois", "@@ -1,2 +1,4 @@", "-antiga", "+nova", "+mais", "+++ c++"].join(
        "\n",
      ),
    ),
    { added: 3, removed: 1 },
  );
});

test("ignora saída que não contém um diff estruturado", () => {
  assert.deepEqual(parseFileChanges("saída comum do agente"), []);
});
