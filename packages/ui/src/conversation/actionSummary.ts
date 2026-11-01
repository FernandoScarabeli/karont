import type { MessagePart } from "@karont/contract";

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
  | "other";

export type ActionSummaryGroup = {
  category: ActionSummaryCategory;
  actions: ConversationAction[];
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
    case "other":
      return "Executou uma ação";
  }
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
    case "other":
      return `Executou ${count} ações`;
  }
}

export function groupConsecutiveActions(actions: ConversationAction[]): ActionSummaryGroup[] {
  const groups: ActionSummaryGroup[] = [];
  for (const action of actions) {
    const category = categoryForAction(action);
    const previous = groups.at(-1);
    if (previous?.category === category) previous.actions.push(action);
    else groups.push({ category, actions: [action] });
  }
  return groups;
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
