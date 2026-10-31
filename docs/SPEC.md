# Karont — Especificação do v1

Versão 1.0 · 2026-10-31 · Aprovada pelo dono do projeto (Fernando Scarabeli) para começar do zero.

Esta spec substitui tudo o que existiu antes. Não há código, decisão ou documento anterior que valha: o repositório foi recriado sem histórico. Onde esta spec não decidir algo, quem implementa propõe e o dono aprova.

## 1. O produto em uma frase

Um app de desktop, bonito e open source, para **conversar com os agentes de IA de linha de comando que você já usa** (Claude Code, Codex e outros), **ver o que eles fazem nos seus projetos** e, mais adiante, **orquestrar vários deles ao mesmo tempo**.

O app não tem IA própria e não guarda credenciais: ele roda as CLIs que já estão instaladas e logadas no computador.

## 2. Para quem

Uma pessoa desenvolvedora que já usa Claude Code e/ou Codex no terminal e quer:
- uma interface de chat de verdade (como o app do ChatGPT ou do Claude), em vez do terminal;
- organizar conversas por projeto e por área (workspace);
- deixar mais de um agente trabalhando e acompanhar tudo num lugar só.

Plataforma do v1: **Linux** (desenvolvido no Ubuntu). macOS e Windows ficam para depois; não fazer nada que impeça portar.

Idioma da interface no v1: **português do Brasil**. Código, identificadores e mensagens de commit em inglês; textos de interface em pt-BR, centralizados para permitir tradução depois.

## 3. Conceitos (vocabulário fixo)

| Termo         | O que é                                                                                                                             |
| ------------- | ----------------------------------------------------------------------------------------------------------------------------------- |
| **Agente**    | Uma CLI de IA instalada no computador (Claude Code, Codex, Gemini CLI…). Detectada sozinha ou adicionada pelo usuário pelo comando. |
| **Terminal**  | Um shell comum do usuário, sem IA. Também aparece no seletor.                                                                       |
| **Workspace** | Uma área que agrupa projetos (ex.: Pessoal, Trabalho). Aparece como aba no topo.                                                    |
| **Projeto**   | Uma pasta do computador. Com Git ganha "ver mudanças" e "desfazer".                                                                 |
| **Conversa**  | Um chat com um agente, dentro de um projeto ou solta (na pasta pessoal).                                                            |
| **Mensagem**  | Do usuário ou do agente. A do agente tem partes: texto, ações (leu arquivo, editou, rodou comando) e erros.                         |
| **Tarefa**    | Item do quadro (A fazer, Em andamento, Revisão, Feito).                                                                             |

Não usar outros nomes para essas coisas na interface ("Dot", "Run", "sessão" etc. não aparecem para o usuário).

## 4. Fluxos do v1

### 4.1 Primeira abertura (onboarding)

1. Tela de boas-vindas curta.
2. **Agentes encontrados:** lista as CLIs detectadas ("Claude Code ✓", "Codex ✓", outras ✗) e permite "Adicionar outra CLI" (nome + comando). Explica, em uma linha, que o login é feito na própria CLI.
3. **Você:** nome (vem preenchido com o nome do sistema) e foto opcional (arquivo local).
4. **Primeiro projeto:** escolher uma pasta, ou "Pular e conversar na pasta pessoal".
5. Termina numa conversa nova, com o agente escolhido.

O onboarding pode ser reaberto pelas configurações.

### 4.2 Conversar com um agente (o fluxo principal)

1. "Nova conversa" (na sidebar, no Início ou num projeto) abre uma conversa vazia, sem modal.
2. No composer, o usuário escolhe o **agente** (seletor) e o **modo** (ver 4.6). O padrão é o último usado.
3. Escreve e aperta **Enter** (Shift+Enter quebra linha). A mensagem aparece como balão do usuário.
4. A resposta do agente aparece **no próprio chat**, chegando ao vivo: texto formatado (markdown: títulos, listas, código com destaque, tabelas, links) e, entre os trechos de texto, **blocos de ação** discretos e recolhíveis ("Leu `src/app.ts`", "Editou 2 arquivos", "Rodou `npm test`" com a saída).
5. Enquanto o agente trabalha: indicador "trabalhando…" e botão **Parar**.
6. A conversa é salva. Reabrir a conversa mostra tudo; a próxima mensagem **continua a mesma sessão** do agente (ele lembra do contexto).
7. Ações por mensagem: copiar; nas do usuário, editar e reenviar; transformar em tarefa.
8. Erros (CLI não encontrada, não logada, falha no meio) aparecem como mensagem de erro clara no chat, com "tentar de novo".

