# SPEC-005 — Workspaces, projetos e conversas

Data: 25/10/2026. Status: **especificação para implementação**.
Entrega: **Fase 4A**, primeira parte da Fase 4. Kanban fica para a Fase 4B.
Esta especificação não declara a implementação nem o aceite da Fase 4.

## 1. Objetivo

Transformar a bancada técnica em um espaço navegável: criar um workspace,
cadastrar um repositório pela interface, abrir conversas independentes com um
Dot, acompanhar suas Runs e voltar ao trabalho por favoritos/recentes.

Fluxo de aceite principal: criar workspace → adicionar projeto → autorizar Dot
→ criar conversa → iniciar Run → enviar mensagem → trocar de conversa → voltar
→ fechar/reabrir janela → consultar histórico e a mesma Run.

O usuário autorizou avançar com organização do trabalho. O Auto Resume continua
uma pendência independente; não precisa ser implementado para esta entrega.

## 2. Leitura inicial e estado real do código

Leia `README.md`, `docs/ARQUITETURA.md`, `docs/PLANO_DE_IMPLEMENTACAO.md`,
`docs/PROTOCOLO_LOCAL.md`, `docs/RECUPERACAO_E_CHECKPOINTS.md`,
`docs/AMBIENTE_LOCAL.md` e `docs/VALIDACAO_CLI_REAL.md`.
Os documentos originais `Central de trabalho com IA — ideias do produto*.md`
contêm histórico superado. As decisões consolidadas e os registros recentes
prevalecem; não reintroduzir Tauri ou trocar a arquitetura.

Pontos de entrada:

| Área | Arquivos principais |
|---|---|
| Persistência/configuração | `apps/daemon/src/database.ts` |
| Execução, worktree e fila | `apps/daemon/src/runs.ts` |
| Continuidade e operações | `apps/daemon/src/continuity.ts`, `auto-resume.ts` |
| Socket e roteamento | `apps/daemon/src/server.ts` |
| Schemas | `packages/contracts/src/index.ts` |
| Cliente e validação de respostas | `packages/local/src/client.ts` |
| Ponte Electron | `apps/desktop/src/main.ts`, `preload.ts`, `api.ts` |
| Bancada e terminais | `apps/desktop/src/renderer.tsx`, `RunDesk.tsx` |
| Regressões | `tests/*.test.mjs`, `scripts/phase1-e2e.mjs`, `desktop-test.mjs` |

A base usa Electron/React/TypeScript, daemon Node independente e SQLite v4 com
WAL. Projetos e Dots vêm de JSON privado. Runs exigem projeto Git, e há até dois
PTYs simultâneos. Não existem entidades Workspace, Chat ou Message de produto.
A tabela `sessions` é a sessão PTY da Run: **não a reutilize como conversa**.
FTS5 existente é de laboratório, não uma busca de conversas já pronta.

Há 27 testes na base, além de E2E desktop. Nesta sessão foram corrigidos o shim
Git para caminhos com espaços e a espera de cópia do relatório no E2E. Essas
alterações e a preparação local podem estar sem commit: preserve-as.
O ciclo básico com Codex autenticado passou, mas não certificou Auto Resume,
continuação nativa após crash ou todos os modos de permissão.

## 3. Escopo desta entrega

Implementar:

1. Criar, listar e renomear workspaces persistentes.
2. Adicionar repositório Git existente a um workspace pela interface, com seleção
   de pasta nativa e autorização explícita dos Dots que poderão executá-lo.
3. Criar, listar, renomear e abrir conversas de projeto e conversas livres.
4. Persistir mensagens digitadas pelo usuário, sem confundi-las com entrada bruta
   no terminal ou com respostas estruturadas do agente.
5. Vincular novas Runs às conversas, mantendo execuções e permissões atuais.
6. Favoritos e recentes globais, com identificação do workspace/projeto de origem.
7. Mover conversa livre para um projeto com prévia, confirmação e validação.
8. Restaurar navegação ao reabrir; preservar terminais e estado de execução.
9. Migrar dados antigos e manter a bancada/laboratório acessíveis para regressão.

Não implementar nesta entrega: Kanban e `/kanban`, Dot Studio, provider/API,
App Server, novos logins, memória/skills, busca global, editor de arquivos,
integrações externas, sincronização, distribuição, exclusão de dados ou projetos,
movimentação entre workspaces/projetos de conversas já vinculadas, rebranding,
nova stack, supervisor ou Auto Resume. Não criar tarefas implicitamente.

## 4. Conversa e execução: semântica obrigatória

### 4.1 Conceitos

