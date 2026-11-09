import assert from "node:assert/strict";
import test from "node:test";
import { resolveInitialAgent } from "./initialAgent.ts";

const base = {
  manualChoice: null,
  projectDefault: null,
  lastUsed: null,
  foundAgentIds: ["claude", "codex"],
};

test("o agente padrão do projeto vence o último usado", () => {
  assert.equal(
    resolveInitialAgent({ ...base, projectDefault: "codex", lastUsed: "claude" }),
    "codex",
  );
});

test("sem agente padrão usa o último usado", () => {
  assert.equal(resolveInitialAgent({ ...base, lastUsed: "claude" }), "claude");
  assert.equal(resolveInitialAgent({ ...base, lastUsed: "terminal" }), "terminal");
});

test("agente padrão não instalado cai no último usado, depois em Terminal", () => {
  const found = ["claude"];
  assert.equal(
    resolveInitialAgent({
      ...base,
      foundAgentIds: found,
      projectDefault: "codex",
      lastUsed: "claude",
    }),
    "claude",
  );
  assert.equal(
    resolveInitialAgent({
      ...base,
      foundAgentIds: found,
      projectDefault: "codex",
      lastUsed: "codex",
    }),
    "terminal",
  );
  assert.equal(
    resolveInitialAgent({ ...base, foundAgentIds: found, projectDefault: "codex" }),
    "terminal",
  );
});

test("a escolha manual sempre vence", () => {
  assert.equal(
    resolveInitialAgent({
      ...base,
      manualChoice: "terminal",
      projectDefault: "codex",
      lastUsed: "claude",
    }),
    "terminal",
  );
  assert.equal(
    resolveInitialAgent({ ...base, manualChoice: "claude", projectDefault: "codex" }),
    "claude",
  );
});

test("a ordem em que o projeto e os agentes carregam não muda o resultado", () => {
  const withProjectFirst = [
    resolveInitialAgent({ ...base, foundAgentIds: null, projectDefault: "codex" }),
    resolveInitialAgent({ ...base, foundAgentIds: ["claude", "codex"], projectDefault: "codex" }),
  ];
  const withAgentsFirst = [
    resolveInitialAgent({ ...base, foundAgentIds: ["claude", "codex"], projectDefault: undefined }),
    resolveInitialAgent({ ...base, foundAgentIds: ["claude", "codex"], projectDefault: "codex" }),
  ];
  assert.equal(withProjectFirst.at(-1), "codex");
  assert.equal(withAgentsFirst.at(-1), "codex");
  assert.equal(withProjectFirst[0], "terminal", "sem a lista de agentes ainda é Terminal");
});
