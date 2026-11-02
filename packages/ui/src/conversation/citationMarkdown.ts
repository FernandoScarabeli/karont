import type { MessageSource } from "@karont/contract";
import { Children, createElement, isValidElement, type ReactElement, type ReactNode } from "react";
import {
  type CitationView,
  findCitationForLink,
  isCitationSeparator,
  normalizeCitationUrl,
  unwrapTrailingCitationGroup,
} from "./sourceCitations.ts";

type MarkdownLinkProps = {
  children?: ReactNode;
  href?: string;
  node?: { position?: { end?: { offset?: number } } };
};

type CitationBadgeProps = {
  citations: readonly CitationView[];
  onOpen: (url: string) => void;
};

type CitationMarkdownComponentsOptions = {
  markdown: string;
  sources: readonly MessageSource[];
  onOpen: (url: string) => void;
  renderBadge: (props: CitationBadgeProps) => ReactNode;
  renderLink: (props: Pick<MarkdownLinkProps, "children" | "href">) => ReactNode;
};

type CitationMarkerProps = CitationBadgeProps & {
  renderBadge: CitationMarkdownComponentsOptions["renderBadge"];
};

function CitationMarker({ citations, onOpen, renderBadge }: CitationMarkerProps) {
  return renderBadge({ citations, onOpen });
}

export function createCitationMarkdownComponents({
  markdown,
  sources,
  onOpen,
  renderBadge,
  renderLink,
}: CitationMarkdownComponentsOptions) {
  function citationForLink({ children, href, node }: MarkdownLinkProps): CitationView | null {
    return findCitationForLink(
      href,
      markdownNodeText(children),
      markdown,
      node?.position?.end?.offset,
      sources,
    );
  }

  function citationLink(props: MarkdownLinkProps) {
    const citation = citationForLink(props);
    if (citation) {
      return createElement(CitationMarker, { citations: [citation], onOpen, renderBadge });
    }
    return renderLink({ children: props.children, href: props.href });
  }

  function groupCitationChildren(children: ReactNode): ReactNode[] {
    const nodes = Children.toArray(children).map((node) => {
      if (!isValidElement(node) || node.type !== citationLink) return node;
      const citation = citationForLink(node.props as MarkdownLinkProps);
      return citation
        ? createElement(CitationMarker, { citations: [citation], onOpen, renderBadge })
        : node;
    });
    const grouped: ReactNode[] = [];
    for (let index = 0; index < nodes.length; index += 1) {
      const marker = nodes[index];
      if (!isCitationMarker(marker)) {
        grouped.push(marker);
        continue;
      }

      const citations = [...marker.props.citations];
      let cursor = index + 1;
      while (
        cursor + 1 < nodes.length &&
        typeof nodes[cursor] === "string" &&
        isCitationSeparator(nodes[cursor] as string) &&
        isCitationMarker(nodes[cursor + 1])
      ) {
        citations.push(...(nodes[cursor + 1] as ReactElement<CitationMarkerProps>).props.citations);
        cursor += 2;
      }

      const prefix = grouped.at(-1);
      const suffix = nodes[cursor];
      if (typeof prefix === "string" && typeof suffix === "string") {
        const unwrapped = unwrapTrailingCitationGroup(prefix, suffix);
        if (unwrapped) {
          if (unwrapped.prefix) grouped[grouped.length - 1] = unwrapped.prefix;
          else grouped.pop();
          nodes[cursor] = unwrapped.suffix;
        }
      }

      const uniqueCitations = new Map<string, CitationView>();
      for (const citation of citations) {
        const key = normalizeCitationUrl(citation.source.url);
        if (key && !uniqueCitations.has(key)) uniqueCitations.set(key, citation);
      }
      grouped.push(
        createElement(CitationMarker, {
          citations: [...uniqueCitations.values()],
          key: marker.key ?? `source-${index}`,
          onOpen: marker.props.onOpen,
          renderBadge,
        }),
      );
      index = cursor - 1;
    }
    return grouped;
  }

  return {
    a: citationLink,
    p: ({ children }: { children?: ReactNode }) =>
      createElement("p", null, groupCitationChildren(children)),
    li: ({ children }: { children?: ReactNode }) =>
      createElement("li", null, groupCitationChildren(children)),
    td: ({ children }: { children?: ReactNode }) =>
      createElement("td", null, groupCitationChildren(children)),
    th: ({ children }: { children?: ReactNode }) =>
      createElement("th", null, groupCitationChildren(children)),
  };
}

function isCitationMarker(value: ReactNode): value is ReactElement<CitationMarkerProps> {
  return isValidElement<CitationMarkerProps>(value) && value.type === CitationMarker;
}

function markdownNodeText(value: ReactNode): string {
  if (typeof value === "string" || typeof value === "number") return String(value);
  if (Array.isArray(value)) return value.map(markdownNodeText).join("");
  if (isValidElement<{ children?: ReactNode }>(value))
    return markdownNodeText(value.props.children);
  return "";
}