- Dot é configuração/identidade; sua definição continua no JSON privado.
- Chat é histórico e contexto de navegação. Não é um processo.
- Run é execução concreta com projeto, Dot, worktree, política e estado próprios.
- Sessão PTY e memória interna da CLI não são o histórico persistente do Chat.
- Fechar painel ou trocar conversa não cancela Run, não recria worktree e não
  envia automaticamente texto ao agente.

Uma conversa pode ter várias Runs ao longo do tempo, com **no máximo uma Run
não terminal vinculada a ela** nesta entrega. Conversas diferentes podem usar o
mesmo Dot simultaneamente, respeitando o teto global de dois PTYs e a fila.
Estados não terminais incluem fila, pausa, espera e recuperação necessária.
Uma Run terminal não autoriza começar outra automaticamente.

### 4.2 Conversas de projeto

Dot e projeto são escolhidos explicitamente. O Dot permanece fixo nessa conversa;
para usar outro, criar outra conversa. Criar/abrir Chat não inicia processo.
“Iniciar execução” usa o fluxo existente de permissões; acesso total mantém a
confirmação nativa por Run. Ao concluir/cancelar uma Run, nova execução exige
nova ação explícita e cria nova Run/worktree. Retomar a Run interrompida continua
usando o fluxo conservador existente, não “Iniciar” disfarçado.

O compositor permite “Salvar mensagem” sem execução. “Enviar ao agente” exige
Run `running` com PTY vivo: não cria Run implicitamente, não entrega à fila e não
reproduz mensagens antigas. Rascunho deve sobreviver à troca de conversa.
O texto livre vira entrada no PTY usando os limites e o mecanismo seguro já
existentes; impedir submissão durante composição IME e impedir duplo clique.

A entrada direta no terminal continua funcionando; controles, senhas, respostas
de autenticação, paste bruto e teclas não são persistidos como Messages.

### 4.3 Conversas livres: limite deliberado da Fase 4A

Conversa livre tem `projectId = null`, pode ter Dot escolhido como identidade,
e aceita histórico local de mensagens/rascunhos. **Não executa agente nesta
entrega**, pois não há backend sem projeto implementado. Mostrar claramente:
“Conversa local — vincule um projeto para executar um agente”. Não simular
resposta de IA, não abrir CLI no HOME e não criar repositório artificial.

Isso entrega organização e histórico livre, mas não satisfaz sozinho o futuro
critério de chat livre com respostas de IA. Registrar essa limitação no relatório
final; a Fase 4 completa e o motor sem projeto continuam pendentes.

### 4.4 O que persiste e o que permanece temporário

Persistir título, origem, Dot, mensagens explícitas do usuário, rascunho, vínculos
com Runs, favoritos e navegação. Exibir respostas atuais da CLI no terminal real.
Não converter stdout/ANSI em mensagens `assistant` nem atribuir sucesso da tarefa
pelo texto do terminal. Não salvar scrollback bruto ou telas de login no banco.

Enquanto o daemon vive, reanexar ao mesmo terminal recupera o buffer disponível.
Após crash/restart, Messages continuam; PTY/scrollback anterior não. Mostrar
essa distinção na UI e manter `recovery_needed` conforme a implementação atual.
Não chamar “histórico completo do agente” a uma lista só de mensagens do usuário.

### 4.5 Envio sem repetição automática

Salvar e enviar são efeitos distintos. Mensagem salva não comprova entrega.
Usar `operationId` para salvar e para a tentativa explícita de envio, com
vinculação à conversa, mensagem e Run. Reservar a intenção antes de escrever
no PTY. Repetição da mesma chave não pode enviar o texto duas vezes.
Após sucesso, rotular “enviado ao terminal”, nunca “processado pelo agente”.
Se ocorrer crash/falha entre intenção e confirmação, marcar entrega incerta;
não reenviar automaticamente. Nova tentativa exige revisão explícita e nova
chave. Não prometer exactly-once para comandos internos da CLI.
Limitar texto persistido por mensagem a 8.000 bytes UTF-8; considerar também
o overhead de bracketed paste no limite atual de `terminal.write`. Rejeitar
excesso antes de gravar/enviar, sem truncamento silencioso.

## 5. Modelo de dados e migração v4 → v5

O daemon continua único escritor. Criar migração transacional e índices. Modelo
mínimo sugerido; nomes podem variar se as invariantes forem mantidas:

