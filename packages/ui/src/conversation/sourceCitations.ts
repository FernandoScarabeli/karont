import { type MessageSource, normalizeSourceUrl, safeSourceUrl } from "@karont/contract";

export type CitationView = {
  source: MessageSource;
  site: string;
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
  const normalizedUrl = normalizeSourceUrl(href);
  if (!url || !normalizedUrl) return null;
  const source = sources.find((candidate) => normalizeSourceUrl(candidate.url) === normalizedUrl);
  const site = sourceSiteName(url);
  const domainLabel = isDomainLabel(label, url, site);
  const trailingReference = isTrailingReference(markdown, endOffset);
  const shortMatchedReference =
    source !== undefined &&
    !isDescriptiveLinkLabel(label) &&
    /^[\p{L}\p{N}._-]{1,20}$/u.test(label.trim());
  if (!domainLabel && !trailingReference && !shortMatchedReference) return null;
  return { source: source ?? { url }, site };
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
    const separated = /^[\s,;()]*/u.exec(suffix)?.[0] ?? "";
    const rest = suffix.slice(separated.length);
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
