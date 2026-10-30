# Plano de implementacao — Karont

## Roteiro por fases • 23/10/2026 • Fontes: guia Ideias e aprendizados de Orca/ADE

Status: plano com daemon separado TypeScript/Node e destruição/recriação da janela Electron CONFIRMADOS (23/10/2026). EM ABERTO: protocolo/handshake e autenticação do IPC; escolher a CLI do Nível 2 e validar detalhes em protótipo.

# Estratégia: esqueleto andando

Construir primeiro um fluxo vertical pequeno: iniciar dois dots, executar tarefas, mostrar streaming e diffs, aprovar ações, desfazer e recuperar com segurança. Só depois ampliar navegação e acabamento.  
Fora da primeira entrega: playground de equipes, calendário e integrações externas, marketplace, modelos locais, evolução avançada de skills, sincronização entre aparelhos, aplicativo móvel, acesso remoto/relay e execução em outra máquina. Esses recursos permanecem na visão pós-V1, devido à complexidade operacional.

## Fase 0 — semana 1 \| P (validação)

Objetivo: provar que Electron atende o Linux principal e definir a fronteira de processos.  
Entregas: protótipo Electron (streaming, oito painéis, editor, tray) e daemon TypeScript/Node com instância única, socket restrito e heartbeat. Testar fechar janela → daemon continua → reabrir janela com layout restaurado. Medir RAM/CPU, abertura e fluidez semanalmente; definir protocolo/handshake e autenticação IPC.  
Critério de aceite: relatório reproduzível com ambiente, métricas, processo/lock do daemon, isolamento do socket e demonstração de fechamento/reabertura sem perder a sessão. Decisão técnica documentada; metas de desempenho são experimentais, não garantias.  
Riscos: consumo de Chromium, daemon duplicado ou sem resposta, tomada indevida do socket, bandeja indisponível e testes pouco representativos.

## Fase 1 — esqueleto funcional \| G

Objetivo: percorrer de ponta a ponta uma execução com segurança recuperável.  
Entregas: daemon TypeScript/Node, SQLite/FTS5, fila e estados de Runs; adaptador PTY e terminais com scrollback persistente no daemon, login pela própria CLI. Dots provisórios por arquivo simples de configuração (Dot Studio na Fase 5). Chat com streaming, dois dots simultâneos, worktree por Run, diff pós-execução e rollback. Iniciar testes unitários do daemon, testes ponta a ponta do Electron com Playwright e integração contínua no GitHub Actions; expandir a suíte da Fase 2 em diante.  
Critério de aceite: executar duas tarefas independentes, reabrir terminais persistentes, rastrear arquivos alterados, mostrar diff após execução e rollback seguro. Testes unitários do daemon e E2E Electron/Playwright passam no GitHub Actions. Recursos não observáveis pela CLI aparecem como indisponíveis.  
Riscos: variações de comportamento/saída das CLIs, PTY e subprocessos, menor observabilidade estruturada, segurança do scrollback e conflitos Git/arquivos.

## Fase 2 — segurança e atenção \| M

Objetivo: conceder autonomia sem perder controle.  
Entregas: motor de permissões no daemon e quatro modos visuais, mapeados às opções nativas de cada CLI quando houver; Central de Aprovações plenamente integrada apenas em adapters estruturados. Tray, notificações, Diagnóstico e relatório Markdown local sanitizado, com consentimento para envio. Ampliar testes unitários, Playwright e CI.  
Critério de aceite: para PTY, trabalho em worktree e diretórios permitidos quando viável, com aprovações governadas pela própria CLI; Karont não controla individualmente cada ação do agente. Central de Aprovações e quatro modos só têm controle pleno via adaptadores estruturados. Fechar janela preserva runs, Diagnóstico gera relatório local sem dados sensíveis.
Riscos: fuga por IPC ou subprocessos, validação insuficiente de comandos em PTY, vazamento no relatório, excesso de aprovações e diferenças de tray/notificações.

## Fase 3 — continuidade \| G

Objetivo: recuperar trabalhos interrompidos com segurança.  
Entregas: checkpoints automáticos/manuais, estados duráveis, recuperação da fila e idempotência. Auto Resume após limite só com integração Nível 2 de UMA CLI escolhida \[EM ABERTO — CLI a definir\], com detecção de cota/reset. Nas demais CLIs, notificar limite quando identificável e oferecer «Retomar» manual. Manter testes unitários, Playwright e CI.  
Critério de aceite: recuperar execução interrompida de ponto seguro, sem efeitos duplicados. Auto Resume testado na CLI integrada Nível 2, se suportado; nas demais, «Retomar» manual e dados indisponíveis quando não observáveis. Falha ambígua exige revisão; teste automatizado cobre crash/reboot.  
Riscos: CLI sem retomada exata, duplicação de operações, corrupção ou checkpoints incompletos.