| Entidade | Campos relevantes |
|---|---|
| `workspaces` | id, name, created_at, updated_at |
| `projects` existente | adicionar workspace_id, origem config/UI; preservar id/root/git_root |
| `chats` | id, workspace_id nullable, project_id nullable, dot_id nullable, title, draft, created_at, updated_at, last_opened_at, favorite, revision |
| `messages` | id, chat_id, role=user, body, created_at, sequência por conversa |
| `runs` existente | adicionar chat_id nullable; preservar todas as referências |
| `message_deliveries` | message_id, run_id, operation_id único, status, timestamps |
| `project_dot_grants` | project_id + dot_id, concessão explícita para projetos UI |
| estado de navegação | workspace/projeto/chat selecionados; laboratório acessível |

IDs novos gerados no daemon; chave de idempotência enviada pelo cliente.
IDs antigos de projeto/Dot continuam aceitos (não converter tudo para UUID).
Definir FKs/índices e validar consistência Chat→Projeto→Workspace no daemon:
um projeto pertence a um workspace; Chat de projeto acompanha esse workspace;
Chat livre pode ser global ou pertencer a workspace sem projeto.

Migrar projetos existentes para workspace padrão “Meus projetos”, uma única vez.
Runs antigas ficam `chat_id = null` e aparecem em “Execuções anteriores”, sem
inventar mensagens nem criar chats falsos. Banco novo percorre as migrações;
versão futura desconhecida é recusada. Testar `foreign_key_check` após migração.
Não apagar Runs, eventos, aprovações, checkpoints, worktrees, layout ou dados de
recuperação existentes. Não renomear banco/diretórios XDG nesta entrega.

### Autoridade da configuração

JSON continua autoridade para executável, args, adapter, identidade e permissões
base dos Dots. Projetos criados pela UI ficam no SQLite e não são escritos de
volta no JSON. Ajustar `syncConfig` para não apagar/sobrescrever projetos UI ou
reassociar workspaces a cada início. Para projetos importados, manter ID e raiz
do JSON, preservando associação ao workspace. Uma colisão entre ID config/UI
com raiz diferente deve ser recusada com erro claro, não resolvida por overwrite.

Autorização efetiva: concessão `projectIds` do JSON para projetos config; concessão
explícita `project_dot_grants` para projetos UI. Remover um Dot da configuração
impede novas Runs, mesmo que tenha grants antigos. Não conceder todos os projetos
a todos os Dots. Revalidar concessão no enqueue, launch e resume. Ajustar
`listDots` e seus consumidores para refletir os projetos efetivamente permitidos.
Não interromper PTYs vivos ao atualizar somente metadados de navegação.

## 6. Cadastro de projeto e fronteiras de segurança

“Adicionar projeto” abre `dialog.showOpenDialog` no main com seleção de diretório.
Renderer fornece workspace, nome e Dots selecionados, nunca `root`, executable,
args, env ou shell. Cancelar não grava nada. Main revalida origem/frame após o
diálogo; mostrar confirmação do caminho escolhido e concessões antes de concluir.

O main encaminha a raiz escolhida ao daemon por comando interno tipado; não expor
um repasse arbitrário desse comando no preload. Cliente Node autenticado do mesmo
UID permanece dentro da fronteira de confiança já documentada. O daemon valida
realpath, diretório existente/acessível, raiz Git exata, workspace e Dots válidos.
Não clonar, inicializar Git nem criar pasta automaticamente. Caminho com espaços
deve funcionar. Repositório sem commit inicial deve ser recusado ou marcado
explicitamente sem possibilidade de execução, nunca falhar só após criar Run.

Um mesmo realpath de repositório é cadastrado uma vez nesta entrega. Duplicata
mostra o projeto existente; nunca duplica ou reassocia silenciosamente. Se a
pasta desaparecer depois, preservar metadados e histórico, sinalizar indisponível
e recusar novas Runs sem crash do aplicativo.

Permissões e estado continuam no daemon, não no prompt. Uma escolha de contexto
visual nunca concede acesso ao projeto nem muda uma Run em andamento. Mensagens
são texto local potencialmente sensível: não exportar em diagnóstico, relatório,
notificação, logs ou benchmark. Renderizar texto como texto; sem HTML executável.
Não conceder privilégios a instruções embutidas em títulos ou mensagens.

## 7. Navegação, favoritos e movimentação

Sidebar com Workspaces/Projetos, Conversas livres, Favoritos e Recentes, além de
acesso ao laboratório e execuções anteriores. Usar uma janela e um renderer;
reaproveitar Central, Diagnóstico, terminais e revisão. Manter os cenários de
benchmark disponíveis por rota/controle próprio; não apagar o laboratório.

