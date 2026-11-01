import assert from "node:assert/strict";
import { test } from "node:test";
import type { ConversationAttachment } from "@karont/contract";
import {
  MAX_IMAGE_ATTACHMENT_BYTES,
  MAX_TEXT_ATTACHMENT_BYTES,
  validateAttachments,
} from "./attachments.ts";
import { ServiceError } from "./errors.ts";

const pngSignature = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]);

function pngAttachment(sizeBytes: number): ConversationAttachment {
  const bytes = Buffer.concat([pngSignature, Buffer.alloc(sizeBytes - pngSignature.length)]);
  return {
    name: "imagem.png",
    mimeType: "image/png",
    kind: "image",
    data: bytes.toString("base64"),
  };
}

function assertInvalidRequest(action: () => unknown, message: RegExp): void {
  assert.throws(action, (error: unknown) => {
    assert.ok(error instanceof ServiceError);
    assert.equal(error.code, "invalid_request");
    assert.match(error.message, message);
    return true;
  });
}

test("valida anexos e devolve apenas metadados de tamanho", () => {
  const result = validateAttachments([
    pngAttachment(8),
    { name: "notas.md", mimeType: "text/markdown", kind: "text", data: "Olá, mundo!" },
  ]);

  assert.deepEqual(result.metadata, [
    { name: "imagem.png", mimeType: "image/png", kind: "image", sizeBytes: 8 },
    { name: "notas.md", mimeType: "text/markdown", kind: "text", sizeBytes: 12 },
  ]);
  assert.equal(result.data[0]?.data, pngAttachment(8).data);
});

test("aceita imagem até 5 MB e recusa imagem maior ou tipo divergente", () => {
  assert.equal(
    validateAttachments([pngAttachment(MAX_IMAGE_ATTACHMENT_BYTES)]).metadata[0]?.sizeBytes,
    MAX_IMAGE_ATTACHMENT_BYTES,
  );
  assertInvalidRequest(
    () => validateAttachments([pngAttachment(MAX_IMAGE_ATTACHMENT_BYTES + 1)]),
    /excede o limite de 5 MB/u,
  );
  assertInvalidRequest(
    () => validateAttachments([{ ...pngAttachment(8), mimeType: "image/jpeg" }]),
    /não corresponde ao tipo image\/jpeg/u,
  );
});

test("aceita texto até 200 kB e recusa conteúdo ou MIME inválido", () => {
  const attachment: ConversationAttachment = {
    name: "dados.json",
    mimeType: "application/json",
    kind: "text",
    data: "é".repeat(MAX_TEXT_ATTACHMENT_BYTES / 2),
  };
  assert.equal(validateAttachments([attachment]).metadata[0]?.sizeBytes, MAX_TEXT_ATTACHMENT_BYTES);
  assertInvalidRequest(
    () => validateAttachments([{ ...attachment, data: `${attachment.data}é` }]),
    /excede o limite de 200 kB/u,
  );
  assertInvalidRequest(
    () => validateAttachments([{ ...attachment, mimeType: "application/pdf" }]),
    /tipo de arquivo de texto reconhecido/u,
  );
});

test("recusa base64 inválido e mais de oito anexos", () => {
  assertInvalidRequest(
    () => validateAttachments([{ ...pngAttachment(8), data: "not base64!" }]),
    /base64 válido/u,
  );
  const text: ConversationAttachment = {
    name: "arquivo.txt",
    mimeType: "text/plain",
    kind: "text",
    data: "x",
  };
  assertInvalidRequest(
    () => validateAttachments(Array.from({ length: 9 }, () => text)),
    /8 anexos/u,
  );
});
