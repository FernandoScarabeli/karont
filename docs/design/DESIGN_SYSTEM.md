# Design system do Karont

## Direção A · Lua — decisão validada em 2026-10-30

A direção segue o estilo True-black flat da skill design-taste-frontend: superfícies em grafite quase preto, profundidade por degraus e cor apenas quando carrega significado. A forma vem da marca lua sobre a água, registrada em [lua-reflexo-estudo-01.png](brand/lua-reflexo-estudo-01.png). A moldura foi implementada; as páginas internas continuam migrando por tarefa. Esta direção substitui a base de 2026-10-25 conforme cada tela migrar.

### Cores semânticas

| Token | Valor | Uso |
| --- | --- | --- |
| `--k-chrome` | `#0F0F10` | Barra do topo e sidebar |
| `--k-page` | `#141415` | Fundo da área principal |
| `--k-card` | `#19191B` | Cartões, compositor e listas |
| `--k-raised` | `#232325` | Linha ativa, item que pede ação e botão secundário |
| `--k-well` | `#0F0F10` | Poço da última linha do terminal |
| `--k-line` | `#262627` | Hairline de 1 px entre superfícies |
| `--k-text` | `#EDEDED` | Texto principal |
| `--k-text-2` | `#A1A1A6` | Texto secundário e rótulos da navegação |
| `--k-text-3` | `#85858B` | Meta e ícones sobre `--k-page`, `--k-card` ou `--k-chrome` |
| `--k-primary` | `#F3EEE3` | Fundo do botão principal, marfim da lua da marca |
| `--k-on-primary` | `#141415` | Texto e ícone sobre `--k-primary` |
| `--k-live` | `#7DB4E0` | Marca da lua viva de uma Run em execução |
| `--k-attention` | `#E5A93B` | Ponto que indica que a Run precisa de você |
| `--k-positive` | `#4CC38A` | Sucesso acompanhado de texto |
| `--k-negative` | `#E5484D` | Erro acompanhado de texto |
| `--k-focus` | `#89ADFF` | Anel de foco por teclado |
| `--k-dot-claude-bg` / `--k-dot-claude-ink` | `#2B201B` / `#F0B79C` | Identidade do Dot Claude Code |
| `--k-dot-codex-bg` / `--k-dot-codex-ink` | `#1A2430` / `#9CC3F0` | Identidade do Dot Codex |
| `--k-dot-other-bg` / `--k-dot-other-ink` | `#232325` / `#A1A1A6` | Identidade de outros Dots |
| `--k-user-bg` / `--k-user-ink` | `#2A2723` / `#EFE9DE` | Fundo e inicial do usuário |

### Tipografia

| Token | Valor | Uso |
| --- | --- | --- |
| `--k-font-ui` | `"Geist Sans", system-ui, sans-serif` | Interface |
| `--k-font-mono` | `"Geist Mono", monospace` | Dados de máquina |
| `--k-fs-title` / `--k-fs-figure` | `28px` / `24px` | Título / número em destaque |
| `--k-fs-body` / `--k-fs-label` | `14px` / `13px` | Texto / rótulo |
| `--k-fs-meta` / `--k-fs-keycap` | `12px` / `11px` | Metadado / atalho |
| `--k-fw-regular` / `--k-fw-medium` / `--k-fw-strong` | `400` / `500` / `600` | Pesos disponíveis |

### Medidas

| Token | Valor | Uso |
| --- | --- | --- |
| `--k-sidebar-width` | `232px` | Largura da sidebar |
| `--k-topbar-height` | `52px` | Altura da barra do topo |
| `--k-nav-row` | `32px` | Linha de navegação |
| `--k-row` | `48px` | Linha padrão |
| `--k-avatar` | `28px` | Avatar e identidade do Dot |
| `--k-icon` / `--k-icon-sm` | `16px` / `14px` | Ícone / ícone auxiliar |
| `--k-composer-height` | `104px` | Altura do compositor |
| `--k-page-pad-x` / `--k-page-pad-top` | `40px` / `36px` | Margem horizontal / superior da página |
| `--k-gap` / `--k-gap-sm` | `24px` / `8px` | Espaço entre grupos / espaço compacto |

### Raios

| Token | Valor | Uso |
| --- | --- | --- |
| `--k-radius-keycap` | `4px` | Tecla de atalho |
| `--k-radius-control` | `8px` | Controle |
| `--k-radius-card` | `12px` | Cartão |
| `--k-radius-panel` | `16px` | Painel |