Favorito é propriedade do Chat, sem duplicar conversa. Recentes ordenados por
abertura explícita, com desempate estável; polling não muda ordem. As duas listas
são globais e mostram origem. Abrir favorito/recentes navega para o contexto real,
sem transportar conteúdo ao projeto anteriormente selecionado. Persistir seleção
somente após validação; referência obsoleta tem fallback de navegação seguro.
Trocar abas não cria novas assinaturas cumulativas nem cancela execução; ao
reativar terminal, fazer attach e substituição do snapshot sem duplicar saída.

Mover Chat livre: mostrar título, origem, destino e Dot; confirmar explicitamente.
Validar autorização do Dot no destino (ou pedir seleção explícita quando não
houver Dot). Preservar id/mensagens/favorito e registrar evento de movimentação.
Bloquear se houver Run vinculada não terminal; não reatribuir histórico de Runs.
Usar revisão otimista: destino confirmado com revisão antiga deve ser recusado
caso outra janela/cliente tenha mudado a conversa. Não enviar mensagens antigas
para uma nova CLI após a movimentação. Cancelar mantém estado anterior.

UI mínima: estados vazios acionáveis, erros claros, foco restaurado após diálogos,
Escape para cancelar, labels acessíveis e uso por teclado. Confirmar layout em
900 e 1440 px sem overflow horizontal. Evitar redesign amplo e novas bibliotecas
para listas/formulários simples.

## 8. Contratos e integração

Ampliar schemas estritos de request/response/evento e todas as camadas juntas.
Famílias de operação sugeridas: workspaces.list/create/rename;
projects.add (main nativo), projects.list por workspace;
chats.list/create/get/rename/open/favorite/move;
messages.list/save/send; navigation.get/set.

Cada mutação tem chave idempotente associada à operação/payload; reuse de chave
com payload diferente é erro. Movimentação e alterações concorrentes usam revisão.
Estender `runs.start` com Chat opcional para compatibilidade; quando presente,
derivar/validar Dot/projeto do Chat, recusando divergência. Preservar clientes e
harnesses existentes que iniciam Run sem Chat.

Listagens paginadas com cursor estável e limite máximo de 100; mensagens carregadas
por conversa, sem carregar todo o banco no renderer. Limitar títulos/nomes a 120
caracteres, rejeitar vazio após trim. Respostas cabem no frame de 64 KiB: orçamento
em bytes, com paginação de mensagens grandes e cursor sem omitir item. Campos
novos e conteúdo privado não entram no Snapshot de laboratório por conveniência.
Preferir eventos tipados a novos pollings curtos. Eventos podem transportar IDs e
revisões para atualizar somente a lista/conversa afetada. Reconexão busca estado
autoritativo; eventos perdidos não justificam replay de mensagens/comandos.

Preservar HMAC, ACLs, limites, validação de frame/URL, CSP, sandbox e confirmação
nativa de acesso total. Não criar canal genérico `invoke(method, payload)` ou API
de filesystem no renderer. Documentar extensões no protocolo; revisão formal
completa permanece pendente, sem alegar aprovação externa.

## 9. Sequência de implementação

1. Levantar contratos e testes atuais; registrar baseline e árvore de trabalho.
2. Implementar migração/domínio e testes de persistência/autorização.
3. Integrar serviços, contratos, cliente e ponte nativa de seleção de pasta.
4. Implementar navegação/conversas e vínculo explícito às Runs existentes.
5. Implementar mensagens, envios idempotentes, favoritos/recentes e movimentação.
6. Executar regressões, E2E novos, capturas e medições; corrigir falhas.
7. Entregar relatório de implementação, evidências e pendências reais.

## 10. Critérios de aceite verificáveis

| ID | Demonstração exigida |
|---|---|
| A1 | Criar/renomear workspace, adicionar projeto pela pasta nativa e persistir após restart |
| A2 | Cancelar diálogo não grava; pasta inválida, duplicada ou indisponível é tratada claramente |
| A3 | Projeto UI e grants sobrevivem ao restart e ao sync do JSON sem ampliar permissões |
| A4 | Duas conversas do mesmo Dot têm mensagens/Runs separadas; limite global de dois PTYs preservado |
| A5 | Criar/abrir Chat não inicia Run; envio só ocorre a PTY vivo da conversa correta |
| A6 | Trocar Chat/fechar janela preserva PID/worktree; voltar reanexa sem duplicar saída |
| A7 | Histórico local e rascunho sobrevivem a restart; perda do terminal é informada corretamente |
| A8 | Chat livre salva mensagens sem projeto, informa ausência de execução e não acessa HOME |
| A9 | Favoritos/recentes persistem e abrem contexto correto; polling não reordena recentes |
| A10 | Mover livre→projeto preserva conteúdo/ID, valida Dot, revisão e confirmação; cancelamento não altera |
| A11 | Retry/reconexão não duplica Chat/Message/Run nem reenvia comandos; entrega incerta exige revisão |
| A12 | Migração de banco v4 com Runs/checkpoints/aprovações preserva dados e integridade |
| A13 | Diff, rollback, recuperação e confirmação nativa de acesso total continuam funcionais |
| A14 | Renderer não injeta paths/config/estado; títulos/mensagens não vazam em relatório/notificação |
| A15 | UI em 900/1440 px utilizável por teclado, sem overflow; regressões e E2E aprovados |

