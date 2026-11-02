import { z } from "zod";

export const MAX_MESSAGE_SOURCES = 20;

export const messageSourceSchema = z.strictObject({
  url: z
    .string()
    .min(1)
    .max(2_048)
    .url()
    .refine((value) => safeSourceUrl(value) !== null, "A URL da fonte deve usar HTTP ou HTTPS."),
  title: z.string().max(240).optional(),
  snippet: z.string().max(720).optional(),
  date: z.string().max(80).optional(),
});

export type MessageSource = z.infer<typeof messageSourceSchema>;

export function safeSourceUrl(value: string): string | null {
  try {
    const url = new URL(value);
    if (url.protocol !== "http:" && url.protocol !== "https:") return null;
    url.username = "";
    url.password = "";
    url.hash = "";
    return url.href;
  } catch {
    return null;
  }
}

export function normalizeSourceUrl(value: string): string | null {
  const safeUrl = safeSourceUrl(value);
  if (!safeUrl) return null;
  const url = new URL(safeUrl);
  url.hostname = url.hostname.replace(/^www\./iu, "");
  for (const key of [...url.searchParams.keys()]) {
    if (/^(?:utm_.+|fbclid|gclid|msclkid|mc_cid|mc_eid|ref)$/iu.test(key))
      url.searchParams.delete(key);
  }
  url.searchParams.sort();
  if (url.pathname.length > 1) url.pathname = url.pathname.replace(/\/+$/u, "");
  return url.href;
}
