import assert from "node:assert/strict";
import { test } from "node:test";
import { extractClaudeAssistantSources, extractClaudeToolSources } from "./claude-adapter.ts";
import { extractCodexWebSearchSources } from "./codex-adapter.ts";
import { makeMessageSource, mergeMessageSources } from "./source-metadata.ts";

test("mapeia resultados estruturados de WebSearch do Claude", () => {
  const sources = extractClaudeToolSources("WebSearch", { query: "notícia" }, [
    {
      type: "web_search_result",
      title: "Notícia em destaque",
      url: "https://www.example.com/news",
      cited_text: "Trecho retornado pelo mecanismo de busca.",
      page_age: "2 days ago",
    },
  ]);

  assert.deepEqual(sources, [
    {
      url: "https://www.example.com/news",
      title: "Notícia em destaque",
      snippet: "Trecho retornado pelo mecanismo de busca.",
      date: "2 days ago",
    },
  ]);
});

test("mapeia citações WebSearch que acompanham a resposta do Claude", () => {
  const sources = extractClaudeAssistantSources([
    {
      type: "text",
      text: "Segundo a notícia.",
      citations: [
        {
          type: "web_search_result_location",
          title: "Relatório anual",
          url: "https://example.com/report",
          cited_text: "O relatório apresenta os resultados.",
        },
      ],
    },
  ]);

  assert.equal(sources.length, 1);
  assert.equal(sources[0]?.title, "Relatório anual");
  assert.equal(sources[0]?.snippet, "O relatório apresenta os resultados.");
});

test("usa URL de entrada e conteúdo textual em resultados WebFetch do Claude", () => {
  const sources = extractClaudeToolSources("WebFetch", { url: "https://example.com/page" }, [
    { type: "text", text: "Page title: Guia do produto\n\nO conteúdo explica como funciona." },
  ]);

  assert.equal(sources.length, 1);
  assert.equal(sources[0]?.url, "https://example.com/page");
  assert.equal(sources[0]?.title, "Guia do produto");
  assert.match(sources[0]?.snippet ?? "", /O conteúdo explica/);
});

test("mapeia resultados do item webSearch do Codex sem expor detalhes do agente à UI", () => {
  const sources = extractCodexWebSearchSources({
    type: "webSearch",
    results: [
      {
        url: "https://example.com/story?utm_source=codex",
        title: "História",
        snippet: "Resumo da busca.",
        published_at: "2026-10-30",
      },
    ],
  });

  assert.deepEqual(sources, [
    {
      url: "https://example.com/story?utm_source=codex",
      title: "História",
      snippet: "Resumo da busca.",
      date: "2026-10-30",
    },
  ]);
  assert.deepEqual(extractCodexWebSearchSources({ type: "commandExecution", results: [] }), []);
});

test("normaliza URL e limita campos e quantidade de fontes", () => {
  const original = makeMessageSource({
    url: "https://example.com/article?utm_source=first",
    title: "Título",
  });
  const enriched = makeMessageSource({
    url: "https://www.example.com/article?utm_source=second",
    snippet: "s".repeat(800),
  });
  assert.ok(original);
  assert.ok(enriched);

  const merged = mergeMessageSources(
    [original],
    [
      enriched,
      ...Array.from({ length: 25 }, (_, index) => ({ url: `https://site${index}.example/` }))
        .map((item) => makeMessageSource(item))
        .filter((item) => item !== null),
    ],
  );

  assert.equal(merged.length, 20);
  assert.equal(merged[0]?.title, "Título");
  assert.equal(merged[0]?.snippet?.length, 720);
});
