import assert from "node:assert/strict";
import test from "node:test";
import { getConversationHistory } from "./conversationHistory.ts";

const message = (id, author, createdAt, parts = [], attachments) => ({
  id,
  conversationId: "conversation-1",
  author,
  status: "done",
  parts,
  ...(attachments ? { attachments } : {}),
  createdAt,
  updatedAt: createdAt,
});

test("inclui apenas mensagens do usuário e ordena da mais antiga à mais recente", () => {
  const older = message("older", "user", "2026-11-02T10:00:00.000Z", [
    { id: "p2", type: "text", markdown: "Segunda parte" },
  ]);
  const newer = message("newer", "user", "2026-11-02T12:00:00.000Z", [
    { id: "p3", type: "text", markdown: "  Pergunta recente  " },
  ]);
  const messages = [
    newer,
    message("agent", "agent", "2026-11-02T11:00:00.000Z", [
      { id: "p4", type: "text", markdown: "Resposta do agente" },
    ]),
    older,
  ];

  assert.deepEqual(
    getConversationHistory(messages).map(({ message: item, preview }) => [item.id, preview]),
    [
      ["older", "Segunda parte"],
      ["newer", "Pergunta recente"],
    ],
  );
});

test("usa o nome dos anexos quando a mensagem não tem texto", () => {
  const attachmentOnly = message(
    "attachment",
    "user",
    "2026-11-02T10:00:00.000Z",
    [],
    [
      { name: "rascunho.md", mimeType: "text/markdown", kind: "text", sizeBytes: 8 },
      { name: "imagem.png", mimeType: "image/png", kind: "image", sizeBytes: 16 },
    ],
  );

  assert.equal(getConversationHistory([attachmentOnly])[0]?.preview, "rascunho.md · imagem.png");
});

test("usa o texto quando a mensagem contém texto e anexos", () => {
  const withTextAndAttachment = message(
    "with-text",
    "user",
    "2026-11-02T10:00:00.000Z",
    [{ id: "p1", type: "text", markdown: "Leia o arquivo" }],
    [{ name: "notas.txt", mimeType: "text/plain", kind: "text", sizeBytes: 12 }],
  );

  assert.equal(getConversationHistory([withTextAndAttachment])[0]?.preview, "Leia o arquivo");
});
