# Design system do Karont

Estado em 2026-10-25: **base visual implementada no desktop**, a partir da direção vigente de `karont.pen`. O canvas continua incluindo propostas futuras; esta entrega não implementa todas as suas telas. Este documento é a fonte canônica das regras visuais, junto de [PROJECT_FLOWS.md](PROJECT_FLOWS.md) e [CHAT_FLOWS.md](CHAT_FLOWS.md).

## Direção e fontes

Workspace desktop escuro, compacto, com separação tonal de superfícies e cor pontual para foco, identidade e estados. Referências originais: `references/01.png` a `references/10.png` e painel de briefing do `karont.pen`; os fundos do briefing não são cores do produto. A direção existente foi implementada, sem criar outra identidade visual.

Canvas e componentes DS definem a composição. `apps/desktop/src/renderer/styles/tokens.css` centraliza os tokens implementados; `karont.css` (mesma pasta) aplica o shell e adapta os componentes existentes. `renderer/features/workspace/` reúne navegação e home, e `renderer/features/chat/` o chat; ToDo, terminal, execução e diagnóstico reutilizam suas funcionalidades com a nova paleta. Novos padrões devem atualizar código, documentação e variáveis/componentes reutilizáveis do canvas na mesma entrega.

## Cores semânticas

Os nomes abaixo correspondem às variáveis do pen.dev e às propriedades CSS com prefixo `--`. Todos estão implementados em `tokens.css`.

| Token | Valor | Uso |
| --- | --- | --- |
| bg-canvas | #141414 | Área principal |
| bg-sidebar | #191919 | Navegação e diálogos |
| bg-composer | #1C1C1C | Compositor e avisos contextuais |
| bg-hover | #242424 | Ação discreta e hover |
| bg-selected | #2D2D2D | Seleção persistente e envio indisponível |
| chat-user-bg | #292929 | Mensagem do usuário |
| text-primary | #EDEDED | Conteúdo principal; superfície de ação primária |
| text-secondary | #A1A1A1 | Metadados, placeholder e ícones |
| border-subtle | #2B2B2B | Divisórias de regiões |
| border-control | #363636 | Limite de controles e menus |
| focus-ring | #89ADFF | Foco por teclado |
| text-error | #F28B82 | Falha com texto explicativo |
| text-success | #8BD5A3 | Confirmação com texto |
| text-warning | #E5C07B | Atenção e recuperação |
| dot-identity | #B7ADEB | Identidade provisória de Dot, nunca estado de execução |

Hover, seleção, foco e execução são estados distintos. Estados não dependem apenas da cor: usar rótulo, ícone e semântica conforme o controle. Ação primária usa `text-primary` sobre o fundo do botão e `bg-canvas` no texto/ícone; foco usa contorno de 2 px e offset de 2 px. Bordas escuras organizam superfícies, sem substituir labels nem foco.

Contrastes dos pares principais no canvas: principal/fundo 15,74:1; secundário/compositor 6,60:1; principal/balão 12,43:1; erro/compositor 7,13:1; foco/fundo 8,32:1. A revisão estática não certifica todos os estados do aplicativo.

## Tipografia, ícones e identidade

Inter 400/500/600 para interface e JetBrains Mono 400 disponível como token para código, empacotadas via `@fontsource` para uso offline. O terminal PTY, CodeMirror e alguns trechos legados ainda usam suas pilhas monoespaçadas anteriores; aplicar `font-code` integralmente nesses componentes permanece pendente. Tokens `font-ui: 'Inter', system-ui, sans-serif` e `font-code: 'JetBrains Mono', monospace`. Lucide via `lucide-react`, em geral 16 px; ações auxiliares 12–14 px. Logo provisória de lua/reflexo preservada (`LuERS.png`, 32 px), sem novo wordmark.

Interface 13 px, grupos/ajuda 12 px, metadados 11 px; títulos de página 24 px e modal 18 px, peso 500. Home 36 px/1,22, peso 500, tracking −1 px; compacta 32 px e −0,8 px. Mensagens 15 px/1,6 (24 px). O Dot usa nome e marcador provisório; mascote do Dot Studio é uma evolução separada.

## Espaçamento, dimensões e superfícies

