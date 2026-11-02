import assert from "node:assert/strict";
import test from "node:test";
import {
  getWordsPerSecond,
  planWordRelease,
  splitIntoTokens,
  splitIntoWords,
} from "./streamingText.mjs";

const values = (tokens) => tokens.map((token) => token.value);

test("divide palavras sem perder espaços nem posições", () => {
  assert.deepEqual(splitIntoWords("Olá, mundo!\n código"), [
    { value: "Olá,", start: 0, end: 4, kind: "word" },
    { value: " ", start: 4, end: 5, kind: "space" },
    { value: "mundo!", start: 5, end: 11, kind: "word" },
    { value: "\n ", start: 11, end: 13, kind: "space" },
    { value: "código", start: 13, end: 19, kind: "word" },
  ]);
});

test("tokens levam o espaço final e só liberam palavra terminada enquanto o texto chega", () => {
  assert.deepEqual(values(splitIntoTokens("Olá, mundo!\n código")), ["Olá, ", "mundo!\n "]);
  assert.deepEqual(values(splitIntoTokens("Olá, mundo!\n código", true)), [
    "Olá, ",
    "mundo!\n ",
    "código",
  ]);
  assert.deepEqual(values(splitIntoTokens("  inicio ", false)), ["  ", "inicio "]);
});

test("posições dos tokens cobrem o texto sem sobreposição", () => {
  const text = "Um texto com **ênfase** e `código` no meio. ";
  const tokens = splitIntoTokens(text);
  assert.equal(tokens.at(-1)?.end, text.length);
  for (const [index, token] of tokens.entries()) {
    assert.equal(token.value, text.slice(token.start, token.end));
    if (index > 0) assert.equal(token.start, tokens[index - 1]?.end);
  }
});

test("não mostra um par de markdown antes de seu fechamento", () => {
  assert.deepEqual(values(splitIntoTokens("Uma **palavra forte")), ["Uma "]);
  assert.deepEqual(values(splitIntoTokens("Uma **palavra forte** aqui ")), [
    "Uma ",
    "**palavra forte** ",
    "aqui ",
  ]);
  assert.deepEqual(values(splitIntoTokens("Use `código inline` agora ")), [
    "Use ",
    "`código inline` ",
    "agora ",
  ]);
});

test("nunca separa um marcador no meio do token", () => {
  for (const text of ["**forte** e _itálico_ ok ", "`a` `b` `c` "]) {
    for (let cut = 1; cut <= text.length; cut += 1) {
      const tokens = splitIntoTokens(text.slice(0, cut));
      for (const token of tokens) {
        const marks = (token.value.match(/\*\*|_|`/gu) ?? []).length;
        assert.equal(marks % 2, 0, `token quebrado em "${token.value}" (corte ${cut})`);
      }
    }
  }
});

test("não corta cercas de código e libera as linhas inteiras", () => {
  const code = "```ts\nconst valor = 1;\n```\n";
  const tokens = splitIntoTokens(code);
  assert.equal(tokens[0]?.value, "```ts\n");
  assert.equal(tokens.at(-1)?.end, code.length);
  assert.deepEqual(splitIntoTokens("```ts", false), []);
});

test("ao terminar, libera o restante mesmo sem fronteira de palavra", () => {
  assert.equal(splitIntoTokens("última palavra", true).at(-1)?.end, 14);
});

test("ritmo sobe com o atraso e fica limitado", () => {
  assert.equal(getWordsPerSecond(0), 18);
  assert.equal(getWordsPerSecond(10), 48);
  assert.equal(getWordsPerSecond(1000), 120);
  assert.ok(getWordsPerSecond(5) < getWordsPerSecond(6));
});

test("sem atraso não libera nada e não guarda fração", () => {
  const plan = planWordRelease({ backlogWords: 0, elapsedMs: 100 });
  assert.equal(plan.count, 0);
  assert.equal(plan.carryWords, 0);
});

test("libera palavras inteiras e guarda a fração para o próximo quadro", () => {
  const plan = planWordRelease({ backlogWords: 5, elapsedMs: 100 });
  assert.equal(plan.count, 3);
  assert.ok(Math.abs(plan.carryWords - 0.3) < 1e-9);
});

test("a fração acumula entre quadros e nunca libera mais que o atraso", () => {
  let carry = 0;
  let released = 0;
  for (let frame = 0; frame < 62; frame += 1) {
    const plan = planWordRelease({ backlogWords: 1000, elapsedMs: 16, carryWords: carry });
    released += plan.count;
    carry = plan.carryWords;
  }
  assert.ok(released >= 118 && released <= 120, `liberou ${released} em ~1 s`);

  const last = planWordRelease({ backlogWords: 2, elapsedMs: 1000, carryWords: 0.9 });
  assert.equal(last.count, 2);
  assert.equal(last.carryWords, 0);
});

test("ao terminar, drena o atraso em até 400 ms", () => {
  let backlog = 60;
  let elapsed = 0;
  let carry = 0;
  let drainMsLeft = 350;
  while (backlog > 0 && elapsed < 2000) {
    const plan = planWordRelease({
      backlogWords: backlog,
      elapsedMs: 16,
      done: true,
      carryWords: carry,
      drainMsLeft,
    });
    backlog -= plan.count;
    carry = plan.carryWords;
    drainMsLeft = plan.drainMsLeft;
    elapsed += 16;
  }
  assert.equal(backlog, 0);
  assert.ok(elapsed <= 400 + 16, `levou ${elapsed} ms`);
});

test("_ dentro de palavra é texto comum e não segura o resto", () => {
  assert.deepEqual(values(splitIntoTokens("Abra nome_arquivo agora ")), [
    "Abra ",
    "nome_arquivo ",
    "agora ",
  ]);
  assert.deepEqual(values(splitIntoTokens("snake_case_name e mais ")), [
    "snake_case_name ",
    "e ",
    "mais ",
  ]);
});

test("asterisco com espaços não abre marcador", () => {
  assert.deepEqual(values(splitIntoTokens("2 * 3 = 6 ")), ["2 ", "* ", "3 ", "= ", "6 "]);
});

test("item de lista começando com '* ' não segura o texto", () => {
  assert.deepEqual(values(splitIntoTokens("* item um\n* item dois ")), [
    "* ",
    "item ",
    "um\n",
    "* ",
    "item ",
    "dois ",
  ]);
});

test("** sem fechamento segura até a válvula e depois libera", () => {
  const short = `**${"palavra ".repeat(5)}`;
  assert.deepEqual(splitIntoTokens(short), []);

  const long = `**${"palavra ".repeat(30)}`;
  const tokens = splitIntoTokens(long);
  assert.ok(tokens.length > 0, "a válvula deve liberar depois de 120 caracteres");
  assert.ok(tokens[0].end > 120, "a primeira liberação passa do limite");
  assert.equal(tokens.at(-1)?.end, long.length);
});

test("negrito e código normais nunca são cortados no meio do marcador", () => {
  const text = "Veja **negrito forte** e `código longo aqui` e fim. ";
  for (let cut = 1; cut <= text.length; cut += 1) {
    const tokens = splitIntoTokens(text.slice(0, cut));
    for (const token of tokens) {
      assert.equal((token.value.match(/\*\*/gu) ?? []).length % 2, 0, `"${token.value}"`);
      assert.equal((token.value.match(/`/gu) ?? []).length % 2, 0, `"${token.value}"`);
    }
  }
  assert.deepEqual(values(splitIntoTokens(text)), [
    "Veja ",
    "**negrito forte** ",
    "e ",
    "`código longo aqui` ",
    "e ",
    "fim. ",
  ]);
});
