# Karont

**Um espaço de trabalho local para organizar projetos, conversas, agentes e tarefas.**

Karont é um aplicativo desktop para Linux em desenvolvimento. Ele reúne projetos Git, conversas, terminais de agentes e tarefas num só lugar. As execuções ficam sob controle de um daemon local, então podem continuar enquanto a janela está fechada.

> O projeto ainda não é uma versão estável nem está pronto para distribuição. Os recursos disponíveis e as limitações atuais estão descritos abaixo.

## O que funciona hoje

- **Workspaces e projetos:** organize repositórios Git e escolha quais Dots têm acesso a cada projeto.
- **Chats:** crie conversas de projeto ou conversas livres, com rascunhos, histórico local, favoritos e recentes.
- **Runs e terminais:** inicie uma execução por ação explícita e acompanhe a CLI no terminal integrado.
- **Diff e rollback:** revise alterações rastreadas na worktree de uma Run e confirme o rollback pela interface.
- **Tarefas:** use o Kanban do projeto ou a visão agregada; crie tarefas manualmente ou revise uma prévia de `/kanban` antes de confirmar.
- **Continuidade:** o daemon e as execuções continuam ativos ao fechar a janela; ao reabrir, o app reconecta às sessões disponíveis.

Cada conceito tem um papel próprio: **Workspace** agrupa projetos, **Projeto** aponta para um repositório, **Dot** representa uma CLI configurada, **Chat** guarda a conversa, **Run** é uma execução e **Tarefa** acompanha trabalho no Kanban.

## Estado e limitações

As fases de execução local, continuidade, organização por Workspaces/Projetos e tarefas foram implementadas no protótipo. A interface recebeu uma base visual e um design system documentados em [`docs/design/`](docs/design/DESIGN_SYSTEM.md). As evidências e o escopo validado de cada entrega estão nos relatórios de implementação.

Alguns limites importantes:

- A saída e as respostas da CLI aparecem no terminal. O Chat guarda mensagens escritas pelo usuário; respostas estruturadas e streaming dentro da conversa ainda são evolução futura.
- Aprovações de comandos executados numa CLI interativa são tratadas pela própria CLI. O terminal e a worktree não equivalem a um sandbox completo do sistema operacional.
- Se o daemon cair, a sessão PTY original não é restaurada. A recuperação pede revisão e confirmação antes de abrir uma nova sessão na mesma worktree.
- Auto Resume após limite do provedor não está disponível. O app não inventa cotas, prazos de reinício ou atividade que a CLI não informa.
- Revisão formal do protocolo IPC, validação em diferentes desktops Linux físicos e empacotamento continuam pendentes.

O ciclo básico com Codex CLI autenticado foi validado para alteração controlada de arquivo, fechamento e reabertura da janela, diff e rollback. Esse ensaio não valida Auto Resume nem todos os modos de aprovação. Veja [o relatório e seus limites](docs/VALIDACAO_CLI_REAL.md).

## Requisitos

- Linux com sessão gráfica e sandbox Chromium do Electron funcionando. **Não use `--no-sandbox`.**
- Node.js 24 ou superior e npm.
- Git, Python 3, compilador C/C++ (por exemplo, `build-essential` no Debian/Ubuntu) e `/usr/bin/flock`.
- Uma CLI de agente instalada e autenticada separadamente, como Codex CLI ou Claude Code.

O pacote `node-pty` compila uma extensão nativa durante a instalação. As dependências do Electron também variam conforme a distribuição Linux.

## Instalação e execução

Na raiz do repositório:

```bash
npm ci
mkdir -p ~/.config/eros
cp config/dots.example.json ~/.config/eros/dots.json
chmod 600 ~/.config/eros/dots.json
```

Edite `~/.config/eros/dots.json`: informe a pasta absoluta do repositório em `root`, o caminho absoluto da CLI em `executable` e os projetos permitidos em `projectIds`. Para encontrar o executável, use `command -v codex` ou `command -v claude`. O arquivo deve ser acessível somente pelo seu usuário. **Não coloque credenciais nele**; autentique-se na CLI pelo próprio terminal.

Depois compile e inicie o desktop:

```bash
npm run build
npm start
```

O Electron inicia o daemon local se necessário. Também é possível iniciar o daemon separadamente com `npm run daemon`. Fechar a janela mantém o daemon e as execuções ativos; `npm start` abre outra janela e reconecta. Para encerrar o daemon explicitamente:

```bash
npm run daemon:stop
```

Em **Workspaces**, adicione um repositório Git existente e selecione explicitamente os Dots permitidos. Criar um Chat não inicia uma Run; iniciar e enviar ao terminal são ações separadas.

## Desenvolvimento e validação

```bash
npm run check          # checagem TypeScript
npm test               # build e testes do daemon
npm run test:e2e       # fluxos Electron com CLIs de teste
npm run test:desktop   # Electron real; requer sessão gráfica e sandbox
npm run benchmark      # medições do daemon
npm run benchmark:report
```

Os E2Es usam fixtures locais e não substituem validações com um provedor real. O desktop E2E requer um ambiente Linux com as dependências gráficas e o sandbox do Electron disponíveis.

## Documentação

- [Arquitetura](docs/ARQUITETURA.md)
- [Design system](docs/design/DESIGN_SYSTEM.md), [fluxos de projetos](docs/design/PROJECT_FLOWS.md) e [fluxos de chat](docs/design/CHAT_FLOWS.md)
- [Workspaces, projetos e conversas — SPEC-005](docs/historico/SPEC_005_IMPLEMENTACAO.md)
- [Tarefas e Kanban — SPEC-006](docs/historico/SPEC_006_IMPLEMENTACAO.md)
- [Protocolo local e segurança](docs/PROTOCOLO_LOCAL.md)
- [Resultados e benchmarks](benchmarks/RESULTADOS.md) e [matriz de aceite](docs/historico/ACEITE_FASE_0.md)

## Contribuições e licença

O repositório ainda está marcado como privado e sem licença (`UNLICENSED`). A licença e as orientações para contribuições externas ainda serão definidas.
