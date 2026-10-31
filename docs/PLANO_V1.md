# Plano — v1 usável

Combinado com o usuário em 2026-10-31 (decisão 26 em [PROGRESSO.md](PROGRESSO.md)). Objetivo: uma ferramenta bonita para ligar os agentes de CLI que a pessoa já usa (Claude, Codex e qualquer outro), conversar com eles e orquestrá-los. Agentes personalizados ("Dots" com papéis próprios, `dots.json`) ficam para depois e saem da vista do usuário.

Prioridade é ficar usável; polimento visual entra junto de cada item, não antes.

| # | Item | O que significa | Estado |
|---|---|---|---|
| 1 | **Agentes de CLI sem configuração** | O app acha sozinho as CLIs de agente instaladas (Claude Code, Codex e outras conhecidas) e permite adicionar qualquer outra pelo comando. O seletor do chat mostra essas CLIs + Terminal. `dots.json` vira opcional e avançado. | A fazer |
| 2 | **Chat de IA de ponta a ponta** | Nova conversa → escolhe a CLI → Enter manda (decisão 23) → resposta no terminal ao lado. Em projeto ou na pasta pessoal (decisão 25). | Em andamento: Terminal embutido (F3-B2) e Run na pasta pessoal (F3-B3) feitos; falta a tela (seletor + Enter) |
| 3 | **Projetos sem exigir Git** | Qualquer pasta vira projeto. Com Git: worktree, "Ver mudanças" e "Desfazer". Sem Git: roda direto na pasta, com aviso claro. | A fazer |
| 4 | **Onboarding** | Primeira abertura: mostra as CLIs encontradas, pergunta o nome e ajuda a criar o primeiro projeto. | A fazer |
| 5 | **Perfil** | Nome e foto, guardados só no PC (hoje já mostra o nome do sistema). | A fazer |
| 6 | **Kanban (Tarefas)** | Já existe; redesenhar na Direção A · Lua. | A fazer |
| 7 | **Orquestração** | Uma página bonita mostrando agentes trabalhando e passando trabalho entre si. Referências no `karont.pen`: image-7 (linha do tempo Orquestrador → agentes), image-10 (fluxo em nós) e image-6 (plano × real). Desenhar antes de implementar. | Por último |

Regras que continuam: o app nunca lê, guarda ou reutiliza credenciais das CLIs (o login é feito na própria CLI); worktree não é sandbox; Auto Resume desligado; UI só mostra o que é real.
