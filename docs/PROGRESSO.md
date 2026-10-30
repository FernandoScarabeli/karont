# Progresso da refatoração

Estado vivo do trabalho descrito em [SPEC_REFATORACAO.md](SPEC_REFATORACAO.md). Atualizado pelo orquestrador ao fim de cada tarefa.

## Fase atual

**Refatoração – Fase 1 (faxina e identidade)**, branch `refactor/fase-1-faxina`. Plano em [PLANO_FASE_1.md](PLANO_FASE_1.md).

| Tarefa | Estado |
|---|---|
| T1 — CI e testes de desktop | Feito (`885b454`). Codex (gpt-6.1-sol high), 2 tentativas |
| T1b — spec005 para os fluxos vigentes | Feito (`7263df1`). Codex: 1ª com sol high, 2ª com luna xhigh; o orquestrador terminou os últimos ajustes (seletor de `<summary>` e corrida de rascunho, DIVIDAS #14), porque o Codex não roda E2E no sandbox dele |
| T2 — docs históricos | Feito (`d9a355e`). Codex luna xhigh, 1 tentativa. Um `git mv` rodou fora do sandbox por aprovação automática da config do Codex; corrigido no comando (ver abaixo) |
| T3 — artefatos gerados fora do git | Feito (`1856094`). Codex luna xhigh, 1 tentativa, sem pedidos fora do sandbox. 492 arquivos saíram do índice. Atenção: o merge apagou esses arquivos da pasta principal; o orquestrador restaurou a partir da worktree. Em outro clone, um `pull` faz o mesmo |
| Reescrita do histórico | Feita em 2026-10-30 com `git filter-branch` (mesmo filtro da T3) em `main` e `refactor/fase-1-faxina`, push forçado com lease. Repositório: 115 MB → 7 MB. Conteúdo final idêntico (mesmo hash de árvore). Backup completo antes: `~/karont-backup-2026-10-30.bundle`. Os hashes de commit mudaram; os citados aqui já são os novos. CI verde depois (commit `1856094`) |
| T4 — renomeação: pacotes e daemon | Feito. Codex luna xhigh, 1 tentativa (não rodou `npm test` no sandbox dele: `listen EPERM`/`getconf EPERM`, como DIVIDAS #12). Orquestrador: `check` OK, `test` 49/49. Decisão do orquestrador: a cópia de `~/.local/share/eros` **não** leva `worktrees/` (copiar worktrees do git as quebra; o banco aponta para o caminho antigo, que é mantido). `test:desktop`/E2E ainda não rodados neste PC (falta o helper do sandbox) |
| T5 a T11 | Pendentes |

Verificação ao fim da T1b (local, pelo orquestrador): `check` OK, `test` 42/42, `test:desktop` OK, `test:e2e` OK (phase1, spec005, spec006). CI verde no push seguinte (run `41098654702`).

### Comando padrão do Codex

O `~/.codex/config.toml` do usuário tem `approvals_reviewer = "auto_review"`, que aprova sozinho pedidos de execução fora do sandbox. Por isso o comando sempre força `approval_policy="never"` (pedidos fora do sandbox são recusados) e libera só a pasta git da própria worktree, para `git mv`/`git add` funcionarem:

```bash
W=~/karont-worktrees/fase-1-tarefa-N
cd "$W" && PATH="$HOME/.local/share/fnm/node-versions/v24.22.2/installation/bin:$PATH" \
codex exec -m gpt-6-luna -c model_reasoning_effort="xhigh" -c approval_policy="never" \
  -C "$W" -s workspace-write --add-dir "<repo>/.git/worktrees/fase-1-tarefa-N" \
  -o <resposta.md> - < <tarefa.md>
```

O Codex não roda E2E no próprio sandbox (`spawnSync getconf EPERM`); o orquestrador roda.

## Fase 0 (concluída, PR #1)

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

Registradas em 2026-10-30, para a Fase 1 (o usuário aceitou todas as recomendações):

9. **Dados e config antigos:** na primeira abertura, copiar `~/.config/eros` e `~/.local/share/eros` para as pastas `karont`, sem apagar as antigas.
10. **Handshake (mudança de protocolo aprovada):** o rótulo `eros:1` em `packages/local/src/wire.ts` passa a usar `karont`. Depois de atualizar, o daemon antigo precisa ser reiniciado uma vez.
11. **Branches de Runs:** Runs novas usam `karont/run-*`; as existentes ficam como estão.
12. **Arquivos de ideias:** os 4 (são documentos diferentes, não cópias) vão para `docs/produto/` com nomes simples.
13. **`.impeccable/review/*.png`:** saem do git, ficam no disco.
14. **Licença:** continua `UNLICENSED` por enquanto; decidir depois.
15. **Histórico do git:** aprovada a reescrita para remover os artefatos gerados. Feita pelo orquestrador depois da tarefa T3, antes do PR da Fase 1, com backup do repositório.
16. **PR da Fase 0:** merge aprovado mesmo com o CI vermelho, porque a falha é anterior e o PR só tem documentação.
17. **Modelo do Codex:** a partir da tarefa T2, usar `-m gpt-6-luna -c model_reasoning_effort="xhigh"` (mais barato). As tarefas são escritas em blocos pequenos, passo a passo, cada um com o seu critério de pronto.

## Ambiente local

- Node 24 via fnm em `~/.local/share/fnm` (shell do usuário não foi alterado).
- Helper do sandbox instalado pelo usuário em `/usr/local/lib/karont-dev/chrome-sandbox` (root, `4755`). Rodar os testes de desktop com `CHROME_DEVEL_SANDBOX=/usr/local/lib/karont-dev/chrome-sandbox`. Depois de cada `npm ci`, renomear `node_modules/electron/dist/chrome-sandbox` (o Chromium ignora a variável se esse arquivo existir) e, se a versão do Electron mudar, reinstalar o helper.

## Bloqueios

- O CI do GitHub está vermelho em `main` desde antes da refatoração (sandbox do Electron), e os testes de desktop/E2E estão desatualizados em relação à UI (DIVIDAS #7 e #10). A regra "merge só com CI verde" depende de resolver isso primeiro.

## Tarefas concluídas

Ver a tabela da fase atual.
