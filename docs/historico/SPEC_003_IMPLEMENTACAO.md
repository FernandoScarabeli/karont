# SPEC-003 — segurança, permissões e integração Linux

Estado: implementação da Fase 2; resultados e pendências de aceite abaixo. A Fase 3 não foi iniciada. Registros das Fases 0/1 permanecem históricos. As escolhas novas deste documento são **propostas técnicas implementadas**, sujeitas à revisão formal do protocolo.

## Recursos e fronteiras

O daemon independente, socket AF_UNIX privado, HMAC, singleton, SQLite WAL/FTS5 e PTYs foram preservados. Nenhuma flag de sandbox foi desativada. Chromium continua isolado, sem Node no renderer. Não há adaptador estruturado novo, telemetria ou envio de relatório.

Cada Dot aceita `adapter: "generic"` (padrão compatível) ou `adapter: "codex"` no JSON privado. O perfil Codex exige `args: []`: parâmetros livres, subcomandos e overrides de configuração não são combinados com políticas de segurança. Executável e projeto continuam sendo configuração local confiável, nunca entrada arbitrária do renderer. O perfil confere `--help` com timeout de 250 ms, término forçado do processo e limite de saída antes de aceitar seus modos. O resultado é reutilizado enquanto identidade/metadados do executável não mudarem; sondas lentas falham como indisponíveis. Identidade/integridade do executável continuam responsabilidade do usuário; um programa malicioso pode mentir sobre seu help.

A interface de capacidades informa `available`, `partial` ou `unavailable` por modo. Os quatro modos aparecem no seletor; os indisponíveis ficam desativados. O daemon recusa modos não suportados antes de criar a Run e revalida as opções antes de iniciar o PTY. O modo solicitado ao iniciar é persistido por Run e exibido como política inicial no terminal. Mudanças feitas depois dentro da própria CLI não são observáveis pelo PTY e não são apresentadas como política atual verificada.

| CLI/perfil testado | Pedir aprovação | Aprovar por mim | Acesso total | Somente leitura |
|---|---|---|---|---|
| Simuladores genéricos Node (E2E) | Parcial: política da CLI, sem imposição pelo eros | Indisponível | Indisponível | Indisponível |
| Fixture de help Codex compatível (unitário) | `--sandbox workspace-write --ask-for-approval on-request` | `--approve-for-me` | `--sandbox danger-full-access --ask-for-approval never`, com confirmação | `--sandbox read-only --ask-for-approval never` |
| Codex 0.164.0 instalado (sonda real) | Opções encontradas; execução funcional pendente | Opção nativa encontrada; execução funcional pendente | Opções encontradas; não executado neste teste | Opções encontradas; garantia funcional pendente |
| Fixture incompatível, executável ausente ou Codex com args livres | Indisponível no perfil Codex | Indisponível | Indisponível | Indisponível |

“Available” significa mapeamento nativo encontrado, **não certificação do sandbox de toda a CLI**. A configuração da CLI, hooks, MCP e ferramentas externas têm suas próprias fronteiras. `on-request` deixa a CLI decidir quando perguntar; não confirma toda operação. `read-only` + `never` impede escalonamento pelo fluxo de comandos nativo; não representa contenção de todo o processo. Worktree nunca é sandbox.

