import type { MessagePart } from "@karont/contract";
import { countDiffLines, formatDiffStats, parseFileChanges } from "./actionDiff.ts";

export type ConversationAction = Extract<MessagePart, { type: "action" }>;
export type ActionSummaryCategory =
  | "read"
  | "edit"
  | "write"
  | "test"
  | "list"
  | "search"
  | "web"
  | "command"
  | "subagent"
  | "mcp"
  | "image"
  | "other";

export type ActionSummaryGroup = {
  category: ActionSummaryCategory;
  actions: ConversationAction[];
};

export type ParentActionGroup = {
  action: ConversationAction;
  children: ConversationAction[];
};

export function summarizeAction(action: ConversationAction, cwd: string): string {
  const category = categoryForAction(action);
  const pathName = actionPath(action, cwd);
  switch (category) {
    case "read": {
      const fileReferences =
        action.actionType === "command" ? commandFileReferences(actionCommand(action)) : [];
      if (fileReferences.length > 1) return `Leu ${fileReferences.length} arquivos`;
      return pathName ? `Leu ${pathName}` : "Leu um arquivo";
    }
    case "edit":
      return pathName ? `Editou ${pathName}` : "Editou um arquivo";
    case "write":
      return pathName ? `Criou ${pathName}` : "Criou um arquivo";
    case "test":
      return "Rodou testes";
    case "list":
      return "Listou arquivos";
    case "search": {
      const query = searchQuery(action);
      return query ? `Procurou por '${query}'` : "Procurou nos arquivos";
    }
    case "web":
      return "Pesquisou na web";
    case "command":
      return "Rodou um comando";
    case "subagent":
      return `Subagente · ${action.title}`;
    case "mcp":
      return mcpActionLabel(action);
    case "image":
      return "Gerou uma imagem";
    case "other":
      return "Executou uma ação";
  }
}

export function summarizeActionDiff(action: ConversationAction, cwd: string): string | null {
  const changes = parseFileChanges(action.output).filter((change) => change.diff.trim());
  if (changes.length === 0) return null;
  const paths = [
    ...new Set(changes.map((change) => diffDisplayPath(change.path, cwd)).filter(Boolean)),
  ];
  const added = changes.reduce((total, change) => total + countDiffLines(change.diff).added, 0);
  const removed = changes.reduce((total, change) => total + countDiffLines(change.diff).removed, 0);
  const createsFiles =
    action.actionType === "write" || changes.every((change) => change.kind === "add");
  const verb = createsFiles ? "Criou" : "Editou";
  const target = paths.length === 1 ? paths[0] : `${paths.length} arquivos`;
  return [`${verb} ${target}`, formatDiffStats(added, removed)].filter(Boolean).join(" ");
}

export function mcpActionLabel(action: ConversationAction): string {
  const { server, tool } = mcpActionParts(action);
  return `${server} · ${tool}`;
}

export function mcpActionParts(action: ConversationAction): { server: string; tool: string } {
  let parsedTitle: { server: string; tool: string } | undefined;
  if (action.title.startsWith("mcp__")) {
    const separator = action.title.indexOf("__", 5);
    if (separator > 5) {
      parsedTitle = {
        server: action.title.slice(5, separator),
        tool: action.title.slice(separator + 2),
      };
    }
  }
  const server = action.server || parsedTitle?.server || "MCP";
  const tool = action.tool || parsedTitle?.tool || action.title;
  return { server, tool };
}

export function summarizeActionGroup(group: ActionSummaryGroup, cwd: string): string {
  const { category, actions } = group;
  if (actions.length === 1 && actions[0]) return summarizeAction(actions[0], cwd);
  const count = actions.length;
  switch (category) {
    case "read":
      return `Leu ${count} arquivos`;
    case "edit":
      return `Editou ${count} arquivos`;
    case "write":
      return `Criou ${count} arquivos`;
    case "test":
      return `Rodou testes ${count} vezes`;
    case "list":
      return `Listou arquivos ${count} vezes`;
    case "search":
      return `Fez ${count} buscas`;
    case "web":
      return `Fez ${count} buscas na web`;
    case "command":
      return `Rodou ${count} comandos`;
    case "subagent":
      return `Rodou ${count} subagentes`;
    case "mcp":
      return `Chamou ${count} ferramentas MCP`;
    case "image":
      return `Gerou ${count} imagens`;
    case "other":
      return `Executou ${count} ações`;
  }
}

export function groupConsecutiveActions(actions: ConversationAction[]): ActionSummaryGroup[] {
  const groups: ActionSummaryGroup[] = [];
  for (const action of actions) {
    const category = categoryForAction(action);
    const previous = groups.at(-1);
    if (
      category !== "subagent" &&
      category !== "mcp" &&
      category !== "image" &&
      previous?.category === category
    )
      previous.actions.push(action);
    else groups.push({ category, actions: [action] });
  }
  return groups;
}