## Fase 4 — organização do trabalho \| M

Objetivo: dar contexto navegável às execuções.  
Entregas: Workspaces \> Projetos, chats livres e mover chat para projeto; favoritos/recentes; Kanban por projeto e visão agregada; /kanban com prévia editável e confirmação. Incluir testes unitários, Playwright e CI.  
Critério de aceite: chat livre funciona sem projeto; conversas e tarefas preservam vínculos; /kanban não cria tarefa sem revisão.  
Riscos: vazamento de contexto entre escopos, modelo de domínio confuso, migração de chats com permissões.

## Fase 5 — experiência diária \| G

Objetivo: tornar o aplicativo utilizável como espaço integrado.  
Entregas: Dot Studio simples (nome livre, mascote 2D, texto livre para primeiro prompt e execução automática após criação); explorador local \+ biblioteca; referência/importação; editor leve com CodeMirror 6 e diffs em tempo real; Busca Global Ctrl+K. Incluir testes unitários, Playwright e CI.  
Critério de aceite: criar Dot e iniciar sua primeira missão; editar/inspecionar arquivo ao lado do chat; busca respeita permissões.  
Riscos: consumo de memória, conflitos de edição, indexação extensa, autorização insuficiente.

## Fase 6 — acabamento e abertura \| G

Objetivo: preparar entrega Linux confiável e participação externa.  
Entregas: microinterações, foco/teclado, acessibilidade, estados vazios/erros, documentação e recuperação; empacotamento .deb e AppImage; matriz real de testes GNOME/KDE, Wayland/X11, GPUs NVIDIA/AMD/Intel e equipamento com 4 GB de RAM; preparação open source (licença, nome/marca e contribuição). Concluir testes unitários, Playwright e CI antes de publicar.  
Critério de aceite: aceitação ponta a ponta, instalação/atualização .deb e AppImage validadas, relatórios de desempenho e compatibilidade por ambiente/hardware; limitações conhecidas documentadas.  
Riscos: diferenças de drivers GPU, ambientes gráficos, memória limitada (4 GB), empacotamento, acessibilidade e compatibilidade de licenças.

# Portões de aceitação do MVP \[DECIDIDO\]

☐ Executar duas tarefas independentes com dots distintos ou sessões separadas.  
☐ Demonstrar aprovação de ação sensível via CLI nativa; aprovações granulares no painel do Karont serão aceitas somente com adaptador estruturado.
☐ Identificar Run e Dot responsáveis por uma modificação.  
☐ Inspecionar diff após a execução e desfazer alterações; diffs ao vivo dependem de adaptador estruturado.  
☐ Fechar a janela e manter os dots em andamento.  
☐ Recuperar uma execução após interrupção segura.

# Checklist de testes

☐ Segurança: instância única, socket privado, protocolo/handshake/autenticação e IPC testados, keyring seguro e limites reais de permissão por CLI; validar tentativas de acesso indevido.  
☐ Prompt injection: arquivo/site/repositório malicioso não concede permissões nem executa instruções privilegiadas.  
☐ Desempenho: medir semanalmente RAM/CPU ociosas, início, 8 painéis, streaming, editor, tray; separar shell, núcleo e CLI.  
☐ Concorrência: worktrees simultâneos, conflitos, rollback e histórico consistente.  
☐ Crash/reboot/suspensão: fechar e reabrir a janela, derrubar daemon e PTY, verificar lock/heartbeat sem matar outro PID, retomar checkpoints e deduplicar efeitos externos.  
☐ Uso e custo: Nível 2 detecta limites e reset para Auto Resume; demais CLIs permitem «Retomar» manual e apresentam dados não observáveis como indisponíveis.

☐ Testes automáticos a partir da Fase 1: testes unitários do daemon, E2E do Electron com Playwright e GitHub Actions; executar em todas as fases subsequentes.

# Riscos e mitigação

