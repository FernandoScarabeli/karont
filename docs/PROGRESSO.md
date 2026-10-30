# Progresso da refatoração

Estado vivo do trabalho descrito em [SPEC_REFATORACAO.md](SPEC_REFATORACAO.md). Atualizado pelo orquestrador ao fim de cada tarefa.

## Fase atual

**Refatoração – Fase 0 (linha de base)**, branch `refactor/fase-0-baseline`. Em andamento.

| Item | Estado |
|---|---|
| Node 24 via fnm | Feito (`v24.22.2`) |
| `npm ci`, `check`, `test` | Feito, verdes |
| `test:desktop`, `test:e2e` | Rodados; falham antes de qualquer mudança: sandbox do Electron (contornado localmente) e testes desatualizados desde o redesign (ver [BASELINE.md](BASELINE.md)) |
| `benchmark` (3 rodadas, mediana) | Feito, mas com o PC ocupado (o usuário optou por não esperar). Refazer ocioso depois |
| `SPEC_REFATORACAO.md`, `AGENTS.md`, `DIVIDAS.md`, `PROGRESSO.md` | Feito |
| `BASELINE.md` | Feito |
| Plano da Fase 1 | Feito: [PLANO_FASE_1.md](PLANO_FASE_1.md), aguardando respostas do usuário |

## Decisões do usuário

Registradas em 2026-10-30.

1. **Node:** fnm sem root, Node 24. Confirmar `node -v` = 24.x antes de qualquer medição.
2. **Qualidade:** Biome no lugar do Prettier. A primeira formatação de todo o código vai em commit isolado, sem nenhuma outra mudança.
3. **Nomenclatura:** nos docs novos, "Refatoração – Fase N". Os docs antigos (`ACEITE_FASE_0`, `DECISOES_FASE_0`, `REVISAO_FASE_0`, `SPEC_00x_*`) vão para `docs/historico/` numa tarefa separada que também corrige todos os links para eles.
4. **Codex:** o orquestrador roda `codex exec` diretamente, uma tarefa por vez, em worktree própria, com o sandbox restrito à worktree (nunca o modo que desliga as proteções). O comando exato é mostrado ao usuário na primeira vez, antes de executar. Sem tarefas em paralelo por enquanto.
5. **Git:** push das branches e **um PR por fase** (não por tarefa). Merge só com CI verde e depois da revisão do orquestrador.
6. **Artefatos visuais:** prints e baselines visuais ficam fora do git, numa pasta ignorada. No repositório ficam só poucas telas de referência aprovadas, em `docs/design/previews`. Reescrever o histórico para remover os ~124 MB de `benchmarks/` é uma opção a apresentar na Fase 1; **não fazer sem aprovação**.
7. **`karont.pen`:** o usuário vai procurar; só é necessário na Fase 3.
8. **Benchmark:** no mínimo 3 rodadas, com o PC ocioso; reportar a mediana. Resultados brutos ficam fora do git (`~/karont-baseline/`); só o `BASELINE.md` entra no repositório.

## Ambiente local

- Node 24 via fnm em `~/.local/share/fnm` (shell do usuário não foi alterado).
- Helper do sandbox instalado pelo usuário em `/usr/local/lib/karont-dev/chrome-sandbox` (root, `4755`). Rodar os testes de desktop com `CHROME_DEVEL_SANDBOX=/usr/local/lib/karont-dev/chrome-sandbox`. Depois de cada `npm ci`, renomear `node_modules/electron/dist/chrome-sandbox` (o Chromium ignora a variável se esse arquivo existir) e, se a versão do Electron mudar, reinstalar o helper.

## Bloqueios

- O CI do GitHub está vermelho em `main` desde antes da refatoração (sandbox do Electron), e os testes de desktop/E2E estão desatualizados em relação à UI (DIVIDAS #7 e #10). A regra "merge só com CI verde" depende de resolver isso primeiro.

## Tarefas concluídas

Nenhuma tarefa de código ainda.