### 4.3 Projetos

- Criar projeto: modal com **nome, ícone e pasta**. Só isso.
- Projeto com Git: depois de uma resposta que mudou arquivos, o chat mostra "N arquivos alterados · ver mudanças · desfazer". "Ver mudanças" abre o diff; "desfazer" volta os arquivos ao estado de antes daquela mensagem (ver 6.4).
- Projeto sem Git: o agente trabalha direto na pasta; o chat avisa, uma vez, que não há "desfazer".
- Conversa sem projeto: roda na pasta pessoal (`~`), com o mesmo aviso.

### 4.4 Workspaces, Início e navegação

- Barra do topo: abas de workspace (com marca de "trabalhando" e de "precisa de você"), aba Início (casinha), "+", busca (Ctrl K).
- Sidebar: Nova conversa, Tarefas, Projetos (com as conversas de cada um), Conversas soltas, rodapé com o perfil e a engrenagem.
- **Tela do workspace:** resumo do dia, composer com escolha de projeto, cartões de projeto (conversas, última atividade, agentes trabalhando), contagem de tarefas.
- **Início:** tudo junto — o que precisa de você, cartões de workspace, tarefas de todos.

### 4.5 Vários agentes ao mesmo tempo

- O usuário pode ter várias conversas com agentes trabalhando em paralelo (projetos diferentes ou o mesmo).
- Limite configurável (padrão 4). Acima do limite, a nova mensagem fica **na fila**, com aviso visível ("na fila: 4 agentes trabalhando").
- Abas, sidebar e Início mostram onde há agente trabalhando e onde algo precisa do usuário.
- No mesmo projeto, dois agentes ao mesmo tempo podem pisar um no outro: o app avisa antes de começar o segundo.

### 4.6 Modos e aprovações

- v1: três modos por conversa, mapeados para as flags de cada CLI: **Só leitura**, **Pode editar** (padrão), **Liberado** (pede confirmação clara antes de ativar, porque o agente pode rodar qualquer comando).
- Depois do v1: pedidos de permissão do agente aparecendo no chat com "Permitir / Negar".

### 4.7 Terminal

- "Terminal" no seletor abre uma conversa que é um terminal de verdade (xterm), no projeto ou na pasta pessoal.
- Em conversas com agente, o botão "ver terminal" é opcional e só existe se a implementação precisar (não é obrigatório no v1).

### 4.8 Tarefas (kanban)

- Quadro com quatro colunas, filtro por projeto e workspace.
- Criar tarefa (título, descrição, projeto). Mensagem do chat → tarefa. Tarefa → "abrir conversa com agente" já com o texto da tarefa.

### 4.9 Perfil e configurações

- Perfil: nome e foto.
- Agentes: lista, detectar de novo, adicionar/remover CLI.
- Limite de agentes simultâneos.
- Aparência: tema escuro (v1); claro depois.
- Diagnóstico: versões, caminhos, estado do serviço, CLIs encontradas.

### 4.10 Depois do v1 (fora do escopo agora)

Orquestração (um agente que divide trabalho para outros, com página de acompanhamento em linha do tempo/fluxo), aprovações no chat, bloco de notas, agentes personalizados (com papel/prompt), macOS/Windows, tema claro, tradução.

## 5. Princípios não negociáveis

1. **Credenciais:** o app nunca lê, guarda, copia ou reutiliza tokens/credenciais das CLIs, nem lê as pastas de configuração delas. Ele só executa a CLI.
2. **Segurança do Electron:** `contextIsolation: true`, `nodeIntegration: false`, `sandbox: true`, CSP restrita, nada de `--no-sandbox`. A interface não acessa o sistema; tudo passa por uma ponte validada.
3. **Honestidade da interface:** só mostrar o que é real. Nada de números inventados; dados de exemplo só em telas de design, marcados.
4. **Sem promessa falsa de isolamento:** pasta de projeto não é sandbox; o modo "Liberado" avisa isso.
5. **Acessibilidade:** foco por teclado em tudo, nomes acessíveis corretos, estados além da cor, contraste AA.
6. **Dependências:** cada dependência nova precisa de motivo escrito e do ok do dono.

## 6. Arquitetura

### 6.1 Peças

