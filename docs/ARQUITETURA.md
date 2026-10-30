# Arquitetura — Karont

## Registro técnico • 23/10/2026 • Base: guia Ideias

Legenda: DECIDIDO \= confirmado; PROPOSTA \= sujeito a validação; EM ABERTO \= requer definição. A aprovação da stack Electron substitui a escolha histórica de Tauri.

## 1\. Visão geral \[DECIDIDO / PROPOSTA\] — 23/10/2026

Shell: Electron \+ React \+ TypeScript \+ Vite \[DECIDIDO\].  
Separação do daemon: DECIDIDO (23/10/2026), TypeScript/Node. EM ABERTO: protocolo/handshake e autenticação do IPC.  
┌───────────────────────────────────────┐  
│ Electron — janela, UI React e painéis │  
└──────────────────┬────────────────────┘  
                   ⇅ IPC/socket local \[DECIDIDO; protocolo a definir\]  
┌──────────────────┴────────────────────┐  
│ Daemon independente \[DECIDIDO\]        │  
│ Runs/fila · permissões · SQLite       │  
│ checkpoints · agendador · eventos     │  
└────────────┬────────────┬─────────────┘  
             │            │  
     PTY gerenciado       Git / arquivos  
     CLIs de agentes      locais · biblioteca  
Daemon separado e TypeScript/Node são DECISÕES CONFIRMADAS (23/10/2026). Ao fechar, destruir a BrowserWindow, manter daemon/tray/runs e recriar a janela com layout restaurado. EM ABERTO: protocolo/handshake e autenticação do IPC.

## 2\. Modelo de domínio \[DECIDIDO / PROPOSTA\] — 23/10/2026

As distinções Dot × Chat × Run × Task e a hierarquia Workspace \> Project são DECIDIDAS. Os nomes e vínculos finos das entidades são modelo técnico PROPOSTO.  
• Workspace — contexto e fronteira de acesso; contém muitos Projects.  
• Project — unidade de trabalho do Workspace; reúne chats, tarefas e arquivos.  
• Dot — identidade, instruções e permissões; escopo Global, Workspace ou Projeto.  
• Chat/Session — conversa independente de um Dot; opcionalmente livre ou vinculada a Project.  
• Message — registro de interação em Chat; pode originar tarefa e contexto de Run.  
• Run — instância de execução com estado; pertence ao contexto de Chat/Dot e pode vincular Task.  
• Task — trabalho duradouro no Kanban; pode existir sem Run ou responsável e associar várias Runs ao longo do tempo.
• Approval — pedido/decisão de autorização associado a Run e operação.  
• ToolCall — uso de ferramenta dentro de Run; guarda resultado, status e risco.  
• FileRef — referência a arquivo local ou item importado da biblioteca de Project.  
• Artifact/Version — artefato e versão produzidos/editados, ligados a Run e FileRef.  
• Checkpoint — estado durável de progresso de Run, automático ou manual.  
• Memory — informação por escopo Global, Workspace ou Dot, com origem e permissões.  
• Skill — procedimento reutilizável/versionado, revisável na aba Evolução.  
• PermissionGrant — concessão revogável por dot/contexto/operação/duração.  
• EventLog — trilha cronológica de ações, alterações, aprovações e recuperação.  
Dot global não implica acesso global a arquivos; permissões são independentes da visibilidade do Dot.

## 3\. Shell desktop e separação de processos \[DECIDIDO\] — 23/10/2026

DECIDIDO (23/10/2026): Electron \+ React \+ TypeScript \+ Vite; CodeMirror 6 sob demanda no editor; React Flow reservado à fase 2\.  
DECIDIDO: Linux é o foco; clicar no X não interrompe dots; o app permanece no tray e restaura a experiência ao reabrir.  
PROPOSTA: renderer único Electron, com painéis React como componentes. DECIDIDO (23/10/2026): destruir BrowserWindow ao fechar, mantendo daemon, tray e runs; recriar a janela e restaurar o layout. O número de renderers/painéis será validado em protótipo.  
DECISÃO CONFIRMADA (23/10/2026): daemon separado em TypeScript/Node. É processo próprio para fila/runs, SQLite/FTS5, permissões, checkpoints, Auto Resume, agendador, adaptadores e notificações. A janela Electron é cliente via IPC/socket local. Rust somente se medições justificarem.  
DECIDIDO: TypeScript/Node para o daemon; Rust fica como opção futura condicionada a medições. EM ABERTO: protocolo/handshake e autenticação do IPC/socket local. Validar no protótipo.

## 4\. Dados e persistência \[DECIDIDO / PROPOSTA\] — 23/10/2026

