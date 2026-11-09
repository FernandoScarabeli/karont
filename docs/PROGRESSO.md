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

21. **Marcos refeitos** (2026-11-07), ver SPEC seção 8:
    - Agora são M0 a M14, com as ideias do dono (Dot, Memória, Equipe, Fluxo de trabalho, Em qualquer lugar, Comunidade, Modelos e segurança, Times).
    - **O instalador é o último marco (M14):** o dono quer lançar com tudo pronto, sem versão pública antes. Isso substitui a recomendação de lançar uma 0.1 cedo.
    - "Dot" volta para a interface (substitui parte da decisão 3); "Agente" continua sendo a CLI.
    - "Sem IA própria" continua: o Dot roda pelas CLIs, e modelos locais entram como opção no M12.
    - Importar de outras ferramentas (M11): só o que o usuário escolher, por ação explícita, nunca credenciais.
    - Acesso de outra máquina (M10): login próprio e seguro, sem abrir o serviço direto na internet.

22. **Executor do M3** (2026-11-08): subagentes **Claude Sonnet 5.5**, uma tarefa por vez, numa worktree própria. Substitui o Codex `gpt-6-luna` (decisão 10 e briefing original do M3) neste marco.

23. **Regras do M3** (aprovadas em 2026-11-08):
    - Ordem das tarefas: B1, F1, B3, F3, B2a, B2b, F2, B4a, B4b, F4 e fechamento. A fila vem antes do desfazer porque o ponto de restauração é criado quando a mensagem sai da fila.
    - Agente esperando permissão ou resposta ocupa vaga. Plano aguardando aprovação não ocupa, porque o turno já acabou.
    - Parar tira a mensagem da fila. Se o serviço reiniciar, ela fica interrompida, com "tentar de novo", e nunca roda sozinha.
    - Conversa solta em pasta Git também tem ver mudanças e desfazer. A pasta pessoal nunca tem, mesmo que seja um repositório.
    - Ficam os últimos 50 pontos de restauração por conversa, e apagar a conversa apaga os dela. Worktree só é removida com clique do usuário.
    - Os pontos aparecem como commits no `git log --all`; aceito.
    - Se o agente fez commit, desfazer volta os arquivos e o commit fica, com aviso antes.
    - Trazer de volta: as mudanças não commitadas viram commit na branch da própria worktree, e depois vem o merge, só com o clique.
    - Remover projeto não apaga a pasta, e as conversas dele viram soltas.

24. **Ícone do projeto em menu** (2026-11-08): o seletor de ícones abre a partir de um botão ao lado do nome, em vez de mostrar a grade inteira. Animação feita com a skill `animate`.

25. **Skill taste no M3** (2026-11-08): a skill `design-taste-frontend`, em `~/.agents/skills`, faz o papel da **taste** do `AGENTS.md`. Ela é voltada a sites, então as telas usam só a parte de telas de aplicativo (`references/app-screens.md`), sem nova direção visual.

26. **Plano do M4** (aprovado em 2026-11-09):
    - Ordem: B1 workspaces, F1 abas e sidebar, B2 resumo agregado, F2 tela do workspace e Início, B3 caixa de entrada, F3 tela da caixa, B4 busca, F4 Ctrl K e fechamento.
    - Conversa solta fica no workspace em que foi criada. Projetos e conversas que já existem vão para um workspace "Pessoal".
    - Caixa de entrada: item na sidebar com contagem, e a mesma lista no Início.
    - Direto na caixa: Permitir/Negar, responder pergunta, aprovar plano e tentar de novo. "Ajustar" um plano abre a conversa.
    - Busca: títulos, projetos e texto das mensagens.
    - Executor: subagentes Claude Sonnet 5.5, uma tarefa por vez, numa worktree própria, como no M3.
    - Tarefas e PRs nessas telas ficam para o M9, quando existirem de verdade.