### Profundidade, camadas e movimento

| Token | Valor | Uso |
| --- | --- | --- |
| `--k-shadow-float` | `0 12px 32px rgb(0 0 0 / 0.4)` | Somente menus, popovers e diálogos flutuantes |
| `--k-z-menu` / `--k-z-dialog` / `--k-z-toast` | `20` / `40` / `60` | Menu / diálogo / aviso |
| `--k-ease` | `cubic-bezier(0.22, 1, 0.36, 1)` | Curva única de movimento |
| `--k-dur-fast` / `--k-dur-menu` / `--k-dur-enter` | `150ms` / `200ms` / `360ms` | Feedback / menu / entrada |

### Regras de uso

- Cor tem significado: `--k-live` aparece somente na marca de uma Run em execução; `--k-attention`, somente no ponto de “precisa de você”; nenhum dos dois aparece em botão, aba ou navegação.
- O botão principal usa fundo `--k-primary` e texto `--k-on-primary`, com um botão principal por área. O secundário usa `--k-raised` com hairline.
- A profundidade vem dos degraus de superfície e da hairline; sombra aparece somente no que flutua.
- O item ativo da navegação clareia o rótulo de `--k-text-2` para `--k-text`, sem pílula colorida.
- Geist Mono é reservado a dados de máquina: branch, tempo, caminho, última linha do terminal, IDs e atalhos; nunca a rótulos.
- Use sentence case: sem rótulos em maiúsculas espaçadas, emoji, gradiente ou brilho.
- A assinatura “lua viva” é um círculo de 7 px com dois traços de reflexo abaixo, de 10 px e 6 px; o segundo tem 60% de opacidade. Use `--k-live` somente em Run com estado `running`.
- A identidade dos Dots é um quadrado de 28 px, raio 8 px, com iniciais (CC, Cx) nas cores de cada Dot.
- `--k-text-3` não atinge 4,5:1 sobre `--k-raised`; nesse fundo, use `--k-text-2`.
- O foco por teclado usa `--k-focus` em anel de 2 px com offset de 2 px.

### Moldura (implementado)

A barra do topo tem 48 px (`--k-shell-topbar-height`), fundo `--k-chrome` e linha inferior `--k-line`. A marca usa o arquivo `assets/karont-lua.png` em 24 × 24 px, raio 6 px, o wordmark “karont” em Geist Sans 15/600 e o controle de recolher/mostrar sidebar. A área da marca mantém 232 px mesmo quando a sidebar está recolhida.

As abas ficam alinhadas ao rodapé da barra: início com largura 40 px, abas de workspace com altura 40 px e até 160 px de nome, e botão de criação com largura 32 px. Workspaces são ordenados por `createdAt`. A aba atual usa fundo `--k-page`, linha `--k-line-strong` (`#2E2E30`) e peso 500; as abas inativas usam `--k-text-2` e hover `--k-card`. A aba ativa não tem linha inferior e recebe as curvas inferiores de 8 px para se unir à página. Clique direito ou Menu/Shift+F10 abre o menu de renomear workspace; Esc e clique fora fecham o menu. As abas excedentes rolam horizontalmente, sem barra visível.

A busca ocupa 260 × 32 px e pode encolher até 200 px. O atalho Ctrl+K/Cmd+K foca o campo; Esc limpa e desfoca. A busca também filtra os Projetos e Chats visíveis na sidebar. Chats recentes de todos os workspaces aparecem em um painel de 360 px, limitado à janela, com fundo `--k-card`, linha `--k-line`, raio `--k-radius-card`, sombra `--k-shadow-float` e camada `--k-z-menu`; o cabeçalho preserva os nomes “Recentes/Resultados · todos os workspaces”. A lista aceita as setas ↑/↓ e Tab; clicar em um resultado abre o Chat e fecha o painel.

A sidebar tem 232 px, fundo `--k-chrome`, linha direita `--k-line` e padding de 16 × 10 px. As linhas de navegação usam 32 px, texto de 14 px e ícones de 16 px. Grupos têm intervalo de 20 px; o cabeçalho mede 28 px e usa texto 12/500. “Favoritos” só aparece quando existe favorito. Conversas de Projeto começam alinhadas 10 px depois do início do nome do Projeto. Uma conversa atual recebe fundo `--k-raised`, peso 500 e `aria-current="page"`.

