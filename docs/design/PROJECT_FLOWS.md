# Projetos — fluxos vigentes

Estado em 2026-10-25: fluxo de criação e edição implementado no desktop a partir do pen.dev, com divergências registradas abaixo. A decisão vigente substitui o fluxo anterior com configuração de agentes. As descrições de estados desenhados não certificam sua implementação integral.

## Regra principal

**Projeto:** abrir um modal com apenas nome, ícone e pasta raiz. **Chat:** abrir diretamente uma conversa nova, sem modal e sem escolher agente ou preencher título antes.

Não colocar listas, papéis ou autorizações de agentes na criação/configuração de projetos nem na abertura de chats. “Desenvolvimento” e “Revisão” eram exemplos indevidos e foram removidos. A quantidade de agentes configurados não acrescenta passos nesses fluxos.

## Criar projeto

Entrada: + no cabeçalho Projetos. Modal centralizado sobre backdrop; foco inicial no nome.

| Campo | Comportamento |
| --- | --- |
| Nome | Obrigatório, até 120 caracteres; label persistente; erro junto ao campo |
| Ícone | Escolha visual simples; pasta como padrão; uma opção selecionada por vez |
| Pasta raiz | Caminho selecionado e ação Escolher… para o diálogo nativo do sistema |

Ícones iniciais Lucide: folder, code-xml, globe, terminal, layers, briefcase, book-open, rocket. Cada opção tem nome acessível e tooltip. Não usar emoji como substituto do sistema de ícones. Não adicionar cor, descrição, modelo ou configuração de agente sem solicitação.

Cancelar/fechar/Esc antes do envio não criam projeto. Cancelar o seletor nativo preserva nome, ícone e pasta anterior. Criar projeto fica indisponível enquanto nome ou pasta obrigatórios faltarem. Após envio, indicar Criando… e impedir repetição; fechar não promete cancelar a gravação. Erro mantém dados. Pasta repetida oferece abrir o vínculo existente, sem criar duplicata. Sucesso fecha o modal e revela o projeto na sidebar com o ícone escolhido, sem abrir chat ou iniciar execução.

Estados desenhados no painel Criar projeto: vazio, preenchido, nome inválido, pasta inacessível, criando, falha ao criar, pasta já vinculada, sucesso na sidebar e seletor de pasta cancelado. O seletor usa UI nativa, não um explorador inventado no app.

## Nova conversa

- + do projeto ou Nova conversa no menu abre imediatamente um chat vazio nesse projeto.
- Nova conversa global usa o projeto aberto; sem projeto aberto, cria uma conversa livre no workspace atual. + em Conversas livres abre uma conversa livre diretamente.
- Nome inicial: Nova conversa. O usuário pode renomear depois. Nenhum título obrigatório, seletor de destino ou formulário antes de conversar.
- Foco no compositor. Criar/abrir o chat não inicia Run e não envia mensagens.
- Se persistência falhar, manter o texto no próprio chat e oferecer Tentar novamente. Não abrir um modal de erro nem apagar o rascunho.

Painel Nova conversa · abertura direta: entrada pelo +, chat vazio pronto para escrever e erro inline. O shell compacto mostra a nova linha selecionada e o chat aberto sem sobreposição ou modal.

A escolha de agente/modelo para executar trabalho pertence ao fluxo de execução, a definir separadamente. Não inferir listas ou permissões por projeto a partir do contrato técnico atual.

## Sidebar e menu

Pasta/ícone + nome + chevron juntos; + e ⋮ aparecem no hover/foco; conversas filhas simples com marcador neutro, sem contadores. Projeto 36 px, conversa 32 px, ações com alvo de 28 px. Hover e foco não significam execução em andamento.

O ícone escolhido identifica o projeto. Ícones personalizados permanecem iguais ao expandir/recolher; o chevron indica expansão. Se o ícone padrão for pasta, a variante de pasta aberta pode acompanhar a expansão.

Clique na linha alterna expansão sem fechar a conversa ativa. + abre chat diretamente. Menu: Nova conversa, Configurações, Renomear projeto. Abrir menu não altera contexto por si só. Menu é ancorado ao item, fora do clipping da lista e limitado à janela; perto da borda inferior abre acima.

