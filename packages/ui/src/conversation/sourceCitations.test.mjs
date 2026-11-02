import assert from "node:assert/strict";
import test from "node:test";
import { normalizeSourceUrl } from "@karont/contract";
import {
  findCitationForLink,
  isCitationSeparator,
  isTrailingReference,
  sourceSiteName,
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
  assert.equal(isCitationSeparator(". Depois "), false);
});

test("deriva nomes curtos de domínios compostos", () => {
  assert.equal(sourceSiteName("https://www.bbc.co.uk/news"), "BBC");
  assert.equal(sourceSiteName("https://www.wikipedia.org/wiki/"), "Wikipedia");
});