O rodapé contém somente a linha do usuário, separada por `--k-line`, com 8 px antes, altura 44 px, avatar redondo de 28 px e engrenagem de 28 px. O nome vem de `window.karont.systemUser()`; durante a carga ou em caso de falha, aparece “Perfil local” e a inicial “P”. O menu da engrenagem conserva Configurações e ferramentas e abre Agentes e Automações.

`LiveMoon` desenha a marca de Run viva em HTML: círculo de 7 px e reflexos de 10 × 1,5 px e 6 × 1,5 px, com intervalo de 2 px e 60% de opacidade no segundo reflexo. Usa somente `--k-live`, inclui `role="img"`, nome acessível e título. `AttentionDot` é um círculo de 6 px com `--k-attention` e rótulo “Precisa de você”. Runs `running`/`queued` e aprovações pendentes ou Runs `recovery_needed` são carregados por `runs(100)` e `approvals()`, associados a workspaces pelo Projeto e atualizados por eventos, sem polling. Em erro, o hook guarda a falha e não exibe marca. A lua aparece também à direita de conversas com Run `running`/`queued`.

#### Tokens da moldura

| Token | Valor | Regra de uso |
| --- | --- | --- |
| `--k-line-strong` | `#2E2E30` | Borda da aba ativa |
| `--k-focus-width` / `--k-focus-offset` | `2px` / `2px` | Foco visível |
| `--k-shell-topbar-height` | `48px` | Altura da barra superior |
| `--k-shell-viewport-height` / `--k-shell-viewport-width` | `100dvh` / `100vw` | Área útil da janela para o shell e popovers |
| `--k-shell-brand-padding-x` / `--k-shell-brand-gap` | `18px` / `10px` | Marca |
| `--k-shell-mark-size` / `--k-shell-mark-radius` | `24px` / `6px` | Símbolo da marca |
| `--k-shell-icon-button-size` | `28px` | Controles de ícone da moldura |
| `--k-shell-tab-height` / `--k-shell-tab-padding-x` / `--k-shell-tab-radius` | `40px` / `14px` / `10px` | Abas de workspace |
| `--k-shell-tabs-padding-left` / `--k-shell-tabs-gap` | `16px` / `2px` | Área de abas |
| `--k-shell-tab-ear-size` | `8px` | Curvas inferiores da aba ativa |
| `--k-shell-tab-home-width` / `--k-shell-tab-plus-width` | `40px` / `32px` | Início e criar workspace |
| `--k-shell-tab-name-max-width` | `160px` | Limite do nome da aba |
| `--k-shell-search-width` / `--k-shell-search-min-width` | `260px` / `200px` | Campo de busca |
| `--k-shell-search-height` / `--k-shell-search-padding-x` | `32px` / `12px` | Campo de busca |
| `--k-shell-search-icon-size` | `14px` | Ícone de busca |
| `--k-shell-search-panel-width` / `--k-shell-search-panel-max-height` | `360px` / `480px` | Limite do painel de resultados |
| `--k-shell-search-panel-viewport-max-height` | `60vh` | Limite responsivo do painel de resultados |
| `--k-shell-search-panel-gap` / `--k-shell-search-panel-inset` | `4px` / `16px` | Painel de resultados |
| `--k-shell-sidebar-padding-y` / `--k-shell-sidebar-padding-x` | `16px` / `10px` | Sidebar |
| `--k-shell-sidebar-gap` / `--k-shell-sidebar-group-gap` | `2px` / `20px` | Sidebar e grupos |
| `--k-shell-sidebar-heading-height` / `--k-shell-sidebar-heading-gap` | `28px` / `6px` | Cabeçalho de grupo |
| `--k-shell-sidebar-empty-size` | `12px` | Estado vazio da sidebar |
| `--k-shell-profile-padding-x` / `--k-shell-profile-height` | `8px` / `44px` | Linha do usuário |
| `--k-shell-profile-top-padding` / `--k-shell-profile-gap` | `8px` / `10px` | Rodapé do usuário |
| `--k-shell-footer-border-width` / `--k-shell-line-width` | `1px` / `1px` | Hairlines da moldura |
| `--k-shell-page-radius` | `12px` | Canto superior esquerdo da página |
| `--k-shell-chat-indent` | `25px` | Alinhamento das conversas de Projeto |
| `--k-shell-settings-menu-width` / `--k-shell-popover-padding` | `228px` / `6px` | Menus da moldura |
| `--k-shell-popover-row-height` / `--k-shell-popover-row-gap` | `32px` / `8px` | Itens de menu |
| `--k-shell-brand-font-size` / `--k-shell-chat-font-size` | `15px` / `13px` | Wordmark e nomes de conversa |
| `--k-live-moon-width` / `--k-live-moon-height` | `12px` / `14px` | Caixa da lua viva |
| `--k-live-moon-orb-size` | `7px` | Círculo da lua viva |
| `--k-live-moon-long-width` / `--k-live-moon-short-width` | `10px` / `6px` | Reflexos da lua viva |
| `--k-live-moon-bar-height` / `--k-live-moon-bar-radius` | `1.5px` / `1px` | Reflexos da lua viva |
| `--k-live-moon-gap` / `--k-live-moon-reflection-opacity` | `2px` / `0.6` | Espaço e opacidade do reflexo menor |
| `--k-live-moon-line-height` | `0` | Evita altura de linha extra na marca HTML |
| `--k-attention-dot-size` | `6px` | Ponto de atenção |

