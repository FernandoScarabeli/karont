import assert from "node:assert/strict";
import { mkdir, mkdtemp, rm, symlink, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { resolveProtocolPath } from "./protocol-path.ts";

test("resolve arquivos internos do protocolo e recusa caminhos perigosos", async () => {
  const temporaryDirectory = await mkdtemp(path.join(os.tmpdir(), "karont-protocol-"));
  const distDirectory = path.join(temporaryDirectory, "dist");
  const outsideDirectory = path.join(temporaryDirectory, "outside");
  await mkdir(path.join(distDirectory, "assets"), { recursive: true });
  await mkdir(outsideDirectory);
  await writeFile(path.join(distDirectory, "index.html"), "interface");
  await writeFile(path.join(distDirectory, "assets", "app.js"), "bundle");
  await writeFile(path.join(outsideDirectory, "secret.txt"), "segredo");
  await symlink(path.join(outsideDirectory, "secret.txt"), path.join(distDirectory, "secret.txt"));

  try {
    assert.equal(
      await resolveProtocolPath("karont://app/", distDirectory),
      path.join(distDirectory, "index.html"),
    );
    assert.equal(
      await resolveProtocolPath("karont://app/assets/app.js", distDirectory),
      path.join(distDirectory, "assets", "app.js"),
    );
    for (const url of [
      "karont://app/../outside/secret.txt",
      "karont://app/%2e%2e/outside/secret.txt",
      "karont://app//etc/passwd",
      "karont://app/%2Fetc/passwd",
      "file:///etc/passwd",
      "karont://app/index.html?download=1",
      "karont://app/index.html#fragment",
      "karont://app/secret.txt",
    ]) {
      assert.equal(await resolveProtocolPath(url, distDirectory), null, url);
    }
  } finally {
    await rm(temporaryDirectory, { recursive: true, force: true });
  }
});
