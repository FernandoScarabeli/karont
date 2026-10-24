# eros (nome de trabalho, a confirmar)

## Um espaço de trabalho para você e seus agentes de IA.

\[LOGO — espaço reservado\]  
\[GIF DE DEMONSTRAÇÃO — espaço reservado\]

# O problema

Trabalhar com IA costuma significar dezenas de abas, chats isolados, terminais, arquivos e tarefas espalhados. Conversas perdem contexto, agentes executam ações sem visibilidade central e retomar um trabalho interrompido dá trabalho.

# A proposta

eros é um aplicativo open source, desktop-first e voltado inicialmente ao Linux. Reúne projetos, chats, agentes especializados, tarefas e arquivos em uma interface leve e organizada. Cada agente, chamado Dot, mantém identidade e permissões próprias; execuções independentes podem continuar enquanto a janela está fechada. O objetivo é coordenar trabalho humano e IA com histórico, controle e recuperação.

# Conceitos principais

• Workspace → Projetos: um contexto agrupa vários projetos, compartilhando recursos apenas conforme permissões.  
• Dot: agente com papel, instruções, visual personalizável e escopo Global, Workspace ou Projeto.  
• Chat/Sessão: conversa independente; um Dot pode manter vários chats simultâneos. Também existem chats livres, sem projeto.  
• Run: uma execução concreta do Dot, separada do chat e da tarefa.  
• Tarefa: unidade acompanhada no Kanban, com responsáveis e histórico auditável.  
• Memória: três camadas — Global, Workspace e Dot.  
• Skill: procedimento reutilizável que um Dot pode aprender e aprimorar sob regras de revisão.

# Funcionalidades — primeira versão e evolução

| Área | V1 | Pós-V1 |
| :---- | :---- | :---- |
| Organização | Workspaces, projetos, chats livres | Sincronização entre PCs |
| Dots e chats | Studio simples; terminal gerenciado (qualquer CLI de agente) e API; múltiplos runs | Adaptadores estruturados (Codex App Server, Claude Agent SDK), Ollama e equipes visuais |
| Controle | Fila; aprovações nativas da CLI; Auto Resume com suporte Nível 2 | Fluxos complexos de equipes |
| Arquivos | Explorador, editor, diff e rollback | Mais integrações externas |
| Tarefas | Kanban e /kanban com revisão | Calendário e automações avançadas |
| Comunidade | Base open source documentada | Marketplace de templates |

# Diferenciais

• Auto Resume por limite de uso: preserva o progresso e retoma quando o provedor permitir.  
• Fila de execuções com perfis Leve, Equilibrado e Máximo; o desempenho do PC vem primeiro.  
• Aprovações centralizadas com recursos completos nos adaptadores estruturados; CLIs em terminal usam suas próprias aprovações.  
• Rollback por execução: visualizar o diff e desfazer alterações de um Dot.  
• Dot Studio: criação rápida, nomes livres e mascotes 2D personalizáveis.

# Princípios

Desempenho mensurável e microinterações bem acabadas; dados locais primeiro; permissões explícitas e auditáveis; inspiração em boas ideias sem copiar código, assets ou identidade visual de terceiros.

# Status do projeto

Continuidade da Fase 3 implementada, preservando as fases anteriores, com validação em Debian 13/KVM e sandbox efetivo. Aceite funcional com CLI real e Auto Resume permanece pendente. Revisão formal do protocolo IPC, desktops Linux físicos e embalagem continuam pendentes; RAM segue monitorada sem limite rígido. Stack: Electron \+ React \+ TypeScript \+ Vite; SQLite/FTS5; daemon independente TypeScript/Node. Ao fechar a janela, daemon e CLIs continuam ativos; as sessões reconectam ao reabrir. Rust fica reservado caso medições justifiquem.

# Como contribuir

\[Em preparação: adicionar guia de contribuição, issues iniciais e código de conduta quando o repositório for publicado.\]

# Licença

A definir.  

---

# Fase 1 — execução local de agentes

Dois dots configurados em JSON podem executar CLIs independentes em PTYs e worktrees Git isoladas. A janela Electron pode fechar enquanto o daemon mantém as sessões; ao reabrir, os terminais retomam a saída disponível. A implementação não controla as aprovações internas da CLI e a worktree não é sandbox. Veja [detalhes, configuração e limites da SPEC-002](docs/SPEC_002_IMPLEMENTACAO.md).

## Executar no Linux

Requisitos: **Node.js 24+**, npm, Git, Python 3, compilador C/C++ (`build-essential` no Debian/Ubuntu), `/usr/bin/flock` (util-linux), sessão gráfica e dependências/sandbox do Electron compatíveis com sua distribuição. A aplicação **exige sandbox Chromium ativo**. Não use `--no-sandbox`.

```bash
npm ci
mkdir -p ~/.config/eros
cp config/dots.example.json ~/.config/eros/dots.json
chmod 600 ~/.config/eros/dots.json
npm run build
npm start
```

Edite o JSON: use caminhos absolutos para a raiz do projeto Git e para cada CLI (`command -v codex`); ajuste `projectIds` para autorizar os dots. O arquivo deve pertencer ao usuário e não pode ser acessível por grupo/outros. Não salve credenciais nele; faça login no terminal da própria CLI.