| Token | Valor | Regra e correspondência |
| --- | --- | --- |
| space-unit | 4 px | Unidade do ritmo; intervalos usuais 8/12/16/20/24/32 |
| sidebar-width | 272 px | Largura do shell; canvas usa dimensão numérica correspondente |
| nav-row-height | 36 px | Navegação/projeto |
| control-height | 40 px | Campos de formulário |
| menu-row-height | 32 px | Conversas e ações compactas |
| radius-control | 6 px | Controles e linhas selecionadas |
| radius-panel | 12 px | Modal, menu e mensagem |
| composer-radius | 16 px | Superfície do compositor |
| composer-padding | 20 px | Respiro interno do compositor |
| composer-gap | 12 px | Separação entre entrada e ações |
| home-title-size / home-title-compact | 36 / 32 px | Hierarquia da home |
| chat-body-size / chat-line-height | 15 px / 1,6 | Leitura da conversa |
| chat-content-width | 760 px | Limite da coluna de conversa, reduzido à área disponível |
| chat-header-height | 56 px | Cabeçalho do chat |
| chat-message-gap | 28 px | Separação entre turnos |

Esses tokens estão no canvas e em `tokens.css`; propriedades geométricas do canvas podem usar o número equivalente quando a instância não resolve a variável. `chat-pane-min` 480 px e `composer-suggestion-height` 36 px continuam referências do canvas; o primeiro é proposta para painéis divididos, o segundo corresponde à altura implementada da sugestão sem variável CSS própria.

Superfícies são planas em repouso. Popover usa sombra `0 12px 32px #0006`; modal `0 24px 80px #0006` e backdrop `#0009`. Modal de projeto: largura máxima 440 px, padding 24, gap 20, opções de ícone 36 × 36. Botões de ícone 32 × 32; ações da sidebar 28 × 28. Contexto desktop; suporte a toque requer revisão própria.

## Componentes e comportamento implementado

- **Shell e sidebar:** topo/rodapé fixos, centro com rolagem vertical e sem overflow horizontal; nomes truncam com título acessível. Projeto expande/recolhe; ações aparecem por hover e foco. Recolher/mostrar sidebar não cria trilho de ícones. Grupos ainda não recolhem: seus chevrons são decorativos. Redimensionamento e prévia temporária permanecem propostas.
- **Navegação:** ToDo usa o fluxo existente; Agentes apresenta Dots configurados; Automações informa indisponibilidade. Configurações e ferramentas preserva acesso a diagnóstico, laboratório e capacidades existentes. Runs permanecem junto do contexto de execução.
- **Busca e recentes:** a busca filtra projetos/conversas do workspace e apresenta conversas recentes/resultados de todos os workspaces em região identificada, com origem workspace/projeto ou conversa livre. Abrir resultado troca para seu contexto real. Não presumir isolamento ao workspace atual nessa região global.
- **Projetos:** criar/editar usa nome, ícone e pasta raiz; seleção nativa separada da gravação. Sem listas, papéis ou concessões de agentes. `Renomear projeto` abre o mesmo modal de três campos; edição inline do canvas ainda não foi implementada. Projetos de origem `config` são editados no arquivo local, com controles indisponíveis e motivo visível.
- **Home:** logo retorna ao início, sem criar Chat/Run nem apagar histórico. Saudação pelo horário local: dia 05h–11h59, tarde 12h–17h59, noite nos demais horários. Sem nome de usuário disponível na API, não inventar identidade. O rodapé usa ícone genérico e o rótulo “Perfil local”, que não indica conta autenticada. Sugestões preenchem o rascunho sem enviar. Abrir com rascunho cria conversa livre e conserva o texto como rascunho; não inicia Run. Validar 8.000 bytes UTF-8 antes da criação, inclusive por Enter; excesso preserva o texto.
- **Chat:** abertura direta como Nova conversa, com foco no compositor. Rascunho, mensagens locais, favoritos, renomear, copiar, editar como nova mensagem, criar tarefa e /kanban com revisão preservam as operações existentes. Salvar mensagem, entregar ao PTY e iniciar Run continuam ações distintas; `sent` confirma escrita no terminal. Respostas e interações reais do Dot ficam no terminal. O chat não exibe respostas estruturadas inventadas.
- **Indisponibilidade:** anexos, limites de provedor e automações informam o motivo. Percentual e reinício demonstrativos do canvas não são telemetria. Não exibir rotação de provedores nem valores de uso sem fonte real.

Bases do canvas: DS / Botão / Base, DS / Input / Base, DS / Projeto / Base, DS / Conversa / Base, DS / Sidebar / Item de navegação e DS / Compositor / Home (`O3YcSw`), com sugestão `mud4e`. Estado normal, hover, foco, seleção, desabilitado, envio, erro e sucesso devem reutilizar tokens. As famílias estruturadas de Chat/Atividade/Perguntas/Comandos continuam propostas além do recorte implementado.