Configurações edita os mesmos três dados: nome, ícone e pasta raiz. Não contém aba Agentes. Nesta implementação, Renomear projeto abre esse mesmo modal; a edição inline com Enter/✓ e Esc/× continua proposta do canvas. Projetos gerenciados pelo arquivo de configuração local têm edição indisponível no app, com explicação. Mudanças de pasta são validadas pelo daemon: não permitem outra raiz já vinculada nem alteração durante Run não terminal.

Falta de agentes não bloqueia cadastro de projeto ou abertura de chat. Pasta indisponível permite acessar o histórico e informa recuperação; requisitos de execução são tratados quando o usuário executar trabalho.

## Estados gerais preservados

Estados vazios, hover, seleção, foco, nome longo com tooltip, Unicode, carregamento, falha do serviço local, paginação, pasta ausente e ausência de workspace continuam aplicáveis. Listas grandes rolam apenas no centro da sidebar; topo e rodapé permanecem fora do scroll. Erro nunca vira vazio falso; preservar dados carregados e oferecer retry.

Remover vínculo, histórico de desvinculados e revincular continuam estudos separados de produto. Preservam pasta/registros e não são etapas da criação. Nenhum deles exige uma lista de agentes no cadastro.

## Dimensões, componentes e teclado

Modal 440 px, padding 24, gap 20, raio 12; campos 40 px; botões 36 px; escolha de ícone 36 × 36. Fontes Inter 13 para conteúdo, 12 para labels/ajuda, 18 para título. Tokens existentes de fundo, borda, foco, erro e sucesso. Em janelas pequenas, limitar altura e rolar o corpo se necessário, mantendo ações visíveis.

Bases reutilizáveis: DS / Botão / Base, DS / Input / Base, DS / Projeto / Base e DS / Conversa / Base. Ícone é propriedade persistida do projeto, não associação a um agente.

Modal de projeto contém foco; Tab segue nome → ícones → pasta → ações. Seleção de ícone tem estado semântico único. Esc fecha modal ou seletor superior primeiro e devolve foco ao acionador. Chat novo leva foco ao compositor. Não interceptar atalhos durante digitação em editor, chat ou terminal. Movimento reduzido elimina deslocamentos.

## Onde revisar

| Nó | Modelo vigente |
| --- | --- |
| RIoBY | Projetos · fluxos simplificados |
| G6jt2c | Criar projeto · nome, ícone e pasta |
| XqE5T | Nova conversa · abertura direta |
| sDXZ9 | Configurações do projeto · nome, ícone e pasta |
| Z3hVpc | Modal de projeto centralizado, desktop 1440 × 900 |
| c97PU2 | Chat aberto diretamente, 1000 × 640 |
| wHa1q | Modal de configurações, janela mínima 840 × 620 |
| FIlFO | Controles reutilizáveis |

O estudo inicial de centro vazio foi substituído pela home com saudação e compositor, conforme DESIGN_SYSTEM.md. Pranchas e exports antigos com escolha de agentes não são requisitos vigentes; os fluxos ativos foram substituídos no canvas.

## Correspondência com implementação

O contrato de resumo de projeto agora inclui `icon` e `root`; a migração SQLite v7 persiste o ícone com padrão `folder`. `projects.update` grava nome, ícone e pasta para projetos de origem `ui`, com chave de operação, validação de raiz e evento `project.updated`. A pasta precisa ser raiz de repositório Git acessível com commit; o seletor de pasta nativo (`eros:projects:choose-folder`) é separado da gravação. Cancelar a seleção não cria projeto.

`chats.create` aceita `dotId: null`, inclusive em projeto. A UI cria projetos com `dotIds: []`, sem concessões automáticas. Abrir um chat não exige agente nem inicia Run. Ao iniciar a Run, o daemon verifica autorização existente, raiz e contexto; se o Chat ainda não tem Dot, o vincula ao Dot autorizado na transação de enfileiramento. Essa vinculação não concede acesso novo. Projetos de configuração continuam usando as autorizações explícitas do arquivo local.

O shell implementa expansão de projetos, ações em hover/foco e recolher/mostrar sidebar. Redimensionamento, prévia temporária e recolher grupos ainda não existem; os chevrons dos títulos de grupo são decorativos. Busca/recentes inclui região global identificada com origem, além do filtro do workspace.

Os exemplos de 1440 × 900, 1000 × 640 e 840 × 620 orientam a revisão. Canvas estático não comprova teclado, foco, scroll, leitores de tela ou persistência. Verificação funcional e limitações da entrega são registradas em DESIGN_SYSTEM.md: check/build, 42/42 testes de backend e redesign-e2e confirmados.
