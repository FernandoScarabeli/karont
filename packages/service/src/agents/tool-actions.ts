import { constants } from "node:fs";
import { lstat, open, realpath } from "node:fs/promises";
import pathModule from "node:path";

export type FileChangeRecord = { path: string; kind: unknown; diff: string };

const TRUNCATION_MARKER = "\n… [truncado]";
const MAX_DIFF_FILE_BYTES = 2 * 1024 * 1024;
const MAX_DIFF_WORK = 200_000;

export function truncateUtf8(
  value: string,
  maxBytes: number,
): { text: string; truncated: boolean } {
  if (Buffer.byteLength(value, "utf8") <= maxBytes) return { text: value, truncated: false };
  const markerBytes = Buffer.byteLength(TRUNCATION_MARKER, "utf8");
  const budget = Math.max(0, maxBytes - markerBytes);
  let text = "";
  for (const character of value) {
    if (Buffer.byteLength(text, "utf8") + Buffer.byteLength(character, "utf8") > budget) break;
    text += character;
  }
  return { text: text + TRUNCATION_MARKER, truncated: true };
}

export function serializeFileChanges(
  changes: FileChangeRecord[],
  maxBytes: number,
): { text: string; truncated: boolean } {
  const accepted: FileChangeRecord[] = [];
  for (const change of changes) {
    const candidate = [...accepted, change];
    const text = JSON.stringify(candidate);
    if (Buffer.byteLength(text, "utf8") <= maxBytes) {
      accepted.push(change);
      continue;
    }

    const diffPoints = Array.from(change.diff);
    let low = 0;
    let high = diffPoints.length;
    let best = "";
    while (low <= high) {
      const middle = Math.floor((low + high) / 2);
      const isFullDiff = middle === diffPoints.length;
      const diff = `${diffPoints.slice(0, middle).join("")}${isFullDiff ? "" : TRUNCATION_MARKER}`;
      const boundedText = JSON.stringify([...accepted, { ...change, diff }]);
      if (Buffer.byteLength(boundedText, "utf8") <= maxBytes) {
        best = boundedText;
        low = middle + 1;
      } else high = middle - 1;
    }
    if (best) return { text: best, truncated: true };
    return { text: JSON.stringify(accepted), truncated: true };
  }
  return { text: JSON.stringify(accepted), truncated: false };
}

export function replacementDiff(oldText: string, newText: string): string {
  const oldLines = diffLines(oldText);
  const newLines = diffLines(newText);
  return [...oldLines.map((line) => `-${line}`), ...newLines.map((line) => `+${line}`)].join("\n");
}

export function unifiedDiff(path: string, kind: string, hunks: string[]): string {
  const oldPath = kind === "add" ? "/dev/null" : path;
  const newPath = kind === "delete" ? "/dev/null" : path;
  return [`--- ${oldPath}`, `+++ ${newPath}`, ...hunks].join("\n");
}

function diffLines(value: string): string[] {
  if (!value) return [];
  const lines = value.replaceAll("\r\n", "\n").split("\n");
  if (value.endsWith("\n") && lines.at(-1) === "") lines.pop();
  return lines;
}

type Action = Extract<import("@karont/contract").MessagePart, { type: "action" }>;
export type MappedActionData = Pick<
  Action,
  "actionType" | "title" | "input" | "output" | "truncated"
> &
  Pick<Action, "server" | "tool" | "parentId">;

