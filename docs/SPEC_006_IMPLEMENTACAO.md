# SPEC-006 — Implementação da Fase 4B

**Estado:** implementada localmente; frontend provisório.  
**Base:** SPEC-005, SQLite v5; banco atual v6.  
**Evidência E2E integrada:** [`benchmarks/spec006/2026-10-25T21-34-29-957Z/`](../benchmarks/spec006/2026-10-25T21-34-29-957Z/).

## Resultado

O Kanban mantém tarefas por projeto separadas de conversas e Runs. A visão
agregada filtra Workspace, Projeto, estado e responsável; quadros de projeto
apresentam quatro colunas e mudança de estado por controle acessível. Formulário
manual e prévia de `/kanban` permitem revisar título, descrição, estado e
responsáveis antes de confirmar. Mensagens salvas podem originar tarefas com
referência à conversa e à mensagem.

O daemon é a autoridade para IDs, timestamps, projeto, origem, permissões e
eventos. Atribuição de Dot só aceita a configuração e os grants efetivos do
projeto. Vínculos de Run não mudam a Run. Edição usa revisão otimista; mutações
aceitam `operationId`, com replay idempotente e rejeição de mesma chave com
conteúdo diferente. Eventos de tarefa são append-only.

A correção B0 aceita a navegação `workspaceId = null` como válida quando aponta
para conversa global existente. A referência inválida continua recebendo
fallback seguro. O E2E fecha a janela, instancia outro processo Electron e
confirma o mesmo ID global, histórico e rascunho.

## Persistência e IPC

A migração transacional v5 → v6 adiciona `tasks`, `task_assignees`,
`task_run_links` e `task_events`, seus índices, FKs e triggers de contexto e
append-only. Conversas e mensagens de origem precisam pertencer ao projeto e à
conversa indicada; Runs relacionadas precisam pertencer ao projeto da tarefa.
Referências históricas a Dots indisponíveis são mantidas para consulta e não
autorizam novas atribuições. A migração termina com `foreign_key_check`.

As operações nomeadas são `tasks.list/get/create/update`,
`tasks.assignees.set`, `tasks.runs.link/unlink` e `tasks.events.list`. O preload
não expõe `invoke` arbitrário. Listas usam cursor e limite até 100, com orçamento
de resposta em bytes abaixo do frame local; a UI oferece página seguinte. Ordenação
é estável por criação e ID, sem ordenação manual.

## Matriz de aceite B0–B16

| ID | Estado/evidência |
|---|---|
| B0 | **Passou.** E2E SPEC-006 fechou e recriou a janela; ID, histórico e rascunho da conversa `null/null` foram preservados. Captura `global-restored-1440.png`. |
| B1 | **Passou.** E2E cria tarefa manual com título, descrição, usuário e Dot autorizado; resposta autoritativa persiste os dados. |
| B2 | **Passou.** Cancelar formulário e prévia não altera contagem de tarefas/eventos. |
| B3 | **Passou.** `/kanban` abre prévia editável, não salva mensagem e não inicia Run; cancelamento conserva o texto. |
| B4 | **Passou.** A ação em mensagem salva cria descrição inicial e mantém chat/message IDs de origem. |
| B5 | **Passou.** Conversa livre exige vínculo; cancelar não cria tarefa. Após vincular, é necessária uma nova revisão. |
| B6 | **Passou.** E2E altera título/estado, confere persistência e histórico; estado também foi operado por teclado. |
| B7 | **Passou.** Dot sem grant é recusado; Dot autorizado não inicia execução nem altera grants. |
| B8 | **Passou.** A Run do projeto diferente é recusada; vínculo no mesmo projeto é permitido. |
| B9 | **Passou.** Estado da tarefa e estado da Run permanecem independentes; tarefa concluída pode ser reaberta explicitamente. |
| B10 | **Passou.** Workflow E2E integrado também passou as suítes anteriores, incluindo favoritos/recentes, terminais, diff e recuperação de Run. |
| B11 | **Passou.** Testes daemon/E2E verificam replay idempotente, payload diferente com mesma chave e revisão obsoleta recusados. Campos locais permanecem na edição em conflito. |
| B12 | **Passou.** Lista agrega projetos e mostra origem; filtros de workspace (com projeto em outro workspace), projeto, estado e responsável foram exercitados. |
| B13 | **Passou.** Fixture cria 105 tarefas; API e UI carregam segunda página sem ocultar itens após os primeiros 100. |
| B14 | **Passou.** Teste recria uma base v5 com dados de trabalho e verifica preservação após v6 e `foreign_key_check` vazio; teste de banco novo cobre a sequência de migrações. |
| B15 | **Passou no escopo local testado.** E2E usa conteúdo sintético e verifica ausência de texto de tarefa em relatório/notificação. Não envia dados externos. |
| B16 | **Parcial.** Fluxos do E2E operam controles nativos por teclado; capturas em 900 e 1440 px confirmam ausência de overflow horizontal global. Não é uma auditoria completa de leitor de tela. |