Os tokens existentes continuam definidos em `tokens.css`; `--k-topbar-height: 52px` fica reservado às superfícies ainda não migradas. A nova moldura usa `--k-shell-topbar-height: 48px`. O foco usa `--k-focus` a 2 px com offset de 2 px. `prefers-reduced-motion` remove transições e animações. A janela mínima prevista é 840 × 620 px: sidebar permanece em 232 px, as abas rolam e a busca não passa abaixo de 200 px.

Agentes e Automações no menu da engrenagem, assim como a busca em painel flutuante, são decisões do orquestrador para esta tarefa e precisam ser validadas com o usuário.

### Contraste WCAG

Contraste calculado pela fórmula WCAG para luminância relativa sRGB: `(Lmais clara + 0,05) / (Lmais escura + 0,05)`. Os valores estão arredondados a duas casas; AA para texto normal exige pelo menos 4,5:1.

| Primeiro plano sobre fundo | Contraste | AA para texto |
| --- | ---: | --- |
| `--k-text` sobre `--k-page` | `15,73:1` | Passa |
| `--k-text` sobre `--k-card` | `15,00:1` | Passa |
| `--k-text` sobre `--k-chrome` | `16,36:1` | Passa |
| `--k-text-2` sobre `--k-page` | `7,16:1` | Passa |
| `--k-text-2` sobre `--k-card` | `6,82:1` | Passa |
| `--k-text-2` sobre `--k-chrome` | `7,45:1` | Passa |
| `--k-text-3` sobre `--k-page` | `5,02:1` | Passa |
| `--k-text-3` sobre `--k-card` | `4,79:1` | Passa |
| `--k-text-3` sobre `--k-chrome` | `5,22:1` | Passa |
| `--k-text-2` sobre `--k-raised` | `6,10:1` | Passa |
| `--k-text-3` sobre `--k-raised` | `4,28:1` | Não passa |
| `--k-on-primary` sobre `--k-primary` | `15,91:1` | Passa |
| `--k-focus` sobre `--k-page` | `8,32:1` | Passa |

### Ainda não implementado / ideias futuras

- **Nova home:** mostrar Runs em andamento via `runs.list`, pedido de permissão para desfazer via `approvals.decide`, ação Retomar, recentes com o Dot e contagens de tarefas. São capacidades a implementar nas telas, não parte desta tarefa de tokens.
- **Uso restante por Dot no rodapé:** ainda não há fonte de dados; a API local não fornece esse dado e o app não pode ler credenciais das CLIs. É necessária uma spec antes de qualquer código.

---

## Base anterior (2026-10-25), em substituição pela Direção A

O conteúdo abaixo registra a base visual anterior. Preserve-o como histórico; suas regras deixam de ser a direção vigente à medida que as telas migram para a Direção A.

### Estado em 2026-10-25

**Base visual implementada no desktop**, a partir da direção vigente de `karont.pen`. O canvas continua incluindo propostas futuras; aquela entrega não implementa todas as suas telas. Este documento continua sendo a fonte canônica das regras visuais históricas, junto de [PROJECT_FLOWS.md](PROJECT_FLOWS.md) e [CHAT_FLOWS.md](CHAT_FLOWS.md).

### Direção e fontes

Workspace desktop escuro, compacto, com separação tonal de superfícies e cor pontual para foco, identidade e estados. Referências originais: `references/01.png` a `references/10.png` e painel de briefing do `karont.pen`; os fundos do briefing não são cores do produto. A direção existente foi implementada, sem criar outra identidade visual.

