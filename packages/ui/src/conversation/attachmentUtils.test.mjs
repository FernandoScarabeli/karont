import assert from "node:assert/strict";
import test from "node:test";
import { classifyAttachmentFile, formatAttachmentSize } from "./attachmentUtils.ts";

test("classifica imagens permitidas pelo MIME ou pela extensão quando o MIME está vazio", () => {
  assert.deepEqual(classifyAttachmentFile({ name: "captura.webp", type: "image/webp" }), {
    kind: "image",
    mimeType: "image/webp",
  });
  assert.deepEqual(classifyAttachmentFile({ name: "captura.jpeg", type: "" }), {
    kind: "image",
    mimeType: "image/jpeg",
  });
  assert.equal(classifyAttachmentFile({ name: "vetor.svg", type: "image/svg+xml" }), null);
});

test("classifica texto, JSON e extensões comuns de código", () => {
  assert.deepEqual(classifyAttachmentFile({ name: "leia-me.txt", type: "text/plain" }), {
    kind: "text",
    mimeType: "text/plain",
  });
  assert.deepEqual(
    classifyAttachmentFile({ name: "dados.json", type: "application/octet-stream" }),
    {
      kind: "text",
      mimeType: "application/json",
    },
  );
  assert.deepEqual(classifyAttachmentFile({ name: "app.ts", type: "application/octet-stream" }), {
    kind: "text",
    mimeType: "text/plain",
  });
  assert.equal(classifyAttachmentFile({ name: "livro.pdf", type: "application/pdf" }), null);
});

test("formata o tamanho do anexo em pt-BR", () => {
  assert.equal(formatAttachmentSize(96), "96 B");
  assert.equal(formatAttachmentSize(1_500), "1,5 kB");
  assert.equal(formatAttachmentSize(5_000_000), "5 MB");
});
