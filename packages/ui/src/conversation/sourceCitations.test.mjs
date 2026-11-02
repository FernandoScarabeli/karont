import assert from "node:assert/strict";
import test from "node:test";
import { normalizeSourceUrl } from "@karont/contract";
import {
  calculateCitationPopoverPosition,
  cleanCitationText,
  findCitationForLink,
  isCitationSeparator,
  isTrailingReference,
  normalizeCitationUrl,
  sourceSiteName,
  unwrapTrailingCitationGroup,
} from "./sourceCitations.ts";

const sources = [
  {
    url: "https://www.bbc.com/news/story?utm_source=assistant#top",
    title: "BBC report",
    snippet: "Trecho do resultado da busca.",
    date: "2026-11-01",
  },
];

test("normaliza URLs equivalentes para casar metadados do resultado", () => {
  assert.equal(
    normalizeSourceUrl("https://bbc.com/news/story#reader?utm_campaign=test"),
    normalizeSourceUrl("https://www.bbc.com/news/story/?utm_source=assistant"),
  );
  assert.equal(
    normalizeCitationUrl("http://www.example.org/article/?utm_source=assistant"),
    normalizeCitationUrl("https://example.org/article"),
  );
});

test("converte link com nome do site em selo e usa metadados casados por URL", () => {
  const citation = findCitationForLink(
    "https://bbc.com/news/story",
    "BBC",
    "Segundo a BBC, o relatório mudou.",
    42,
    sources,
  );

  assert.equal(citation?.site, "BBC");
  assert.equal(citation?.source.title, "BBC report");
  assert.equal(citation?.source.snippet, "Trecho do resultado da busca.");
});

test("casa por host e caminho e descarta metadados brutos do resultado real", () => {
  const citation = findCitationForLink(
    "https://blog.logrocket.com/node-js-24-new/?utm_campaign=chat",
    "Logrocket",
    "A versão foi lançada.",
    24,
    [
      {
        url: "https://www.blog.logrocket.com/node-js-24-new?utm_source=claude",
        title: 'Links: [{"title":"blog.logrocket.com","url":"',
        snippet:
          '","url":"https://blog.logrocket.com/node-js-24-new"},{"title":"forest.watch.impress.co.jp","url":"https://forest.watch.impress.co.jp/docs/news/2012357.html"}]',
      },
    ],
  );

  assert.equal(citation?.site, "Logrocket");
  assert.equal(citation?.source.title, undefined);
  assert.equal(citation?.source.snippet, undefined);
});

test("limpa markdown da descrição e rejeita texto serializado como trecho", () => {
  assert.equal(
    cleanCitationText("**A versão** usa [Node.js](https://nodejs.org)."),
    "A versão usa Node.js.",
  );
  assert.equal(cleanCitationText('{"title":"Outro site","url":"https://example.com"}'), undefined);
  assert.equal(cleanCitationText('"}]'), undefined);
});

test("converte referências entre parênteses no fim da frase em selo", () => {
  const markdown = "O estudo foi publicado recentemente ([relatório](https://example.org/paper)).";
  const linkEnd = "](https://example.org/paper)";
  const end = markdown.indexOf(linkEnd) + linkEnd.length;
  const citation = findCitationForLink("https://example.org/paper", "relatório", markdown, end, []);

  assert.equal(citation?.site, "Example");
  assert.equal(citation?.source.url, "https://example.org/paper");
});

test("mantém link descritivo no meio da frase como link normal, mesmo com resultado correspondente", () => {
  const citation = findCitationForLink(
    "https://www.bbc.com/news/story?utm_source=assistant#top",
    "leia o relatório completo",
    "Leia o relatório completo antes de continuar com os passos seguintes.",
    45,
    sources,
  );

  assert.equal(citation, null);
});

test("transforma uma referência curta casada com a busca em selo no meio da frase", () => {
  const citation = findCitationForLink(
    "https://www.bbc.com/news/story?utm_source=assistant#top",
    "1",
    "O primeiro dado [1] foi confirmado; depois explico a comparação.",
    18,
    sources,
  );

  assert.equal(citation?.site, "BBC");
});

test("aceita um grupo de referências em sequência até o fim da frase", () => {
  const markdown = "Dados de duas fontes ([BBC](https://bbc.com/a), [AP](https://apnews.com/b)).";
  const linkEnd = "](https://bbc.com/a)";
  const end = markdown.indexOf(linkEnd) + linkEnd.length;

  assert.equal(isTrailingReference(markdown, end), true);
  assert.equal(isCitationSeparator(", "), true);
  assert.equal(isCitationSeparator(" e "), true);
  assert.equal(isCitationSeparator("; "), true);
  assert.equal(isCitationSeparator(". Depois "), false);
  for (const separator of [", ", " e ", "; "]) {
    const markdown = `Fontes ([Logrocket](https://logrocket.com/a)${separator}[Clever](https://clever.cloud/b)).`;
    const end =
      markdown.indexOf("](https://logrocket.com/a)") + "](https://logrocket.com/a)".length;
    assert.equal(isTrailingReference(markdown, end), true);
  }
  const bracketedMarkdown =
    "Fontes [[Logrocket](https://logrocket.com/a); [Clever](https://clever.cloud/b)].";
  const bracketedEnd =
    bracketedMarkdown.indexOf("](https://logrocket.com/a)") + "](https://logrocket.com/a)".length;
  assert.equal(isTrailingReference(bracketedMarkdown, bracketedEnd), true);
  assert.deepEqual(unwrapTrailingCitationGroup("Fontes (", ")."), {
    prefix: "Fontes ",
    suffix: ".",
  });
  assert.deepEqual(unwrapTrailingCitationGroup("Fontes [", "]"), {
    prefix: "Fontes ",
    suffix: "",
  });
  assert.equal(unwrapTrailingCitationGroup("Fontes (", "). Em seguida"), null);
});

test("posiciona o cartão acima ou abaixo dentro dos limites da janela", () => {
  assert.deepEqual(
    calculateCitationPopoverPosition({
      anchor: { top: 500, bottom: 520, left: 20, width: 30 },
      card: { width: 320, height: 200 },
      viewport: { width: 800, height: 600 },
      gap: 8,
      margin: 12,
    }),
    { side: "above", top: 292, left: 12, maxHeight: 480 },
  );

  const position = calculateCitationPopoverPosition({
    anchor: { top: 200, bottom: 220, left: 380, width: 30 },
    card: { width: 320, height: 900 },
    viewport: { width: 400, height: 400 },
    gap: 8,
    margin: 12,
  });
  assert.deepEqual(position, { side: "above", top: 12, left: 68, maxHeight: 180 });
});

test("deriva nomes curtos de domínios compostos", () => {
  assert.equal(sourceSiteName("https://www.bbc.co.uk/news"), "BBC");
  assert.equal(sourceSiteName("https://www.wikipedia.org/wiki/"), "Wikipedia");
});