Canvas e componentes DS definem a composição. `apps/desktop/src/renderer/styles/tokens.css` centraliza os tokens implementados; `karont.css` (mesma pasta) aplica o shell e adapta os componentes existentes. `renderer/features/workspace/` reúne navegação e home, e `renderer/features/chat/` o chat; ToDo, terminal, execução e diagnóstico reutilizam suas funcionalidades com a nova paleta. Novos padrões devem atualizar código, documentação e variáveis/componentes reutilizáveis do canvas na mesma entrega.

### Cores semânticas

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

### Tipografia, ícones e identidade

Inter 400/500/600 para interface e JetBrains Mono 400 disponível como token para código, empacotadas via `@fontsource` para uso offline. O terminal PTY, CodeMirror e alguns trechos legados ainda usam suas pilhas monoespaçadas anteriores; aplicar `font-code` integralmente nesses componentes permanece pendente. Tokens `font-ui: 'Inter', system-ui, sans-serif` e `font-code: 'JetBrains Mono', monospace`. Lucide via `lucide-react`, em geral 16 px; ações auxiliares 12–14 px. Logo provisória de lua/reflexo preservada (`LuERS.png`, 32 px), sem novo wordmark.

Interface 13 px, grupos/ajuda 12 px, metadados 11 px; títulos de página 24 px e modal 18 px, peso 500. Home 36 px/1,22, peso 500, tracking −1 px; compacta 32 px e −0,8 px. Mensagens 15 px/1,6 (24 px). O Dot usa nome e marcador provisório; mascote do Dot Studio é uma evolução separada.

### Espaçamento, dimensões e superfícies

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

### Componentes e comportamento implementado

- **Shell e sidebar:** topo/rodapé fixos, centro com rolagem vertical e sem overflow horizontal; nomes truncam com título acessível. Projeto expande/recolhe; ações aparecem por hover e foco. Recolher/mostrar sidebar não cria trilho de ícones. Grupos ainda não recolhem: seus chevrons são decorativos. Redimensionamento e prévia temporária permanecem propostas.
- **Navegação:** ToDo usa o fluxo existente; Agentes apresenta Dots configurados; Automações informa indisponibilidade. Configurações e ferramentas preserva acesso a diagnóstico, laboratório e capacidades existentes. Runs permanecem junto do contexto de execução.
- **Busca e recentes:** a busca filtra projetos/conversas do workspace e apresenta conversas recentes/resultados de todos os workspaces em região identificada, com origem workspace/projeto ou conversa livre. Abrir resultado troca para seu contexto real. Não presumir isolamento ao workspace atual nessa região global.
- **Projetos:** criar/editar usa nome, ícone e pasta raiz; seleção nativa separada da gravação. Sem listas, papéis ou concessões de agentes. `Renomear projeto` abre o mesmo modal de três campos; edição inline do canvas ainda não foi implementada. Projetos de origem `config` são editados no arquivo local, com controles indisponíveis e motivo visível.
- **Home:** logo retorna ao início, sem criar Chat/Run nem apagar histórico. Saudação pelo horário local: dia 05h–11h59, tarde 12h–17h59, noite nos demais horários. Sem nome de usuário disponível na API, não inventar identidade. O rodapé usa ícone genérico e o rótulo “Perfil local”, que não indica conta autenticada. Sugestões preenchem o rascunho sem enviar. Abrir com rascunho cria conversa livre e conserva o texto como rascunho; não inicia Run. Validar 8.000 bytes UTF-8 antes da criação, inclusive por Enter; excesso preserva o texto.
- **Chat:** abertura direta como Nova conversa, com foco no compositor. Rascunho, mensagens locais, favoritos, renomear, copiar, editar como nova mensagem, criar tarefa e /kanban com revisão preservam as operações existentes. Salvar mensagem, entregar ao PTY e iniciar Run continuam ações distintas; `sent` confirma escrita no terminal. Respostas e interações reais do Dot ficam no terminal. O chat não exibe respostas estruturadas inventadas.
- **Indisponibilidade:** anexos, limites de provedor e automações informam o motivo. Percentual e reinício demonstrativos do canvas não são telemetria. Não exibir rotação de provedores nem valores de uso sem fonte real.

Bases do canvas: DS / Botão / Base, DS / Input / Base, DS / Projeto / Base, DS / Conversa / Base, DS / Sidebar / Item de navegação e DS / Compositor / Home (`O3YcSw`), com sugestão `mud4e`. Estado normal, hover, foco, seleção, desabilitado, envio, erro e sucesso devem reutilizar tokens. As famílias estruturadas de Chat/Atividade/Perguntas/Comandos continuam propostas além do recorte implementado.