DECIDIDO: SQLite local, modo WAL e busca FTS5; migrações versionadas; metadados no banco, anexos/snapshots fora dele, em diretórios XDG por conteúdo/hash. Arquivos podem ser referenciados (padrão, sem cópia) ou importados.  
DECIDIDO: histórico auditável de eventos append-only, checkpoints e versões de arquivos; backup/exportação como direção aprovada, sem compartilhar o arquivo SQLite ativo entre máquinas.  
PROPOSTA: manifesto com hashes, políticas de retenção para logs/cache/snapshots e restauração validada. Sincronização entre computadores é pós-V1 e EM ABERTO.

## 5\. Adaptadores de IA — DECISÃO CONFIRMADA (23/10/2026) — incorporar; detalhes a validar em protótipo

Contrato único de eventos tipados permanece objetivo para adaptadores estruturados. O adaptador inicial por terminal gerenciado tem menor granularidade de eventos; normalização de streaming, status, permissões, diffs e consumo depende das capacidades da CLI.  
Primeiro adaptador da V1: terminal gerenciado por PTY, executando CLIs de agentes. O login ocorre na própria CLI; o Karont não captura, armazena nem reutiliza tokens de assinatura. Processos de terminal e scrollback persistem no daemon, independentemente da janela; ao reabrir, a UI se reconecta. Adaptadores estruturados — Codex App Server (experimental), API própria, Claude Agent SDK/Claude Code e Ollama — entram depois para aprovações detalhadas, diffs ao vivo e métricas. Trade-off: mais compatibilidade inicial, menos eventos estruturados.
Seguir a autenticação oficial de cada CLI/provedor; não interceptar credenciais nem pressupor assinatura como API ilimitada. Controlar permissões do processo PTY, acesso ao terminal e retenção segura de scrollback. Recursos não observáveis via CLI devem aparecer como indisponíveis, sem simular dados.

### Limites do adaptador por terminal e níveis de suporte — DECISÃO CONFIRMADA (23/10/2026)

O PTY genérico não controla individualmente as ações do agente: aprovações pertencem à própria CLI. Central de Aprovações, quatro modos de permissão e diffs ao vivo só funcionam plenamente com adaptadores estruturados. O Karont mapeia modos às opções nativas disponíveis de cada CLI, sem simular permissões inexistentes.
Nível 1 (qualquer CLI): terminal/scrollback persistentes no daemon; worktree Git por Run; diff após execução; rollback com verificação de conflitos; notificação de conclusão. Manter diretório de trabalho no worktree e limitar diretórios acessíveis quando houver mecanismo efetivo; worktree sozinho NÃO é sandbox.  
Nível 2 (uma CLI com integração profunda): \[EM ABERTO — CLI a definir\]. Detectar limite e horário de reset quando a CLI expuser esses dados, estado da sessão e Auto Resume quando suportado. Se faltarem dados de uso, mostrar «indisponível»; sem métricas inventadas. Detalhes a validar em protótipo.  
PÓS-V1 — ESTUDO: contenção de processos do Linux por bubblewrap ou containers, para restringir acesso além do diretório de trabalho e das opções internas de cada CLI.

## 6\. Execução e isolamento \[DECIDIDO\] — 23/10/2026

Fila persistente e múltiplas Runs simultâneas; worktree Git por execução de escrita em repositório, com diffs e revisão antes de integrar alterações.  
Worktree NÃO é sandbox: comandos ainda precisam de motor de permissões e isolamento de processos quando viável. Para arquivos não Git, usar versões, checkpoints e detecção de conflitos; nunca sobrescrever silenciosamente alterações posteriores de pessoas ou outros dots.  
Rollback por execução com prévia e trilha auditável; reversão de arquivos não equivale a desfazer ações externas.

## 7\. Permissões e segurança \[DECIDIDO / limites do PTY\] — 23/10/2026

DECIDIDO: motor de permissões do Karont fora do prompt. Modos: Pedir aprovação, Aprovar por mim, Acesso total, Somente leitura. No PTY, cada modo só pode mapear opções que a CLI realmente ofereça; o Karont não intercepta nem aprova cada ação interna. Concessões individuais (Permitir uma vez/sempre/Negar) dependem da integração estruturada.
DECIDIDO como funcionalidade do produto: Central de Aprovações no Mission Control e painel flutuante; gestão detalhada de ações sensíveis somente via adaptadores estruturados. No PTY, as aprovações permanecem na CLI. Segredos no Secret Service/keyring seguro, com fallback criptografado por senha.  
DECIDIDO: permissões no daemon e fora do prompt, com contextIsolation=true, nodeIntegration=false, sandbox=true e validação de mensagens IPC. A UI não acessa diretamente recursos do sistema. Isso não concede controle sobre cada ação interna de uma CLI sob PTY.  
PROPOSTA — escopo pré-aprovado por tarefa: para Runs noturnas/autônomas, definir previamente diretórios, ferramentas e tipos de ação permitidos, preservando pedidos de aprovação para exceções ou riscos; não significa acesso irrestrito.

