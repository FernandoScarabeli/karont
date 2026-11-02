import { type MessageSource, normalizeSourceUrl, safeSourceUrl } from "@karont/contract";

export type CitationView = {
  source: MessageSource;
  site: string;
};

export type CitationPopoverPosition = {
  side: "above" | "below";
  top: number;
  left: number;
  maxHeight: number;
};

const domainLabels: Record<string, string> = {
  apnews: "AP",
  bbc: "BBC",
  cnn: "CNN",
  npr: "NPR",
  nytimes: "NYTimes",
  reuters: "Reuters",
  wikipedia: "Wikipedia",
};

const compoundSuffixes = new Set([
  "co.uk",
  "org.uk",
  "ac.uk",
  "com.au",
  "net.au",
  "co.nz",
  "com.br",
  "com.mx",
  "co.jp",
  "co.in",
]);

const descriptiveLinkLabels = new Set([
  "aqui",
  "artigo",
  "fonte",
  "here",
  "link",
  "leia",
  "noticia",
  "report",
  "read",
  "saiba mais",
  "site",
  "source",
  "website",
]);

export function findCitationForLink(
  href: string | undefined,
  label: string,
  markdown: string,
  endOffset: number | undefined,
  sources: readonly MessageSource[],
): CitationView | null {
  if (!href) return null;
  const url = safeSourceUrl(href);
  const normalizedUrl = normalizeCitationUrl(href);
  if (!url || !normalizedUrl) return null;
  const matchedSource = sources.find(
    (candidate) => normalizeCitationUrl(candidate.url) === normalizedUrl,
  );
  const source = cleanCitationSource(matchedSource, url);
  const site = sourceSiteName(url);
  const domainLabel = isDomainLabel(label, url, site);
  const trailingReference = isTrailingReference(markdown, endOffset);
  const shortMatchedReference =
    source !== undefined &&
    !isDescriptiveLinkLabel(label) &&
    /^[\p{L}\p{N}._-]{1,20}$/u.test(label.trim());
  if (!domainLabel && !trailingReference && !shortMatchedReference) return null;
  return { source, site };
}