export async function mapClaudeToolAction(
  name: string,
  input: Record<string, unknown>,
  parentId?: string,
  cwd?: string,
): Promise<MappedActionData> {
  const withParent = (action: MappedActionData): MappedActionData =>
    parentId ? { ...action, parentId } : action;
  if (name === "Edit") {
    const path = stringValue(input.file_path);
    const oldText = stringValue(input.old_string);
    const newText = stringValue(input.new_string);
    const before = path ? await readSafeFile(path, cwd) : { status: "unavailable" as const };
    const edits = [{ oldText, newText, replaceAll: input.replace_all === true }];
    const applied = before.status === "read" ? applyEdits(before.content, edits) : undefined;
    const positioned =
      before.status === "read" && applied?.positioned
        ? makeUnifiedHunks(before.content, applied.content)
        : undefined;
    const hunks = positioned ?? edits.map((edit) => replacementDiff(edit.oldText, edit.newText));
    const fileChanges = path
      ? [
          {
            path,
            kind: { type: "update" },
            diff: unifiedDiff(path, "update", hunks),
          },
        ]
      : [];
    const output = serializeFileChanges(fileChanges, 64 * 1024);
    const boundedInput = truncateUtf8(path || "", 8 * 1024);
    return withParent({
      actionType: "edit",
      title: `${name}${path ? ` · ${path}` : ""}`,
      input: boundedInput.text,
      output: output.text,
      truncated: boundedInput.truncated || output.truncated,
    });
  }
  if (name === "NotebookEdit") {
    const path = stringValue(input.file_path);
    const oldText = stringValue(input.old_string);
    const newText = stringValue(input.new_string);
    const fileChanges = path
      ? [
          {
            path,
            kind: { type: "update" },
            diff: unifiedDiff(path, "update", [replacementDiff(oldText, newText)]),
          },
        ]
      : [];
    const output = serializeFileChanges(fileChanges, 64 * 1024);
    const boundedInput = truncateUtf8(path || "", 8 * 1024);
    return withParent({
      actionType: "edit",
      title: `NotebookEdit${path ? ` · ${path}` : ""}`,
      input: boundedInput.text,
      output: output.text,
      truncated: boundedInput.truncated || output.truncated,
    });
  }
  if (name === "MultiEdit") {
    const path = stringValue(input.file_path);
    const edits = Array.isArray(input.edits) ? input.edits.filter(isRecord) : [];
    const replacements = edits.map((edit) => ({
      oldText: stringValue(edit.old_string),
      newText: stringValue(edit.new_string),
      replaceAll: edit.replace_all === true,
    }));
    const before = path ? await readSafeFile(path, cwd) : { status: "unavailable" as const };
    const applied = before.status === "read" ? applyEdits(before.content, replacements) : undefined;
    const positioned =
      before.status === "read" && applied?.positioned
        ? makeUnifiedHunks(before.content, applied.content)
        : undefined;
    const hunks =
      positioned ?? replacements.map((edit) => replacementDiff(edit.oldText, edit.newText));
    const fileChanges = path.length
      ? [{ path, kind: { type: "update" }, diff: unifiedDiff(path, "update", hunks) }]
      : [];
    const output = serializeFileChanges(fileChanges, 64 * 1024);
    const boundedInput = truncateUtf8(path || "", 8 * 1024);
    return withParent({
      actionType: "edit",
      title: `MultiEdit${path ? ` · ${path}` : ""}`,
      input: boundedInput.text,
      output: output.text,
      truncated: boundedInput.truncated || output.truncated,
    });
  }
  if (name === "Write") {
    const path = stringValue(input.file_path);
    const content = stringValue(input.content);
    const previous = path ? await readSafeFile(path, cwd) : { status: "unavailable" as const };
    const lines = diffLines(content);
    const kind = previous.status === "missing" ? "add" : "update";
    const hunks =
      previous.status === "missing"
        ? [`@@ -0,0 +1,${lines.length} @@\n${lines.map((line) => `+${line}`).join("\n")}`]
        : previous.status === "read"
          ? (makeUnifiedHunks(previous.content, content) ?? [
              replacementDiff(previous.content, content),
            ])
          : [lines.map((line) => `+${line}`).join("\n")];
    const diff = unifiedDiff(path, kind, hunks);
    const output = serializeFileChanges(
      path
        ? [{ path, kind: { type: previous.status === "missing" ? "add" : "update" }, diff }]
        : [],
      64 * 1024,
    );
    const boundedInput = truncateUtf8(path || "", 8 * 1024);
    return withParent({
      actionType: "write",
      title: `Write${path ? ` · ${path}` : ""}`,
      input: boundedInput.text,
      output: output.text,
      truncated: boundedInput.truncated || output.truncated,
    });
  }
  if (name === "Task") {
    const description = stringValue(input.description);
    const boundedInput = truncateUtf8(stringValue(input.prompt) || description, 8 * 1024);
    return withParent({
      actionType: "subagent" as Action["actionType"],
      title: description || "Subagente",
      input: boundedInput.text,
      output: "",
      truncated: boundedInput.truncated,
    });
  }
  const mcp = parseClaudeMcpToolName(name);
  if (mcp) {
    const boundedInput = truncateUtf8(jsonText(input), 8 * 1024);
    return withParent({
      actionType: "mcp" as Action["actionType"],
      title: `${mcp.tool} (${mcp.server})`,
      input: boundedInput.text,
      output: "",
      truncated: boundedInput.truncated,
      server: mcp.server,
      tool: mcp.tool,
    });
  }
  const actionType = claudeActionType(name);
  const title = claudeActionTitle(name, input);
  const boundedInput = truncateUtf8(summarizeClaudeInput(input, name === "Bash"), 8 * 1024);
  return withParent({
    actionType,
    title,
    input: boundedInput.text,
    output: "",
    truncated: boundedInput.truncated,
  });
}

