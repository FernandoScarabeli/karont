# Implementação SPEC-005 — Workspaces, projetos e conversas

Data: 25/10/2026. Status: **Fase 4A implementada; ajuste 01 da restauração global corrigido e validado**.

Esta entrega organiza projetos e conversas no shell do Eros. Não declara a Fase
4 completa. Kanban e `/kanban` continuam na Fase 4B; Auto Resume continua
indisponível conforme a SPEC-004.

Uma revisão manual reproduziu a perda da seleção ao reabrir conversa livre
global: o bootstrap aceitava a navegação somente quando `workspaceId` existia e
substituía o contexto `null/null` pelo workspace padrão, embora o daemon tivesse
validado o chat salvo. O bootstrap agora valida o chat e seu escopo, aceita uma
conversa global existente com `workspaceId` e `projectId` nulos e carrega seus
detalhes antes de publicar a navegação no React. Conversas de workspace/projeto
continuam exigindo contexto existente; navegações inválidas seguem para o
fallback. A implementação segue o [ajuste 01](SPEC_005_AJUSTE_01_NAVEGACAO_GLOBAL.md).

## O que foi implementado

- Shell inicial de Workspaces, com criação e renomeação persistentes e workspace
  padrão “Meus projetos”.
- Cadastro de repositório Git existente pela seleção nativa de pasta. O main
  mostra a raiz selecionada e os Dots escolhidos numa confirmação explícita; a
  concessão fica limitada ao projeto e não altera a configuração-base do Dot.
- Conversas de projeto e conversas livres, com rascunho, título, favoritos,
  recentes, navegação restaurada e histórico de mensagens digitadas pelo usuário.
- Início explícito de Run por conversa. Criar ou abrir conversa não inicia
  execução. O Dot e o projeto são derivados e validados pelo daemon.
- Envio explícito de uma mensagem salva ao PTY ativo da mesma conversa. Uma
  intenção de entrega é persistida antes da escrita; chave repetida não reenvia
  e uma entrega ambígua exige revisão explícita para uma nova tentativa.
- Movimentação de conversa livre para projeto com prévia, confirmação, revisão
  otimista, validação do Dot e preservação de ID, histórico e favorito.
- Área separada para execuções anteriores. Workspaces não substituem o
  Laboratório, a Central de Aprovações, o diff, o rollback ou a recuperação.

Texto salvo pelo usuário é a única origem de mensagens estruturadas nesta fase.
Saída ANSI/stdout e entrada bruta do PTY permanecem no terminal. Conversas livres
guardam conteúdo local e não expõem execução até serem vinculadas a um projeto;
não há respostas de IA simuladas nem uso de provedor pago na suíte SPEC-005.

## Migração e limites de segurança

O banco SQLite migra de v4 para v5 em transação. A migração cria workspaces,
chats, messages, message deliveries, concessões de Dot, navegação, operações e
eventos; adiciona origem e workspace a projetos e `chat_id` opcional às Runs.
Projetos vindos da configuração são associados ao workspace “Meus projetos”.
Runs anteriores continuam válidas com `chat_id = NULL`. A migração verifica
chaves estrangeiras ao final; o teste de fixture preserva Runs, worktrees,
checkpoints e aprovações.

Projetos adicionados pela interface são persistidos no banco, sem gravar raiz,
executável ou permissões editáveis no JSON. `syncConfig` mantém projetos de
origem UI e suas concessões, não amplia grants e rejeita colisões de ID/raiz.
Raízes são canonicalizadas e validadas como repositório Git no daemon. O main
revalida a origem após os diálogos nativos.

O renderer recebe capacidades IPC nomeadas pelo preload; não há `invoke`
genérico nem campos para enviar raiz, executável, argumentos ou ambiente. O
daemon revalida contexto e grants ao iniciar/lançar Runs. Uma conversa aceita no
máximo uma Run não terminal e o limite global de dois PTYs permanece. Conversa
livre não pode iniciar uma Run. As respostas e eventos não carregam texto de
mensagens em notificações, relatórios ou eventos de estado.

## Como usar

Na raiz do projeto, carregue o ambiente preparado e inicie o app:

```bash
source scripts/local-env.sh
npm start
```

Em Workspaces, crie ou selecione um workspace e use **Adicionar** para escolher
um repositório existente. Marque os Dots que poderão executá-lo e confirme a
pasta e a concessão na janela nativa. Em seguida, crie uma conversa de projeto e
inicie uma execução quando desejar. Salvar a mensagem e enviá-la ao terminal são
ações separadas; o botão de envio exige uma Run ativa dessa conversa.

Conversas livres aceitam mensagens e rascunhos locais. Para iniciar execução,
use **Vincular a projeto…**, confira a prévia e confirme a movimentação. Se a
entrega ao terminal ficar incerta, a interface exige revisão antes de tentar
novamente.