O Electron inicia o daemon independente se necessário. Também é possível iniciá-lo separadamente:

```bash
npm run daemon
# Em outro terminal:
npm start
npm run daemon:status
```

Feche pelo X ou pelo botão da UI: a janela é destruída, mantendo daemon, tray e agentes. Reabra pelo tray ou execute `npm start` novamente. As execuções e sessões são registradas no SQLite; o scrollback limitado fica em RAM do daemon e está disponível após reabrir a janela enquanto o daemon estiver vivo. Um crash/restart do daemon não recupera a sessão PTY nesta fase. O menu do tray permite sair somente da interface. Para encerrar o daemon explicitamente:

```bash
npm run daemon:stop
```

O laboratório sintético da Fase 0 continua disponível para comparação. As aprovações de cada agente são realizadas pela própria CLI. Rollback reverte somente arquivos rastreados naquela worktree; ele não desfaz ações externas ou caminhos que não foram registrados.

## Testes e medições

```bash
npm run check
npm test
npm run sandbox:diagnose # leitura e sonda, não substitui E2E
npm run benchmark        # daemon, sem sessão gráfica
npm run test:desktop     # Electron real; exige sandbox disponível
npm run test:e2e         # duas CLIs simuladas, sem provedor pago
npm run benchmark:report
```

[Matriz de aceite](docs/ACEITE_FASE_0.md) · [Como repetir benchmarks](docs/BENCHMARKS.md) · [Resultados locais](benchmarks/RESULTADOS.md) · [Protocolo e segurança](docs/PROTOCOLO_LOCAL.md).

**Validação atual:** `npm run check` e `npm test` passam localmente (27 testes; os 16 anteriores preservados e 11 novos casos de continuidade). `test:desktop` e `test:e2e` passaram em Debian 13/KVM com sandbox real; evidências e medições estão em [resultados](benchmarks/RESULTADOS.md) e [SPEC-002](docs/SPEC_002_IMPLEMENTACAO.md). O host Ubuntu continua sem exceções de sandbox. A revisão formal do IPC continua pendente.

A licença open source definitiva continua pendente do mantenedor. `UNLICENSED`/`private` no package.json evita indicar uma licença que não foi escolhida.

Histórico da Fase 0: [diagnóstico do sandbox e ambiente necessário](docs/SANDBOX_LINUX.md) · [revisão e evidências](docs/REVISAO_FASE_0.md) · reprodução em [VM](docs/AMBIENTE_VM_FASE_0.md). O fluxo e os testes originais seguem preservados; novas evidências com sandbox estão em `benchmarks/runs/`.

## Fase 2 — segurança e atenção (SPEC-003)

Quatro modos de permissão por capacidade real do perfil, Central de Aprovações para rollback auditável, notificações Linux no main (inclusive sem janela), tray com execuções ativas, Diagnóstico e relatório Markdown local com prévia, cópia e salvamento. Não há telemetria ou envio automático. Veja [implementação, capacidades, evidências e pendências](docs/SPEC_003_IMPLEMENTACAO.md).

O perfil padrão `generic` mantém as políticas da própria CLI: “Pedir aprovação” aparece como parcial, sem garantia do eros; os demais modos ficam indisponíveis. Para Codex compatível, configure `"adapter": "codex", "args": []` no Dot. Os modos são mapeados para opções nativas detectadas no help; acesso total exige confirmação nativa por execução. Hooks/MCP e ferramentas externas continuam exigindo revisão própria.

Notificações Electron no Linux requerem `libnotify4` e serviço freedesktop compatível. O app registra indisponibilidade sem cair. Para testar entrega ao serviço em laboratório: `EROS_TEST_NOTIFICATIONS=1 xvfb-run -a dbus-run-session -- npm run test:e2e` (requer `python3-dbus`). O teste real do Codex continua com aceite funcional **BLOQUEADO**; simuladores não o substituem. GNOME/KDE e revisão formal do IPC permanecem pendentes.

Ao atualizar o código/build, conclua as Runs antes de atualizar o daemon (`npm run daemon:stop`). Main e daemon precisam usar os mesmos contratos; não há reinício automático que interrompa sessões para atualizar componentes.

## Fase 3 — continuidade (SPEC-004)

Fila e pausa de agendamento persistentes, checkpoints automáticos/manuais, recuperação conservadora após crash do daemon e operações com proteção contra replay. Uma Run interrompida passa a `recovery_needed`; o PTY perdido não é restaurado. **Retomar** oferece nova sessão na mesma worktree somente após revisão e confirmação explícita, sem reenviar a tarefa. Processos sobreviventes e operações incertas bloqueiam repetição, rollback e remoção automática.

Auto Resume aparece **indisponível** para os perfis atuais. A infraestrutura de capacidades/agendamento foi testada com fixtures; Codex 0.164.0 foi investigado, mas a validação autenticada permanece bloqueada. `autoResume: false` no Dot e o controle por Run preservam o veto do usuário. [Relatório da fase](docs/SPEC_004_IMPLEMENTACAO.md) · [Recuperação e limites](docs/RECUPERACAO_E_CHECKPOINTS.md) · [Capacidades reais](docs/AUTO_RESUME_CAPACIDADES.md). Não foi iniciada a Fase 4.
