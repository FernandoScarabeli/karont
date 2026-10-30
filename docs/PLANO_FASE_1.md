# Plano — Refatoração – Fase 1 (faxina e identidade)

Branch da fase: `refactor/fase-1-faxina`. Cada tarefa roda em worktree própria (`refactor/fase-1-tarefa-N`), é revisada pelo orquestrador e entra na branch da fase. Um PR por fase, para `main`.

Regras comuns a todas as tarefas (não repetidas abaixo): seguir `AGENTS.md` e `docs/SPEC_REFATORACAO.md` seção 5; sem dependências novas (exceto T8, aprovada); sem mudar comportamento visível; não alterar `packages/contracts`, `packages/local/src/wire.ts` nem schema/migrações, salvo onde a tarefa disser; problemas fora do escopo vão para `docs/DIVIDAS.md`; relatório final no formato da seção 5.1. Critérios sempre presentes: `npm run check` e `npm test` passam.

Os itens marcados com **[decisão]** dependem de resposta do usuário antes de a tarefa começar.

## Ordem e dependências

```
T1 CI e testes de desktop  →  T2 docs históricos  →  T3 higiene de benchmarks
  →  T4 → T5 → T6 → T7 renomeação por área
  →  T8 Biome (config)  →  T9 Biome (formatação em massa, commit isolado)
  →  T10 catch {} vazios  →  T11 licença e README
```

T1 vem primeiro porque, sem ela, o CI está vermelho em `main` e a regra "merge só com CI verde" não tem como ser cumprida. T9 vem depois da renomeação para não gerar conflito com ela.

---

### T1 — Fazer o CI e os testes de desktop voltarem a rodar