27. **Sem aviso de "não usa Git"** (2026-11-09): o dono mandou tirar o aviso do chat, sem etiqueta nem faixa no lugar. Sem Git, "ver mudanças" e "desfazer" só não aparecem.
28. **Testes com agente real** (2026-11-09): usam o Codex `gpt-6-luna` em esforço `low`, para não gastar o limite do Claude. Se algo só puder ser testado no Claude real, perguntar antes.
29. **Telas do M4** (aprovadas em 2026-11-09): a tela do workspace aparece sem conversa aberta na aba, ou ao clicar de novo na aba em que já se está. Tem a linha do dia, o campo de mensagem com escolha de projeto e um cartão por projeto. O Início tem o que precisa de você e um cartão por workspace. "Nova conversa" abre limpa, sem cartões. Cartão de projeto abre conversa nova nele; cartão de workspace abre a aba.
30. **Sidebar e divisão** (aprovado em 2026-11-09): a sidebar tem largura ajustável e fecha deixando uma faixa com ícones de atalho, inspirada no Splitter de ui.productdevbook.com. Esse componente não está publicado no npm nem tem o código no GitHub, então o comportamento é feito com `react-resizable-panels`, já aprovada. "Dividir" abre sempre à direita, sem menu. O destaque ao arrastar um painel só aparece onde soltar muda o layout.

## M4 — estado
Branch `m4-navegacao`, a partir da `main` com o M3. Feito, nesta ordem: B1 (workspaces no serviço), F1 (abas e sidebar), F1b (ajustes do dono), B2 (resumo agregado), F2 (telas do workspace e do Início), B3 e F3 (caixa de entrada), B4 e F4 (busca), E2E dos fluxos, F5 (sidebar ajustável, faixa de ícones e divisão direta). Falta o PR.

Testes (2026-11-09):
- `npm run check`: contrato 40, serviço 348, desktop 41, interface 227, sem falhas. Build ok. E2E: 14 de 14.
- Teste real no Electron, em banco e pastas temporárias, com Codex 0.167.0 `gpt-6-luna`, esforço `low`: 11 de 11. Cobriu permissão aprovada pela caixa de entrada, arquivo criado, caixa vazia depois, busca, resumo, ponto de restauração, continuar a sessão e mover o projeto de workspace no meio do turno. O Claude real não foi testado, para não gastar o limite (decisão 28).

Medições:
- Migração da busca com 50 mil mensagens: 0,35 s. Busca: menos de 50 ms.
- App parado (build de produção, 30 s depois de dois turnos reais): serviço com CPU 0% e 33 MB (PSS); Electron com CPU 0,02% e 714 MB somando o working set (Browser 188, GPU 297, Utility 78, Tab 151). A soma conta memória compartilhada várias vezes e foi medida depois de uso, então não é comparável direto aos 622 MB do M3.

Notas técnicas:
- Painéis de workspaces visitados ficam montados e escondidos, para terminais e conversas não piscarem na troca de aba. Cada workspace visitado custa os assinantes de eventos dele.
- O F5 foi feito sem a skill taste; a tela foi conferida à mão pelo orquestrador.