## 8\. Confiabilidade e continuidade \[DECIDIDO / PROPOSTA\] — 23/10/2026

Estados propostos do motor: queued → running → waiting\_approval / waiting\_quota / paused → completed / failed / recovery\_needed.  
DECIDIDO: checkpoints automáticos/manuais e Auto Resume ativado por padrão quando o adaptador suportar detectar cotas e retomada. No terminal genérico (Nível 1), oferecer retomada manual e não afirmar Auto Resume sem Nível 2\. Persistir estados e recuperar fila após falha/reboot.  
DECIDIDO: ações externas devem ser reconciliadas antes de repetição; resultados e identificadores de operações evitam efeitos duplicados. Retomada exata depende das capacidades do adaptador; ações incertas pedem aprovação.

## 9\. Desempenho e observabilidade \[DECIDIDO / PROPOSTA\] — 23/10/2026

DECIDIDO: preservar recursos do Linux acima da velocidade dos dots; perfis Leve, Equilibrado e Máximo e Gerenciador de Execuções com fila, pausa e prioridade.  
METAS PROPOSTAS, A VALIDAR: abertura \<2 s; RAM ociosa \<200 MB; CPU ociosa \<1%; feedback comum \<100 ms. Medir separadamente Electron, daemon TypeScript/Node, CLIs e modelos; não são garantias.  
PROPOSTA: único renderer; listas virtualizadas, editor carregado sob demanda e suspensão de painéis fora de foco; medições semanais com oito painéis, streaming, editor e tray.

## 10\. Memória e skills \[DECIDIDO\] — 23/10/2026

Memória Global, Workspace e Dot, separada por permissões. Dots podem aprender e aprimorar skills; aprendizado de baixo risco pode ocorrer no escopo do Dot. Alterações centrais e promoção de conhecimento entre escopos exigem revisão.  
A aba Evolução registra origem e mudanças; mecanismos sofisticados de autoevolução ficam para depois da V1.

## 11\. Mission Control e notificações \[DECIDIDO / PROPOSTA\] — 23/10/2026

DECIDIDO: Mission Control e linha do tempo de runs, aprovações, arquivos e atividades; notificações do Linux para aprovações, conclusão e falhas. No PTY genérico, dados e aprovações dependem das capacidades da CLI; detalhes de tool calls e diffs ao vivo só com adaptador estruturado.  
DECIDIDO: Central de Aprovações em visão completa e painel acessível globalmente. PROPOSTA: Mini Mission Control flutuante para status rápidos; layout padrão de painéis permanece a detalhar.

## 12\. Daemon à prova de falhas — DECISÃO CONFIRMADA (23/10/2026) — incorporar; detalhes a validar em protótipo

• Instância única: lock/socket com identificação do processo dono; se já houver daemon ativo, não iniciar outro. Recuperar lock órfão apenas depois de confirmar que o antigo dono não existe.  
• Socket local privado do usuário: diretório e endpoint com permissões restritas; autenticar e validar o cliente.  
• Heartbeat periódico do daemon e vigia externo leve: agir só diante de batimento parado e identidade do processo confirmada (PID \+ momento de início, evitando PID reutilizado); não reiniciar indevidamente após suspensão/retomada do computador.  
• Abertura de projetos/worktrees com tentativas limitadas e backoff crescente, sem loop intenso.  
• Encerramento ordenado: desfazer a inicialização parcialmente concluída e liberar recursos na ordem inversa da criação.  
• Pós-V1, opcional: integrar daemon ao login do usuário via systemd \--user.  
DECISÃO CONFIRMADA (23/10/2026): daemon separado em TypeScript/Node; robustez a validar no protótipo. EM ABERTO: protocolo/handshake e autenticação do IPC.

## 13\. Diagnóstico e suporte — DECISÃO CONFIRMADA (23/10/2026) — incorporar; detalhes a validar em protótipo