## Evidência e medições locais

Execução em Ubuntu de desenvolvimento, fixtures Git locais e Dot simulado, sem
conta paga ou credenciais. A evidência principal inclui quatro capturas e
`spec006-e2e.json` no diretório integrado acima. O teste confirma também que
`/kanban` no meio de uma frase é salvo como texto comum e não abre a prévia.

| Medida | Resultado |
|---|---:|
| Abrir quadro de projeto | 70,2 ms |
| Resposta daemon para página seguinte | 1,9 ms |
| Paginação na UI | 72,2 ms |
| App, ocioso (RSS/PSS agregado dos processos) | 749,0 / 320,3 MiB; CPU 4,10% de um core na amostra |
| Daemon, ocioso | 83,9 / 47,9 MiB; CPU 0% na amostra |
| App com duas Runs sintéticas (RSS/PSS) | 737,6 / 310,0 MiB; CPU 1,64% de um core na amostra |
| Daemon com duas Runs (RSS/PSS) | 210,9 / 92,7 MiB; CPU 0% na amostra |

Cada medição de processo cobre uma janela de 1,2 s; foi uma amostra por cenário,
no mesmo host. Carga concorrente do desktop não foi controlada, RSS pode contar
páginas compartilhadas e as Runs estavam ativas para validar vínculo. Esses
números não representam uma medição prolongada, referência de hardware ou
garantia de CI.

## Ajuste 01 — Filtro residual no Kanban

No quadro do projeto, os cartões agora são filtrados somente pelo projeto
selecionado. Estado e responsável continuam aplicados pelo daemon na visão
agregada, mas não restringem os resultados do quadro; os dois controles ficam
desabilitados nesse modo. Os valores permanecem no estado da tela e voltam a
filtrar a lista agregada ao alternar de volta. O filtro de projeto continua
limitando as tarefas carregadas para o quadro.

O E2E integrado cobre a alternância pela interface com quatro fixtures do mesmo
projeto, uma em cada estado, uma tarefa sem o responsável selecionado e uma
tarefa de outro projeto. Confirma que “A fazer” funciona na lista, que os quatro
cartões aparecem nas colunas corretas com estado e responsável desabilitados,
que mover “Em revisão” para “Concluída” atualiza a coluna de destino e que os
filtros de estado e responsável são restaurados ao voltar à lista. A tarefa do
outro projeto não aparece no quadro.

**Resultado:** passou em `npm run test:e2e`, usando fixtures locais. A checagem
está registrada como B17 em
[`spec006-e2e.json`](../benchmarks/spec006/2026-10-25T21-34-29-957Z/spec006-e2e.json);
a captura do quadro após mover o cartão é
[`kanban-residual-filter-1440.png`](../benchmarks/spec006/2026-10-25T21-34-29-957Z/kanban-residual-filter-1440.png).

## Validação e pendências

Validação executada com `source scripts/local-env.sh`:

- `npm run check` — passou.
- `npm test` — passou na segunda execução, 36/36 testes. A primeira execução teve uma falha intermitente no teste de entrega, que esperava `sent` e recebeu `uncertain`.
- `npm run test:desktop` — passou; Electron real, sandbox ativo, sem erro de renderer.
- `npm run test:e2e` — passou; E2E anteriores de execução/recuperação e organização, mais SPEC-006 com B17.
- Reexecução de `node scripts/spec006-e2e.mjs` após acrescentar a verificação de menção no meio da frase e filtro real entre dois Workspaces — passou.
- `git diff --check` — passou.

Revisão formal do protocolo local continua pendente conforme o registro
existente. Não foram avaliados CI remota, entrega D-Bus de notificações,
comportamento autenticado de provider, nem Auto Resume. Esses itens não são
aprovados por testes de fixtures locais e Auto Resume permanece independente.

## Ajuste 02 — Ordem das tentativas de entrega

**Causa demonstrada.** O log original foi recuperado do histórico local de execução
(2026-10-25T21:26:38.861Z). O teste
`entrega exige Run da conversa, não repete a mesma chave e retry incerto é explícito`,
em `tests/workspaces.test.mjs:430:12`, esperava `sent` e consultou `uncertain`.
A asserção falhou na listagem de mensagens, depois que a nova tentativa explícita
já havia retornado `sent`. O teste usa callbacks síncronos simulados e uma exceção
intencional na tentativa anterior; não usa PTY real, CLI, IPC, encerramento ou
reinício de processo. Seu sucesso exige retorno normal da escrita simulada, sem
espera por prompt ou prontidão de CLI.

