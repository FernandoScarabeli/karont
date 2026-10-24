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

Em fase de design, ainda sem código. Stack: Electron \+ React \+ TypeScript \+ Vite; SQLite/FTS5. Daemon independente TypeScript/Node CONFIRMADO (23/10/2026). Ao fechar, a janela Electron é destruída sem encerrar os dots; o layout é restaurado ao reabrir. Rust fica reservado caso medições justifiquem.

# Como contribuir

\[Em preparação: adicionar guia de contribuição, issues iniciais e código de conduta quando o repositório for publicado.\]

# Licença

A definir.  
