export const MAX_EXTERNAL_URL_BYTES = 4_096;

export function validateExternalUrl(value: unknown): string | null {
  if (
    typeof value !== "string" ||
    !value ||
    value.trim() !== value ||
    Buffer.byteLength(value, "utf8") > MAX_EXTERNAL_URL_BYTES ||
    /\p{Cc}/u.test(value)
  )
    return null;

  let parsed: URL;
  try {
    parsed = new URL(value);
  } catch {
    return null;
  }
  if (parsed.protocol !== "http:" && parsed.protocol !== "https:" && parsed.protocol !== "mailto:")
    return null;
  if ((parsed.protocol === "http:" || parsed.protocol === "https:") && !parsed.hostname)
    return null;
  if (parsed.protocol === "mailto:" && !parsed.pathname) return null;
  return parsed.href;
}