### Layout, movimento e acessibilidade

Home: bloco máximo 640 px e gap 32; padding desktop 32/48/96. Até 1100 px, bloco 600 px e padding 32/32/56. Sidebar ocupa 272 px e pode ser recolhida; abaixo de 700 px usa 240 px. Modal limita largura à janela menos 32 px e altura disponível, com rolagem. Chat tem histórico e compositor próprios; terminal e execução aparecem em ferramentas contextuais, sem divisão de chats nesta entrega.

Tokens `motion-fast` 140 ms e `motion-panel` 220 ms; curva `motion-ease: cubic-bezier(0.16,1,0.3,1)`. Feedback de botão usa 140 ms. Não interpretar a presença de `motion-panel` como implementação de todos os movimentos desenhados. `prefers-reduced-motion` desativa animações, transições e scroll suave. Seleção, caret e scrollbars usam a paleta.

Foco visível, nomes acessíveis em ícones, erros textuais, estados disabled e diálogos nativos orientam a navegação por teclado. Enter sem Shift salva/abre conforme o contexto; Shift+Enter quebra linha; composição IME não deve enviar. Texto UTF-8 tem limite de 8.000 bytes, não somente 8.000 caracteres. Não capturar atalhos de editor ou terminal indiscriminadamente.

Revisar desktop 1440 × 900, compacto 1000 × 640 e mínimo 840 × 620, além de nomes longos, Unicode, overflow e acesso à sidebar recolhida. Canvas estático não certifica leitores de tela, foco real, IME, persistência, reconexão ou seleção nativa. A verificação funcional final e seus resultados pertencem ao registro desta implementação; não presumir cobertura completa de acessibilidade a partir de capturas ou testes de integração.

### Registro e propostas preservadas

Em 2026-10-25 foram explorados shell vazio, sidebar e home; a decisão de home com saudação/compositor substituiu o centro vazio. Nome “Scarabeli”, “100% de uso restante” e “12:34” eram exemplos demonstrativos do canvas. A implementação omite nome pessoal sem fonte, usa “Perfil local” com ícone genérico no rodapé e mostra uso indisponível. A direção escura, sidebar de 272 px, projeto com três campos e chat direto são decisões vigentes implementadas em 2026-10-25.

Continuam propostas: redimensionar sidebar/prévia temporária, recolher grupos, rotação automática/limites reais de provedores, streaming estruturado, perguntas, anexos, CommandMenu global, divisão/restauração de painéis, remover/revincular projetos e mascote do Dot. A rotação estudada (5 s / 240 ms, pausar por hover/foco, movimento reduzido sem deslocamento) depende de fonte de uso e validação própria. A dica Tab da home também permanece exploração; Tab deve manter saída normal do campo.

Referências de composição: [Sidebar](https://www.fluidfunctionalism.com/docs/sidebar?preset=sa1FQfCxG4), [InputMessage](https://www.fluidfunctionalism.com/docs/input-message?preset=ma288), ThinkingSteps, AskUserQuestions, ChatMessage e CommandMenu. Inspiração não implica instalar essas bibliotecas ou implementar todos os seus controles. Para os fluxos desenhados e respectivos nós, consultar os documentos de projetos e chats.

### Verificação da implementação (2026-10-25)

Confirmados: `npm run check`, `npm run build`, 42/42 testes de backend e `redesign-e2e`. A suíte cobre a vinculação autorizada de Dot ao iniciar Run em chat com `dotId: null`; o e2e inclui limite UTF-8, Enter repetido, busca/recentes global e sidebar sem overflow horizontal (`scrollWidth <= clientWidth`). Capturas finais em `.impeccable/review/`: `desktop.png`, `compact.png`, `minimum.png`, `chat.png` e `project-modal.png`, com viewport CSS de 1440 × 900, 1000 × 640 e 840 × 620 fixado por Playwright dentro do Electron. `scripts/redesign-e2e.mjs` verifica `innerWidth`/`innerHeight` exatos; as dimensões externas da janela nativa podem diferir. Essas verificações não certificam leitores de tela nem implementam os fluxos futuros do canvas.

A correspondência com código/documentação foi registrada no contexto dos nós `eWay8`, `wkzUF`, `yFm1c`, `O3YcSw`, `scdAg`, `ukJrn`, `t5tVqU`, `KZD4C`, `rmjvP` e `Z3hVpc`, preservando composição e tokens aprovados.
