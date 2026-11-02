export const MAX_IMAGE_ATTACHMENT_BYTES = 5_000_000;
export const MAX_TEXT_ATTACHMENT_BYTES = 200_000;
export const MAX_CONVERSATION_ATTACHMENTS = 8;

export type AttachmentKind = "image" | "text";
export type AttachmentFileInfo = { kind: AttachmentKind; mimeType: string };

const allowedImageMimeTypes = new Set(["image/png", "image/jpeg", "image/gif", "image/webp"]);
const imageMimeByExtension: Record<string, string> = {
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".gif": "image/gif",
  ".webp": "image/webp",
};
const acceptedApplicationTextTypes = new Set([
  "application/json",
  "application/javascript",
  "application/xml",
  "application/yaml",
  "application/x-yaml",
  "application/toml",
  "application/sql",
]);
const codeExtensions = new Set([
  ".astro",
  ".bash",
  ".c",
  ".cc",
  ".clj",
  ".cljs",
  ".cpp",
  ".cs",
  ".css",
  ".cxx",
  ".dart",
  ".ex",
  ".exs",
  ".go",
  ".graphql",
  ".gql",
  ".h",
  ".hpp",
  ".html",
  ".java",
  ".js",
  ".jsx",
  ".kt",
  ".kts",
  ".lua",
  ".md",
  ".mdx",
  ".mjs",
  ".mts",
  ".php",
  ".pl",
  ".proto",
  ".py",
  ".rb",
  ".rs",
  ".sass",
  ".scala",
  ".scss",
  ".sh",
  ".sql",
  ".svelte",
  ".swift",
  ".ts",
  ".tsx",
  ".vue",
  ".xml",
  ".yaml",
  ".yml",
  ".zsh",
]);

export function classifyAttachmentFile(
  file: Pick<File, "name" | "type">,
): AttachmentFileInfo | null {
  const mimeType = file.type.trim().toLowerCase().split(";", 1)[0] ?? "";
  const extension = extensionOf(file.name);

  if (allowedImageMimeTypes.has(mimeType)) return { kind: "image", mimeType };
  if (mimeType.startsWith("image/")) return null;
  if (!mimeType) {
    const inferredImageMime = imageMimeByExtension[extension];
    if (inferredImageMime) return { kind: "image", mimeType: inferredImageMime };
  }

  if (mimeType.startsWith("text/")) return { kind: "text", mimeType };
  if (acceptedApplicationTextTypes.has(mimeType) || mimeType.endsWith("+json")) {
    return { kind: "text", mimeType: mimeType.endsWith("+json") ? "application/json" : mimeType };
  }
  if (extension === ".json") return { kind: "text", mimeType: "application/json" };
  if (codeExtensions.has(extension)) return { kind: "text", mimeType: "text/plain" };
  return null;
}

export function formatAttachmentSize(sizeBytes: number): string {
  if (sizeBytes < 1_000) return `${sizeBytes} B`;
  const unit = sizeBytes < 1_000_000 ? "kB" : "MB";
  const divisor = unit === "kB" ? 1_000 : 1_000_000;
  const value = new Intl.NumberFormat("pt-BR", { maximumFractionDigits: 1 }).format(
    sizeBytes / divisor,
  );
  return `${value} ${unit}`;
}

function extensionOf(name: string): string {
  const dotIndex = name.lastIndexOf(".");
  return dotIndex < 0 ? "" : name.slice(dotIndex).toLowerCase();
}
