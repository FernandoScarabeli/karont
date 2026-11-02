import type { ConversationAttachment, ConversationAttachmentMetadata } from "@karont/contract";
import { ServiceError } from "./errors.ts";

export const MAX_IMAGE_ATTACHMENT_BYTES = 5_000_000;
export const MAX_TEXT_ATTACHMENT_BYTES = 200_000;

const imageMimeTypes = new Set(["image/png", "image/jpeg", "image/gif", "image/webp"]);
const textApplicationMimeTypes = new Set([
  "application/json",
  "application/javascript",
  "application/xml",
  "application/yaml",
  "application/x-yaml",
  "application/toml",
  "application/sql",
]);

export type ValidatedAttachments = {
  data: ConversationAttachment[];
  metadata: ConversationAttachmentMetadata[];
};

export function validateAttachments(
  attachments: ConversationAttachment[] | undefined,
): ValidatedAttachments {
  if (!attachments?.length) return { data: [], metadata: [] };
  if (attachments.length > 8)
    throw new ServiceError("invalid_request", "A conversa aceita no máximo 8 anexos.");

  const data: ConversationAttachment[] = [];
  const metadata: ConversationAttachmentMetadata[] = [];
  for (const attachment of attachments) {
    const name = attachment.name.trim();
    if (!name || name !== attachment.name || /\p{Cc}/u.test(attachment.name)) {
      throw new ServiceError("invalid_request", "O nome de cada anexo deve ser válido.");
    }

    let sizeBytes: number;
    if (attachment.kind === "image") {
      sizeBytes = validateImageAttachment(attachment);
    } else {
      sizeBytes = validateTextAttachment(attachment);
    }
    data.push(attachment);
    metadata.push({
      name: attachment.name,
      mimeType: attachment.mimeType,
      kind: attachment.kind,
      sizeBytes,
    });
  }
  return { data, metadata };
}

function validateImageAttachment(
  attachment: Extract<ConversationAttachment, { kind: "image" }>,
): number {
  if (!imageMimeTypes.has(attachment.mimeType)) {
    throw new ServiceError(
      "invalid_request",
      `O anexo de imagem “${attachment.name}” precisa ser PNG, JPEG, GIF ou WebP.`,
    );
  }
  const maxEncodedBytes = Math.ceil(MAX_IMAGE_ATTACHMENT_BYTES / 3) * 4;
  if (attachment.data.length > maxEncodedBytes) {
    throw new ServiceError(
      "invalid_request",
      `A imagem “${attachment.name}” excede o limite de 5 MB.`,
    );
  }
  if (!isBase64(attachment.data)) {
    throw new ServiceError(
      "invalid_request",
      `Os dados da imagem “${attachment.name}” não estão em base64 válido.`,
    );
  }
  const padding = attachment.data.endsWith("==") ? 2 : attachment.data.endsWith("=") ? 1 : 0;
  const decodedBytes = (attachment.data.length / 4) * 3 - padding;
  if (decodedBytes > MAX_IMAGE_ATTACHMENT_BYTES) {
    throw new ServiceError(
      "invalid_request",
      `A imagem “${attachment.name}” excede o limite de 5 MB.`,
    );
  }
  const bytes = Buffer.from(attachment.data, "base64");
  if (bytes.byteLength !== decodedBytes || bytes.toString("base64") !== attachment.data) {
    throw new ServiceError(
      "invalid_request",
      `Os dados da imagem “${attachment.name}” não estão em base64 válido.`,
    );
  }
  if (!matchesImageMimeType(bytes, attachment.mimeType)) {
    throw new ServiceError(
      "invalid_request",
      `O conteúdo da imagem “${attachment.name}” não corresponde ao tipo ${attachment.mimeType}.`,
    );
  }
  return bytes.byteLength;
}

function validateTextAttachment(
  attachment: Extract<ConversationAttachment, { kind: "text" }>,
): number {
  const mimeType = attachment.mimeType.split(";", 1)[0]?.trim().toLowerCase() ?? "";
  if (!mimeType.startsWith("text/") && !textApplicationMimeTypes.has(mimeType)) {
    throw new ServiceError(
      "invalid_request",
      `O anexo “${attachment.name}” precisa ter um tipo de arquivo de texto reconhecido.`,
    );
  }
  const sizeBytes = Buffer.byteLength(attachment.data, "utf8");
  if (sizeBytes > MAX_TEXT_ATTACHMENT_BYTES) {
    throw new ServiceError(
      "invalid_request",
      `O arquivo de texto “${attachment.name}” excede o limite de 200 kB.`,
    );
  }
  return sizeBytes;
}

function isBase64(value: string): boolean {
  if (value.length === 0 || value.length % 4 !== 0) return false;
  const padding = value.endsWith("==") ? 2 : value.endsWith("=") ? 1 : 0;
  const payloadEnd = value.length - padding;
  for (let index = 0; index < payloadEnd; index += 1) {
    const code = value.charCodeAt(index);
    const isAlphaNumeric =
      (code >= 65 && code <= 90) || (code >= 97 && code <= 122) || (code >= 48 && code <= 57);
    if (!isAlphaNumeric && code !== 43 && code !== 47) return false;
  }
  for (let index = payloadEnd; index < value.length; index += 1) {
    if (value.charCodeAt(index) !== 61) return false;
  }
  return true;
}

function matchesImageMimeType(bytes: Buffer, mimeType: string): boolean {
  switch (mimeType) {
    case "image/png":
      return (
        bytes.length >= 8 &&
        bytes.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]))
      );
    case "image/jpeg":
      return bytes.length >= 3 && bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff;
    case "image/gif":
      return (
        bytes.length >= 6 &&
        (bytes.toString("ascii", 0, 6) === "GIF87a" || bytes.toString("ascii", 0, 6) === "GIF89a")
      );
    case "image/webp":
      return (
        bytes.length >= 12 &&
        bytes.toString("ascii", 0, 4) === "RIFF" &&
        bytes.toString("ascii", 8, 12) === "WEBP"
      );
    default:
      return false;
  }
}
