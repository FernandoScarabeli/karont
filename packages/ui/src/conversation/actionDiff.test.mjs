import assert from "node:assert/strict";
import test from "node:test";
import {
  countDiffLines,
  formatDiffStats,
  getDiffDisplayLines,
  parseFileChanges,
} from "./actionDiff.ts";

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

test("lê o tipo de mudança Claude quando kind é estruturado", () => {
  assert.deepEqual(
    parseFileChanges(
      JSON.stringify([
        { path: "src/app.ts", kind: { type: "update" }, diff: "@@ -1 +1 @@\n-old\n+new" },
      ]),
    ),
    [{ path: "src/app.ts", kind: "update", diff: "@@ -1 +1 @@\n-old\n+new" }],
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

test("omite a contagem de edição que for zero", () => {
  assert.equal(formatDiffStats(3, 0), "+3");
  assert.equal(formatDiffStats(0, 2), "−2");
  assert.equal(formatDiffStats(1, 1), "+1 −1");
  assert.equal(formatDiffStats(0, 0), "");
});

test("remove cabeçalhos do diff e oculta o único hunk", () => {
  const lines = getDiffDisplayLines(
    [
      "diff --git a/src/app.ts b/src/app.ts",
      "index 1234567..abcdef0 100644",
      "--- a/src/app.ts",
      "+++ b/src/app.ts",
      "@@ -1 +1 @@",
      "-antes",
      "+depois",
    ].join("\n"),
  );

  assert.deepEqual(lines, [
    { text: "-antes", kind: "removed" },
    { text: "+depois", kind: "added" },
  ]);
});

test("mantém hunks múltiplos como separadores discretos", () => {
  assert.deepEqual(
    getDiffDisplayLines(["@@ -1 +1 @@", "-antes", "+depois", "@@ -5 +5 @@", "-x", "+y"].join("\n")),
    [
      { text: "@@ -1 +1 @@", kind: "hunk" },
      { text: "-antes", kind: "removed" },
      { text: "+depois", kind: "added" },
      { text: "@@ -5 +5 @@", kind: "hunk" },
      { text: "-x", kind: "removed" },
      { text: "+y", kind: "added" },
    ],
  );
});

test("ignora saída que não contém um diff estruturado", () => {
  assert.deepEqual(parseFileChanges("saída comum do agente"), []);
});