type FileReadResult =
  | { status: "read"; content: string }
  | { status: "missing" }
  | { status: "unavailable" };

async function readSafeFile(filePath: string, cwd = process.cwd()): Promise<FileReadResult> {
  try {
    const candidate = pathModule.isAbsolute(filePath)
      ? pathModule.resolve(filePath)
      : pathModule.resolve(cwd, filePath);
    let parent: string;
    try {
      parent = await realpath(pathModule.dirname(candidate));
    } catch (error) {
      return isFileMissing(error) ? { status: "missing" } : { status: "unavailable" };
    }
    const target = pathModule.resolve(parent, pathModule.basename(candidate));
    try {
      const initialStat = await lstat(target);
      if (!initialStat.isFile() || initialStat.isSymbolicLink()) return { status: "unavailable" };
    } catch (error) {
      return isFileMissing(error) ? { status: "missing" } : { status: "unavailable" };
    }
    if ((await realpath(target)) !== target) return { status: "unavailable" };

    const file = await open(target, constants.O_RDONLY | constants.O_NOFOLLOW);
    try {
      const stats = await file.stat();
      if (!stats.isFile() || stats.size > MAX_DIFF_FILE_BYTES) return { status: "unavailable" };
      const bytes = await file.readFile();
      if (bytes.byteLength > MAX_DIFF_FILE_BYTES || bytes.includes(0))
        return { status: "unavailable" };
      return { status: "read", content: new TextDecoder("utf-8", { fatal: true }).decode(bytes) };
    } finally {
      await file.close();
    }
  } catch {
    return { status: "unavailable" };
  }
}

function isFileMissing(error: unknown): boolean {
  return isRecord(error) && error.code === "ENOENT";
}

type TextEdit = { oldText: string; newText: string; replaceAll: boolean };

function applyEdits(source: string, edits: TextEdit[]): { content: string; positioned: boolean } {
  let content = source;
  let positioned = true;
  for (const edit of edits) {
    if (!edit.oldText) {
      positioned = false;
      continue;
    }
    const occurrences: number[] = [];
    let searchFrom = 0;
    while (searchFrom <= content.length - edit.oldText.length) {
      const index = content.indexOf(edit.oldText, searchFrom);
      if (index < 0) break;
      occurrences.push(index);
      searchFrom = index + edit.oldText.length;
      if (!edit.replaceAll) break;
    }
    const totalOccurrences = edit.replaceAll
      ? occurrences.length
      : countOccurrences(content, edit.oldText);
    if (!occurrences.length) {
      positioned = false;
      continue;
    }
    const firstOccurrence = occurrences[0];
    if (firstOccurrence === undefined) {
      positioned = false;
      continue;
    }
    if (!edit.replaceAll && totalOccurrences !== 1) positioned = false;
    if (edit.replaceAll && occurrences.length !== totalOccurrences) positioned = false;
    const indexes = edit.replaceAll ? occurrences : [firstOccurrence];
    for (const index of indexes.reverse())
      content = `${content.slice(0, index)}${edit.newText}${content.slice(index + edit.oldText.length)}`;
  }
  return { content, positioned };
}

function countOccurrences(value: string, search: string): number {
  let count = 0;
  let from = 0;
  while (from <= value.length - search.length) {
    const index = value.indexOf(search, from);
    if (index < 0) break;
    count += 1;
    from = index + search.length;
  }
  return count;
}

type DiffOperation = { type: "equal" | "delete" | "insert"; line: string };

function makeUnifiedHunks(oldText: string, newText: string): string[] | undefined {
  if (oldText === newText) return [];
  const oldLines = diffLines(oldText);
  const newLines = diffLines(newText);
  const operations = myersDiff(oldLines, newLines);
  if (!operations) return undefined;
  const changed = operations.flatMap((operation, index) =>
    operation.type === "equal" ? [] : [index],
  );
  if (!changed.length) return undefined;

  const ranges: Array<{ start: number; end: number }> = [];
  for (const index of changed) {
    const start = Math.max(0, index - 3);
    const end = Math.min(operations.length - 1, index + 3);
    const previous = ranges.at(-1);
    if (previous && start <= previous.end + 1) previous.end = end;
    else ranges.push({ start, end });
  }

  return ranges.map(({ start, end }) => {
    let oldBefore = 0;
    let newBefore = 0;
    for (let index = 0; index < start; index++) {
      const type = operations[index]?.type;
      if (!type) continue;
      if (type !== "insert") oldBefore += 1;
      if (type !== "delete") newBefore += 1;
    }
    const slice = operations.slice(start, end + 1);
    const oldCount = slice.filter((operation) => operation.type !== "insert").length;
    const newCount = slice.filter((operation) => operation.type !== "delete").length;
    const oldStart = oldCount === 0 ? oldBefore : oldBefore + 1;
    const newStart = newCount === 0 ? newBefore : newBefore + 1;
    return [
      `@@ -${oldStart},${oldCount} +${newStart},${newCount} @@`,
      ...slice.map((operation) =>
        operation.type === "equal"
          ? ` ${operation.line}`
          : `${operation.type === "delete" ? "-" : "+"}${operation.line}`,
      ),
    ].join("\n");
  });
}

