import assert from "node:assert/strict";
import { test } from "node:test";
import { getSystemUserName } from "./user-name.ts";

test("usa o primeiro nome do campo GECOS do usuário atual", async () => {
  const name = await getSystemUserName({
    userInfo: { uid: 1001, username: "fernando" },
    readPasswd: async () =>
      "outra:x:1000:1000:Outra Pessoa,,,\nfernando:x:1001:1001:Fernando Scarabeli,Room 4,,,:/home/fernando:/bin/bash\n",
    platform: "linux",
  });
  assert.equal(name, "Fernando");
});

test("usa o username quando o GECOS não está disponível", async () => {
  const name = await getSystemUserName({
    userInfo: { uid: 1001, username: "fernando" },
    readPasswd: async () => "fernando:x:1001:1001:,,,/home/fernando:/bin/bash\n",
    platform: "linux",
  });
  assert.equal(name, "fernando");
});

test("retorna null quando o sistema não informa um usuário", async () => {
  const name = await getSystemUserName({
    userInfo: { uid: 1001, username: "  " },
    platform: "linux",
    readPasswd: async () => "",
  });
  assert.equal(name, null);
});
