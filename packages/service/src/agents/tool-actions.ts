export type FileChangeRecord = { path: string; kind: unknown; diff: string };

const TRUNCATION_MARKER = "\n… [truncado]";

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
  const oldStart = oldLines.length ? 1 : 0;
  const newStart = newLines.length ? 1 : 0;
  return [
    `@@ -${oldStart},${oldLines.length} +${newStart},${newLines.length} @@`,
    ...oldLines.map((line) => `-${line}`),
    ...newLines.map((line) => `+${line}`),
  ].join("\n");
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

export function mapClaudeToolAction(
  name: string,
  input: Record<string, unknown>,
  parentId?: string,
): MappedActionData {
  const withParent = (action: MappedActionData): MappedActionData =>
    parentId ? { ...action, parentId } : action;
  if (name === "Edit" || name === "NotebookEdit") {
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
      title: `${name}${path ? ` · ${path}` : ""}`,
      input: boundedInput.text,
      output: output.text,
      truncated: boundedInput.truncated || output.truncated,
    });
  }
  if (name === "MultiEdit") {
    const path = stringValue(input.file_path);
    const edits = Array.isArray(input.edits) ? input.edits.filter(isRecord) : [];
    const hunks = edits.map((edit) =>
      replacementDiff(stringValue(edit.old_string), stringValue(edit.new_string)),
    );
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
    const lines = diffLines(content);
    const diff = unifiedDiff(path, "add", [
      [`@@ -0,0 +1,${lines.length} @@`, ...lines.map((line) => `+${line}`)].join("\n"),
    ]);
    const output = serializeFileChanges(
      path ? [{ path, kind: { type: "add" }, diff }] : [],
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