export function groupActionsByParentId(actions: ConversationAction[]): ParentActionGroup[] {
  const roots = actions.filter((action) => !action.parentId);
  return roots.map((action) => ({
    action,
    children:
      action.actionType === "subagent"
        ? actions.filter((child) => child.parentId === action.id)
        : [],
  }));
}

export function categoryForAction(action: ConversationAction): ActionSummaryCategory {
  const command = actionCommand(action);
  if (action.actionType === "command") {
    if (
      /\b(?:npm|pnpm|yarn|bun)\s+(?:run\s+)?test\b|\b(?:pytest|vitest|jest|cargo\s+test|go\s+test|dotnet\s+test)\b/i.test(
        command,
      )
    )
      return "test";
    if (/\b(?:rg\s+(?:[^\n]*\s)?--files|find|ls|tree)\b/i.test(command)) return "list";
    if (/\b(?:rg|grep)\b/i.test(command)) return "search";
    if (/\b(?:sed|cat|head|tail|less|bat)\b/i.test(command)) return "read";
    return "command";
  }
  if (action.actionType === "read") return "read";
  if (action.actionType === "edit") return "edit";
  if (action.actionType === "write") return "write";
  if (action.actionType === "search") return "search";
  if (action.actionType === "web") return "web";
  if (action.actionType === "subagent") return "subagent";
  if (action.actionType === "mcp") return "mcp";
  if (action.actionType === "image") return "image";
  return "other";
}

function actionCommand(action: ConversationAction): string {
  const parsed = parseInput(action.input);
  if (parsed && typeof parsed.command === "string") return parsed.command;
  return action.input || action.title;
}

function actionPath(action: ConversationAction, cwd: string): string {
  const parsed = parseInput(action.input);
  const directPath = [parsed?.file_path, parsed?.path, parsed?.filename].find(
    (value): value is string => typeof value === "string" && Boolean(value.trim()),
  );
  const fromTitle =
    action.title.match(/(?:·|:)\s*(.+)$/u)?.[1] ??
    action.title.match(/^(?:leu|read|edit(?:ou)?|write|criou)\s+(.+)$/iu)?.[1];
  const commandPath =
    action.actionType === "command" ? commandFileReferences(actionCommand(action))[0] : undefined;
  const candidate =
    directPath ??
    commandPath ??
    (action.actionType === "command"
      ? ""
      : (fromTitle ?? (looksLikePath(action.input) ? action.input : "")));
  if (!candidate) return "";
  let display = candidate.trim().split(/\r?\n/u, 1)[0] ?? "";
  display = display.replace(/^['"`]+|['"`]+$/gu, "");
  const normalizedCwd = cwd.replace(/\/+$/u, "");
  if (normalizedCwd && display.startsWith(`${normalizedCwd}/`)) {
    display = display.slice(normalizedCwd.length + 1);
  } else if (display.startsWith("/")) {
    display = display.split("/").at(-1) ?? display;
  }
  return display;
}

function commandFileReferences(command: string): string[] {
  const references = [
    ...command.matchAll(
      /(?:^|[\s'"])((?:\.{0,2}\/|\/)?[\w@.-][\w./@-]*\.[A-Za-z0-9_-]+)(?=$|[\s'"])/gu,
    ),
  ]
    .map((match) => match[1])
    .filter((value): value is string => Boolean(value));
  return [...new Set(references)];
}

function searchQuery(action: ConversationAction): string {
  const parsed = parseInput(action.input);
  const direct = [parsed?.pattern, parsed?.query].find(
    (value): value is string => typeof value === "string" && Boolean(value.trim()),
  );
  if (direct) return direct.trim().replace(/^['"]|['"]$/gu, "");
  if (action.actionType === "command") {
    const command = actionCommand(action);
    const match = command.match(/\b(?:rg|grep)\b(?:\s+-[^\s]+\s+)*(?:['"]([^'"]+)['"]|([^\s]+))/iu);
    return (match?.[1] ?? match?.[2] ?? "").trim();
  }
  const titleQuery = action.title.match(/(?:·|:)\s*(.+)$/u)?.[1];
  if (titleQuery && !looksLikePath(titleQuery)) return titleQuery.trim();
  return "";
}

function parseInput(input: string): Record<string, unknown> | null {
  try {
    const parsed: unknown = JSON.parse(input);
    return parsed !== null && typeof parsed === "object" && !Array.isArray(parsed)
      ? (parsed as Record<string, unknown>)
      : null;
  } catch {
    return null;
  }
}

function looksLikePath(value: string): boolean {
  return /(?:^|[\s'"`])(?:\.{0,2}\/|\/)?[\w.@-][\w./@-]*\.[A-Za-z0-9_-]+(?:\s|$|['"`])/u.test(
    value,
  );
}

function diffDisplayPath(path: string, cwd: string): string {
  const normalizedCwd = cwd.replace(/\/+$/u, "");
  if (normalizedCwd && path.startsWith(`${normalizedCwd}/`)) {
    return path.slice(normalizedCwd.length + 1);
  }
  if (path.startsWith("/")) return path.split("/").at(-1) ?? path;
  return path;
}
