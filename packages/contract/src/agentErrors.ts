export type AgentErrorAgent = "claude" | "codex";

export type AgentErrorDescription = {
  message: string;
  details?: string;
};

const MAX_MESSAGE_LENGTH = 240;
const MAX_DETAILS_BYTES = 8 * 1024;

export function describeAgentError(raw: string, agent?: AgentErrorAgent): AgentErrorDescription {
  const source = raw;
  const normalizedSource = raw.trim();
  const parsed = findJsonError(source);
  const internalMessage = parsed?.message?.trim();
  const detectionText = [
    parsed ? internalMessage : normalizedSource,
    parsed?.code,
    parsed?.type,
    parsed?.status === undefined ? undefined : `status: ${parsed.status}`,
  ]
    .filter(Boolean)
    .join(" ");
  const name = agentName(agent);
  const friendlyMessage = knownErrorMessage(detectionText, name);
  const message = friendlyMessage ?? truncateFirstLine(internalMessage || normalizedSource);
  const details = normalizedSource ? limitUtf8(source, MAX_DETAILS_BYTES) : undefined;

  return details && details !== message ? { message, details } : { message };
}

function agentName(agent?: AgentErrorAgent): string {
  if (agent === "claude") return "Claude Code";
  if (agent === "codex") return "Codex";
  return "agente";
}

function knownErrorMessage(text: string, name: string): string | undefined {
  if (
    /safety_violation|regurg|content[_ -]filter|content filtering|filtro de conteúdo|output stream.*blocked/i.test(
      text,
    )
  )
    return `O ${name} interrompeu a resposta: o filtro de conteúdo do provedor bloqueou o texto. Tente reformular o pedido.`;
  if (/rate[-_ ]limit|usage limit|too many requests|status\s*[:=]?\s*429|\b429\b/i.test(text))
    return `O ${name} atingiu o limite de uso. Tente de novo mais tarde.`;
  if (/overloaded|status\s*[:=]?\s*(?:529|503)|\b(?:529|503)\b/i.test(text))
    return `O serviço do ${name} está sobrecarregado agora. Tente de novo em instantes.`;
  if (
    /context_length_exceeded|prompt is too long|context length.{0,24}(?:exceed|long)|maximum context/i.test(
      text,
    )
  )
    return `Esta conversa ficou longa demais para o ${name}. Comece uma conversa nova.`;
  if (
    /status\s*[:=]?\s*401|\b401\b|not logged in|please log in|run\s+\/login|login required|authentication required|logged out|oauth.{0,20}(?:expired|invalid)|não está conectado/i.test(
      text,
    )
  )
    return `${name} não está conectado. Faça login na CLI e tente novamente.`;
  if (
    /ECONNRESET|ETIMEDOUT|ECONNREFUSED|EHOSTUNREACH|ENETUNREACH|\btimeout\b|timed? out|connection reset/i.test(
      text,
    )
  )
    return `A conexão com o ${name} caiu. Tente de novo.`;
  if (
    /\bENOENT\b|cli.{0,32}(?:not found|não encontrada|não encontrado)|não foi possível encontrar.{0,24}cli/i.test(
      text,
    )
  )
    return `${name} não encontrado. Instale a CLI e tente novamente.`;
  return undefined;
}

type ParsedError = {
  message?: string;
  code?: string;
  type?: string;
  status?: string | number;
};

function findJsonError(source: string): ParsedError | undefined {
  try {
    const direct = readError(JSON.parse(source) as unknown);
    if (direct) return direct;
    return undefined;
  } catch {
    // O texto pode ter prefixos/sufixos de log ao redor do JSON.
  }

  for (let start = 0; start < source.length; start += 1) {
    if (source[start] !== "{" && source[start] !== "[") continue;
    const candidate = parseEmbeddedJson(source, start);
    if (candidate === undefined) continue;
    const found = readError(candidate);
    if (found) return found;
  }
  return undefined;
}

function parseEmbeddedJson(source: string, start: number): unknown {
  const stack: string[] = [];
  let inString = false;
  let escaped = false;
  for (let index = start; index < source.length; index += 1) {
    const character = source[index];
    if (inString) {
      if (escaped) escaped = false;
      else if (character === "\\") escaped = true;
      else if (character === '"') inString = false;
      continue;
    }
    if (character === '"') {
      inString = true;
      continue;
    }
    if (character === "{" || character === "[") stack.push(character);
    else if (character === "}" || character === "]") {
      const opener = stack.pop();
      if ((opener === "{" && character !== "}") || (opener === "[" && character !== "]"))
        return undefined;
      if (stack.length === 0) {
        try {
          return JSON.parse(source.slice(start, index + 1)) as unknown;
        } catch {
          return undefined;
        }
      }
    }
  }
  return undefined;
}

function readError(value: unknown): ParsedError | undefined {
  if (Array.isArray(value)) {
    for (const item of value) {
      const nested = readError(item);
      if (nested) return nested;
    }
    return undefined;
  }
  if (!isRecord(value)) return undefined;

  const error = isRecord(value.error) ? value.error : undefined;
  const message = stringValue(error?.message) ?? stringValue(value.message);
  const code = stringValue(error?.code) ?? stringValue(value.code);
  const type = stringValue(error?.type) ?? stringValue(value.type);
  const status = numberOrString(error?.status) ?? numberOrString(value.status);
  if (message) return { message, code, type, status };

  for (const nestedValue of Object.values(value)) {
    const nested = readError(nestedValue);
    if (nested)
      return {
        message: nested.message ?? message,
        code: nested.code ?? code,
        type: nested.type ?? type,
        status: nested.status ?? status,
      };
  }
  return code || type || status !== undefined ? { message, code, type, status } : undefined;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function stringValue(value: unknown): string | undefined {
  return typeof value === "string" && value.length > 0 ? value : undefined;
}

function numberOrString(value: unknown): string | number | undefined {
  return typeof value === "number" || typeof value === "string" ? value : undefined;
}

function truncateFirstLine(value: string): string {
  const firstLine = value.split(/\r?\n/u, 1)[0]?.trim() ?? "";
  const characters = Array.from(firstLine);
  if (characters.length <= MAX_MESSAGE_LENGTH) return firstLine;
  return `${characters.slice(0, MAX_MESSAGE_LENGTH - 1).join("")}…`;
}

function limitUtf8(value: string, maxBytes: number): string | undefined {
  if (!value) return undefined;
  if (utf8ByteLength(value) <= maxBytes) return value;
  const suffix = "\n[detalhes cortados após 8 kB]";
  const maxContentBytes = maxBytes - utf8ByteLength(suffix);
  let bytes = 0;
  let limited = "";
  for (const character of value) {
    const codePoint = character.codePointAt(0) ?? 0;
    const characterBytes =
      codePoint <= 0x7f ? 1 : codePoint <= 0x7ff ? 2 : codePoint <= 0xffff ? 3 : 4;
    if (bytes + characterBytes > maxContentBytes) break;
    bytes += characterBytes;
    limited += character;
  }
  return `${limited}${suffix}`;
}

function utf8ByteLength(value: string): number {
  let bytes = 0;
  for (const character of value) {
    const codePoint = character.codePointAt(0) ?? 0;
    bytes += codePoint <= 0x7f ? 1 : codePoint <= 0x7ff ? 2 : codePoint <= 0xffff ? 3 : 4;
  }
  return bytes;
}
