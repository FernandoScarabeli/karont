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
| T4 — renomeação: pacotes e daemon | Feito. Codex luna xhigh, 1 tentativa (não rodou `npm test` no sandbox dele: `listen EPERM`/`getconf EPERM`, como DIVIDAS #12). Orquestrador: `check` OK, `test` 49/49. Decisão do orquestrador: a cópia de `~/.local/share/eros` **não** leva `worktrees/` (copiar worktrees do git as quebra; o banco aponta para o caminho antigo, que é mantido). Depois, o orquestrador corrigiu dois pontos que só apareceram no CI: o `cpSync` do Node 24.22 recusa destino já existente (`0186396`), e o `phase1-e2e` procurava o título antigo `# eros` no relatório (`a557a84`, adiantando um pedaço da T6). CI verde (run `41114543577`). E2E ainda não rodados neste PC (falta o helper do sandbox) |
| T5 — renomeação: desktop | Feito. Codex luna xhigh, 1 tentativa. `window.karont`, canais `karont:*`, textos e logo (`k`+`karont`), userData em `~/.config/karont` com `migrateLegacyDirs()` chamada antes (senão o Electron criaria a pasta vazia e a cópia da T4 não aconteceria). Os E2E foram ajustados só onde usam a ponte ou o nome do app. Orquestrador: `check` OK, `test` 50/50; CI verde (run `41117432662`), E2E incluídos |
| T6 — renomeação: scripts, testes, CI e pacote raiz | Feito. Codex luna xhigh, 1 tentativa. Pacote raiz `karont`; variáveis `KARONT_*` nos scripts (as só de desenvolvimento, como `KARONT_REAL_CLI` e `KARONT_BENCH_ROUNDS`, sem alternativa antiga); usuário da VM `karont`. O orquestrador desfez uma troca de texto desnecessária em `scripts/report.mjs` ("números" contém "eros"). Ficam de propósito: `tests/paths.test.mjs`, o bloco de compatibilidade de `tests/daemon.test.mjs` e `eros/run-fixture`. CI verde na 3ª tentativa (run `41119305498`): as duas primeiras falharam em intermitências sem relação com a renomeação (DIVIDAS #15 e #20). Para a T7: docs vigentes ainda citam `EROS_REAL_CLI`, `EROS_QEMU_PREFIX` e o usuário `eros` da VM |
| T7 — renomeação: documentação | Feito. Codex luna xhigh, 1 tentativa. README com a seção "Vindo do nome antigo (eros)"; docs técnicos com caminhos, variáveis, handshake `karont:1` e helper do sandbox em `/usr/local/lib/karont-dev`. Ficam com o nome antigo de propósito: `historico/`, `produto/`, SPEC, PLANO_FASE_1, PROGRESSO, RETOMAR, BASELINE, DIVIDAS #19 e a seção de compatibilidade do README |
| T8 — Biome: configuração | Feito pelo orquestrador (precisa de rede para instalar; o Codex não tem). `@biomejs/biome` 2.5.15 exato (as 2.6.x tinham menos de 2 semanas), Prettier e `.prettierrc.json` removidos, `biome.json` com o mesmo estilo (aspas simples, 100 colunas, vírgula final) e o mesmo escopo do antigo `npm run format`. Scripts `lint`, `format`, `format:check`; no CI os dois rodam como não bloqueantes. Nenhum código alterado. Medido para a T9: `format` muda 24 arquivos (+5130/−1185). Lint com as regras recomendadas: 109 erros, 163 avisos, 31 infos (os maiores: `useButtonType` 88, `noNonNullAssertion` 80, `noDescendingSpecificity` 44) |
| T9 — Biome: formatação em massa | Feito pelo orquestrador. Commit isolado só com `npm run format` (24 arquivos; precisou de 2 passadas, porque o Biome não estabiliza um trecho de `workspaces.ts` na 1ª). Conferido: o build do daemon/desktop/pacotes é idêntico ignorando espaços; no renderer só mudou a divisão de 2 textos JSX (`" / "` e `" · "`), mesmo texto na tela. `check` OK, `test` 50/50. Em commit separado, o CI passou a bloquear em `format:check`; o lint continua só avisando (DIVIDAS #21) |
| T10 — `catch {}` vazios | Feito pelo orquestrador (só comentários; repassar ao Codex seria escrever o mesmo texto duas vezes). Os 11 ganharam um comentário dizendo por que o erro pode ser ignorado, conferido no código em volta; nenhum passou a registrar log e nenhum comportamento mudou. `check` OK, `test` 50/50. Fora do escopo, anotado: 15 `.catch(() => {})` no renderer (DIVIDAS #22) |
| T11 — licença e README | Feito pelo orquestrador. Licença segue `UNLICENSED` (decisão 14), sem arquivo LICENSE; o README dizia "privado", mas o repositório é público: agora explica que o código pode ser lido, mas não usado nem redistribuído. A seção de compatibilidade saiu do meio do passo a passo de instalação, e o README ganhou os comandos do Biome. Correção importante: o `daemon:stop` novo não alcança o daemon antigo (outra pasta de runtime e outro handshake), então o README manda encerrar o antigo **antes** de atualizar (ou com `kill`). Isso refina a decisão 10 |
| Extra — intermitência #20 | Feito pelo orquestrador. Causa encontrada no código (eventos de `recovery_needed` emitidos antes de o desktop reconectar; o desktop só vê no heartbeat de 2 s). O `phase1-e2e` agora espera os 2 avisos antes de clicar em Retomar. Limite do produto anotado em DIVIDAS #20 |

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