• Tela/comando «Diagnóstico» (doctor): versões do app e do daemon, uptime, Linux/distribuição e ambiente gráfico, CPU/RAM/GPU, Git e CLIs disponíveis, keyring, tray e última falha/travamento.  
• «Reportar problema»: gerar relatório Markdown local, removendo segredos, caminhos pessoais, histórico/conteúdo dos chats e outros identificadores sensíveis. Mostrar prévia para revisão e cópia.  
• Envio automático de relatório somente com consentimento explícito. Telemetria anônima, se futuramente adotada, deve ser opt-in e documentada.

## 14\. Posicionamento e diferenciais — DECISÃO CONFIRMADA (23/10/2026) — incorporar; detalhes a validar em protótipo

• Não competir reproduzindo as funcionalidades maduras de terminal e worktree de Orca/ADE; reaproveitar padrões de arquitetura e UX, sem copiar implementação.  
• Diferenciais do Karont: Dot Studio e mascotes 2D personalizáveis; Auto Resume por limite de uso; fila com perfis Leve/Equilibrado/Máximo; memória Global/Workspace/Dot; foco real em Linux com .deb e AppImage testados.
• Observação da referência Orca: materiais consultados exibem uso e horário de reset de cotas dos agentes, sinalizando que esses dados podem ser expostos por algumas CLIs/provedores. Não há evidência observada de retomada automática na referência; disponibilidade deve ser verificada para cada adaptador.

## 15\. Licenças e propriedade intelectual — DECISÃO CONFIRMADA (23/10/2026) — incorporar; detalhes a validar em protótipo

• Orca: MIT. ADE: AGPL-3.0. Usar ideias e padrões como inspiração, sem copiar código do ADE; a incorporação de código coberto por AGPL pode impor obrigações de copyleft incompatíveis com a licença escolhida para o Karont.
• Qualquer reuso de código ou assets exige revisão da licença, atribuições preservadas e registro da origem. Criar mascotes, marca e interface autorais.  
• EM ABERTO: licença do Karont; MIT ou Apache-2.0 são sugestões, não escolhas aprovadas. Nota técnica informativa, sem aconselhamento jurídico.

## 16\. Fora da V1 — DECISÃO CONFIRMADA (23/10/2026) — incorporar; detalhes a validar em protótipo

Sincronização entre aparelhos, aplicativo móvel, acesso remoto/relay e execução em outra máquina. Ficam pós-V1 devido à complexidade de autenticação, redes, estados distribuídos e recuperação; o tamanho e abrangência da arquitetura documentada do ADE reforçam a necessidade de escopo reduzido.

# Decisões em aberto

| Decisão pendente | Quem decide | Prioridade |
| :---- | :---- | :---- |
| IPC: protocolo, handshake e autenticação | Fernando (com apoio de IA) | Alta |
| Escolha da CLI para suporte Nível 2 | Fernando (com apoio de IA) | Alta |
| Orçamento de RAM/CPU e métricas | Fernando (com apoio de IA) | Alta |
| Escopo pré-aprovado por tarefa | Fernando (com apoio de IA) | Alta |
| Retenção, backup e sincronização | Fernando (com apoio de IA) | Média |
| Mini Mission Control e layout | Fernando (com apoio de IA) | Média |

# Referências

Documentação oficial: Electron — Tray, Process Model, Security e safeStorage (electronjs.org/docs); SQLite — WAL, FTS5 e backup (sqlite.org); Git — git-worktree (git-scm.com/docs/git-worktree). Referências técnicas já constam na guia Ideias. Estudos de referência (padrões, não cópia): Orca — https\://github.com/stablyai/orca (MIT); ADE — https\://github.com/arul28/ADE (AGPL-3.0); documentação da arquitetura ADE — https\://github.com/arul28/ADE/blob/main/docs/ARCHITECTURE.md .  

## SPEC-003 — propostas implementadas da Fase 2

O perfil PTY passa a expor capacidades por modo; perfis `generic` e `codex` não constituem adaptadores estruturados. Políticas nativas são selecionadas e revalidadas pelo daemon. Acesso total exige concessão explícita; o main Electron obtém confirmação nativa por execução. Nenhuma autorização é derivada de stdout ou prompt. SQLite v3 preserva dados anteriores e acrescenta modo da Run e pedidos de rollback com decisões auditadas em eventos.

Central, Diagnóstico e relatório usam o único renderer existente. Notificações e tray vivem no main, inclusive sem janela. Diagnóstico é sob demanda; relatório usa coleta mínima permitida e sanitização, com salvamento/cópia locais. Novos contratos e riscos estão em [PROTOCOLO_LOCAL.md](PROTOCOLO_LOCAL.md) e [SPEC_003_IMPLEMENTACAO.md](historico/SPEC_003_IMPLEMENTACAO.md). São propostas implementadas, sem presumir aprovação formal do protocolo ou segurança completa das ferramentas internas de CLIs. A Fase 3 permanece fora desta entrega.

