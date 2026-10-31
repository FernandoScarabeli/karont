import assert from "node:assert/strict";
import test from "node:test";
import { applyDialogResult, decideOnClose, readStoredCloseBehavior } from "./close-behavior.ts";

test("decide a ação a partir da preferência guardada", async () => {
  for (const stored of ["ask", "background", "quit"] as const) {
    assert.equal(decideOnClose({ stored, quitting: false }), stored);
  }
  assert.equal(decideOnClose({ stored: "desconhecido", quitting: false }), "ask");
  assert.equal(decideOnClose({ stored: null, quitting: false }), "ask");
  assert.equal(decideOnClose({ stored: "quit", quitting: true }), "close");

  const stored = await readStoredCloseBehavior(async () => "background");
  assert.equal(decideOnClose({ stored, quitting: false }), "background");

  const missing = await readStoredCloseBehavior(async () => null);
  assert.equal(decideOnClose({ stored: missing, quitting: false }), "ask");

  const unavailable = await readStoredCloseBehavior(() => new Promise(() => undefined), 5);
  assert.equal(decideOnClose({ stored: unavailable, quitting: false }), "ask");
});

test("grava a escolha do diálogo apenas quando marcada e não cancelada", () => {
  assert.deepEqual(applyDialogResult({ response: 0, checkboxChecked: true }), {
    action: "background",
    preference: "background",
  });
  assert.deepEqual(applyDialogResult({ response: 0, checkboxChecked: false }), {
    action: "background",
    preference: null,
  });
  assert.deepEqual(applyDialogResult({ response: 1, checkboxChecked: true }), {
    action: "quit",
    preference: "quit",
  });
  assert.deepEqual(applyDialogResult({ response: 1, checkboxChecked: false }), {
    action: "quit",
    preference: null,
  });
  assert.deepEqual(applyDialogResult({ response: 2, checkboxChecked: true }), {
    action: "cancel",
    preference: null,
  });
  assert.deepEqual(applyDialogResult({ response: 2, checkboxChecked: false }), {
    action: "cancel",
    preference: null,
  });
});