- **Contexto:** o CI falha em `main` porque o Electron aborta pelo sandbox no runner Ubuntu 24.04, e os testes `test:desktop`/`test:e2e` esperam `Daemon conectado` na primeira tela, texto que saiu dela no redesign (DIVIDAS #7, #10).
- **Objetivo:** no CI, preparar o helper do sandbox do jeito que o Electron documenta (dono root e modo `4755` no runner descartável), sem desligar o sandbox. Atualizar os scripts de teste para navegar até a tela onde o indicador de conexão existe hoje, ou usar outro sinal real de conexão já presente na UI, **sem mudar a UI**.
- **Pode alterar:** `.github/workflows/linux.yml`, `scripts/desktop-test.mjs`, `scripts/phase1-e2e.mjs`, `scripts/spec005-e2e.mjs`, `scripts/spec006-e2e.mjs`, `scripts/harness.mjs`, `docs/SANDBOX_LINUX.md`.
- **Aceite:** `test:desktop` e `test:e2e` passam localmente (com `CHROME_DEVEL_SANDBOX`) e no CI; nenhum argumento que desligue o sandbox; nenhuma mudança em `apps/`.

### T2 — Mover os documentos históricos

- **Objetivo:** mover `ACEITE_FASE_0.md`, `DECISOES_FASE_0.md`, `REVISAO_FASE_0.md` e `SPEC_00x_*.md` para `docs/historico/` com `git mv` e corrigir **todos** os links para eles no repositório.
- **Pode alterar:** `docs/**`, `README.md`, `AGENTS.md`.
- **Aceite:** `grep` não encontra link quebrado para os arquivos movidos; histórico do git preservado (`git log --follow`).

### T3 — Tirar artefatos gerados do versionamento

- **Objetivo:** `.gitignore` para `benchmarks/runs/`, `benchmarks/series/`, `benchmarks/spec*/`, `benchmarks/history/**/*.png|*.json`, `benchmarks/tmp/` e uma pasta ignorada para prints e baselines visuais; `git rm --cached` nesses caminhos (**sem apagar do disco**). Manter `benchmarks/RESULTADOS.md` e os `*-latest.json` pequenos. Ajustar o upload de artefatos no CI.
- **[decisão]** Arquivos de ideias na raiz e `.impeccable/review/*.png` (ver perguntas).
- **Pode alterar:** `.gitignore`, `.github/workflows/linux.yml`, índice do git em `benchmarks/`, `.impeccable/`, os 4 arquivos de ideias.
- **Aceite:** `git ls-files benchmarks | wc -l` pequeno e justificado; arquivos continuam no disco; CI verde.
- **Opcional, só com aprovação:** reescrever o histórico para remover os ~124 MB (ver perguntas).

### T4 — Renomear eros → Karont: pacotes compartilhados e daemon

- **Objetivo:** `@eros/contracts` e `@eros/local` → `@karont/*`; `EROS_*` → `KARONT_*`; caminhos `~/.config/eros`, `~/.local/share/eros` e `/run/user/<uid>/eros-<uid>` → `karont`, **com compatibilidade**: se só o antigo existir, usar o antigo (ou copiar, nunca apagar). Variáveis antigas `EROS_*` continuam aceitas como alternativa. Textos do daemon.
- **[decisão]** Identificador do handshake em `wire.ts` e prefixo de branch das Runs (ver perguntas).
- **Pode alterar:** `packages/**` (o nome `EROS_APP_VERSION` em `contracts` incluído, sem mudar formato), `apps/daemon/**`, testes correspondentes em `tests/`.
- **Aceite:** testes novos cobrindo a compatibilidade com config/dados antigos; schema intacto.

### T5 — Renomear: desktop

- **Objetivo:** `window.eros` → `window.karont`, canais IPC `eros:*` → `karont:*`, evento `eros-open-run`, textos de UI ("EROS / AMBIENTE LOCAL" etc.).
- **Pode alterar:** `apps/desktop/**`.
- **Aceite:** `grep -rni eros apps/desktop` vazio; `test:desktop` passa.

### T6 — Renomear: scripts, testes, CI e pacote raiz

- **Objetivo:** `eros-phase-zero` → `karont`, scripts, testes, nome do artefato do CI.
- **Pode alterar:** `package.json`, `package-lock.json` (só o nome), `scripts/**`, `tests/**`, `.github/**`.
- **Aceite:** `npm ci` limpo; CI verde.

### T7 — Renomear: documentação

- **Objetivo:** atualizar docs vigentes. Docs em `docs/historico/` ficam como estão (referência histórica intencional). Documentar a compatibilidade de config/dados no README.
- **Pode alterar:** `docs/**` (exceto `historico/`), `README.md`.
- **Aceite:** `grep -ri eros` só encontra histórico, compatibilidade de config e o changelog.

### T8 — Biome: configuração (sem formatar nada)

- **Objetivo:** adicionar `@biomejs/biome` (aprovado), `biome.json` imitando o estilo do `.prettierrc.json` atual, scripts `lint`, `format`, `format:check`; remover Prettier e `.prettierrc.json`; adicionar `lint` e `format:check` ao CI (pode começar como não bloqueante até T9).
- **Pode alterar:** `package.json`, `package-lock.json`, `biome.json`, `.prettierrc.json`, `.github/workflows/linux.yml`.
- **Aceite:** `npm run lint` roda; nenhum arquivo de código alterado.

### T9 — Biome: formatação em massa (commit isolado)

- **Objetivo:** `npm run format` uma vez, **nada além disso** no commit. Se o lint apontar erros reais, eles vão para `docs/DIVIDAS.md`, não são corrigidos aqui.
- **Aceite:** diff só de formatação; `format:check` passa; CI passa a bloquear em `format:check`.

### T10 — Revisar os 11 `catch {}` vazios

- **Objetivo:** cada um ganha um comentário curto dizendo por que o erro pode ser ignorado, ou passa a registrar o erro. Lista em `docs/DIVIDAS.md` #6.
- **Pode alterar:** só os 11 trechos listados.
- **Aceite:** `grep` de `catch {}` vazio sem comentário retorna zero; sem mudança de comportamento além de logs.

### T11 — Licença e README

- **[decisão]** Licença.
- **Objetivo:** arquivo de licença, campo `license` no `package.json`, README com nome único, status real e passo do `dots.json`.
- **Aceite:** README não contradiz o estado público do repositório.