Antes de modificar a implementação, 30 execuções isoladas sequenciais produziram
11 falhas nessa mesma asserção. A suíte completa executada em seguida também
falhou ali (35/36). Portanto, a evidência não aponta para o ciclo de vida do PTY
como causa deste incidente.

A listagem escolhia a entrega por `updated_at DESC, operation_id DESC`; a guarda
contra nova tentativa usava `created_at DESC, operation_id DESC`. Duas tentativas
podem compartilhar o mesmo milissegundo. Como UUIDs são aleatórios, o desempate
podia escolher a entrega antiga `uncertain` em vez da nova `sent`. Isso também
podia fazer a guarda ignorar uma entrega já confirmada. Dois cenários dirigidos,
com UUIDs ordenados de forma adversa e relógio fixo ou recuando, falharam de forma
determinística antes da correção e passaram depois.

As consultas da última entrega, do histórico e da guarda agora usam a ordem de
inserção das tentativas (`rowid` da tabela SQLite existente). As linhas são
inseridas por tentativa e atualizadas no mesmo registro; a ordem independe do
relógio e do UUID. Não houve migração de schema nem alteração da escrita,
permissões, conversas, Runs, Kanban, ponte Electron ou visual. A regressão também
verifica a ordem depois de VACUUM e reabertura do banco.

O fluxo permanece: validar contexto/Run ativa → persistir intenção `pending` e
chave idempotente → chamar escrita → persistir `sent` no retorno normal ou
`uncertain` na exceção. `RunManager.write` verifica a sessão ativa e chama
`active.process.write` sincronamente; não há confirmação semântica do agente.
Eventos de entrega são emitidos após a mutação persistida e não alteram o
resultado de uma consulta autoritativa. A recuperação converte intenções pendentes
em `uncertain`, sem escrever no terminal. Repetir uma chave retorna o registro
existente, inclusive quando a Run já terminou. Nova tentativa incerta ainda exige
nova chave e revisão explícita.

A cobertura existente de sucesso estrito, exceção, contexto e retry explícito foi
mantida. Cinco regressões adicionais cobrem desempate e relógio regressivo,
intenção persistida antes do callback, bloqueio de nova escrita após `sent`,
replay de ambas as chaves, exceção e queda de subprocesso imediatamente após a
intenção, recuperação/reabertura sem reenvio, Run cancelada antes da validação ou
durante uma escrita ambígua e limpeza independente de duas fixtures. Nenhuma
expectativa de sucesso aceita indistintamente `sent` ou `uncertain`.

Evidências sanitizadas e harness reproduzível:
[`benchmarks/spec006/ajuste02/`](../benchmarks/spec006/ajuste02/).
Contêm a stack original sem caminho pessoal, resultados por execução e estágio,
cenários dirigidos e auditoria de recursos. Não contêm corpo de mensagens, saída
de terminal, tokens, variáveis de ambiente ou exceções arbitrárias. Não foi
adicionada instrumentação nem flag de falha em produção.

**Validação final** com `source scripts/local-env.sh`:

- Teste original isolado: **30/30 execuções consecutivas aprovadas** após a correção.
- Regressões direcionadas: **6/6 aprovadas**, incluindo o teste original.
- `npm test`: **três execuções consecutivas aprovadas, 41/41 em cada uma**.
- `npm run check`, `npm run test:e2e` e `git diff --check`: **aprovados**.
- Auditoria sequencial final: **nenhum novo diretório de fixture ou daemon
  remanescente detectado**, inclusive após o E2E; sockets ficam nos diretórios
  temporários removidos. Recursos preexistentes foram preservados.

Resultados por execução em `after.json`, `validation.json` e `final-check.json`.
A primeira rodada pós-correção coincidiu com E2E em andamento durante a amostragem
de recursos; está preservada em `preliminary-after.json` e não é usada como prova
de limpeza. A rodada final foi executada sequencialmente para eliminar essa
interferência na medição. `test:desktop` separado não se aplica à
alteração: não houve mudança na ponte Electron, reconexão ou ciclo de janela;
o E2E integrado executa Electron real.

**Limitações:** a confirmação `sent` continua limitada ao contrato de escrita ao
terminal, sem afirmar processamento pela CLI. Os cenários de queda/encerramento
são sintéticos; não validam providers autenticados. A auditoria compara novos
diretórios de fixtures e processos de daemon com o inventário inicial e preserva
recursos preexistentes. As repetições aumentam a confiança nesta correção, sem
provar ausência de todas as corridas possíveis.