• Electron consumir mais recursos que o desejado → único renderer, carregamento sob demanda, painéis suspensos, destruir a janela ao fechar e medir continuamente.  
• Dependência de protocolos experimentais → terminal PTY na V1; adaptadores estruturados futuros isolados, com testes de integração.  
• Worktrees não oferecerem contenção → permissões reais \+ isolamento de processos.  
• Ações duplicadas após falha → checkpoints, IDs de ferramentas, reconciliação e aprovação quando houver dúvida.  
• Vazamento de dados ou credenciais → chaveiro, fallback criptografado, redação de logs e validação de IPC.  
• Crescimento de escopo → manter gates por fase; sincronização, celular, relay e execução remota fora da V1.

• Daemon duplicado ou travado → lock de instância única, socket restrito, heartbeat e vigia que identifica o mesmo processo antes de reiniciar; proteção contra retorno de suspensão.  
• Variações de Linux/driver/ambiente gráfico → matriz GNOME/KDE, Wayland/X11, GPU NVIDIA/AMD/Intel e 4 GB de RAM em testes reais.

# 

# • Expectativa de controle de permissões maior do que o PTY oferece → informar níveis 1/2 na UI, usar aprovações nativas da CLI, não prometer ações granulares nem diffs ao vivo sem adaptador estruturado.

# Referências

As decisões deste roteiro consolidam a guia Ideias e os aprendizados de Orca (MIT) e ADE (AGPL-3.0) como referências de padrões, sem copiar implementação nem identidade visual. Repositórios: https\://github.com/stablyai/orca ; https\://github.com/arul28/ADE ; arquitetura do ADE: https\://github.com/arul28/ADE/blob/main/docs/ARCHITECTURE.md .  

## Registro SPEC-003 — Fase 2

Implementados os modos por capacidade, confirmação nativa de acesso total, pedidos/decisões reais de rollback no daemon, Central de Aprovações, integração de atenção Linux, Diagnóstico e relatório local sanitizado. Histórico e escopo das fases anteriores preservados. O teste real escolhido (Codex) foi tentado, mas seu aceite funcional completo está **BLOQUEADO**; revisões formais e GNOME/KDE continuam pendentes. Consulte [entrega e evidências](historico/SPEC_003_IMPLEMENTACAO.md). Implementação não equivale a aceite das pendências nem autoriza iniciar a Fase 3.

## Registro SPEC-004 — Fase 3

Implementadas continuidade persistente, fila, checkpoints, recuperação conservadora e infraestrutura opcional de Auto Resume. Codex 0.164.0 foi investigado em ambiente isolado sem credenciais; sua validação funcional autenticada continua bloqueada e Auto Resume aparece indisponível. O aceite técnico e as pendências constam no [relatório SPEC-004](historico/SPEC_004_IMPLEMENTACAO.md), sem autorizar início automático da Fase 4.

## Atualização de 25/10/2026 — preparação da Fase 4A

O ciclo básico com Codex autenticado foi validado posteriormente; consulte
[o resultado e seus limites](VALIDACAO_CLI_REAL.md). Auto Resume permanece pendente.
O usuário autorizou avançar para organização do trabalho e solicitou uma SPEC para
implementação por seu subagente. A [SPEC-005 — Workspaces, projetos e conversas](historico/SPEC_005_ORGANIZACAO_DO_TRABALHO.md)
define a primeira entrega, Fase 4A. Kanban e `/kanban` ficam para a Fase 4B.
Conversas livres nesta primeira entrega têm histórico local, sem motor de IA;
esse limite não equivale ao aceite completo de chats livres da Fase 4.
Este registro documenta o escopo preparado, não uma implementação concluída.

## Registro SPEC-005 — Fase 4A implementada

Implementada a primeira parte da organização do trabalho: workspaces persistentes,
cadastro de projeto por seletor nativo e concessão explícita de Dots, conversas de
projeto/livres, mensagens do usuário, drafts, Runs vinculadas, favoritos/recentes
e movimentação de conversa livre com preview e confirmação. O acesso ao
laboratório e às execuções antigas foi preservado. O relatório
[SPEC_005_IMPLEMENTACAO.md](historico/SPEC_005_IMPLEMENTACAO.md) contém migração, validações,
matriz A1–A15, medições e limitações reais.

Conversa livre nesta etapa é somente histórico local; não existe backend sem
projeto e não se simula resposta de IA. Kanban e `/kanban` permanecem para a Fase
4B, e Auto Resume continua pendente conforme o registro SPEC-004. Esta entrega
não inicia nem autoriza fases posteriores.
