# Plano — Refatoração – Fase 3 (estilos e redesign visual)

Branch da fase: `refactor/fase-3-design`, criada a partir de `main` depois do merge da Fase 2 (PR #3). Um PR por fase. Spec: [SPEC_REFATORACAO.md](SPEC_REFATORACAO.md), seção 6, "Fase 3". Regras de design: `AGENTS.md`, seção "Design do produto".

Este plano é o ponto de partida do **chat de design** (decisão 21). Ele é diferente das fases anteriores: a direção visual vem do usuário, por referências e conversa. As tarefas de código só começam depois que a direção estiver aprovada.

## Situação (2026-10-30)

- O usuário acha a interface atual ruim ("horrível") e quer refazê-la.
- O `karont.pen` antigo não está disponível. O usuário vai instalar o pen.dev neste PC e criar um `karont.pen` novo na raiz do repositório. A regra do `AGENTS.md` (design no pen.dev, com variáveis e componentes) continua valendo.
- Referências: o usuário vai mandar prints, links e comentários pelo chat. Elas ficam em `docs/design/references/`, que já tem `01.png`–`10.png` de uma rodada anterior, sem anotação. Confira com o usuário se essas ainda valem.
- Estilos hoje: `renderer/styles/tokens.css` (43 linhas), `style.css` (1.846) e `karont.css` (1.007). Todo CSS global é importado em `renderer/main.tsx`, nessa ordem, depois do `xterm.css`. `tests/desktop-structure.test.mjs` garante que nenhum outro arquivo importa CSS. **Se a Fase 3 adotar CSS por componente, esse teste precisa mudar junto, de propósito.**
- A comparação visual (`npm run visual -- <nome>` e `node scripts/visual-snapshot.mjs --compare <a> <b>`) passa a servir para **mostrar** o que mudou. Os PNGs de antes e depois de cada tela são os prints de revisão.

## Etapa A — Direção visual (chat de design, sem código)

1. **Coletar referências.** Para cada coisa que o usuário mandar, salve a imagem em `docs/design/references/` com um nome curto e descritivo. Registre em `docs/design/references/README.md` uma linha por referência: de onde veio, **o que o usuário gostou** e o que não quer copiar. Links sem imagem também vão para o README.
2. **Perguntar o que incomoda** na interface atual, com os prints de `npm run visual -- atual` na mão: cores, densidade, tipografia, hierarquia, navegação.
3. **Propor 2 ou 3 direções**, cada uma com paleta (dark e, se fizer sentido, light), tipografia, densidade, raios e um exemplo aplicado a uma tela, de preferência a home. Cada proposta diz de quais referências veio. Não invente identidade sem base nas referências (spec, Fase 3, item 3).
4. **O usuário escolhe** (ou mistura). Registre a decisão em PROGRESSO como decisão do usuário.
5. **No `karont.pen`:** variáveis para os tokens, componentes com variantes e o painel de referências/briefing. Se o pen.dev ainda não estiver pronto, a direção aprovada vira primeiro o `DESIGN_SYSTEM.md` + `tokens.css`, e o `.pen` é alimentado depois, marcado como pendente.

Pronto quando: direção escolhida, registrada e com tokens definidos (nomes e valores) no `DESIGN_SYSTEM.md`, marcada como "decisão validada".

## Etapa B — Base técnica (código, sem mudar as telas ainda)

Decisão pendente, a levar ao usuário com recomendação: **CSS Modules ou arquivos planos com `@layer`** (spec, seção 10, pergunta 4). Recomendação inicial do orquestrador: **arquivos planos com `@layer`** (sem dependência nova, sem mudar build, fácil de ler); confirmar com o usuário.

- B1. `tokens.css` completo: cores semânticas, tipografia, espaçamento, raios, bordas, sombras, z-index, durações/easings e tamanhos de ícone.
- B2. Consolidar `style.css` + `karont.css`: cada regra vai para o componente ou feature dona, ou é apagada se não tiver mais uso. Zero cor ou valor solto fora de `tokens.css` (conferir com grep).
- B3. Biblioteca mínima em `renderer/components/`: Button (variantes e estados), IconButton, Input/Textarea, Dialog (a partir do `FormDialog`), Menu/Popover, Tabs, Tooltip, Badge/StatusPill, Card, EmptyState, Toast. Cada um com hover, foco, ativo, desabilitado, erro e carregando.

## Etapa C — Tela por tela

Ordem da spec: (a) shell + sidebar/navegação, (b) home, (c) chat, (d) runs/terminal/diff, (e) tarefas, (f) diagnóstico/atenção. A cada tela:

- prints em 1440 px e ~900 px (antes e depois, pelo `npm run visual`) mostrados ao usuário;
- checklist: contraste AA, foco por teclado, estados além da cor, overflow, painéis em janelas menores;
- `DESIGN_SYSTEM.md` atualizado na mesma entrega (o que é implementado e o que é proposta);
- E2E verdes (seletores podem mudar se o texto ou a estrutura mudar de propósito; nunca esconder um teste que falha).

## Dívidas que a Fase 3 deve resolver ou decidir

Ver [DIVIDAS.md](DIVIDAS.md): #5 (polling no renderer → eventos), #13 (nome acessível dos controles dentro de `<label>`), #14 (corrida do rascunho do Chat), #22 (`.catch(() => {})` sem tratamento). Também: aplicar `font-code` de verdade no terminal e no CodeMirror, e respeitar `prefers-reduced-motion`.

## Lembretes

- Vocabulário fixo: Workspace, Projeto, Dot, Chat, Run, Tarefa.
- A UI só mostra capacidades reais; exploração e dados demonstrativos ficam marcados.
- Decisões vigentes de fluxo (`AGENTS.md`): projeto criado em modal só com nome, ícone e pasta raiz; nova conversa abre direto um chat vazio.
- Rodar os E2E com o PC livre (DIVIDAS #23).