function myersDiff(oldLines: string[], newLines: string[]): DiffOperation[] | undefined {
  const maxDistance = Math.min(
    oldLines.length + newLines.length,
    Math.floor(Math.sqrt(MAX_DIFF_WORK * 2)),
  );
  const offset = maxDistance + 1;
  const frontier = new Int32Array(offset * 2 + 1);
  frontier.fill(-1);
  frontier[offset + 1] = 0;
  const trace: Int32Array[] = [];
  let distance = -1;
  let work = 0;

  for (let d = 0; d <= maxDistance; d++) {
    work += 2 * d + 1;
    if (work > MAX_DIFF_WORK) return undefined;
    for (let k = -d; k <= d; k += 2) {
      const index = offset + k;
      const before = frontier[index - 1] ?? -1;
      const after = frontier[index + 1] ?? -1;
      let x = k === -d || (k !== d && before < after) ? after : before + 1;
      let y = x - k;
      while (x < oldLines.length && y < newLines.length && oldLines[x] === newLines[y]) {
        x += 1;
        y += 1;
      }
      frontier[index] = x;
      if (x >= oldLines.length && y >= newLines.length) {
        distance = d;
        break;
      }
    }
    trace.push(frontier.slice());
    if (distance >= 0) break;
  }
  if (distance < 0) return undefined;

  let x = oldLines.length;
  let y = newLines.length;
  const reversed: DiffOperation[] = [];
  for (let d = distance; d > 0; d--) {
    const previous = trace[d - 1];
    if (!previous) return undefined;
    const k = x - y;
    const before = previous[offset + k - 1] ?? -1;
    const after = previous[offset + k + 1] ?? -1;
    const previousK = k === -d || (k !== d && before < after) ? k + 1 : k - 1;
    const previousX = previous[offset + previousK] ?? -1;
    const previousY = previousX - previousK;
    while (x > previousX && y > previousY) {
      reversed.push({ type: "equal", line: oldLines[x - 1] ?? "" });
      x -= 1;
      y -= 1;
    }
    if (x === previousX) {
      reversed.push({ type: "insert", line: newLines[y - 1] ?? "" });
      y -= 1;
    } else {
      reversed.push({ type: "delete", line: oldLines[x - 1] ?? "" });
      x -= 1;
    }
  }
  while (x > 0 && y > 0) {
    reversed.push({ type: "equal", line: oldLines[x - 1] ?? "" });
    x -= 1;
    y -= 1;
  }
  while (x > 0) {
    reversed.push({ type: "delete", line: oldLines[x - 1] ?? "" });
    x -= 1;
  }
  while (y > 0) {
    reversed.push({ type: "insert", line: newLines[y - 1] ?? "" });
    y -= 1;
  }
  return reversed.reverse();
}

