import { readFileSync } from "node:fs";
import { createInterface } from "node:readline";

type FixtureLine = { direction: string; stream: string; line: string };
const fixturePath = process.env.KARONT_FAKE_CLAUDE_FIXTURE;
if (!fixturePath)
  throw new Error("KARONT_FAKE_CLAUDE_FIXTURE precisa apontar para uma gravação JSONL.");
const records = readFileSync(fixturePath, "utf8")
  .split(/\r?\n/)
  .filter(Boolean)
  .map((line) => JSON.parse(line) as FixtureLine);
let cursor = 0;

const stdin = createInterface({ input: process.stdin, crlfDelay: Infinity });
process.stdin.resume();
const keepAlive = setTimeout(() => undefined, 24 * 60 * 60 * 1_000);
stdin.once("close", () => clearTimeout(keepAlive));
stdin.on("line", (line) => {
  let host: Record<string, unknown>;
  try {
    host = JSON.parse(line) as Record<string, unknown>;
  } catch {
    fail("host enviou JSON inválido");
    return;
  }
  if (host.type === "control_request") {
    const request = host.request as Record<string, unknown> | undefined;
    if (request?.subtype === "initialize") {
      consumeHostRecord("control_request", "initialize");
      pump();
      return;
    }
    if (request?.subtype === "interrupt") {
      consumeHostRecord("control_request", "interrupt");
      pump();
      return;
    }
  }
  if (host.type === "user") {
    consumeHostRecord("user");
    pump();
    return;
  }
  if (host.type === "control_response") {
    const response = host.response as Record<string, unknown> | undefined;
    const actual = response?.response as Record<string, unknown> | undefined;
    const expected = consumeHostRecord("control_response");
    if (expected) {
      try {
        const captured = JSON.parse(expected.line) as Record<string, unknown>;
        const expectedResponse = captured.response as Record<string, unknown> | undefined;
        const expectedToolResponse = expectedResponse?.response as
          | Record<string, unknown>
          | undefined;
        if (expectedToolResponse?.behavior !== actual?.behavior)
          fail("resposta do host difere da gravação selecionada");
        if (
          expectedToolResponse?.updatedPermissions &&
          JSON.stringify(expectedToolResponse.updatedPermissions) !==
            JSON.stringify(actual?.updatedPermissions)
        )
          fail("updatedPermissions não corresponde à sugestão gravada");
      } catch (error) {
        fail(error instanceof Error ? error.message : String(error));
      }
    }
    pump();
  }
});

function consumeHostRecord(type: string, subtype?: string): FixtureLine | undefined {
  for (; cursor < records.length; cursor += 1) {
    const record = records[cursor];
    if (record?.direction !== "out" || record.stream !== "stdin") continue;
    let parsed: Record<string, unknown> = {};
    try {
      parsed = JSON.parse(record.line) as Record<string, unknown>;
    } catch {
      /* fixture rows are already validated by JSONL parsing */
    }
    const request = parsed.request as Record<string, unknown> | undefined;
    const matches = parsed.type === type && (subtype === undefined || request?.subtype === subtype);
    if (matches) {
      cursor += 1;
      return record;
    }
  }
  fail(`a gravação não contém saída de host ${type}${subtype ? `/${subtype}` : ""}`);
  return undefined;
}

function pump(): void {
  while (cursor < records.length) {
    const record = records[cursor];
    if (!record) return;
    if (record.direction === "out" && record.stream === "stdin") return;
    cursor += 1;
    if (record.direction === "stderr") process.stderr.write(`${record.line}\n`);
    else if (record.direction === "in" && record.stream === "stdout")
      process.stdout.write(`${record.line}\n`);
  }
  if (
    !records.some(
      (record) =>
        record.direction === "in" &&
        record.stream === "stdout" &&
        JSON.parse(record.line).type === "result",
    )
  )
    process.exit(1);
}

function fail(message: string): void {
  process.stderr.write(`fake claude: ${message}\n`);
  process.exitCode = 2;
}
