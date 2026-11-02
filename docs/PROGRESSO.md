# Progresso

Repositório recriado do zero em 2026-10-31.

## Estado
- **M0 (esqueleto)** — concluído e na `main` (PR #1, 2026-10-31).
- **M1 (agentes)** — concluído na branch `m1-agentes`; PR aberto para a `main` (2026-10-31).
  - [x] B1 Detecção de agentes + CLIs do usuário (serviço e contrato)
  - [x] B2 Terminal no serviço (`node-pty`, eventos com backpressure, sobrevive à janela)
  - [x] F1 Configurações › Agentes (lista, detectar de novo, adicionar/remover CLI)
  - [x] F2 Nova conversa com seletor (agentes "em breve" + Terminal) e Terminal na interface (xterm)
  - [x] B3 Fechar a janela: perguntar / segundo plano (bandeja) / fechar tudo
  - [x] F3 Configurações › Geral ("Ao fechar a janela")
  - [x] B4 Escolher pasta (diálogo nativo), pastas recentes, terminal com comando inicial
  - [x] F4 Campo de mensagem único (composer) + botão de pasta + cabeçalho do terminal
  - [x] F5 Conversas lado a lado (dividir, redimensionar, arrastar para os cantos, layout salvo)
  - [x] Fonte de títulos: **Sora** no lugar da Instrument Serif (entra no F4)
  - [x] F6 Ajustes do dono (pasta direto no seletor do sistema, "Vamos trabalhar", sem textos de ajuda, ícones das CLIs)
  - [x] B6 Correções da revisão de código (cliente lento, fechar tudo, limite de terminais, homeDir, detecção, open mais rápido)
  - [x] F7 Correções da revisão na interface (resize, resync/replay, foco ao encerrar, homeDir)
  - [x] E2E + PR (orquestrador)

## Decisões do dono

1. Recomeçar do zero, sem histórico (2026-10-31).
2. Licença MIT, repositório público.
3. Chat de verdade (resposta da IA no chat, não no terminal); agente trabalha direto na pasta, com desfazer pelo Git; "Agente" no lugar de "Dot"; banco novo; ponte feita para streaming; markdown seguro (dependência a aprovar no M2).
4. Referências visuais ficam fora do repositório (`karont.pen` do dono, no pen.dev).
5. Plano do M0 aprovado (2026-10-31), com estas escolhas:
   - CSS Modules para escopo (já vem no Vite).
   - Fonte Geist via `@fontsource/geist-sans` e `@fontsource/geist-mono` (arquivos locais, sem rede).
   - Build: Vite para interface, preload e main; `tsc` só para checagem de tipos; sem `electron-vite`; empacotador só no M7.
   - Banco no M0: só mecanismo de migrações + tabela `settings`; demais tabelas nos marcos que usarem.

6. `lucide-react` aprovado para ícones (2026-10-31). Motivo: o design do `karont.pen` já usa os ícones Lucide; são SVGs locais.
7. Fonte não fica presa só à Geist: pode haver uma segunda fonte (ex.: títulos/marca), escolhida pelo dono (2026-10-31).
8. Cor de marca: o padrão é o **marfim** (`#F3EEE3`, "branco papel"), e a pessoa escolhe outra cor de destaque numa lista pronta (aprovado em 2026-10-31). Lista: marfim `#F3EEE3`, magenta `#FF4F8B`, turquesa `#2DD4C4`, lima `#C6F135`, azul elétrico `#5B8CFF`, coral `#FF7A59` (todas com contraste AA com texto `#0F0F10` e sobre o fundo). A escolha fica salva em `settings` e a tela entra no M5. No M0 basta o token `--k-color-brand` ser único e trocável. Estados nunca dependem só da cor (sempre texto ou ícone junto).
9. Segunda fonte: **Sora** na marca e nos títulos grandes; o resto em Geist (escolhida em 2026-10-31, no lugar da Instrument Serif, que o dono não gostou). Dependência `@fontsource-variable/sora` aprovada; `@fontsource/instrument-serif` removida.

10. Fluxo de trabalho: o orquestrador só coordena; todo código é feito pelo Codex `gpt-6-luna` em `xhigh` (2026-10-31).
11. `main` protegida: só por PR com o CI "Checagens e testes" verde; sem force push nem exclusão; vale para admins (2026-10-31).

12. Fluxos do M1 aprovados (2026-10-31):
    - Engrenagem → **Configurações**, começando pela seção **Agentes** (lista ✓/✗, detectar de novo, adicionar/remover CLI). Outras seções virão.
    - Não há botão "Novo terminal": **"Nova conversa" abre com um seletor** de agentes (Claude Code, Codex, Gemini…) **ou Terminal**. No M1 só o Terminal funciona; os agentes aparecem como "em breve" até o M2.
    - **Fechar a janela pergunta**: "Fechar tudo" (encerra agentes, terminais e o serviço) ou "Deixar rodando em segundo plano" (esconde a janela, fica um ícone na bandeja). Caixa "Lembrar minha escolha"; dá para mudar nas Configurações.
    - Terminais vivem no serviço: com o app em segundo plano ou a janela reaberta, o terminal continua e mostra as últimas linhas.
    - `@xterm/addon-fit` aprovado (ajusta o terminal ao tamanho da área).

13. Tarefas de front: o Codex usa a skill **taste** para construir; a revisão com a skill **unslop** é feita pelo orquestrador (o Codex não tem essa skill) e volta como correção para o Codex aplicar (2026-10-31). Regra em `AGENTS.md`.

14. Pedidos do dono antes do PR do M1 (2026-10-31):
    - **Instrument Serif sai** (o dono não gostou); nova fonte de títulos a escolher numa página de comparação.
    - **Campo de mensagem único** para tudo (agentes e Terminal), no estilo das referências: texto em cima; embaixo à esquerda seletor + pasta; à direita enviar redondo marfim. No Terminal o texto é um comando opcional que roda ao abrir. Sem botões que ainda não funcionam (microfone, anexar ficam para quando funcionarem; anexar no M2).
    - **Botão de pasta** abre o seletor de pastas nativo do sistema; o app lembra as pastas recentes. Arquivos entram pelo "anexar" no M2.
    - **Cabeçalho do terminal** redesenhado.
    - **Conversas lado a lado**: botão "Dividir"; divisórias arrastáveis; arrastar uma conversa para um canto reorganiza a tela; layout salvo. Feito já no M1 com terminais. Dependência `react-resizable-panels` aprovada.

15. Codex sempre no **modo rápido** (`-c service_tier="fast"`), pedido do dono (2026-10-31).

16. Painéis, depois de ver a tela (2026-10-31): sem menu "⋯" no cabeçalho; "Encerrar terminal" vira um `X` no item da sidebar (no hover/foco); o `X` do painel só fecha o painel; mover painel por teclado com `Ctrl+Alt+Shift+setas`. O "Rodando" sai do cabeçalho; a bolinha de status fica ao lado do item na sidebar (cinza = terminal rodando; azul fica para agente trabalhando no M2).

17. Ajustes do dono antes do PR do M1 (2026-10-31): o botão de pasta abre **direto** o seletor de pastas do sistema (sem menu); a Nova conversa ganha uma frase grande ("Vamos trabalhar"); placeholder do Terminal "Digite seu comando"; **sem textos de ajuda** embaixo do campo (nada de "Enter abre…"); ícones reais das CLIs (devicons, MIT) no seletor e nas Configurações. Para depois: placeholder com frases engraçadas que vão trocando ("faz meu café", "domine o mundo").

18. M2 é **chat interativo completo** (2026-10-31): permissão de comando no chat (Permitir / Sempre nesta conversa / Negar), perguntas do agente com opções, plano para aprovar, lista de tarefas ao vivo, linha do tempo dos passos. Claude por processo aberto com `stream-json` + `--permission-prompts host`; Codex por `codex app-server`. Modos: Só leitura / Pode editar (comandos pedem permissão) / Liberado. Composer no estilo da referência do dono (agente/modelo, esforço, acesso, anexar, enviar; faixa embaixo com pasta e branch). Referências de interface: agent-elements.21st.dev, fluidfunctionalism.com, kobra.systems (trace-waterfall). Dependências `react-markdown`, `remark-gfm`, `rehype-highlight` aprovadas. Fixtures gravados com o modelo mais barato (Haiku / menor do Codex).

19. **Leveza é requisito** (2026-10-31): o app não pode comer RAM nem CPU. Toda tarefa do M2 em diante leva critério de desempenho (lista virtualizada em conversas longas, deltas agrupados, nada de re-render por token, processos das CLIs encerrados quando ociosos, sem polling). O orquestrador mede RAM/CPU no fim de cada marco.

20. **Planejar** (decisão do orquestrador na ausência do dono, 2026-10-31, revisável): botão "Planejar" no composer. Com ele ligado, o agente só planeja (Claude `plan`, Codex `collaborationMode: plan`); o cartão de plano tem Aprovar (executa no modo de acesso escolhido) e Ajustar.

## M2 — estado em 2026-10-31 (fim da sessão sem o dono)
Branch `m2-chat` (sem PR). Feito e testado com as CLIs reais no preview (Haiku / GPT-5.6-Luna):
- Chat com Claude Code (processo aberto, `stream-json`, `--permission-prompts host --permission-prompt-tool stdio`) e Codex (`codex app-server --stdio`).
- Texto ao vivo com markdown, ações, cartões de permissão (Permitir / Sempre / Negar), pergunta com opções, plano (botão Planejar, Aprovar/Ajustar), tarefas, erro com tentar de novo, Parar, continuar sessão.
- Composer: agente, modelo (lista real do Codex), esforço por modelo, acesso, Planejar.
- Linha do tempo em cascata com horários reais por parte.
- Leveza: app parado ≈ 340 MB de memória real (PSS, janela + serviço + preview), CPU ≈ 0%.
- Fixtures reais em `packages/service/src/agents/fixtures/` e protocolo em `PROTOCOLO.md`.

## M2 — estado em 2026-11-01 (com o dono)
Branch `m2-chat` (sem PR; o dono testa no preview antes de juntar na `main`). Depois do estado anterior, entrou:
- Cartões do Codex (permissão, pergunta, plano) testados de verdade na tela. Corrigido: resposta de pergunta não chegava (chave por índice) e "Pode editar" do Codex agora usa `approvalPolicy: untrusted`.
- Anexos (botão, colar, arrastar; imagem até 5 MB, texto até 200 kB; só metadados no banco), branch do Git na faixa (`folders.gitInfo`), links abrem no navegador (`openExternal` validado no main).
- Planejar lembrado por conversa (migração v7).
- Leveza do streaming: markdown em blocos memorizados, deltas a cada 64 ms; aba da UI 12–20% de CPU numa resposta de ~14 mil caracteres (antes 60–110%), serviço ~1–2% e 52 MB. Bundle inicial 464 kB (terminal e realce sob demanda).
- UX: títulos automáticos (CLI do agente, modelo barato, em segundo plano; renomear com duplo clique), ações resumidas ("Leu 3 arquivos"; comando completo atrás de um botão; cartões de permissão mostram o comando inteiro), faixa pasta/branch mais estreita que o composer, saudação por horário com nome (`system.userName` + "Como te chamar" nas Configurações), placeholder digitando frases engraçadas (`TextType` próprio, sem gsap).

### Rodada de UI/UX (2026-11-01, tarde) — já na `m2-chat`
- **Barra do composer (F9):** agente sem pílula; modelo sem "Padrão", lembrado por agente (`composer.<agente>.model`), é o que de fato é enviado; esforço = ícone `Gauge` do Lucide cujo ponteiro gira, **clique avança o nível** (setas também), etiqueta "Esforço: X" some sozinha; botão de opções (`SlidersHorizontal`) com Acesso (**Só ler / Pedir antes / Acesso total**) e Planejar (switch), selos "Planejar"/"Acesso total" quando ativos. Salvamento otimista (nada pisca). Composer mais baixo (textarea mín. 40px).
- **Lista de conversas (F10):** ⋯ no hover/foco e botão direito: Fixar, Renomear (inline), Abrir ao lado, Arquivar, Apagar (com confirmação). Grupos "Fixadas"/"Recentes"; "Ver arquivadas" no ⋯ do cabeçalho (⋯ à esquerda do `+`). Migração v9 (`pinned_at`, `archived_at`), `conversation.setPinned`/`setArchived`, `list({ archived })`. Scrollbar própria (`components/ScrollArea`, 12px no Chromium, `auto` no Firefox, `scrollbar-gutter: stable`, colada na borda da sidebar). Área de trabalho sem moldura (canto reto, uma linha só). Corrigido `Dialog` que roubava o foco na montagem.
- **Status na sidebar (F11):** bolinha antes do ⋯: verde = resposta não vista, amarelo pulsando (2,4 s) = trabalhando, laranja-avermelhado = precisa de você, vazada = erro. Migração v10 (`unread_at`), `conversation.markSeen`. Status saiu do cabeçalho da conversa.
- **Erros legíveis (F12):** `describeAgentError` no contrato (filtro de conteúdo, limite, sobrecarga, contexto longo, login, rede); parte `error` ganhou `details` (cru) atrás de "Ver detalhes".
- **Opções da mensagem por clique (F15):** nada aparece sob as mensagens por padrão; um clique na mensagem mostra copiar/editar/tentar de novo e a **Linha do tempo**; Esc/clique fora fecha; seleção de texto e links não abrem.
- A vitrine `#chat` (F13/F14) foi criada e **removida** a pedido do dono.
- **Clique na mensagem (F17/F19):** sem moldura nem fundo ao abrir (foco visível só no teclado). Mensagem do usuário: data e hora em cima do balão, Copiar/Editar embaixo; "Reenviar" removido. Resposta do agente: data embaixo, acima das ações. Data e ícones alinhados à borda.
- **Trocar de conversa sem piscar (F18):** caches pequenos em memória (`conversationCache.ts`: 20 conversas, modelos por agente, branch por pasta) mostram o último dado na hora e atualizam por trás; composer e faixa com a forma final enquanto carrega; "Carregando…" só após 300 ms. Medido quadro a quadro: nenhum quadro sem controles.
- **Data e espaço (F21):** formato "17:14 · 1 de nov." (ano só se for outro); data em cima também na resposta do agente; espaço da data e das ações sempre reservado (abrir só faz fade, nada se move; só a Linha do tempo empurra).
- **"Trabalhando" versão C (F20 protótipo → F22):** pontinhos 3×3 em espiral + frase do passo com shimmer (Pensando, Lendo X, Lendo N arquivos, Rodando X, Respondendo, Trabalhando, Parando) + linha do raciocínio + chips dos arquivos; fica logo abaixo da resposta que está chegando; some em `waiting`. Tela provisória `#trabalhando` apagada. Testado com Claude Haiku real.
- **Conversa no estilo Agent Elements (F23 protótipo → F24):** linhas de ferramenta com ícone, sem caixa; resposta terminada recolhida em "Trabalhou por X ›" (só a resposta final visível; erro e pendências sempre fora); indicador = espiral + frase com shimmer (substituiu a versão C). Referência MIT reescrita no nosso padrão, sem dependência nova.
- **Dados das ferramentas (B9/B10):** `actionType` ganhou `subagent`, `mcp`, `image`; campos opcionais `parentId`, `server`, `tool`. Claude Edit/MultiEdit/Write geram diff unificado no formato do Codex, com números de linha reais e 3 linhas de contexto (o serviço lê o arquivo na hora do `tool_use`; sem posição → diff sem `@@`). Fixtures de subagente/MCP/imagem são construídos (não gravados): falta testar com CLIs reais.
- **Ajustes (F25–F27):** opções da mensagem voltaram para o hover (espaço reservado); conversa mais junta; composer ajustado ao conteúdo; história aberta sem caixa; painel de diff com números de linha, cores e realce (sem copiar/baixar, a pedido do dono). Diff do Claude conferido com edição real.
- **Mais ajustes (F28–F35, 2026-11-01 noite):** painéis de ferramenta sem caixa própria; "Apagar todas as conversas" em Configurações › Geral › Dados (`conversation.count`/`deleteAll`, para agentes antes, não apaga terminais); saída de comando com cara de terminal (prompt `$`, "saída N · duração", cores ANSI com parser próprio); **fluid hover** (destaque único que desliza, mola em CSS `linear()`, sem `motion`) em sidebar, menus e Configurações; **texto em máquina de escrever** (letra a letra, ~220 car/s adaptativo, cursor de bloco; só na última parte de texto em andamento; rolagem acompanha no mesmo quadro e só para por ação do usuário). Medido com Claude real: 60 fps sem quadros longos, rolagem 100% colada.
- **Executor:** o Codex estourou o limite na noite de 2026-11-01; o dono mandou usar subagente Haiku até voltar.
- **F36/B11/F37:** tokens de movimento (`--k-motion-fast/moderate/slow` + `-exit`, molas em `linear()`, `styles/motion.ts`) aplicados no app todo; subagente do Claude 2.1.x se chama **`Agent`** (não `Task`) e agora vira `subagent` com os passos filhos (`parent_tool_use_id`) aninhados — fixture real sanitizada `subagente-agent.jsonl`; MCP conferido com Claude real (`pencil · get_style`); "Trabalhou por X" agora recebe `startedAt/endedAt` ao vivo (`conversation.stateChanged`). Codex ainda sem teste real de subagente/MCP (limite). E2E teve 1 falha intermitente numa rodada (23 s), passou na seguinte: observar.

### Decisões do dono nesta rodada
- Sem letras de atalho de teclado nos menus.
- Odeia cartões com faixa/borda colorida lateral (ex.: cartão de erro atual). Ainda **não escolheu** o novo modelo de erro; os 4 propostos foram: (1) inline sem cartão, (2) nota neutra com título, (3) rodapé com separador fino e ações à direita, (4) caixinha compacta de uma linha com botões de ícone e frase só nos detalhes.
- Quer protótipo visual (tela provisória) antes de implementar mudanças grandes de visual.

### Próximo (pedido do dono)
- Redesenho da conversa com refs que ele vai mandar (o "Trabalhando…" atual é feio).
- Trazer o que falta, usando como **referência** os componentes do Agent Elements (https://agent-elements.21st.dev, MIT; são Tailwind + várias libs, então **reescrever no nosso padrão, sem dependência nova**): edição com diff, subagente (Task do Claude), ferramenta MCP, "Trabalhando…" com shimmer, sugestões. Antes, conferir que dados os adaptadores já gravam de cada ferramenta.
- **Levantamento dos dados (feito em 2026-11-01)** — o que os adaptadores já gravam em `action` (`input` ≤ 8 kB, `output` ≤ 64 kB):
  - **Diff de edição.** Claude: `Edit`/`Write` guardam **só o caminho** (`summarizeInput` descarta `old_string`/`new_string`/`content`); `MultiEdit` cai em `other`. Precisa mudar o serviço para guardar a edição estruturada. Codex: `fileChange` guarda em `output` o JSON de `changes` com `diff` (unificado) por arquivo (`FileUpdateChange { path, kind, diff }`) → **dá para mostrar diff já**, só a UI.
  - **Subagente.** Claude `Task` → `other` (título "Task · …", input = `description`); chamadas internas do subagente não são agrupadas. Codex `collabAgentToolCall` → `other` com o item cru em JSON. Precisa `actionType` novo e agrupamento.
  - **MCP.** Claude `mcp__<servidor>__<ferramenta>` → `other`, input só com os nomes dos parâmetros ("Parâmetros: a, b"). Codex `mcpToolCall` → `other`, título = `item.tool`, input = item cru. Precisa `actionType: "mcp"` com servidor, ferramenta e parâmetros.
  - **Geração de imagem.** Codex tem `imageGeneration` (com `savedPath`, `revisedPrompt`) e hoje cai em `other` sem mostrar a imagem. Dá para exibir a imagem gerada (ler o arquivo pelo serviço, com validação de caminho).
  - **"Trabalhando…" com shimmer.** Só UI, não depende de dados.
- Pendências pequenas: bundle inicial ~508 kB (passou de 500); aviso do PostCSS no build (`from` não passado, provavelmente o `composes` do ScrollArea).

## Notas técnicas
- Pacotes: `packages/contract`, `packages/service`, `packages/desktop`, `packages/ui`. Versões fixas (sem `^`).
- Node 24 roda `.ts` direto (type stripping): testes e serviço em dev rodam sem build. Por isso o TS usa `erasableSyntaxOnly` (sem `enum`/`namespace`) e imports com extensão `.ts`.
- TypeScript 7.0.2 (compilador nativo).
- Electron 45.2.1 traz Node 24.22.1 com `node:sqlite`: o serviço pode rodar como `ELECTRON_RUN_AS_NODE=1` no app empacotado.
- Tokens de cor vêm da "Direção A · Lua" do `karont.pen`. Só `--k-color-danger` (`#EF7B73`) não estava no design: proposta do orquestrador, ajustável.
- Biome usa `"preset": "recommended"` (o `biome migrate` tinha trocado para `none`, o que desliga as regras).
- Codex: `.claude/settings.local.json` libera `codex exec` sem pedir permissão (dono pediu "libera o codex"). Tarefas: uma worktree por tarefa em `~/karont-worktrees/<tarefa>` + `<tarefa>-ref/` (tarefa.md, resposta.md, codex.log); seguimento com `codex exec ... resume <SID>`.
- Preview web: `npm run preview:web` na raiz → http://127.0.0.1:5173/. Reaproveita um serviço já rodando; se não houver, inicia um em modo dev (`KARONT_DEV=1`) e o encerra ao sair. Depois de mudar o serviço, reinicie o preview (`kill $(pgrep -f '^node src/preview/main.ts')` e rode de novo). Testes de tela: scripts Playwright temporários na raiz (`.x.mjs`, apagar depois), Claude com Haiku.
- Rodar o app: `npm run start:desktop` (com `CHROME_DEVEL_SANDBOX=/usr/local/lib/karont-dev/chrome-sandbox`). E2E: `npm run test:e2e` (mesma variável). Rodada completa local: ~6 s de checagens + ~2 s de E2E.
- O E2E usa `chromiumSandbox: true`: o Playwright passa `--no-sandbox` ao Electron por padrão.
- O serviço destacado é iniciado por um `bash` mínimo que fecha os descritores herdados acima de 2. O Chromium deixa caches da GPU e sockets internos sem CLOEXEC, e o serviço os seguraria por horas (isso também travava o `app.close()` do Playwright).
- `node-pty` 1.1.0 usa N-API: o mesmo binário roda no Node 24 e no Electron (`ELECTRON_RUN_AS_NODE`). O npm 12 bloqueia scripts de instalação; `node-pty` está liberado em `allowScripts` no `package.json` da raiz (precisa de python3, make e g++).
- Terminal e CSP: o xterm 6 injeta `<style>` (Viewport, DomRenderer) e um `setAttribute("style")`. Com `style-src 'self'` isso é bloqueado. `packages/ui/src/terminal/cspStyles.ts` desvia esses estilos para `adoptedStyleSheets` (não passam pelo `style-src`) sem afrouxar a CSP. Validado no Electron: zero violações. Ao atualizar o xterm, refazer essa checagem.