## Registro SPEC-004 — continuidade

A Fase 3 acrescenta ao daemon existente uma camada transacional de estados/checkpoints e uma infraestrutura de agendamento por capacidade, sem supervisor externo. Migração v4 preserva dados e adiciona checkpoints/operações/jobs e identidade Linux. Runs interrompidas ficam recovery_needed; PTY perdido não é reanexado. Nova sessão na mesma worktree exige confirmação e não reenvia prompt. Codex é a única candidata investigada; nenhum adaptador Nível 2 está certificado para Auto Resume na produção. [Implementação e evidências](historico/SPEC_004_IMPLEMENTACAO.md). Fase 4 não iniciada.

## Registro SPEC-005 — Fase 4A: organização do trabalho

O daemon continua sendo o único escritor do SQLite. A migração v5 cria
`workspaces`, conversas, mensagens, entregas, concessões explícitas de Dot e
registro de operações; `projects` recebe workspace/origem e `runs` recebe
`chat_id` opcional. Projetos da configuração são preservados e associados ao
workspace “Meus projetos”. Projetos cadastrados pela UI permanecem no banco, sem
gravar executáveis ou permissões no JSON. `syncConfig` mantém associações e grants
e recusa colisões de ID/raiz. FKs e triggers impedem que uma Run vinculada tenha
conversa, Dot ou projeto divergentes.

Workspace, Project, Chat e Run são domínios distintos. Conversa de projeto fixa
seu Dot; cada conversa permite no máximo uma Run não terminal e continua sujeita
ao limite global de dois PTYs. Conversa livre tem `project_id = NULL`, pode guardar
mensagens e rascunho, mas não pode iniciar agente. Somente texto explicitamente
salvo pelo usuário vira Message; stdout, ANSI, credenciais e entrada bruta de PTY
não são gravados como mensagens.

Favoritos, abertura recente e navegação ficam persistidos; abertura explícita
atualiza `last_opened_at`, enquanto polling não o altera. Listas usam cursor
estável, no máximo 100 itens, com paginação adicional para caber no frame local.
Mover uma conversa livre para projeto usa preview, grant validado, confirmação e
revisão otimista, preservando ID, conteúdo e favorito e sem reenviar mensagens.
Envio ao PTY registra intenção antes da escrita; mesma chave não reenvia e falha
ambígua exige revisão explícita.

As telas de execução, diff, rollback, atenção e laboratório existentes continuam
acessíveis pelo mesmo renderer. Comportamento, migração, limites e evidências
estão detalhados em [SPEC_005_IMPLEMENTACAO.md](historico/SPEC_005_IMPLEMENTACAO.md). A
Fase 4B (Kanban) e Auto Resume não faziam parte daquela entrega.

## Registro SPEC-006 — Fase 4B: Kanban e `/kanban`

SQLite v6 acrescenta `tasks`, `task_assignees`, `task_run_links` e
`task_events` por migração transacional v5→v6. O daemon valida projeto fixo,
conversa/mensagem de origem, Runs relacionadas, responsáveis e grants atuais.
Referências históricas a Dots que perderam disponibilidade continuam visíveis,
sem autorizar nova atribuição. Triggers garantem contexto de projeto e eventos
append-only; revisão otimista e `operationId` protegem concorrência e replay.

Chat, Task e Run seguem distintos. Tarefa não exige chat, Run ou responsável;
uma Run pode estar ligada a tarefas diferentes do mesmo projeto. Alterar estado,
responsável ou vínculo não inicia nem altera Run, concede permissão ou envia
mensagens. O estado da tarefa não segue a conclusão da CLI automaticamente.

O compositor estruturado reconhece `/kanban` apenas no início do texto como
comando completo ou seguido por espaço. Texto em frase, terminal e stdout não
acionam criação. A prévia é editável e requer confirmação; conversa livre exige
vinculação e uma nova revisão. Ação em mensagem salva preserva os IDs de chat e
mensagem. Quadros têm quatro colunas, detalhes e histórico; controles explícitos
funcionam por teclado. A visão agregada mantém filtros e acesso às páginas além
dos primeiros 100 itens.

Main, preload, cliente e daemon usam operações IPC nomeadas `tasks.*` com schemas
estritos; não há `invoke` arbitrário. Texto de tarefa não é incluído em logs,
relatórios ou notificações. Implementação, matriz de aceite, medições locais,
limitações e evidências estão em [SPEC_006_IMPLEMENTACAO.md](historico/SPEC_006_IMPLEMENTACAO.md).