## 11. Testes, medições e evidências

No ambiente local preparado: `source scripts/local-env.sh`. Em outras máquinas,
Node 24+ e `npm ci`. Não reinstalar/substituir o Node do sistema por conveniência.

Executar `npm run check`, `npm test`, `npm run test:desktop`, `npm run test:e2e`.
Acrescentar testes de domínio e E2E que cubram A1–A15, incluindo restart real,
concorrência/replay, tentativa de envio para Run de outra conversa, Dot sem grant,
colisão de IDs, migração e paginação de mensagens no limite de bytes. Manter os
27 testes anteriores; adaptação justificada não pode enfraquecer suas invariantes.
Para diálogo de pasta, o harness pode substituir `showOpenDialog` no processo main
por fixture temporária; não adicionar caminho de teste à API de produção.

E2E usa CLIs simuladas, não conta paga; não provoca esgotamento de cota. Fixtures
não contam como aprovação de provider. Verificar isolamento de conteúdo entre
conversas e projetos, sem alegar que isso transforma worktree em sandbox.

Medir RAM/CPU ociosas e com duas Runs, janela fechada, reabertura e troca de
conversas; adicionar carga de histórico paginado. Repetir série de cinco rodadas
se o shell/polling mudar materialmente. Documentar ambiente, PSS/RSS separados,
medianas/p95 e comparação com baseline equivalente. Não usar amostras antigas
para aprovar o código novo, nem desabilitar sandbox para obter métricas.

Salvar evidências novas em `benchmarks/spec005/` e rodadas datadas, preservando
histórico. Capturas com dados sintéticos, sem mensagens privadas/credenciais.
Atualizar CI para executar o E2E desta entrega; análise local do YAML não equivale
a execução remota aprovada. Se o ambiente impedir um teste, informar causa exata
e o que passou; não marcar como aprovado.

## 12. Entrega e limites de autorização

Entregar código, testes e `docs/SPEC_005_IMPLEMENTACAO.md` com:
funcionalidades, migração, decisões, instruções de uso, evidências, matriz A1–A15,
métricas e limitações. Atualizar README, arquitetura, plano e protocolo sem apagar
registros históricos. Declarar **Fase 4A implementada** somente após evidências;
não declarar Fase 4 completa, Auto Resume suportado ou chat livre com IA.

Pode implementar e validar esta SPEC sem pedir nova aprovação para escolhas
rotineiras coerentes com ela. Não publicar, fazer merge, escolher licença,
alterar políticas globais de sandbox ou iniciar a Fase 4B/5. Não sobrescrever
alterações locais anteriores; não fazer reset/limpeza destrutiva do checkout.
Não executar agente pago nem ler/copiar credenciais para a suíte automatizada.

Se uma dependência externa bloquear parte do trabalho, concluir o que for
independente e registrar o bloqueio. Decisões que reduzam os critérios de aceite
ou mudem a semântica acima devem ser explicitadas, não escondidas em implementação.

## Prompt para o subagente

> Implemente a SPEC-005 em `docs/SPEC_005_ORGANIZACAO_DO_TRABALHO.md`, correspondente
> à Fase 4A: Workspaces, cadastro de projetos pela interface, conversas persistentes,
> vínculo às Runs, favoritos/recentes e movimentação de conversa livre para projeto.
> Leia a SPEC inteira e as referências iniciais antes de editar. Preserve as
> mudanças locais existentes e as invariantes de execução, permissões, sandbox,
> recuperação e rollback. Chat livre nesta entrega é histórico local sem motor
> de IA; não simule respostas nem persista stdout como mensagens estruturadas.
> Progrida até código, regressões, E2E e relatório de implementação completos,
> documentando evidências e bloqueios reais. Não implemente Kanban/Auto Resume,
> não publique e não altere a configuração de segurança do sistema.