export function mapCodexSpecialAction(item: Record<string, unknown>): MappedActionData | undefined {
  const type = stringValue(item.type);
  if (type === "fileChange") {
    const changes = normalizeCodexFileChanges(item.changes);
    const actionType = changes.some((change) => changeKindName(change.kind) === "add")
      ? "write"
      : "edit";
    const boundedInput = truncateUtf8(changes.map((change) => change.path).join("\n"), 8 * 1024);
    const output = serializeFileChanges(changes, 64 * 1024);
    return {
      actionType,
      title: actionType === "write" ? "Criou arquivos" : "Editou arquivos",
      input: boundedInput.text,
      output: output.text,
      truncated: boundedInput.truncated || output.truncated,
    };
  }
  if (type === "mcpToolCall") {
    const server = stringValue(item.server);
    const tool = stringValue(item.tool);
    const boundedInput = truncateUtf8(jsonText(item.arguments ?? {}), 8 * 1024);
    const boundedOutput = truncateUtf8(jsonText(item.result ?? ""), 64 * 1024);
    return {
      actionType: "mcp" as Action["actionType"],
      title: `${tool || "Ferramenta MCP"}${server ? ` (${server})` : ""}`,
      input: boundedInput.text,
      output: boundedOutput.text,
      truncated: boundedInput.truncated || boundedOutput.truncated,
      ...(server ? { server } : {}),
      ...(tool ? { tool } : {}),
    };
  }
  if (type === "collabAgentToolCall") {
    const tool = stringValue(item.tool);
    const prompt = stringValue(item.prompt);
    const boundedInput = truncateUtf8(prompt || jsonText(item), 8 * 1024);
    return {
      actionType: "subagent" as Action["actionType"],
      title: collabToolTitle(tool),
      input: boundedInput.text,
      output: "",
      truncated: boundedInput.truncated,
    };
  }
  if (type === "imageGeneration") {
    const boundedInput = truncateUtf8(stringValue(item.revisedPrompt), 8 * 1024);
    const boundedOutput = truncateUtf8(stringValue(item.savedPath), 64 * 1024);
    return {
      actionType: "image" as Action["actionType"],
      title: "Gerou uma imagem",
      input: boundedInput.text,
      output: boundedOutput.text,
      truncated: boundedInput.truncated || boundedOutput.truncated,
    };
  }
  return undefined;
}

export function normalizeCodexFileChanges(value: unknown): FileChangeRecord[] {
  if (Array.isArray(value)) {
    return value.filter(isRecord).flatMap((change) => {
      const path = stringValue(change.path);
      if (!path) return [];
      return [
        {
          path,
          kind: change.kind ?? change.type ?? { type: "update" },
          diff: stringValue(change.diff),
        },
      ];
    });
  }
  if (!isRecord(value)) return [];
  return Object.entries(value).flatMap(([path, rawChange]) => {
    if (!isRecord(rawChange)) return [];
    return [
      {
        path,
        kind: rawChange.kind ?? rawChange.type ?? { type: "update" },
        diff: stringValue(rawChange.diff),
      },
    ];
  });
}

function parseClaudeMcpToolName(name: string): { server: string; tool: string } | undefined {
  if (!name.startsWith("mcp__")) return undefined;
  const remainder = name.slice("mcp__".length);
  const separator = remainder.indexOf("__");
  if (separator <= 0 || separator + 2 >= remainder.length) return undefined;
  return { server: remainder.slice(0, separator), tool: remainder.slice(separator + 2) };
}

function collabToolTitle(tool: string): string {
  const titles: Record<string, string> = {
    spawnAgent: "Iniciou um subagente",
    sendInput: "Enviou instruções ao subagente",
    resumeAgent: "Retomou um subagente",
    wait: "Aguardou um subagente",
    closeAgent: "Encerrou um subagente",
    sendMessage: "Enviou uma mensagem ao subagente",
    followupTask: "Enviou uma tarefa ao subagente",
    interruptAgent: "Interrompeu um subagente",
    listAgents: "Consultou os subagentes",
  };
  return titles[tool] ?? "Usou um subagente";
}

function changeKindName(value: unknown): string {
  if (typeof value === "string") return value;
  return isRecord(value) ? stringValue(value.type) || "update" : "update";
}

function jsonText(value: unknown): string {
  if (typeof value === "string") return value;
  if (value === undefined || value === null) return "";
  try {
    return JSON.stringify(value, null, 2);
  } catch {
    return String(value);
  }
}

function stringValue(value: unknown): string {
  return typeof value === "string" ? value : "";
}

function claudeActionType(name: string): Action["actionType"] {
  if (name === "Read") return "read";
  if (name === "Edit" || name === "MultiEdit" || name === "NotebookEdit") return "edit";
  if (name === "Write") return "write";
  if (name === "Bash") return "command";
  if (name === "Glob" || name === "Grep") return "search";
  if (name === "WebSearch" || name === "WebFetch") return "web";
  return "other";
}

function claudeActionTitle(name: string, input: Record<string, unknown>): string {
  const detail =
    stringValue(input.file_path) || stringValue(input.command) || stringValue(input.pattern);
  return `${name}${detail ? ` · ${detail}` : ""}`;
}

function summarizeClaudeInput(input: Record<string, unknown>, preferCommand: boolean): string {
  const raw = [
    ...(preferCommand ? [input.command] : []),
    input.description,
    input.file_path,
    input.pattern,
    input.query,
    input.url,
    input.command,
    input.subject,
  ].find((value) => typeof value === "string" && value.length > 0);
  return typeof raw === "string"
    ? raw
    : Object.keys(input).length
      ? `Parâmetros: ${Object.keys(input).join(", ")}`
      : "Sem entrada resumida.";
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
