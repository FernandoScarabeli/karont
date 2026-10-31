import assert from "node:assert/strict";
import { mkdtemp, stat } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { test } from "node:test";
import { computeMac, createNonce, createSecret, readSecret, verifyMac } from "./auth.ts";

test("segredo e MAC são criados e comparados com tamanho seguro", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "ks-"));
  const secretPath = path.join(root, "service.secret");
  const secret = await createSecret(secretPath);
  const nonce = createNonce();
  const mac = computeMac(secret, nonce);

  assert.equal(secret.byteLength, 32);
  assert.match(nonce, /^[0-9a-f]{64}$/);
  assert.equal(await readSecret(secretPath).then((value) => value.equals(secret)), true);
  assert.equal(verifyMac(secret, nonce, mac), true);
  const tampered = `${mac.slice(0, -1)}${mac.endsWith("0") ? "1" : "0"}`;
  assert.equal(verifyMac(secret, nonce, tampered), false);
  assert.equal(verifyMac(secret, nonce, "abc"), false);
  assert.equal((await stat(secretPath)).mode & 0o777, 0o600);
});
