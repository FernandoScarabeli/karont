import assert from "node:assert/strict";
import { test } from "node:test";
import { mapClaudeToolAction, mapCodexSpecialAction } from "./tool-actions.ts";

test("Claude limita prompt e diff em bytes e mantém o JSON do diff válido", () => {
  const task = mapClaudeToolAction("Task", {
    description: "Revisar arquivos",
    prompt: "🙂".repeat(5_000),
  });
  assert.equal(Buffer.byteLength(task.input, "utf8") <= 8 * 1024, true);
  assert.equal(task.truncated, true);

  const edit = mapClaudeToolAction("Edit", {
    file_path: "src/modulo.ts",
    old_string: "linha antiga\n".repeat(12_000),
    new_string: "linha nova\n".repeat(12_000),
  });
  assert.equal(Buffer.byteLength(edit.output, "utf8") <= 64 * 1024, true);
  assert.equal(edit.truncated, true);
  assert.equal(JSON.parse(edit.output)[0]?.path, "src/modulo.ts");
});

test("Codex limita parâmetros e resultado MCP em bytes", () => {
  const mcp = mapCodexSpecialAction({
    type: "mcpToolCall",
    server: "docs",
    tool: "lookup",
    arguments: { value: "🙂".repeat(5_000) },
    result: "resultado longo ".repeat(5_000),
  });
  assert.ok(mcp);
  assert.equal(Buffer.byteLength(mcp.input, "utf8") <= 8 * 1024, true);
  assert.equal(Buffer.byteLength(mcp.output, "utf8") <= 64 * 1024, true);
  assert.equal(mcp.truncated, true);
});
