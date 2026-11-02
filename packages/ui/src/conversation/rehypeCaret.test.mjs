import assert from "node:assert/strict";
import test from "node:test";
import { rehypeCaret } from "./rehypeCaret.ts";

const CLASS = "streamingCaret";

function paragraph(children) {
  return { type: "root", children: [{ type: "element", tagName: "p", children }] };
}

function text(value) {
  return { type: "text", value };
}

function element(tagName, children) {
  return { type: "element", tagName, children };
}

test("põe o cursor dentro do elemento que guarda o último texto", () => {
  const tree = paragraph([text("Olá "), element("strong", [text("mundo")])]);
  rehypeCaret({ className: CLASS })(tree);

  const strong = tree.children[0].children[1];
  const caret = strong.children.at(-1);
  assert.equal(caret.tagName, "span");
  assert.deepEqual(caret.properties, { className: [CLASS], ariaHidden: true });
  assert.equal(tree.children[0].children.at(-1).tagName, "strong");
});

test("ignora texto só com espaço ao final", () => {
  const tree = paragraph([text("fim"), text("  \n")]);
  rehypeCaret({ className: CLASS })(tree);
  const caret = tree.children[0].children.at(-1);
  assert.equal(caret.tagName, "span");
  assert.equal(tree.children[0].children.length, 3);
});

test("sem texto visível não adiciona cursor", () => {
  const tree = paragraph([element("img", []), text("   ")]);
  rehypeCaret({ className: CLASS })(tree);
  assert.equal(tree.children[0].children.length, 2);
});