## Layout, movimento e acessibilidade

Home: bloco máximo 640 px e gap 32; padding desktop 32/48/96. Até 1100 px, bloco 600 px e padding 32/32/56. Sidebar ocupa 272 px e pode ser recolhida; abaixo de 700 px usa 240 px. Modal limita largura à janela menos 32 px e altura disponível, com rolagem. Chat tem histórico e compositor próprios; terminal e execução aparecem em ferramentas contextuais, sem divisão de chats nesta entrega.

Tokens `motion-fast` 140 ms e `motion-panel` 220 ms; curva `motion-ease: cubic-bezier(0.16,1,0.3,1)`. Feedback de botão usa 140 ms. Não interpretar a presença de `motion-panel` como implementação de todos os movimentos desenhados. `prefers-reduced-motion` desativa animações, transições e scroll suave. Seleção, caret e scrollbars usam a paleta.

Foco visível, nomes acessíveis em ícones, erros textuais, estados disabled e diálogos nativos orientam a navegação por teclado. Enter sem Shift salva/abre conforme o contexto; Shift+Enter quebra linha; composição IME não deve enviar. Texto UTF-8 tem limite de 8.000 bytes, não somente 8.000 caracteres. Não capturar atalhos de editor ou terminal indiscriminadamente.

Revisar desktop 1440 × 900, compacto 1000 × 640 e mínimo 840 × 620, além de nomes longos, Unicode, overflow e acesso à sidebar recolhida. Canvas estático não certifica leitores de tela, foco real, IME, persistência, reconexão ou seleção nativa. A verificação funcional final e seus resultados pertencem ao registro desta implementação; não presumir cobertura completa de acessibilidade a partir de capturas ou testes de integração.

## Registro e propostas preservadas

Em 2026-10-25 foram explorados shell vazio, sidebar e home; a decisão de home com saudação/compositor substituiu o centro vazio. Nome “Scarabeli”, “100% de uso restante” e “12:34” eram exemplos demonstrativos do canvas. A implementação omite nome pessoal sem fonte, usa “Perfil local” com ícone genérico no rodapé e mostra uso indisponível. A direção escura, sidebar de 272 px, projeto com três campos e chat direto são decisões vigentes implementadas em 2026-10-25.

Continuam propostas: redimensionar sidebar/prévia temporária, recolher grupos, rotação automática/limites reais de provedores, streaming estruturado, perguntas, anexos, CommandMenu global, divisão/restauração de painéis, remover/revincular projetos e mascote do Dot. A rotação estudada (5 s / 240 ms, pausar por hover/foco, movimento reduzido sem deslocamento) depende de fonte de uso e validação própria. A dica Tab da home também permanece exploração; Tab deve manter saída normal do campo.

Referências de composição: [Sidebar](https://www.fluidfunctionalism.com/docs/sidebar?preset=sa1FQfCxG4), [InputMessage](https://www.fluidfunctionalism.com/docs/input-message?preset=ma288), ThinkingSteps, AskUserQuestions, ChatMessage e CommandMenu. Inspiração não implica instalar essas bibliotecas ou implementar todos os seus controles. Para os fluxos desenhados e respectivos nós, consultar os documentos de projetos e chats.

## Verificação da implementação (2026-10-25)

Confirmados: `npm run check`, `npm run build`, 42/42 testes de backend e `redesign-e2e`. A suíte cobre a vinculação autorizada de Dot ao iniciar Run em chat com `dotId: null`; o e2e inclui limite UTF-8, Enter repetido, busca/recentes global e sidebar sem overflow horizontal (`scrollWidth <= clientWidth`). Capturas finais em `.impeccable/review/`: `desktop.png`, `compact.png`, `minimum.png`, `chat.png` e `project-modal.png`, com viewport CSS de 1440 × 900, 1000 × 640 e 840 × 620 fixado por Playwright dentro do Electron. `scripts/redesign-e2e.mjs` verifica `innerWidth`/`innerHeight` exatos; as dimensões externas da janela nativa podem diferir. Essas verificações não certificam leitores de tela nem implementam os fluxos futuros do canvas.

A correspondência com código/documentação foi registrada no contexto dos nós `eWay8`, `wkzUF`, `yFm1c`, `O3YcSw`, `scdAg`, `ukJrn`, `t5tVqU`, `KZD4C`, `rmjvP` e `Z3hVpc`, preservando composição e tokens aprovados.
