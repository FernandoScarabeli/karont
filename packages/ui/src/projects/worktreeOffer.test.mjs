import assert from "node:assert/strict";
import test from "node:test";
import { shouldOfferSeparateCopy } from "./worktreeOffer.ts";

const busy = { projectId: "p", state: "working" };
const base = { projectId: "p", isTerminal: false, usesGit: true, conversations: [busy] };

test("oferece a cópia com Git e conversa ocupada na pasta do projeto", () => {
  assert.equal(shouldOfferSeparateCopy(base), true);
  for (const state of ["queued", "waiting"]) {
    assert.equal(
      shouldOfferSeparateCopy({ ...base, conversations: [{ projectId: "p", state }] }),
      true,
    );
  }
});

test("não oferece sem motivo", () => {
  assert.equal(
    shouldOfferSeparateCopy({ ...base, conversations: [{ ...busy, worktreeId: "w1" }] }),
    false,
    "ocupada em cópia separada",
  );
  assert.equal(shouldOfferSeparateCopy({ ...base, usesGit: false }), false, "sem Git");
  assert.equal(shouldOfferSeparateCopy({ ...base, projectId: undefined }), false, "sem projeto");
  assert.equal(shouldOfferSeparateCopy({ ...base, isTerminal: true }), false, "Terminal");
  assert.equal(
    shouldOfferSeparateCopy({ ...base, conversations: [{ projectId: "outro", state: "working" }] }),
    false,
    "ocupada em outro projeto",
  );
  assert.equal(
    shouldOfferSeparateCopy({
      ...base,
      conversations: [
        { projectId: "p", state: "idle" },
        { projectId: "p", state: "error" },
      ],
    }),
    false,
    "conversas paradas",
  );
  assert.equal(shouldOfferSeparateCopy({ ...base, conversations: [] }), false);
});