## M3 — estado em 2026-11-08 (fim da noite, sem o dono)
Juntado na `main` em 2026-11-09 (PR #5, CI verde). Feito, nesta ordem: B1, F1, B3, F3, B2a, B2b, F2, B4a, B4b, F4.

Testes (`17ef182` e os docs):
- `npm run check`: contrato 38, serviço 312, desktop 41, interface 164, sem falhas. Build ok. E2E: 8 de 8.
- Teste real com as CLIs instaladas, em banco e pastas temporárias, nos modelos mais baratos (Claude Code 2.1.319 com Haiku; Codex 0.167.0 com `gpt-6-luna`, esforço `low`): 38 de 38. Cobriu criar, apagar, renomear e alterar arquivo; ver mudanças; desfazer sem mudar HEAD, stash e status; continuar a sessão; agente na cópia separada e continuar a sessão nela; ramo de conversa na cópia; trazer de volta; remover cópia; fila com limite 1.

Medições:
- Foto do ponto de restauração: ~40 ms num repositório real de 5,4 mil arquivos; ~100 ms em 50 mil arquivos. Não havia repositório muito maior na máquina; acima de 10 s a mensagem segue sem desfazer.
- App parado (Electron empacotado, 30 s depois de abrir): CPU ~0,1%. Serviço 41 MB (PSS). Soma do working set dos processos do Electron: 622 MB, com memória compartilhada contada várias vezes, então **não** é comparável aos ~340 MB de PSS do M2: o sandbox do Chromium impede ler o PSS dos processos filhos.

Decisões técnicas que valem lembrar:
- Vagas da fila são derivadas do estado das conversas, sem contador: nenhum caminho de saída prende vaga.
- A cópia do index temporário mantém o horário do original. Sem isso, o Git deixa passar uma edição de mesmo tamanho feita no mesmo instante ("racy git") e a foto sai errada.
- O desfazer grava o estado atual em `refs/karont/restore/<conversa>/<mensagem>/undo` antes de tocar em qualquer arquivo.
- Aprovar um plano não entra na fila, porque o processo já está aberto. Pode passar do limite por um momento.
- O `<dialog>` modal deixa o resto da página inerte: popover em portal abre atrás dele. Dentro de diálogo, use painel no próprio diálogo.
- Cópias separadas ficam em `<dataDir>/worktrees`, com branch `karont/<projeto>-<6 hex>`.

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

### Rodada de 2026-11-01 (noite) → 2026-11-02 — também já na `m2-chat`
- F38: ações da mensagem **só com ícone** (tooltip + `aria-label`): usuário = Copiar, Editar; agente = Copiar, Tentar de novo (só na última resposta, agente parado), **Criar branch**, Linha do tempo. "Criar branch" = **ramificar a conversa** (opção A do dono): `conversation.branch({ id, messageId })`, conversa nova "<título> · ramo" com histórico até o ponto, abre em painel. Fork nativo: Claude `--resume <id> --fork-session` (só a última resposta); Codex `thread/fork` com `lastTurnId` (qualquer turno). Resposta antiga do Claude → sessão nova com o histórico como contexto + aviso discreto. Testado com Codex real: o ramo lembrou do contexto.
- F40: ícones de ação quadrados (28 px), sem passar da borda.
- B12/B13: subagente do Codex pelo protocolo **real**: `subAgentActivity` (`started`/`completed`, `agentThreadId`, `agentPath`) + itens da thread filha (`params.threadId`) aninhados por `parentId`; `wait` sem receptores não vira linha. Fixture real sanitizado `fixtures/codex/subagente-real.jsonl`. Testado com Codex real.
- F39: raio (modo rápido) no composer; Codex manda `serviceTier` (tier anunciado pelo `model/list`, ex. `priority`) por turno.

## Estado ao fim da sessão (2026-11-02, noite) — LEIA ISTO PRIMEIRO
- **2026-11-02 (tarde, 2ª parte):** 3ª revisão de código (`/code-review high` de `7bb851d..`) → 10 achados, todos confirmados com teste e corrigidos pelo Codex em **B18.01–B18.10** (fonte com URL > 2048 travava a conversa; retry de compactação mandava "/compactar"; retry perdia skills — agora salvas na parte de texto; anel de contexto após compactar; `$skill,` com pontuação; enviar antes do catálogo carregar; `$nome` duplicado no prompt; catálogo de skills com promessa compartilhada e TTL de 5 min; corrida fontes × coalescedor; `pipeline` no preview) + **B18.11** (a CLI real manda `compact_metadata.post_tokens`, snake_case; fixtures trocadas pela saída real). check + build + E2E 4/4 e testado com CLIs reais no preview de produção: compactar no Claude (33 mil → 7,3 mil), `$eco-teste, banana azul` no Claude e no Codex. **PR #3 juntado na `main`.** Pendência pequena: no Codex, tirar `$nome` deixa a pontuação seguinte (", banana azul").
- O reboot apagou `/tmp/karont-teste-grande` (recriado vazio com README e uma skill `eco-teste` em `.claude/skills`, `.agents/skills`, `.codex/skills`). Worktrees novas: depois do `npm ci`, apagar `node_modules/electron/dist/chrome-sandbox` para o E2E usar o `CHROME_DEVEL_SANDBOX`.
- Nada rodando. O PC do dono foi reiniciado: para mostrar, rode `npm run preview:web:prod` (modo produção, mede o que o app real faz; build em `packages/ui/dist-preview`) ou `npm run preview:web` (dev). Ambos em http://127.0.0.1:5173/. Depois de mudar o serviço ou a UI, reinicie o preview (`kill $(pgrep -f '^node src/preview/main.ts')` — cuidado: um `pkill -f` com esse texto no próprio comando mata o seu shell).
- **Meça desempenho sempre no preview de produção** (React dev é muito mais lento). Scripts de medição usados (troca de conversa quadro a quadro, long tasks, rolagem): em `~/karont-worktrees/m2-f47d-troca-sem-vazio-ref/medir-troca.mjs` e `~/karont-worktrees/m2-p1-desempenho-ref/repro-rolagem.mjs` (copie para a raiz como `.x.mjs` para rodar e apague depois).
- Executor: Codex `gpt-6-luna` xhigh fast, uma worktree por tarefa (`~/karont-worktrees/<tarefa>` + `<tarefa>-ref` com `tarefa.md`/`resposta.md`/`codex.log`). Fila sequencial funcionou com `fila.sh` (ver `m2-b15-revisao-ref`). Se o Codex estourar o limite: subagente Haiku com as mesmas regras.
- Regras novas do dono (memória): Claude/Codex são só os primeiros agentes — **todo recurso por capacidade do adaptador** (`agent.capabilities`), sem `if (agent === …)` na UI; tela provisória **só** quando o visual não está decidido e há mais de uma opção.
- Pendências: ~50 ms parados entre o clique numa conversa e a troca; cada bloco de mensagens antigas carregado ao rolar gera long task de 50–90 ms; bundle inicial > 500 kB; aviso do PostCSS (`from`); a lista de modelos do Claude leva alguns segundos na 1ª vez; apagar conversa não fecha o painel dela em outra janela. Conversa "Teste de desempenho (pode apagar)" (300 mensagens) serve para medir. Worktrees antigas em `~/karont-worktrees/` podem ser limpas.

- Rodada da noite (dono dormindo, autorizou fazer tudo):
  - **1ª revisão de código** do PR (10 achados) → **B15.01–B15.10**, um por commit, cada um reproduzido com teste antes de corrigir: acesso do Codex ao continuar (resume leva `sandbox`/`approvalPolicy`), abrir conversa no meio da resposta (`get()` usa a mensagem em memória + `startOffset` nos deltas), `truncateUtf8` O(n), fork do Claude só conclui com id novo, Parar durante a abertura/plano pendente, retry com anexos (bytes em memória, limite 3 conversas/25 MB), erro na abertura não desfaz renomear/fixar, pasta apagada tem erro próprio, conversa apagada não volta (`conversation.removed`), linha do Claude até 32 MiB (imagem vira "imagem, N kB").
  - **F42:** tooltips no modelo do esforço em anexar, agente, modelo, raio, opções e enviar/parar (componente `components/Tooltip`).
  - **B15.11:** lista real de modelos do Claude via `initialize` (`response.models`): Opus 5.5 (marcado "Padrão"), Sonnet 5.5, Fable 5.1, Haiku 5.5, Haiku 4.5, Sonnet 5, Opus 5, Fable 5, Opus 4.8/4.7/4.6, Sonnet 4.6… Esforço por modelo. Raio continua desligado no Claude. Reserva fixa se a CLI falhar.
  - **2ª revisão** (sobre a B15) → **B16**: processo órfão ao parar durante a abertura, nada é salvo sozinho na troca de modelo, modelo desconhecido é preservado, `opus` não vira `default`, **sem `sandboxPolicy` no `turn/start`** (respeita a config do Codex do usuário; a troca de acesso vai pelo `thread/resume`), fork via `result`, `setOptions` sem mudança não mata a sessão, `#emit` sem SQLite por evento, esforços do contrato.
  - Testado com CLIs reais no preview: lista de modelos do Claude, mensagem no Claude (Haiku) e no Codex, e Codex em "Só ler" depois de trocar o modo recusando criar arquivo.
- **Rodada de 2026-11-02 (tarde), já na `m2-chat`:** F42–F43 tooltips (inclusive esforço e ações da mensagem); F44 protótipo → F45 histórico de mensagens no composer (variante A: balões à direita, fundo borrado, uma linha com "…", alinhado ao composer, abre nas mais recentes); 15 px entre texto e ícones de ação; F46 blocos até 50 linhas sem rolagem aninhada, abrir/fechar com transição e chevron, conteúdo mantido após abrir; B17/B17b serviço dos atalhos (`composer.files`, `composer.skills`, `conversation.compact`, `agent.capabilities` — **tudo por capacidade do adaptador**, pronto para outros agentes/APIs).
- **Desempenho (P1–P1f), medido no preview de produção** (`npm run preview:web:prod`; conversa de teste com 300 mensagens): abrir 1,4 s → **sem long task**; focar campo/abrir bloco/menu 50–170 ms → **~10 ms**; mensagens paginadas (20 iniciais, blocos de 10 ao rolar, ancoragem nativa `overflow-anchor` sem pulos); Sidebar e `ActionMenu` sem re-render por foco. Resta: cada bloco carregado ao rolar gera long task de 50–90 ms. **Meça sempre no preview de produção** (o dev do React é muito mais lento).
- **Fim da tarde de 2026-11-02, já na `m2-chat`:** F48 atalhos no composer (`@` arquivos, `$` skills, `/` comandos do Karont; placeholder "Pergunte qualquer coisa · @ arquivos, $ skills, / comandos"; tudo por `agent.capabilities`); F47d troca de conversa sem quadro vazio (painel não remonta por `key`; composer pelo índice; mensagens anteriores esmaecidas até as novas) — **o blur (F47–F47c) foi revertido** porque piorava a troca; F49 citações inline (selo com inicial + nome do link, "LogRocket +1", cartão em portal com ‹ › 1/N, metadados das buscas no adaptador); F50 uso de contexto (anel ao lado do histórico, tooltip "Contexto: 3% · 32,9 mil de 1 mi tokens", popover com Compactar; Claude `modelUsage.contextWindow`, Codex `thread/tokenUsage/updated`). Tudo testado com CLIs reais no preview de produção.
- Pendências novas: ~50 ms entre o clique numa conversa e a troca; cada bloco de mensagens antigas carregado ao rolar gera long task de 50–90 ms; conversa "Teste de desempenho (pode apagar)" (300 mensagens) serve para medir.
- Pendências pequenas: bundle inicial > 500 kB; aviso do PostCSS (`from`); a lista do Claude leva alguns segundos na 1ª vez (até lá aparece o id cru, ex. "haiku"); fechar painéis de outra janela quando chega `conversation.removed` (precisa mexer em `NavigationContext`).
- Executor: Codex `gpt-6-luna` xhigh fast (fila sequencial com `fila.sh` em `~/karont-worktrees/m2-b15-revisao-ref/` funcionou bem). Se estourar, subagente Haiku.
- Testes reais: projeto de teste em `/tmp/karont-teste-grande`. Scripts Playwright temporários `.x.mjs` na raiz (apagar depois).

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