```
Electron (janela)                Serviço local (daemon Node)
  renderer React  ──IPC──► main ──socket local──►  agentes (CLIs), terminais,
  (sem acesso ao sistema)  (valida tudo)           SQLite, Git
```

- **Renderer:** React + TypeScript + Vite. Sem acesso a Node. Fala só com a ponte (`window.karont`).
- **Main (Electron):** janela, menu, bandeja, diálogos nativos (escolher pasta, confirmar modo Liberado). Valida cada mensagem da UI com o mesmo schema do contrato e repassa ao serviço.
- **Serviço local (daemon):** processo Node separado, iniciado pelo app e que **continua rodando com a janela fechada** (agentes não morrem ao fechar a janela). Dono do banco, dos processos das CLIs, dos terminais e do Git.
- **Contrato:** um pacote compartilhado com schemas zod de todas as requisições, respostas e eventos. Tipos do TS derivados do zod (nunca escritos à mão em dois lugares).

### 6.2 Ponte UI ↔ serviço

- **Um canal genérico** de requisição (`request(method, params)`) validado no main pelo schema do contrato, mais um canal de **eventos** (o serviço empurra: mensagens chegando, estado dos agentes, fila). Diálogos nativos têm canais próprios.
- Socket local (Unix domain socket na pasta de runtime do usuário, permissão 0700), autenticado com segredo por sessão (HMAC) — só o mesmo usuário conecta.
- **Feito para streaming:** respeita _backpressure_ (espera o `drain`, nunca derruba o cliente por buffer cheio), limite por mensagem (não por buffer), e o serviço **junta** pedaços de texto (ex.: a cada 50 ms) antes de enviar.

### 6.3 Executores de agente

- **Modo chat (padrão):** cada mensagem do usuário roda a CLI no modo estruturado e transforma a saída em partes da mensagem do agente:
  - **Claude Code** (testado com 2.1.316): `claude -p --output-format stream-json --verbose` (`--include-partial-messages` para texto ao vivo), `--session-id <uuid>` na primeira mensagem e `--resume <id>` nas seguintes, `--permission-mode` para os modos. Alternativa a avaliar: um processo por conversa com `--input-format stream-json` (várias mensagens pelo stdin).
  - **Codex** (testado com 0.166.0): `codex exec --json`, `codex exec resume <id>` para continuar, `-s/--sandbox` para os modos, `-C` para a pasta, `--skip-git-repo-check` fora de Git.
  - Outras CLIs com modo JSON (Gemini CLI, OpenCode) entram por **adaptadores**; uma CLI sem modo estruturado só pode ser usada como Terminal.
  - **Antes de implementar cada adaptador, conferir as flags na versão instalada** (`--help`) e escrever o adaptador contra um **fixture** da saída real (gravado uma vez, sem dados pessoais), para os testes não dependerem da CLI.
- **Modo terminal:** `node-pty` + xterm.js no renderer.
- **Fila:** o serviço controla quantos agentes rodam ao mesmo tempo (configuração).
- **Interrupção:** "Parar" encerra o processo da CLI; se o app/serviço cair no meio de uma resposta, a mensagem fica marcada como interrompida, com "tentar de novo". Sem maquinaria de recuperação de processo.

### 6.4 Git: ver mudanças e desfazer

- O agente trabalha **direto na pasta do projeto** (não em cópia).
- Antes de cada mensagem num projeto com Git, o serviço guarda um **ponto de restauração** sem mexer na branch nem no stash do usuário (ex.: `git stash create` + ref própria em `refs/karont/…`, ou árvore temporária equivalente).
- Depois da resposta: lista os arquivos alterados desde o ponto; "ver mudanças" mostra o diff; "desfazer" restaura os arquivos alterados para o ponto (com confirmação e aviso se o usuário mexeu nos mesmos arquivos depois).
- Sem Git: sem ponto de restauração, com aviso.
- Cópia separada (git worktree) para dois agentes no mesmo projeto fica para depois do v1.

### 6.5 Dados

- SQLite (`node:sqlite`, sem dependência), um arquivo na pasta de dados do usuário, permissões privadas.
- Tabelas do v1 (sugestão): `workspaces`, `projects`, `conversations`, `messages` (autor, partes em JSON, estado), `agent_sessions` (id da sessão da CLI por conversa), `restore_points`, `tasks`, `settings`, `agents` (CLIs adicionadas pelo usuário).
- Migrações versionadas desde o v1.

