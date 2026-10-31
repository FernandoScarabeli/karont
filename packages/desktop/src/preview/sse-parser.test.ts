import assert from "node:assert/strict";
import { test } from "node:test";
import { createSseParser } from "../../../ui/src/bridge/sse.ts";

test("junta eventos que chegam partidos entre leituras", () => {
  const events: string[] = [];
  const parser = createSseParser((data) => events.push(data));
  parser.push('data: {"event":"');
  parser.push('bridge.status","payload":{"state":"connected"}}\n');
  parser.push("\n");
  assert.deepEqual(events, ['{"event":"bridge.status","payload":{"state":"connected"}}']);
});

test("separa vários eventos recebidos no mesmo pedaço", () => {
  const events: string[] = [];
  const parser = createSseParser((data) => events.push(data));
  parser.push("data: primeiro\n\ndata: segundo\n\n");
  assert.deepEqual(events, ["primeiro", "segundo"]);
});

test("ignora comentários SSE", () => {
  const events: string[] = [];
  const parser = createSseParser((data) => events.push(data));
  parser.push(": comentário\n\ndata: útil\n\n");
  assert.deepEqual(events, ["útil"]);
});

test("trata quebras CRLF inclusive quando chegam em pedaços diferentes", () => {
  const events: string[] = [];
  const parser = createSseParser((data) => events.push(data));
  parser.push("data: um\r");
  parser.push("\n\r\ndata: dois\r\n\r\n");
  assert.deepEqual(events, ["um", "dois"]);
});
