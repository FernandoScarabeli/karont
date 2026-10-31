import { createHmac, randomBytes, timingSafeEqual } from "node:crypto";
import { chmod, open, readFile, unlink } from "node:fs/promises";

export async function createSecret(secretPath: string): Promise<Buffer> {
  await unlink(secretPath).catch((error: NodeJS.ErrnoException) => {
    if (error.code !== "ENOENT") throw error;
  });

  const secret = randomBytes(32);
  const handle = await open(secretPath, "wx", 0o600);
  try {
    await handle.writeFile(secret.toString("hex"), "utf8");
    await handle.chmod(0o600);
  } finally {
    await handle.close();
  }
  await chmod(secretPath, 0o600);
  return secret;
}

export async function readSecret(secretPath: string): Promise<Buffer> {
  const serialized = (await readFile(secretPath, "utf8")).trim();
  if (!/^[0-9a-f]{64}$/i.test(serialized)) {
    throw new Error("O segredo do serviço local é inválido.");
  }
  return Buffer.from(serialized, "hex");
}

export function createNonce(): string {
  return randomBytes(32).toString("hex");
}

export function computeMac(secret: Buffer, nonce: string): string {
  return createHmac("sha256", secret).update(nonce, "utf8").digest("hex");
}

export function verifyMac(secret: Buffer, nonce: string, mac: string): boolean {
  if (!/^[0-9a-f]{64}$/i.test(mac)) return false;
  const expected = Buffer.from(computeMac(secret, nonce), "hex");
  const supplied = Buffer.from(mac, "hex");
  if (expected.byteLength !== supplied.byteLength) return false;
  return timingSafeEqual(expected, supplied);
}
