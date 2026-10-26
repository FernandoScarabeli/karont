# Chats — fluxos da experiência

Estado em 2026-10-25: **implementação parcial da direção visual do pen.dev** no desktop. Abertura direta, compositor, mensagens locais, tarefas e ferramentas PTY usam a nova base visual; as famílias abaixo continuam especificando também capacidades futuras. As telas do canvas incluem conteúdo demonstrativo identificado na faixa superior; a faixa inferior descreve transição e não faz parte da UI final.

## Direção e fontes

Referências inspecionadas: [InputMessage](https://www.fluidfunctionalism.com/docs/input-message?preset=ma288), [ThinkingSteps](https://www.fluidfunctionalism.com/docs/thinking-steps), [AskUserQuestions](https://www.fluidfunctionalism.com/docs/ask-user-questions), [ChatMessage](https://www.fluidfunctionalism.com/docs/chat-message), [CommandMenu](https://www.fluidfunctionalism.com/docs/command-menu). Inspirar composição, hierarquia e interação, preservando a paleta e os conceitos do Karont. Nenhuma biblioteca foi instalada na etapa de design. A implementação posterior usa Lucide e fontes locais via @fontsource, conforme DESIGN_SYSTEM.md.

Documento pai consultado: [Central de trabalho com IA — ideias do produto](https://docs.google.com/document/d/1JumZ0uBJh5JmFrA1E-bvwrv6OhnvHlIQW-tSJhRK_Cw/edit). É um registro vivo com decisões e propostas históricas. As decisões recentes em PROJECT_FLOWS.md prevalecem sobre formulários antigos: projeto tem nome, ícone e pasta; chat novo abre diretamente, sem modal ou lista de agentes.

## Contrato atual e evolução proposta

| Capacidade | Situação |
| --- | --- |
| Mensagens do usuário, rascunhos, favoritos, projeto/chat, criar tarefa e /kanban com revisão | Existem no produto; a apresentação foi redesenhada. |
| Salvar mensagem e enviar ao terminal | São operações distintas no contrato atual. Entrega sent confirma escrita no terminal, não processamento pelo agente. |
| Runs, interrupção, retomada, terminal, entrega pendente/incerta | Existem operações relacionadas; conferir capacidades e estados retornados antes da integração da nova UI. |
| Mensagens do Dot arquivadas, streaming na conversa e atividade estruturada | Proposta de evolução. Hoje a resposta do agente aparece no terminal. |
| AskUserQuestions, resposta estruturada, anexos/contexto, CommandMenu global e divisão/restauração de painéis | Propostas visuais, exigem contratos e implementação próprios. |
| Aprovação granular e pedidos estruturados | Somente quando o adaptador retornar e aceitar esses eventos. No PTY, interação e aprovação ficam na própria CLI. |
| Limite do provedor, tempo de reinício, porcentagem, custo | Exibir somente dados reais. Se ausentes, informar indisponibilidade; não inventar estimativas. |

Separar Workspace > Projeto, identidade Dot, conversa Chat, execução Run e Tarefa. Abrir um Chat ou um painel não executa trabalho. Mesmos projeto/workspace não compartilham automaticamente o histórico entre chats.

## Recorte implementado e divergências

Chat de projeto aceita `dotId: null` na abertura. Iniciar Run exige Dot já autorizado e faz a vinculação inicial ao chat, sem conceder acesso automaticamente. Home abre conversa livre com o texto como rascunho; não envia ao agente. Sem perfil na API, saudação omite nome. O rodapé usa “Perfil local” com ícone genérico, sem indicar conta autenticada, e informa limites indisponíveis, sem números demonstrativos.

A conversa preserva rascunho, mensagens locais, favorito, renomear, copiar, editar como nova mensagem, tarefa e prévia /kanban. Salvar, entregar ao terminal e iniciar Run são operações separadas; entrega `sent` confirma somente escrita no PTY. Terminal/Run e ToDo reutilizam operações existentes com a nova paleta. Configurações mantém diagnóstico e ferramentas acessíveis. Busca/recentes global identifica workspace/projeto de origem.

Streaming e atividade estruturados, perguntas, anexos, CommandMenu global, divisão/restauração de painéis e limites/rotação de provedores continuam propostas. As famílias A–F descrevem o comportamento pretendido dessas evoluções, não uma lista de recursos integralmente implementados. O fluxo PTY E6 é a referência operacional atual. Editar como nova copia para o compositor; a restauração dedicada do rascunho anterior de A6 ainda é proposta. Remover/revincular projeto também continua futuro; não confundir com a movimentação explícita já existente de conversa livre para projeto.

## A — conversar

A1 abre chat vazio com foco no compositor, pelo + do projeto ou Nova conversa. A origem do chat continua visível no cabeçalho. Sem configuração compatível, o chat abre e guarda rascunho; o requisito de execução é explicado no envio (E7).

A1 → A2: Enter sem Shift ou botão de envio, desde que haja conteúdo e capacidade. IME/composição não envia. Shift+Enter quebra linha. Validar o limite vigente de 8.000 bytes antes de enviar; informar excesso ao lado do campo e manter texto. Clique repetido não cria outra mensagem/Run: usar identificador de operação e estado de envio.

A2 → A3: salvar/entregar/iniciar são estados distintos; o estado visual deve derivar do contrato, sem afirmar processamento só porque houve escrita no PTY. No modo estruturado proposto, a UI pode encadear as operações com feedback explícito. No modo atual, usar E6.

A3 mostra atividade observável: eventos de leitura/ferramentas e resumos públicos do adaptador. Recolher preserva estado e link para detalhes. Não exibir raciocínio privado ou inventar um plano de etapas. Sem eventos, usar indicador genérico de atividade; não inventar progresso nem duração.

A4 mantém rascunho editável durante streaming. Na proposta conservadora desta entrega, envio de uma segunda mensagem fica indisponível enquanto a Run estiver ocupada, com ação Parar separada. Não há fila automática inventada. Interrupção segue E3 → E4. A introdução de fila exige contrato próprio.

A5 apresenta resposta final em texto aberto, ações da mensagem e resultado acionável quando existente. Copiar e abrir resultado têm rótulo acessível. Documento demonstrativo não equivale a arquivo persistido. F1 detalha código e fontes; F6 detalha ações.

A6 copia a mensagem para o compositor e envia como **nova mensagem**, sem alterar silenciosamente o histórico. Cancelar restaura o rascunho anterior. Não cria ramificação nem reexecuta ações anteriores automaticamente.

## B — perguntar e responder

Entrada: pedido estruturado do adaptador. O painel inline mantém o usuário dentro do chat e a Run em espera. B1 escolha única, B2 múltipla escolha com alternativa própria, B3 resposta aberta, B4 revisão. Selecionar não envia automaticamente. Não confundir pergunta com concessão de permissão.

B1 → B2 → B3: Continuar valida a etapa; Voltar preserva escolhas e texto. Perguntas opcionais podem oferecer Pular quando isso estiver indicado no pedido; obrigatórias não podem ser puladas. Outra resposta vazia, se selecionada, precisa de validação contextual.

B3 erro: ajuda e erro junto ao campo, com texto além da cor; primeira falha recebe foco. Corrigir mantém as outras respostas. Referência do exemplo pode ser URL ou descrição: não impor validação de URL a uma resposta descritiva.

B4 permite editar qualquer etapa e apresenta o conjunto antes do envio. Enviar respostas → B7, controles de repetição indisponíveis e estado Enviando. Recibo confirmado → B5, resumo no histórico e retomada da mesma Run, sem nova execução duplicada.

Falha confirmada → B6, preservar conjunto e oferecer retry/revisão. Entrega incerta exige conciliar a operação antes de repetir. Retry usa o identificador do mesmo pedido; não tratar pedido expirado como ativo. Pedido expirado ou Run cancelada deve mostrar a resposta como rascunho local e pedir um novo contexto, sem enviar a uma execução encerrada.

Responder depois → B8 recolhe a pergunta, preserva etapa/respostas e mantém pendência visível. Voltar a responder reabre no ponto salvo. Isso não pula, responde ou cancela a Run. Cancelar execução é ação separada. Se pedido for cancelado pelo adaptador, manter o histórico da interação com estado encerrado.

Teclado: Tab navega ações/campos; setas percorrem radiogroup/checkboxes, Espaço seleciona e Enter no botão avança. Atalhos numéricos só se houver foco no grupo e não em campo de texto. Resposta aberta usa Ctrl+Enter ou botão explícito para continuar; Enter insere nova linha. Leitor de tela anuncia etapa, pergunta, seleção, erros e envio sem anunciar cada token.

## C — CommandMenu e /kanban

C1: Ctrl+K ou botão Comandos abre um diálogo com busca, grupos e ações contextualizados ao painel em foco. Preservar rascunho e guardar acionador. Busca filtra nomes, descrição e contexto do workspace, respeitando permissões. Não listar conteúdos privados de outros contextos.

C2: digitar dividir, setas escolhem, Enter executa a ação nomeada no rodapé. Ação de criar chat à direita segue D2. C3 busca sem resultado oferece limpar busca ou Esc. Falha de carregar resultados deve informar erro e retry, sem mostrar vazio falso.

Esc fecha apenas a camada superior e devolve foco ao acionador. Clique fora fecha a paleta, sem enviar o rascunho. Ctrl+K é atalho com modificador: não capturar texto, atalhos nativos do terminal ou a composição IME. Itens indisponíveis informam motivo e são ignorados pelas setas. O resultado do comando deve ser anunciado.

C4: / no início de uma intenção de comando abre menu local ancorado acima do compositor. Setas e Enter selecionam o comando; não enviar o texto bruto ao agente. Esc preserva o texto e fecha. Texto que contém / em URL/caminho não dispara menu indevidamente.

C4 → C5: /kanban prepara prévia editável com título, descrição e projeto de destino. Criar tarefa valida e persiste. Cancelar devolve texto ao compositor. Sucesso C6 mantém vínculo com Chat e oferece Abrir tarefa; não inicia Run. Falha E8 preserva prévia e permite retry com deduplicação.

## D — painéis de chat

D1: botão Dividir oferece Nova conversa e Conversa existente. Nova conversa abre diretamente um chat vazio à direita no mesmo projeto (D2), ou livre no workspace quando a origem for livre; sem modal de criação. Foco vai ao novo compositor. A conversa esquerda mantém histórico, rascunho e Run.

Conversa existente abre seletor de chats no painel direito (D3), com busca e contexto. Selecionar abre; Cancelar restaura a vista anterior, sem criar um Chat descartável. Se o chat já está visível, focar sua vista existente em vez de duplicar uma segunda instância editável com rascunhos divergentes.

D4: dois chats, rascunhos, rolagens e Runs independentes. Apenas um painel tem foco de ação global. Cabeçalho identifica chat e origem; linha superior e texto Painel em foco ajudam na orientação. Cada compositor envia somente para seu Chat. Transferir contexto requer ação explícita, não é consequência de dividir.

Divisória com alvo de 8 px e alça visual de 2 × 40. Arraste altera proporção; teclado ajusta com setas quando a divisória estiver focada, Home retorna ao mínimo e duplo clique restaura 50/50. Proposta: mínimo 480 px por painel e no máximo dois visíveis nesta primeira entrega; mais chats permanecem em abas. Não impor limite à quantidade de Chats ou Runs a partir do limite visual.

D5: × fecha só a vista, sem apagar Chat nem cancelar Run. Feedback oferece Reabrir. O painel restante ocupa o espaço. Maximizar oculta temporariamente o outro painel e oferece restaurar a divisão. Layout e estado pertencem ao workspace; rascunho pertence ao Chat. Troca de workspace restaura seu próprio layout e não mistura escopos.

D6–D7: com espaço insuficiente para dois painéis de 480 px + divisória, usar abas, preservando chats, foco, proporção e Runs. A sidebar pode ser recolhida, sem criar trilho novo. O botão Mostrar sidebar permanece no início do cabeçalho em D6–D7 e recupera navegação e seletor de workspace; fechar devolve foco ao acionador. A tela de 1000 × 640 e a de 840 × 620 mostram essa adaptação. Ao ampliar, restaurar a divisão anterior. Abas e menus grandes rolam; títulos truncam com tooltip/nome acessível, e ações de fechar continuam alcançáveis.

D8: falha de abrir/reconectar um painel fica nele, sem bloquear a outra conversa. Retry e Escolher outro chat preservam o estado da esquerda. Uma Run em segundo plano continua acompanhável pelo seu chat e por suas áreas de execução existentes.

## E e F — recuperação e conteúdo

| Estado | Resultado e recuperação |
| --- | --- |
| E1 falha confirmada | Texto preservado; retry da mesma operação, sem criar mensagem duplicada. |
| E2 entrega incerta | Conferir terminal/Run e conciliar. Revisar antes de nova tentativa com efeito colateral. |
| E3 interrompendo | Aguardar confirmação do adaptador; não mostrar interrompida imediatamente. |
| E4 interrompida | Resposta parcial preservada; Continuar depende da capacidade de retomada. Interromper não reverte arquivos. |
| E5 restauração | Recarregar chats/layout/rascunhos e reconciliar Runs. Operação incerta pede revisão humana; rascunho editável, envio bloqueado até confirmação. |
| E6 PTY | Terminal real é fonte da resposta e das interações. Preservar distinção salvar × entregar. |
| E7 sem provedor | Chat e rascunho acessíveis; conectar adaptador antes de executar. |
| E8 falha de tarefa | Manter prévia; retry deduplicado ou Cancelar para restaurar texto. |
| F1 mensagem rica | Texto 15/24, listas, código monoespaçado com copiar e fonte identificável. Código/tabelas rolam horizontalmente sem alargar o painel. |
| F2 contexto | Se o adaptador aceitar, seletor nativo → validar tipo/tamanho/acesso → referência com remover → prévia → envio. Cancelar seletor não altera rascunho. Rejeição explica causa e mantém itens válidos. Limites vêm do adaptador; não inventar tamanho aceito. |
| F3 histórico | Paginação com retry, conservar itens já carregados e posição de leitura. Rolagem manual não é puxada a cada token; Ir para mais recente oferece retorno. |
| F4 aprovação | Somente pedido estruturado real, com operação, Dot, escopo e prévia. Permitir uma vez ou negar; não ampliar concessão. No PTY, abrir terminal. |
| F5 limite | Mostrar motivo e disponibilidade retornados. Sem prazo, informar desconhecido. Preservar rascunho; retomar apenas após disponibilidade confirmada. |
| F6 ações da mensagem | Ações por hover e foco com espaço reservado. Copiar, editar como nova e criar tarefa seguem seus fluxos; sem salto de layout. |

Contexto escolhido no computador só pode ser enviado ao provedor conforme ação explícita do usuário e política efetiva. Remover anexo tira o item da mensagem, não apaga arquivo local. Arquivo inacessível deve permanecer identificável e permitir remover/reselecionar.

## Movimento, acessibilidade e limites de verificação

Reutilizar os tokens de DESIGN_SYSTEM.md. Movimento proposto: feedback de hover/foco 140 ms, abertura/recolhimento de atividade e painel 220 ms, curva cubic-bezier(0.16,1,0.3,1). Atualização do streaming não anima cada token. Respeitar prefers-reduced-motion: remover deslocamentos e shimmer; estado continua explícito em texto/ícone.

Foco de 2 px em focus-ring com offset de 2 px. Controles de ícone 32 px, opções 64 px e botões 36 px; contexto desktop, não certificado para toque. Todos os ícones precisam de nome acessível e tooltip. Erro/sucesso/espera usam ícone e texto, além da cor. Seleção de texto, caret e scrollbars precisam ser tematizados na implementação.

Canvas estático não verifica teclado, hit-testing, leitores de tela, IME, gravação, rede, tooltips, scroll real, restauração ou animação. Foram desenhados desktop 1440 × 900, compacto 1000 × 640 e mínimo 840 × 620. Nomes longos, Unicode, texto de 8.000 bytes, muitas abas e grandes históricos exigem testes funcionais na implementação. Esta observação descreve a etapa original de canvas; a migração posterior altera frontend e daemon. Na implementação foram confirmados check/build, 42/42 testes de backend e redesign-e2e, incluindo UTF-8/Enter repetido, busca/recentes global e sidebar sem overflow horizontal. Isso não equivale a certificação de leitores de tela ou de todas as propostas deste documento.

## Onde revisar no karont.pen

Mapa principal: Chats / Comece aqui · mapa dos fluxos (`VEuIF`). Três pranchas de componentes no topo: conversa/atividade (`h7p2oN`), perguntas (`GpEx5`), comandos (`ZV1Zh`). As famílias A–F estão abaixo, em duas linhas por família.

| Código | Tela | Nó |
| --- | --- | --- |
| A1 | Nova conversa · entrada direta | `rmjvP` |
| A2 | Mensagem enviada · iniciando | `qZ1cS` |
| A3 | Thinking · atividade expandida | `JBXdb` |
| A4 | Resposta em streaming · nova orientação | `WDq94` |
| A5 | Resposta concluída · ações e resultado | `zKDAg` |
| A6 | Editar como nova mensagem · preservar histórico | `U2VzB` |
| B1 | Pergunta · escolha única | `ZiDEo` |
| B2 | Pergunta · múltipla escolha e outro | `o78cfJ` |
| B3 | Pergunta aberta · validação inline | `Uj3EN` |
| B4 | Revisar respostas · confirmação | `uUQnY` |
| B5 | Respostas enviadas · retomar atividade | `RViqh` |
| B6 | Falha ao enviar respostas · recuperação | `HQlty` |
| C1 | CommandMenu · ponto de entrada | `euVGB` |
| C2 | CommandMenu · busca e seleção | `Ff9nX` |
| C3 | CommandMenu · nenhum resultado | `y789E2` |
| C4 | Comando no compositor · /kanban | `MXvEm` |
| C5 | Prévia /kanban · editar e criar | `OzThq` |
| C6 | Tarefa criada · resultado no contexto | `A783q` |
| D1 | Dividir área · escolher o resultado | `WoR54` |
| D2 | Novo chat à direita · foco no compositor | `scEc3` |
| D3 | Abrir existente à direita · escolher chat | `uZHHp` |
| D4 | Dois chats ativos · rascunhos independentes | `ktqON` |
| D5 | Fechar painel · execução preservada | `wS2M4` |
| D6 | Janela compacta · chats em abas | `ZCsP1` |
| D7 | Janela mínima · alternar e voltar | `kEmE2` |
| D8 | Falha num painel · o outro continua | `Drezb` |
| E1 | Falha confirmada de envio · rascunho preservado | `UGEFF` |
| E2 | Entrega incerta · conferir antes de repetir | `WKBYC` |
| E3 | Interromper Run · solicitação em andamento | `bPkeh` |
| E4 | Run interrompida · continuar com contexto | `ZCYH2` |
| E5 | Reabrir workspace · restaurar estado | `xOwAB` |
| E6 | Adaptador PTY · terminal como fonte real | `L3RYM` |
| E7 | Execução indisponível · conectar e recuperar | `TLfKA` |
| E8 | Falha ao criar tarefa · prévia preservada | `ZoNF8` |
| F1 | Mensagem rica · código e fontes | `wtwzQ` |
| F2 | Contexto anexado · prévia e validação | `N6diBY` |
| F3 | Histórico · recuperar carregamento anterior | `z0zHES` |
| F4 | Aguardando aprovação · ação contextual | `GC9jf` |
| F5 | Limite do provedor · espera sem estimativa inventada | `DmQ50` |
| F6 | Ações de mensagem · menu contextual | `N5lPfp` |
| B7 | Enviando respostas · bloquear repetição | `lVUY9` |
| B8 | Responder depois · pendência preservada | `MoQRM` |


## Registro de verificação do canvas (2026-10-25)

Revisão independente em capturas das seis famílias e originais selecionados. Corrigidos: envio durante conciliação (E5), identidade Nova conversa e seleção da sidebar (A1/D2), cabeçalho do seletor (D3) e acesso à sidebar nas janelas compactas (D6/D7). Contraste calculado para pares principais: texto principal/fundo 15,74:1; texto secundário/compositor 6,60:1; texto principal/balão do usuário 12,43:1; erro/compositor 7,13:1; foco/fundo 8,32:1. Estes cálculos não substituem a validação do app e de todos os estados.

Prévia persistente: [dois chats](previews/chat-split-2026-10-25.png), [perguntas](previews/chat-questions-2026-10-25.png), [comandos](previews/chat-commands-2026-10-25.png), [mapa](previews/chat-map-2026-10-25.png). A revisão direcionada confirmou resolvidas as três correções acima; entrega aprovada no escopo de design estático.