### 6.6 Detecção de agentes

- Catálogo de CLIs conhecidas (claude, codex, gemini, opencode, aider, cursor-agent, qwen, goose, amp, crush).
- Procurar no `PATH` **e** em pastas comuns (`~/.local/bin`, `~/bin`, `~/.npm-global/bin`, `~/.bun/bin`, `~/.cargo/bin`, `~/.claude/local`, `/usr/local/bin`, `/usr/bin`, `~/.nvm/versions/node/*/bin`), porque o app iniciado pela interface gráfica tem `PATH` curto.
- Só verificar se o arquivo existe e é executável. Nunca rodar a CLI para "testar login".
- Variável para desligar a detecção nos testes (os testes não podem depender das CLIs da máquina).

### 6.7 Interface e design

- Direção visual: tema escuro, grafite quase preto, uma cor de destaque para "trabalhando" e outra para "precisa de você", tipografia Geist (Sans e Mono). Tokens CSS centralizados desde o primeiro dia; nada de cor/medida solta.
- **CSS com escopo** desde o começo (CSS Modules ou `@layer` com prefixo por componente). Nada de regra global em `header`, `h1`, `select`, `button`.
- Componentes base reutilizáveis: botão, botão-ícone, campo, diálogo, menu, seletor, tooltip, badge/estado, cartão, estado vazio, toast.
- Referências visuais: arquivo `karont.pen` do dono (fora do repositório, no pen.dev). Peça ao dono os prints das telas quando for desenhar algo.
- Markdown das respostas: renderizador que **não injeta HTML cru** (ex.: `react-markdown` + `remark-gfm`; links abrem no navegador do sistema pelo main, nunca dentro do app).

### 6.8 Preview no navegador (ferramenta de desenvolvimento)

- `npm run preview:web`: o Vite serve a interface no navegador com recarga automática, falando com o serviço real por uma ponte HTTP + SSE em `127.0.0.1`, protegida por token por sessão e checagem de Host/Origin. Só existe em desenvolvimento; não entra no build.
- Serve para o dono ver e pedir ajustes de tela em tempo real.

### 6.9 Pilha

Node 24 · TypeScript · Electron (última estável) · React 19 · Vite · zod · `node:sqlite` · `node-pty` · `@xterm/xterm` · Playwright (E2E) · Biome (lint/format) · `node:test`. Gerenciador: npm (workspaces). Qualquer coisa além disso: pedir.

## 7. Qualidade e testes

- **Rápidos (toda tarefa):** `typecheck`, lint, testes do serviço com **CLIs falsas** que imitam o modo JSON do Claude e do Codex (a partir de fixtures), e **1 E2E de fumaça**: abrir o app → nova conversa → mensagem → resposta aparece no chat.
- **Completos (antes de juntar na `main`):** E2E dos fluxos do v1 (onboarding, chat com cada adaptador, projeto com/sem Git, ver mudanças/desfazer, fila, terminal, tarefas).
- **Real:** o dono testa com Claude/Codex de verdade no preview a cada marco.
- CI no GitHub Actions rodando os rápidos e os completos.

## 8. Marcos

| Marco | Entrega                                                                                                                               | Pronto quando                                                          |
| ----- | ------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------- |
| M0    | Esqueleto: Electron seguro, serviço, socket com streaming, contrato, banco, ponte de canal único, preview web, tokens e moldura vazia | App abre; preview abre; teste de fumaça do esqueleto passa no CI       |
| M1    | Agentes: detecção, adicionar CLI, Terminal                                                                                            | Configurações listam as CLIs reais; Terminal abre                      |
| M2    | **Chat de verdade** com Claude Code e Codex (streaming, ações, continuar sessão, parar, erros)                                        | O dono conversa com os dois no preview e as respostas aparecem no chat |
| M3    | Projetos (pasta, Git opcional, ver mudanças, desfazer) + fila de agentes                                                              | Desfazer funciona num projeto Git real                                 |
| M4    | Workspaces, Início, sidebar, busca                                                                                                    | Navegação completa                                                     |
| M5    | Onboarding, perfil, configurações                                                                                                     | Primeira abertura guiada                                               |
| M6    | Tarefas                                                                                                                               | Quadro com os fluxos de 4.8                                            |
| M7    | Release 0.1.0 (AppImage/deb)                                                                                                          | Instala e roda num Ubuntu limpo                                        |