Fonte do mapeamento: help local do Codex 0.164.0 e [documentação oficial de comandos](https://developers.openai.com/codex/cli/reference), consultados nesta implementação. O código exige a opção explícita `--approve-for-me` antes de oferecer automação; não substitui essa opção por `--full-auto` ou aprovação simulada.

Acesso total exige confirmação nativa no main Electron, com cancelamento como padrão, mesmo que o renderer envie `elevatedConfirmed: true`. Após a confirmação, main valida novamente a origem e encaminha a concessão. O daemon exige a concessão explícita e o suporte do perfil. Um cliente Node autenticado do mesmo UID pode autorizar diretamente; não existe proteção contra processos maliciosos desse mesmo usuário.

## Central de Aprovações

A Central fica na navegação global Mission Control, acima da bancada; abre em painel na mesma janela, sem desmontar os terminais. Mostra operação, Dot, projeto, Run, pedido, decisão e horários. Há atalho para o terminal da execução, inclusive entre sessões recentes.

Pedidos reais são emitidos somente para rollback elegível. A prévia gera um identificador UUID no daemon e reutiliza o pedido pendente. Confirmar ou negar muda seu estado uma única vez; o daemon revalida hashes/conflitos antes de escrever. Falhas terminam o pedido como `failed`, exigindo nova prévia. O histórico append-only `run_events` registra pedido, decisão, resultado e arquivos revertidos. O SQLite migra de v2 para v3 sem recriar os dados; adiciona `runs.permission_mode` e `approvals`.

O caminho compatível `rollback.apply` exige `confirmed:true` e pedido pendente emitido pelo daemon. Não permite escrever por mera alteração de um estado visual. A confirmação de rollback usa `<dialog>` nativo HTML, com foco modal e Escape; cancelar registra negação quando há pedido pendente.

O PTY não cria pedidos pela interpretação de stdout. Não há botões para aprovar ferramentas de agentes nem aviso inventado de interação pendente. Aprovações internas e autenticação permanecem na CLI. Aprovações granulares e detecção estruturada continuam fora desta fase.

## Notificações, tray e janela

`Electron.Notification` roda no main, independentemente da BrowserWindow. Eventos de conclusão/erro, falha de conexão e resultado de rollback geram títulos e corpo fixos, sem nome de projeto, Dot, prompt ou saída. A preferência é local e persistente. Eventos são deduplicados por identificador; histórico limitado registra `submitted`, `failed`, `unavailable` ou `disabled`. `submitted` significa envio solicitado, nunca visualização confirmada. Ausência de libnotify/serviço não derruba o app.

No Linux, instalar `libnotify4` junto às dependências desktop. O clique na notificação solicita abertura e foco da Run, quando o serviço da plataforma oferece a ação. A visibilidade e o clique físico ainda precisam de validação no compositor alvo.

Tray exibe contagem de Runs ativas e atalhos. Fechar a janela destrói o renderer, mantendo main/tray, daemon e PTYs. “Encerrar aplicativo” termina a interface e suas notificações; daemon/CLIs continuam. Não existe renderer oculto de manutenção. O singleton reabre a janela existente. Falha de criação do tray é tratada; a janela ainda pode ser reaberta executando o aplicativo.

A conexão é monitorada pelo main. Na reconexão, sessões anexadas são reanexadas e os terminais substituem a prévia para evitar replay duplicado. Layout legado permanece no SQLite. Nenhuma sessão PTY é recuperada após crash do daemon; isso segue reservado à Fase 3.

## Diagnóstico e relatório

Diagnóstico consulta dados somente sob demanda: versão do pacote/runtime, PID/uptime/conexão, distribuição/kernel/arquitetura, sessão gráfica indicada pelo ambiente, RAM/CPUs, Git, acessibilidade dos executáveis configurados, IPC e integração desktop. Não exporta caminhos das CLIs ou variáveis do ambiente. GPU e keyring ficam “não verificado” quando não sondados. Sandbox exibido é a configuração obrigatória; comprovação efetiva fica no E2E com seccomp/NoNewPrivs. Um objeto Tray criado não comprova visibilidade em GNOME/KDE.

Última falha conhecida pelo main fica em memória, com mensagem fixa. Não há coletor de crash durável; o diagnóstico explicita essa limitação. Não foram criados processos permanentes de diagnóstico.

Reportar problema gera Markdown no main a partir de uma lista permitida de campos técnicos, sem ler chats, scrollback, configuração de projetos, dumps de ambiente ou exceções arbitrárias. A sanitização adicional remove caminhos, usuário/hostname, emails, URLs, padrões de credenciais e JWTs, além de caracteres que poderiam injetar estrutura Markdown. Há prévia somente leitura, cópia explícita e salvamento por diálogo nativo. Renderer não escolhe caminho por IPC nem fornece texto para escrita arbitrária. Nenhuma transmissão é realizada.

A sanitização é defesa em profundidade sobre uma coleta mínima, não um detector universal de segredos. Revise o arquivo antes de compartilhá-lo. Ele inclui dados técnicos como PID, versões e capacidade de RAM, deliberadamente necessários ao diagnóstico.

## Validação com CLI real

O usuário escolheu Codex nesta sessão. O teste opt-in `scripts/real-cli-test.mjs` foi executado com o binário instalado, versão 0.164.0, em repositório temporário. O help confirmou as quatro opções nativas e a CLI abriu no PTY. Não foram lidos arquivos de credenciais nem gravados tokens, identificadores privados de sessão ou conteúdo do terminal no relatório de teste.

**BLOQUEADO para aceite funcional completo:** a tarefa não produziu o diff controlado no prazo e o host Ubuntu recusou o Electron no preflight de sandbox. O ciclo Electron + mesma CLI real, autenticação quando necessária, diff e rollback real não foi aprovado. A VM de validação usa simuladores e não recebeu credenciais do host. Evidência reduzida: [`real-cli.json`](../../benchmarks/spec003/real-cli.json). A sondagem de help não substitui esse teste.

O script real é opt-in (`EROS_REAL_CLI=/caminho/absoluto/codex node scripts/real-cli-test.mjs`), não roda na CI e não instala CLIs. Não automatiza aprovação de ferramentas a partir de texto arbitrário de stdout. Saída privada fica apenas em memória temporária e é descartada. A pendência não bloqueia testes independentes da Fase 2, mas impede declarar o aceite funcional dos agentes.

## Testes, evidências e desempenho

Validação local e na VM Debian concluída: `npm run check` e `npm test` passaram com **16 testes, zero falhas/ignorados**. Nove verificações históricas permanecem, o fluxo PTY anterior foi ampliado e cinco testes novos cobrem capacidades, notificações, diagnóstico, sanitização e IPC. O Electron da Fase 0 passou; a série final exige cinco rodadas aprovadas com sandbox efetivo. O E2E ampliado passou em 1440 px e 900 px, com prova de `sandboxed`, Seccomp=2 e NoNewPrivs=1.

O E2E verificou: duas CLIs simuladas; PIDs/sessões após destruir/reabrir janela; entrada/saída recuperadas após SIGSTOP/SIGCONT; prévia, Escape com negação auditada e nova confirmação de rollback; recusa de contorno da confirmação nativa de acesso total; Diagnóstico; prévia/cópia/salvamento de Markdown; preferência de notificações; ausência de overflow em 900 px. A fixture freedesktop recebeu cinco notificações com conteúdo fixo (duas conclusões, rollback, erro sem janela e desconexão), identificadas como eros, sem duplicação. Depois de desativar a preferência, a conclusão seguinte ficou registrada como `disabled`.

| Evidência final | Arquivo |
|---|---|
| E2E e medições separadas por processo | [JSON](../../benchmarks/runs/2026-10-24T00-40-12-960Z/phase1-e2e.json) |
| Central com decisão negada e aplicada | [Screenshot](../../benchmarks/runs/2026-10-24T00-40-12-960Z/phase2-approvals.png) |
| Diagnóstico e histórico de entregas ao serviço | [Screenshot](../../benchmarks/runs/2026-10-24T00-40-12-960Z/phase2-diagnostics-after-events.png) |
| Layout 900 px | [Screenshot](../../benchmarks/runs/2026-10-24T00-40-12-960Z/phase2-compact.png) |
| Exemplo real de relatório sanitizado | [Markdown](../../benchmarks/runs/2026-10-24T00-40-12-960Z/phase2-report.md) |
| Cinco rodadas desktop + daemon | [Manifesto](../../benchmarks/series/2026-10-24T00-34-57-999Z/manifest.json) |
| Resultado consolidado | [Resumo JSON](../../benchmarks/spec003/validation-summary.json) |
| Check, unitários, desktop, E2E, série e benchmark | [Logs persistentes](../../benchmarks/spec003-validation/) |
| Capacidades do Codex instalado, sem credenciais | [Sonda de help/mapeamento](../../benchmarks/spec003/capability-probe.json) |
| Workflow YAML e comandos declarados | [Validação local](../../benchmarks/spec003/workflow-validation.json) |

A execução remota do GitHub Actions **não foi disparada nem aprovada** nesta sessão. O YAML foi analisado com PyYAML; mantém Node 24, check, unitários/integração, Electron da Fase 0, E2E ampliado com notificações e upload das evidências. O serviço D-Bus de teste requer `python3-dbus`; verifica entrega ao serviço, sem alegar visualização humana. A dependência `libnotify4` foi declarada na CI e no provisionamento. Na VM existente, foi extraída para um diretório do usuário, sem alteração privilegiada no host ou nas políticas de sandbox.

A VM foi reiniciada após uma interrupção de causa não determinada. A série válida foi repetida integralmente depois; a rodada interrompida não foi contada como aprovação. A implementação funcional e a última revisão do texto de erro têm manifestos de fonte separados; a revisão textual não mudou os mecanismos ou cargas medidas. Os 50 arquivos de código/teste do host e da VM foram comparados por SHA-256 para a validação final.

| Cenário | PSS total Fase 1 | PSS total Fase 2 | CPU total Fase 1 → Fase 2 |
|---|---:|---:|---:|
| Ocioso, mediana de cinco rodadas | 373,97 MiB | **372,92 MiB** | 1,66 → 1,33% |
| Dois PTYs, uma amostra E2E | 510,54 MiB | **529,91 MiB** | 1,99 → 2,78% |
| Janela destruída + dois PTYs, uma amostra | 421,09 MiB | **429,76 MiB** | 0,00 → 0,80% |

O total com dois PTYs cresceu 19,37 MiB (3,79%) nessa comparação de amostras únicas. A série sem agentes ficou próxima da referência, sem evidência de ganho causal. O E2E desta fase inclui diagnóstico/relatório/screenshots antes da medição com agentes; instrumentação, compartilhamento de páginas e carga não controlada limitam a comparação. A CPU usa 100%=um núcleo e resolução de ticks; zero não é custo absoluto nulo. Não foi atribuído vazamento nem causa específica por profiler. Não houve redução de isolamento para economizar RAM. Componentes separados, RSS/PSS, p95, tempos e análise do daemon isolado estão em [RESULTADOS.md](../../benchmarks/RESULTADOS.md).

A antiga meta de 200 MB permanece histórica. A referência de aproximadamente 400 MB ocioso aceita na Fase 1 não foi transformada em limite rígido para todas as cargas. A mediana ociosa da série equivale a aproximadamente 391 MB decimais. O limite estrito de CPU <1% não foi demonstrado.

Critérios técnicos exercitados: capacidades e quatro modos honestos; recusa de modo não suportado; confirmação efetiva de operações do eros; Central com pedidos reais; notificações via D-Bus; continuidade sem janela; Diagnóstico verificável; relatório local sanitizado; testes das novas superfícies IPC; unitários/E2E; benchmarks documentados. **O aceite funcional com CLI real continua pendente/BLOQUEADO**, e os testes físicos de integração e revisão formal abaixo não foram convertidos em aprovações.

## Arquivos entregues

Criados:

- `apps/daemon/src/permissions.ts`, `diagnostics.ts`: capacidades, argumentos nativos e diagnóstico.
- `apps/desktop/src/Attention.tsx`, `notifications.ts`: Central, Diagnóstico, relatório e notificações.
- `packages/local/src/report.ts`: coleta permitida e sanitização Markdown.
- `tests/phase2.test.mjs`, `tests/fixtures/notification-service.py`: segurança, capacidades, ausência de ferramentas, sanitização e serviço freedesktop simulado.
- `scripts/real-cli-test.mjs`, este documento e evidências `benchmarks/spec003/`.

Modificados:

- `packages/contracts/src/index.ts`, `packages/local/src/client.ts`: contratos e validação das novas mensagens/respostas.
- `apps/daemon/src/database.ts`, `runs.ts`, `server.ts`: migração, permissões e ciclo auditável de pedidos/decisões.
- `apps/desktop/src/main.ts`, `preload.ts`, `api.ts`, `renderer.tsx`, `RunDesk.tsx`, `style.css`: ponte IPC, confirmação nativa, navegação, modos, foco, restauração e integração Linux.
- `scripts/build.mjs`, `phase1-e2e.mjs`, `scripts/vm/provision-guest.sh`, `validate-guest.sh`, `tests/runs.test.mjs`, `.github/workflows/linux.yml`: build/versionamento, testes preservados/ampliados e dependências Linux.
- README, arquitetura, plano, protocolo e resultados: documentação e histórico preservados.

## Pendências e riscos residuais

- Aceite funcional com CLI real escolhido pelo usuário: **BLOQUEADO**, conforme acima.
- Revisão formal das extensões de protocolo v1 e modelo de capacidades: pendente.
- GNOME/KDE, Wayland físico, clique real de tray/notificação, comportamento sem serviço e escalas em hardware real: validação manual pendente. Fixture D-Bus não substitui compositor.
- GPU e keyring não sondados; crash persistente e retomada após falha do daemon fora de escopo.
- PTY e processos do mesmo UID continuam acessando recursos da conta conforme a CLI. Prompt, stdout e Git worktree não são fronteiras de segurança.
- Limites de buffer/frame e histórico são preservados; dados antigos podem ficar fora das listas limitadas. Backpressure pode exigir attach/reconexão.
- Rollback afeta somente arquivos registrados na worktree, não ações externas; não constitui transação atômica sobre efeitos do agente. Conflitos são revalidados antes da reversão.
- Nenhum avanço para a Fase 3, publicação, commit ou telemetria remota foi realizado.