export function normalizeCitationUrl(value: string): string | null {
  return normalizeSourceUrl(value)?.replace(/^https?:\/\//iu, "") ?? null;
}

export function cleanCitationText(value: string | undefined): string | undefined {
  if (!value || looksLikeRawSearchData(value)) return undefined;
  const cleaned = value
    .replace(/<[^>]*>/gu, " ")
    .replace(/!?\[([^\]]*)\]\((?:<[^>]+>|[^)]+)\)/gu, "$1")
    .replace(/^\s{0,3}(?:#{1,6}\s*|>\s*|[-*+]\s+)/gmu, "")
    .replace(/[`*_~]/gu, "")
    .replace(/\s+/gu, " ")
    .trim();
  return /[\p{L}\p{N}]{2}/u.test(cleaned) ? cleaned.slice(0, 720) : undefined;
}

export function unwrapTrailingCitationGroup(
  prefix: string,
  suffix: string,
): { prefix: string; suffix: string } | null {
  const opening = /([([])\s*$/u.exec(prefix)?.[1];
  if (!opening) return null;
  const closing = opening === "(" ? ")" : "]";
  const afterClosing = /^\s*([)\]])([\s.!?…]*)$/u.exec(suffix);
  if (afterClosing?.[1] !== closing) return null;
  return {
    prefix: prefix.replace(/[([]\s*$/u, ""),
    suffix: suffix.replace(/^\s*[)\]]/u, ""),
  };
}

export function calculateCitationPopoverPosition(input: {
  anchor: { top: number; bottom: number; left: number; width: number };
  card: { width: number; height: number };
  viewport: { width: number; height: number };
  gap: number;
  margin: number;
}): CitationPopoverPosition {
  const { anchor, card, viewport, gap, margin } = input;
  const spaceAbove = Math.max(0, anchor.top - margin - gap);
  const spaceBelow = Math.max(0, viewport.height - margin - anchor.bottom - gap);
  const side = spaceBelow >= card.height || spaceBelow >= spaceAbove ? "below" : "above";
  const maxHeight = side === "above" ? spaceAbove : spaceBelow;
  const height = Math.min(card.height, maxHeight);
  const maxTop = Math.max(margin, viewport.height - margin - height);
  const preferredTop = side === "above" ? anchor.top - gap - height : anchor.bottom + gap;
  const top = Math.min(maxTop, Math.max(margin, preferredTop));
  const maxLeft = Math.max(margin, viewport.width - margin - card.width);
  const preferredLeft = anchor.left + anchor.width / 2 - card.width / 2;
  const left = Math.min(maxLeft, Math.max(margin, preferredLeft));
  return { side, top, left, maxHeight };
}

function cleanCitationSource(
  source: MessageSource | undefined,
  fallbackUrl: string,
): MessageSource {
  if (!source) return { url: fallbackUrl };
  const title = cleanCitationText(source.title);
  const snippet = cleanCitationText(source.snippet);
  const date = cleanCitationText(source.date);
  return {
    url: safeSourceUrl(source.url) ?? fallbackUrl,
    ...(title ? { title } : {}),
    ...(snippet ? { snippet } : {}),
    ...(date ? { date } : {}),
  };
}

function looksLikeRawSearchData(value: string): boolean {
  return (
    /^\s*(?:links|results|search results)\s*:\s*\[/iu.test(value) ||
    /(?:^|[{,]\s*)["']?(?:url|title|snippet|description|summary)["']?\s*:/iu.test(value)
  );
}

export function sourceSiteName(value: string): string {
  try {
    const labels = new URL(value).hostname.replace(/^www\./iu, "").split(".");
    const suffix = labels.slice(-2).join(".");
    const base = labels.length > 2 && compoundSuffixes.has(suffix) ? labels.at(-3) : labels.at(-2);
    const domain = (base || labels[0] || "site").toLowerCase();
    return (
      domainLabels[domain] ??
      domain.replace(/(^|[-_])([a-z])/gu, (_match, _sep, char: string) => char.toUpperCase())
    );
  } catch {
    return "Site";
  }
}

export function isCitationSeparator(value: string): boolean {
  return /^[\s,;()[\]]*$/u.test(value) || /^\s+(?:e|and)\s+$/iu.test(value);
}

export function isTrailingReference(markdown: string, endOffset: number | undefined): boolean {
  if (endOffset === undefined || endOffset < 0 || endOffset > markdown.length) return false;
  let suffix = markdown.slice(endOffset);
  const nextMarkdownLink = /^\[[^\]]{1,240}\]\((?:<[^>]+>|[^)\s]+)(?:\s+["'][^"']*["'])?\)/u;

  while (true) {
    let rest = suffix;
    while (true) {
      const separator = /^(?:[\s,;()]+|\]+|(?:e|and)\s+)/iu.exec(rest)?.[0];
      if (!separator) break;
      rest = rest.slice(separator.length);
    }
    const match = nextMarkdownLink.exec(rest);
    if (!match) {
      suffix = rest;
      break;
    }
    suffix = rest.slice(match[0].length);
  }

  suffix = suffix.replace(/^[\])}"'”’»\s]*/u, "");
  if (!suffix) return true;
  return /^[.!?…](?:\s|$)/u.test(suffix);
}

function isDomainLabel(label: string, url: string, site: string): boolean {
  const normalized = label
    .trim()
    .toLowerCase()
    .replace(/^(?:https?:\/\/)?(?:www\.)/iu, "")
    .replace(/[\s.,/]+$/u, "");
  if (!normalized) return false;
  const host = new URL(url).hostname.replace(/^www\./iu, "").toLowerCase();
  const hostStart = host.split(".")[0] ?? "";
  const root = host.split(".").slice(-2).join(".");
  const rootWithoutSuffix = root.split(".")[0] ?? "";
  const normalizedSite = site.toLowerCase().replace(/[^a-z0-9]/gu, "");
  const compactLabel = normalized.replace(/[^a-z0-9]/gu, "");
  return [host, hostStart, root, rootWithoutSuffix, normalizedSite].some(
    (candidate) =>
      candidate === normalized || candidate.replace(/[^a-z0-9]/gu, "") === compactLabel,
  );
}

function isDescriptiveLinkLabel(label: string): boolean {
  const normalized = label
    .normalize("NFD")
    .replace(/\p{Diacritic}/gu, "")
    .trim()
    .toLowerCase()
    .replace(/[.!?]+$/u, "");
  return descriptiveLinkLabels.has(normalized) || /\s/u.test(normalized);
}