## Validações locais

Os comandos foram executados com `source scripts/local-env.sh` na preparação
local (Node 24.22.1, Ubuntu 26.04.1 LTS, kernel 7.0.0-38, x64, Intel i5-10210U,
8 CPUs lógicas, 14,8 GiB de RAM, Electron 45, sessão Wayland).

| Comando | Resultado real |
|---|---|
| `npm run check` | Aprovado; TypeScript sem erros. |
| `npm test` | Aprovado; 34 testes, 34 passaram, 0 falharam. O teste novo cobre restauração de chat global/projeto e fallback de workspace, projeto e conversa removidos. |
| `npm run test:desktop` | Aprovado após fornecer a autorização da sessão Xwayland ao processo; sandbox, Seccomp, NoNewPrivs, fechamento/reabertura, daemon preservado e layout compacto verificados. Evidência: [`desktop.json`](../../benchmarks/runs/2026-10-25T20-38-56-153Z/desktop.json). |
| `npm run test:e2e` | Aprovado; E2E de regressão e SPEC-005 passaram. Evidências: [`phase1-e2e.json`](../../benchmarks/runs/2026-10-25T20-39-28-290Z/phase1-e2e.json) e [`spec005-e2e.json`](../../benchmarks/spec005/2026-10-25T20-39-57-317Z/spec005-e2e.json). |

No desktop, a primeira tentativa parou no preflight porque o terminal não tinha
`XAUTHORITY` exportado. A repetição do desktop e o E2E foram executados com a
autorização da sessão ativa; ambos passaram, sem alteração persistente do
ambiente nem mudança de sandbox. O build também passou e ainda emite o aviso não
bloqueante de chunk de renderer acima de 500 kB. Não houve execução remota do
workflow do GitHub.

A regressão automatizada abre uma conversa livre global pelas listas
**Conversas livres**, **Favoritos** e **Recentes**, confirmando a navegação
`null/null` em cada caminho. Em seguida recarrega a interface e fecha/reabre a
janela; confirma o mesmo `chatId`, mensagem e rascunho, além de nenhuma Run
criada. O resultado está no check “conversa global aberta por Conversas livres,
Favoritos e Recentes…” do relatório E2E SPEC-005. O teste de unidade também
fecha e reabre o SQLite com a navegação global e confirma a restauração de
conversa de projeto e o fallback para workspace, projeto e conversa inexistentes.

A E2E SPEC-005 usa uma CLI local de fixture, não um modelo pago. Os 15 checks do
relatório incluem: cancelamento/teclado, workspace e projeto, pasta Git inválida
e raiz indisponível, duplicidade, concessão de Dot, conversas sem Run implícita,
Run e envio vinculados, duas conversas no mesmo Dot, envio cruzado recusado,
favoritos/recentes, restauração da conversa global após reload e reabertura da
janela, chat livre, movimentação com confirmação/cancelamento,
histórico de 105 mensagens, layout em 900/1440 px, fechamento/reabertura com os
mesmos PIDs e scrollback, relatório/notificações sem mensagem privada e ausência
de erros no renderer. A captura anterior à correção do histórico revelou muitas
consultas de entrega por mensagem; a página agora inclui as entregas recentes na
mesma resposta paginada. A captura final não apresenta erro de histórico.

O E2E de regressão passou com sandbox, dois terminais, troca/reabertura, diff,
prévia e rollback auditado, confirmação nativa para modo de acesso total,
checkpoint e recuperação após `SIGKILL` real do daemon com nova sessão confirmada
explicitamente. A fixture D-Bus de notificações não foi habilitada nesta execução;
por isso a entrega ao serviço nativo não foi verificada aqui. Isso não é contado
como aprovado. A SPEC-005 verificou que o relatório e o estado de notificações não
incluem o marcador de mensagem privada.

### Medições da E2E SPEC-005

Cada estado foi amostrado em cinco rodadas de 2,5 segundos. A tabela mostra RSS,
PSS e CPU combinados da árvore Electron e daemon, como mediana/p95. RSS somado
conta páginas compartilhadas mais de uma vez; PSS as distribui. CPU é percentual
de um núcleo lógico. A carga geral do host não foi controlada.

| Estado | RSS combinado MiB (mediana/p95) | PSS combinado MiB (mediana/p95) | CPU de 1 núcleo % (mediana/p95) |
|---|---:|---:|---:|
| Ocioso | 765,6 / 766,1 | 313,2 / 313,5 | 1,19 / 2,78 |
| Duas Runs | 929,6 / 929,7 | 388,0 / 388,2 | 1,59 / 1,98 |
| Troca de conversas | 922,6 / 925,1 | 379,8 / 382,4 | 1,98 / 5,16 |
| Histórico paginado | 918,7 / 920,1 | 373,4 / 374,6 | 1,19 / 1,59 |
| Janela fechada, daemon e PTYs ativos | 767,4 / 769,6 | 312,0 / 314,2 | 0,40 / 1,19 |
| Janela reaberta | 931,3 / 940,4 | 383,7 / 392,8 | 1,19 / 1,19 |

