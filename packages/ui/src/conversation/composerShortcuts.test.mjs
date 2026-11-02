import assert from "node:assert/strict";
import test from "node:test";
import { composerAutocompleteKeyAction } from "../components/Composer/composerKeyboard.ts";
import {
  detectComposerShortcut,
  findMentionedSkills,
  fuzzyFilter,
  insertComposerShortcut,
  removeComposerCommand,
} from "./composerShortcuts.ts";

test("detecta atalhos no começo e depois de espaço na posição do cursor", () => {
  assert.deepEqual(detectComposerShortcut("@readme", 7), {
    type: "file",
    start: 0,
    caret: 7,
    tokenEnd: 7,
    query: "readme",
  });
  assert.equal(detectComposerShortcut("Leia @src/app.ts", 10)?.query, "src/");
  assert.equal(detectComposerShortcut("Leia @src/app.ts", 4), null);
  assert.equal(detectComposerShortcut("antes@depois", 13), null);
  assert.equal(detectComposerShortcut("$re", 3, false), null);
  assert.equal(detectComposerShortcut("Use $review", 11)?.type, "skill");
  assert.equal(detectComposerShortcut("/planejar", 9)?.type, "command");
});

test("fechar com Escape não altera o texto e não escolhe uma sugestão", () => {
  const value = "Leia @rea";
  const trigger = detectComposerShortcut(value, value.length);
  assert.ok(trigger);
  assert.equal(composerAutocompleteKeyAction("Escape", true), "close");
  assert.equal(composerAutocompleteKeyAction("Escape", false), null);
  assert.equal(value, "Leia @rea");
});

test("filtra por subsequência difusa e limita a lista", () => {
  const options = ["project-helper", "README.md", "repo-health"];
  assert.deepEqual(
    fuzzyFilter(options, "ph", (value) => value),
    ["repo-health", "project-helper"],
  );
  assert.deepEqual(
    fuzzyFilter(options, "readme", (value) => value, 1),
    ["README.md"],
  );
});

test("insere uma sugestão no token sob o cursor e mantém o restante do texto", () => {
  const value = "Leia @re depois";
  const trigger = detectComposerShortcut(value, 8);
  assert.ok(trigger);
  assert.deepEqual(insertComposerShortcut(value, trigger, "@src/readme.md "), {
    value: "Leia @src/readme.md depois",
    caret: 20,
  });
});

test("remove comando e recolhe o espaço entre o texto preservado", () => {
  const value = "Antes /compactar depois";
  const trigger = detectComposerShortcut(value, 16);
  assert.ok(trigger);
  assert.deepEqual(removeComposerCommand(value, trigger), {
    value: "Antes depois",
    caret: 6,
  });
});

test("skills só seguem no envio enquanto o nome continua no texto", () => {
  const catalog = [
    { name: "project-helper", path: "/projeto/.agents/skills/project-helper/SKILL.md" },
    { name: "review", path: "/projeto/.agents/skills/review/SKILL.md" },
  ];
  assert.deepEqual(findMentionedSkills("$project-helper confira $review", catalog), catalog);
  assert.deepEqual(findMentionedSkills("$project-helper $review", catalog, 1), [catalog[0]]);
  assert.deepEqual(findMentionedSkills("$project-helper confira", catalog), [catalog[0]]);
  assert.deepEqual(findMentionedSkills("$unknown", catalog), []);
});
