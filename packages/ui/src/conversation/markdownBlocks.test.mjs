import assert from "node:assert/strict";
import test from "node:test";
import { splitMarkdownBlocks } from "./markdownBlocks.ts";

test("divide Markdown por blocos de topo e mantém listas e cercas juntas", () => {
  const markdown = [
    "# Introdução",
    "",
    "Uma explicação em um parágrafo.",
    "",
    "- primeiro item",
    "- segundo item",
    "",
    "```ts",
    "const answer = 42;",
    "```",
  ].join("\n");

  assert.deepEqual(
    splitMarkdownBlocks(markdown).map(({ markdown: content, kind, closed }) => ({
      content,
      kind,
      closed,
    })),
    [
      { content: "# Introdução", kind: "markdown", closed: true },
      { content: "Uma explicação em um parágrafo.", kind: "markdown", closed: true },
      { content: "- primeiro item\n- segundo item", kind: "markdown", closed: true },
      { content: "```ts\nconst answer = 42;\n```", kind: "code", closed: true },
    ],
  );
});

test("mantém títulos Setext completos no mesmo bloco", () => {
  const blocks = splitMarkdownBlocks("Título Setext\n---------------\n\nTexto do parágrafo.");

  assert.equal(blocks.length, 2);
  assert.equal(blocks[0]?.markdown, "Título Setext\n---------------");
  assert.equal(blocks[0]?.closed, true);
});

test("marca uma cerca aberta como bloco em crescimento e não como código fechado", () => {
  const blocks = splitMarkdownBlocks("# Saída\n\n~~~js\nconsole.log('ao vivo');\n");

  assert.equal(blocks.length, 2);
  assert.deepEqual(blocks[1], {
    markdown: "~~~js\nconsole.log('ao vivo');",
    kind: "code",
    closed: false,
    hasFencedCode: true,
    start: 9,
  });
});

test("reconhece o fechamento com o mesmo marcador e comprimento suficiente", () => {
  const blocks = splitMarkdownBlocks("~~~ts\nlet value = 1;\n~~~~\n\nPróximo parágrafo.");

  assert.equal(blocks[0]?.closed, true);
  assert.equal(blocks[0]?.kind, "code");
  assert.equal(blocks[1]?.markdown, "Próximo parágrafo.");
});

test("mantém listas soltas em um único bloco sem absorver o parágrafo seguinte", () => {
  const blocks = splitMarkdownBlocks("- Primeiro item\n\n- Segundo item\n\nParágrafo seguinte.");

  assert.equal(blocks.length, 2);
  assert.equal(blocks[0]?.markdown, "- Primeiro item\n\n- Segundo item");
  assert.equal(blocks[0]?.closed, true);
  assert.equal(blocks[1]?.markdown, "Parágrafo seguinte.");
});

test("detecta código cercado dentro de uma lista para realçar quando o bloco fechar", () => {
  const blocks = splitMarkdownBlocks(
    "- Exemplo\n\n  ```ts\n  const value = 1;\n  ```\n\n- Próximo item",
  );

  assert.equal(blocks.length, 1);
  assert.equal(blocks[0]?.kind, "markdown");
  assert.equal(blocks[0]?.hasFencedCode, true);
  assert.equal(blocks[0]?.closed, false);
});

test("reduz o texto enviado ao parser durante uma resposta longa", (context) => {
  const sections = [];
  for (let section = 0; section < 32; section += 1) {
    sections.push(`### Parte ${section + 1}\n\n`);
    sections.push(
      "Texto explicativo da resposta sobre streaming, desempenho e decisões técnicas. ".repeat(4),
    );
    sections.push("\n\n- Primeiro item\n- Segundo item com detalhes\n- Terceiro item\n\n");
    if (section === 5 || section === 18 || section === 27) {
      sections.push(`\`\`\`ts\nfunction example${section}() { return "stream"; }\n\`\`\`\n\n`);
    }
  }

  const body = sections.join("");
  const padding = "Continuação da resposta. ";
  const sample =
    `${body}${padding.repeat(Math.ceil(Math.max(0, 14000 - body.length) / padding.length))}`.slice(
      0,
      14000,
    );
  const batches = 469;
  let baselineParserCharacters = 0;
  let blockParserCharacters = 0;
  let previous = new Map();

  for (let batch = 1; batch <= batches; batch += 1) {
    const markdown = sample.slice(0, Math.ceil((sample.length * batch) / batches));
    baselineParserCharacters += markdown.length;

    const next = new Map();
    splitMarkdownBlocks(markdown).forEach((block) => {
      const useHighlight = block.hasFencedCode && block.closed;
      const before = previous.get(block.start);
      if (!before || before.markdown !== block.markdown || before.useHighlight !== useHighlight) {
        blockParserCharacters += block.markdown.length;
      }
      next.set(block.start, { markdown: block.markdown, useHighlight });
    });
    previous = next;
  }

  assert.equal(sample.length, 14000);
  assert.ok(blockParserCharacters < baselineParserCharacters / 10);
  context.diagnostic(
    `14.000 caracteres em ${batches} atualizações: ${baselineParserCharacters.toLocaleString("pt-BR")} caracteres enviados ao parser antes; ${blockParserCharacters.toLocaleString("pt-BR")} com blocos memoizados.`,
  );
});