A resposta da página paginada mediu 0,556 ms; os cinco lotes da carga tiveram
3,095–3,595 ms. Não há baseline pré-4A equivalente nesse host; esses números
servem como referência inicial, não como alegação de melhoria/regressão. As
capturas sintéticas estão em [`spec005-1440.png`](../../benchmarks/spec005/2026-10-25T20-39-57-317Z/spec005-1440.png) e [`spec005-900.png`](../../benchmarks/spec005/2026-10-25T20-39-57-317Z/spec005-900.png).

## Matriz de aceite A1–A15

| Critério | Resultado e evidência |
|---|---|
| A1 | **Passou.** Workspace e projeto criados/renomeados pela UI; persistência verificada após reabrir DB/manager e pela E2E. |
| A2 | **Passou.** E2E cobre cancelamento sem gravação, pasta que não é repositório, raiz indisponível e raiz duplicada; diálogos e erro de cadastro foram verificados. |
| A3 | **Passou.** Projeto UI e grants sobreviveram a reopen e `syncConfig`; colisão de raiz não reassocia o projeto. |
| A4 | **Passou.** Duas conversas do mesmo Dot têm Runs/PTYs independentes; suíte mantém o teto global de dois PTYs e rejeita envio cruzado. |
| A5 | **Passou.** Criar conversa não cria Run; envio requer ação explícita, mensagem salva e Run da mesma conversa. Saída da fixture foi encontrada no terminal e não em Messages. |
| A6 | **Passou.** Alternar conversa, fechar janela e abrir outra BrowserWindow manteve os mesmos PIDs, daemon e scrollback, sem Run duplicada/cancelada. |
| A7 | **Passou.** Persistência de mensagens, rascunho, favorito e restauração global foram confirmadas por reload e reabertura da janela no E2E; conversa de projeto também restaurou seu contexto. O fluxo de recuperação continua usando `recovery_needed`, sem reanexar PTY automaticamente. |
| A8 | **Passou.** Chat livre persiste mensagem/rascunho sem RunDesk; a API não recebe caminho de HOME nem oferece filesystem ao chat. |
| A9 | **Passou.** Favoritos e recentes são globais; teste de domínio confirma que listar/pollar recentes não altera `last_opened_at`. |
| A10 | **Passou.** Prévia, cancelamento e confirmação na UI; teste de domínio cobre grant e revisão obsoleta. ID, conteúdo e favorito são preservados. |
| A11 | **Passou.** Replays não duplicam operações; envio incerto exige confirmação/revisão e chave nova. Teste de domínio verifica ausência de segunda escrita na repetição. |
| A12 | **Passou.** Fixture v4→v5 preserva Run, worktree, checkpoint e aprovação e termina com `PRAGMA foreign_key_check` vazio. |
| A13 | **Passou.** Regressão desktop/E2E preserva sandbox, confirmação nativa, diff, rollback e recuperação. Entrega real de notificação D-Bus não foi verificada nesta rodada. |
| A14 | **Passou.** Bridge IPC não oferece comandos/caminhos/configuração ao renderer; envio entre conversas é recusado; relatório e estado de notificações não incluem texto privado; stdout não vira mensagem. |
| A15 | **Passou.** E2E usa Escape/Enter, verifica 900/1440 px sem overflow e salva capturas; `npm run check`, 34 testes e os E2Es de regressão/SPEC-005 passaram. |

## Limites e pendências

- Conversa livre é histórico local, sem motor de IA. Não há Kanban, `/kanban`,
  Auto Resume, busca global, integração externa ou sincronização nesta fase.
- Fixtures não certificam comportamento de provider/CLI real, e esta E2E não usa
  credenciais ou cota paga. O ciclo real básico registrado em
  [`VALIDACAO_CLI_REAL.md`](../VALIDACAO_CLI_REAL.md) não é prova de respostas
  estruturadas de chat.
- Não foi habilitada a fixture D-Bus; a entrega nativa de notificações não é
  declarada aprovada. Não houve validação remota do workflow CI.
- O ajuste 01 de navegação global não tem pendência conhecida; sua evidência E2E
  usa a fixture local sem rede ou provedor pago.
- A revisão formal do protocolo IPC continua pendente. A fronteira cobre clientes
  locais do mesmo usuário, não protege contra processos hostis com o mesmo UID nem
  transforma worktree em sandbox.
- Não existe série pré-4A comparável no mesmo ambiente; as medições acima são
  referências para comparações futuras.
