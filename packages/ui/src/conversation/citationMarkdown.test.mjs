import assert from "node:assert/strict";
import test from "node:test";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import Markdown from "react-markdown";
import remarkGfm from "remark-gfm";
import { createCitationMarkdownComponents } from "./citationMarkdown.ts";
import { splitMarkdownBlocks } from "./markdownBlocks.ts";
import { rehypeCaret } from "./rehypeCaret.ts";

const markdown = `O Node.js 24 foi lançado em 6 de maio de 2025 e começou como versão "Current". ([LogRocket](https://blog.logrocket.com/node-js-24-new), [Clever Cloud](https://www.clever.cloud/developers/changelog/2025/05-07-node-24/))

Ele virou LTS em outubro de 2025 e tem suporte até abril de 2028. ([Clever Cloud](https://www.clever.cloud/developers/changelog/2025/05-07-node-24/))`;

test("agrupa citações renderizadas pelo mesmo pipeline Markdown da conversa", () => {
  const blocks = splitMarkdownBlocks(markdown);
  const html = blocks
    .map((block, index) => {
      const components = createCitationMarkdownComponents({
        markdown: block.markdown,
        sources: [],
        onOpen: () => undefined,
        renderBadge: ({ citations }) => {
          const first = citations[0];
          const extraCount = citations.length - 1;
          const label = `${first?.site ?? ""}${extraCount > 0 ? ` +${extraCount}` : ""}`;
          return createElement("span", { "data-source-badge": "" }, label);
        },
        renderLink: ({ children, href }) => createElement("a", { href }, children),
      });

      return renderToStaticMarkup(
        createElement(
          Markdown,
          {
            components,
            remarkPlugins: [remarkGfm],
            rehypePlugins:
              index === blocks.length - 1 ? [[rehypeCaret, { className: "caret" }]] : [],
          },
          block.markdown,
        ),
      );
    })
    .join("");

  assert.equal(blocks.length, 2);
  assert.equal((html.match(/data-source-badge/gu) ?? []).length, 2);
  assert.match(
    html,
    /versão &quot;Current&quot;\. <span data-source-badge="">LogRocket \+1<\/span><\/p>/u,
  );
  assert.match(
    html,
    /suporte até abril de 2028\. <span data-source-badge="">Clever Cloud<\/span>/u,
  );
  assert.doesNotMatch(html, /&quot;Current&quot;\. \(/u);
  assert.doesNotMatch(html, /2028\. \(/u);
});
