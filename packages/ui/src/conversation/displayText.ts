export type DisplayText = {
  text: string;
  fullText: string;
  title?: string;
};

export function formatConversationText(
  value: string,
  conversationPath: string,
  maxLength = 96,
): DisplayText {
  const relative = conversationPath
    ? replacePathRoot(value, conversationPath.replace(/\/+$/u, ""), "")
    : value;
  const fullText = replaceHomeRoot(relative, getHomeRoot(conversationPath));
  const text = middleEllipsis(fullText, maxLength);

  return {
    text,
    fullText,
    ...(text !== value ? { title: value } : {}),
  };
}

export function formatFolderPath(path: string, maxLength = 72): DisplayText {
  const fullText = replaceHomeRoot(path, getHomeRoot(path));
  const text = middleEllipsis(fullText, maxLength);

  return {
    text,
    fullText,
    ...(text !== path ? { title: path } : {}),
  };
}

export function cleanMarkdownPreview(value: string): string {
  return value
    .replace(/^\s{0,3}(?:`{3,}|~{3,})[^\n]*\n?/gmu, "")
    .replace(/^\s{0,3}#{1,6}\s+/gmu, "")
    .replace(/^\s{0,3}>\s?/gmu, "")
    .replace(/^\s*(?:[-*+]|\d+[.)])\s+/gmu, "")
    .replace(/!\[([^\]]*)\]\([^)]*\)/gu, "$1")
    .replace(/\[([^\]]+)\]\([^)]*\)/gu, "$1")
    .replace(/\*\*(.*?)\*\*/gu, "$1")
    .replace(/__(.*?)__/gu, "$1")
    .replace(/~~(.*?)~~/gu, "$1")
    .replace(/\*(.*?)\*/gu, "$1")
    .replace(/_(.*?)_/gu, "$1")
    .replace(/`+([^`]+)`+/gu, "$1")
    .replace(/\s+/gu, " ")
    .trim();
}

function replaceHomeRoot(value: string, homeRoot: string | null): string {
  if (homeRoot) return replacePathRoot(value, homeRoot, "~");

  return value.replace(
    /(^|[\s"'`(=,:])\/(?:home\/[^/]+|Users\/[^/]+|root)(?=\/|$|[\s"'`),;!?])/gu,
    "$1~",
  );
}

function getHomeRoot(path: string): string | null {
  return (
    path.match(/^\/(?:home\/[^/]+|Users\/[^/]+)/u)?.[0] ??
    (path === "/root" || path.startsWith("/root/") ? "/root" : null)
  );
}

function replacePathRoot(value: string, pathRoot: string, replacement: string): string {
  if (!pathRoot) return value;
  const escapedRoot = pathRoot.replace(/[.*+?^${}()|[\]\\]/gu, "\\$&");
  const expression = new RegExp(
    `(^|[\\s"'\\x60(=,:])${escapedRoot}(/|(?=$|[\\s"'\\x60),;!?]))`,
    "gu",
  );

  return value.replace(expression, (_match, boundary: string, slash: string) => {
    if (replacement === "~") return `${boundary}~${slash ? "/" : ""}`;
    return `${boundary}${slash ? "" : "."}`;
  });
}

function middleEllipsis(value: string, maxLength: number): string {
  if (value.length <= maxLength) return value;
  if (maxLength < 5) return `${value.slice(0, Math.max(0, maxLength - 1))}…`;

  const visibleLength = maxLength - 1;
  const leftLength = Math.ceil(visibleLength / 2);
  const rightLength = Math.floor(visibleLength / 2);
  return `${value.slice(0, leftLength)}…${value.slice(-rightLength)}`;
}
