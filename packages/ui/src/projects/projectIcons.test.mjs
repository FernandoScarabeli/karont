import assert from "node:assert/strict";
import test from "node:test";
import { Folder } from "lucide-react";
import { getProjectIcon, PROJECT_ICONS } from "./projectIcons.ts";

test("ícone desconhecido cai em Folder", () => {
  assert.equal(getProjectIcon("nao-existe"), Folder);
  assert.equal(getProjectIcon(""), Folder);
});

test("a lista curada tem nomes únicos no formato aceito pelo serviço", () => {
  const names = PROJECT_ICONS.map((option) => option.name);
  assert.equal(new Set(names).size, names.length);
  for (const name of names) assert.match(name, /^[a-z0-9-]{1,40}$/);
  for (const option of PROJECT_ICONS) assert.equal(getProjectIcon(option.name), option.Icon);
});
