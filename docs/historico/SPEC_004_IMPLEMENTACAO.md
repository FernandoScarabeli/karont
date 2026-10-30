# SPEC-004 — continuidade, recuperação e Auto Resume

Implementação da Fase 3, sem iniciar a Fase 4. Este documento distingue continuidade técnica e suporte funcional de provedor. Histórico das fases anteriores e benchmarks foram preservados; os arquivos novos ficam em `benchmarks/spec004/` e em novas rodadas de `benchmarks/runs/` e `benchmarks/series/`.

## 1. Funcionalidades implementadas
Fila persistente com dois PTYs simultâneos, pausa exclusivamente do agendamento, nove estados persistidos, checkpoints automáticos/manuais, detecção de encerramento não ordenado e recuperação conservadora. A UI permite enfileirar enquanto existem dois processos, criar checkpoints, cancelar e revisar alternativas de retomada. Mostra data/estado/origem do último checkpoint, risco de nova sessão e indisponibilidade de cota/reset/Auto Resume.

A retomada manual reabre a mesma worktree em uma **nova sessão explicitamente confirmada**, sem reenviar prompt. Não reanexa PTY morto nem afirma restaurar memória interna do agente. Configuração/política e autorização Dot/projeto são revalidadas. Sobreviventes ou operações incertas bloqueiam repetição. Preferências de Auto Resume existem por Dot (JSON privado) e Run (controle na UI e SQLite).

## 2. Alterações de arquitetura
Daemon Node/TypeScript separado, Electron/React, socket privado autenticado, sandbox e SQLite WAL/FTS5 foram mantidos. Não houve supervisor novo, isolamento por container, serviço remoto ou SDK de inferência adicionado. Foram adicionados módulos de continuidade e agendamento ao daemon existente.

Migração SQLite 3→4 amplia o CHECK de estados sem perder Runs ou referências; adiciona identidade Linux das sessões, `runs.auto_resume`, checkpoints, operações e jobs de retomada. Transições e snapshots usam transações com savepoints. O daemon continua sendo autoridade; renderer recebe resumos validados.

O modelo e seus limites estão em [Recuperação e checkpoints](../RECUPERACAO_E_CHECKPOINTS.md). Fingerprints não são cópias de arquivos. PTY/scrollback permanecem efêmeros após morte do daemon; checkpoints preservam referências, estado e incertezas, sem capturar credenciais ou prompts.

## 3. Modelo de estados e checkpoints
O daemon valida nove estados: queued, running, paused, waiting_quota, waiting_approval, recovery_needed, completed, failed e cancelled. Paused pausa somente o agendamento. Estados incertos nunca são convertidos automaticamente em completed. O processo é identificado por boot/starttime/UID/executável, além do PID; um registro running não prova vida do processo.

Checkpoints preservam estado, contexto, worktree, referências de eventos, política e operações confirmadas/pendentes/incertas. Há registros antes do início, nas transições, antes/depois de operações, na espera de limite e no shutdown, além do botão manual. Conteúdo, transições, retenção e limites completos: [Recuperação e checkpoints](../RECUPERACAO_E_CHECKPOINTS.md). Não são snapshots de memória/PTY e não contêm credenciais ou prompts.

## 4. Demonstração de crash e recuperação
A suíte provoca SIGKILL real com duas Runs. A CLI normal encerra quando perde o PTY; a fixture que ignora SIGHUP sobrevive. Após restart, ambas ficam recovery_needed, a fila pausada permanece e nenhuma nova Run é criada. Processo sobrevivente bloqueia nova sessão; depois de terminar a fixture identificada, a nova sessão exige confirmação e mantém Run/worktree.

Uma segunda prova usa um shim Git de teste que conclui somente o primeiro restore e mata o daemon durante rollback. O primeiro arquivo fica restaurado, o segundo permanece modificado; no restart, a operação incerta impede repetir o rollback. O shim existe apenas no harness temporário; não há flag de falha/teste habilitável no daemon de produção.

Foi observado um detalhe real de forkpty: logo após fork, /proc pode mostrar a sessão do pai antes de setsid. A detecção foi corrigida para conferir o líder e o escopo de sessão do PTY, sem tratar a sessão do daemon como processo sobrevivente do agente. Identidades incluem PID, boot, starttime, UID e executável; PID reutilizado não autoriza associação.

## 5. Testes de idempotência
Enqueue, checkpoint e retomada usam chaves vinculadas ao contexto. Chamadas simultâneas com a mesma chave retornam a mesma Run e não criam outro PTY. Pause/cancel validam estado. A fila é reconstruída dos mesmos registros, não reenviada como novas Runs. Worktree e rollback têm intenção persistente anterior ao efeito e confirmação posterior. Crash na janela entre efeito externo e confirmação bloqueia repetição; não se promete exactly once de efeitos externos.

Testes cobrem chave reutilizada com Run/tipo incompatíveis, operação já confirmada, intenção incerta, conflito de worktree, transição inválida, reabertura SQLite e concorrência. Clientes legados que omitem operationId ao iniciar não têm deduplicação semântica de solicitações independentes; o desktop atualizado sempre fornece a chave.

## 6. Capacidades efetivas da CLI escolhida
Uma única candidata foi investigada: **Codex 0.164.0**. Há comandos nativos de continuação e protocolo estruturado com IDs, estados e campos de limite/reset. A sonda real gerou schemas, executou initialize/account/read e abriu a CLI em PTY com HOME/CODEX_HOME vazios. A conta estava ausente, a consulta de limite e a continuação com ID inexistente falharam; não houve reset verificado.

A tarefa Git com agente real, rollback real, ciclo de janela com esse agente, continuação autenticada e Auto Resume real continuam **BLOQUEADOS**. A sonda caracteriza melhor o bloqueio da Fase 2; não é aprovação funcional. [Capacidades, fontes oficiais, prova real e pendências](../AUTO_RESUME_CAPACIDADES.md).

## 7. Resultado real do Auto Resume
A infraestrutura opcional persiste sessão/intenção de adaptador confiável e espera por reset conhecido. Tem cancelamento, revalidação, backoff limitado, teto de três tentativas e quarentena de tentativa incerta. Nenhum adaptador de produção é certificado; generic e Codex exibem indisponível. Reset desconhecido não inicia polling de cota. Fixtures provam a lógica do eros, sem alegar suporte do provedor.

## 8. Testes, benchmarks e comparação com a Fase 2
`npm run check` e `npm test` passaram no host e na VM: **27 testes, zero falhas/ignorados**, preservando os 16 anteriores. Os 11 novos casos cobrem migração/reabertura, transições, identidades, operações incertas, scheduler/reset/backoff, veto Dot/Run, IPC, SIGKILL com concorrência, rollback parcial, jobs incertos e socket sem autenticação. Cenários simulados não aprovam um provedor.

O E2E final passou com sandbox ativo e prova runtime/Seccomp=2/NoNewPrivs=1, dois PTYs, janela destruída/reaberta, checkpoint manual, SIGKILL do daemon, reconexão e nova sessão confirmada. O veto por Run foi gravado antes do crash e preservado. A fixture D-Bus recebeu duas notificações de recuperação e uma de nova sessão; o polling seguinte não duplicou esses eventos. Títulos/corpos são fixos. Inspeção visual das capturas finais em 1440 e 900 px concluída; não houve overflow horizontal no teste.

| Evidência final | Arquivo |
|---|---|
| Host: check e 27 testes | [check](../../benchmarks/spec004/host-check.log), [testes](../../benchmarks/spec004/host-unit.log) |
| VM: check, 27 testes e E2E | [check](../../benchmarks/spec004/check.log), [testes](../../benchmarks/spec004/unit.log), [E2E](../../benchmarks/spec004/e2e.log) |
| E2E estruturado | [JSON](../../benchmarks/runs/2026-10-24T01-24-37-774Z/phase1-e2e.json) |
| Diálogo de recuperação e layout compacto | [1440 px](../../benchmarks/runs/2026-10-24T01-24-37-774Z/phase3-recovery.png), [900 px](../../benchmarks/runs/2026-10-24T01-24-37-774Z/phase3-compact.png) |
| Cinco rodadas com sandbox | [Manifesto](../../benchmarks/series/2026-10-24T01-20-02-258Z/manifest.json) |
| Checkpoints, espera, fila e crash | [JSON](../../benchmarks/spec004/continuity-benchmark.json) |
| CLI real sem credenciais importadas | [Sonda](../../benchmarks/spec004/codex-probe.json) |
| Fonte final igual entre host e VM | [56 hashes](../../benchmarks/spec004/tested-source-sha256.json), [conferência](../../benchmarks/spec004/source-verification.json) |
| Workflow | [Validação local; remoto não executado](../../benchmarks/spec004/workflow-validation.json) |

PSS total ocioso mediano: **368,96 MiB** (Fase 2: 372,92 MiB); p95 370,15 MiB. CPU ociosa mediana 1,33%, p95 1,66% de um núcleo; meta estrita <1% não demonstrada. A diferença de memória não comprova ganho causal. A referência aproximada de 400 MB decimais não é teto para agentes ativos.

Checkpoints: cinco lotes de cem; medianas por lote 7,19–7,86 ms e p95 8,43–9,74 ms, mantendo cem automáticos. Banco 228 KiB, WAL ~3,94 MiB estabilizados no ensaio. Espera simulada por 35 s não alterou linhas SQLite. Fila real com vinte Runs: 2 running + 18 queued antes do SIGKILL; 2 recovery_needed + 2 running + 16 queued após restart, sem criar novas Runs. PSS mediano daemon + duas CLIs: 77,22 → 77,45 MiB. Amostras curtas não provam ausência de vazamento de longo prazo.

[Resultados, componentes, duas CLIs com/sem janela, metodologia e comparação completa](../../benchmarks/RESULTADOS.md). Histórico anterior preservado em benchmarks/history/pre-spec004 e nas rodadas originais.

O YAML do GitHub Actions foi validado localmente e continua declarando check, testes e E2E ampliado. Nenhuma execução remota foi disparada nem declarada aprovada. Benchmarks e E2E finais usam o mesmo código de produção; o último ensaio ampliou apenas a fixture/harness de notificações.

## 9. Pendências de segurança e compatibilidade
Foi produzido um [parecer interno específico das novas operações IPC](../PROTOCOLO_LOCAL.md). Origem/frame, autenticação, schemas estritos e respostas/eventos validados foram preservados. Comandos, estado, snapshots, sessão nativa e reset não podem ser injetados pelo renderer. Stdout continua sem autoridade sobre política/continuidade.

Não houve auditoria externa; revisão formal completa permanece pendente. Permanecem riscos de processos do mesmo UID, descendentes que mudam de sessão, alterações externas concorrentes na worktree, limites de fingerprint, perda elétrica com synchronous=NORMAL, retenção prolongada de auditoria e CLIs com hooks/MCP próprios. Não existe contenção completa do processo. Notificações usam títulos fixos e deduplicação no main por evento/sessão durante restart do daemon; entrega ao serviço não comprova leitura humana. Deduplicação não persiste após morte do próprio main.

## 10. Recomendação de aceite técnico e funcional
| Grupo | Resultado e limite |
|---|---|
| A — Runs/fila/checkpoints persistentes | Implementado; migração, fila não iniciada e pausa recuperadas sem recriar Runs |
| A — crash/concorrência/idempotência | SIGKILL de daemon e durante rollback, sobrevivente, PID inválido/reutilizado e replay cobertos |
| A — retomada manual | Nova sessão confirmada na mesma worktree; sem reattach de PTY perdido nem repetição silenciosa de prompt |
| A — limitações visíveis | Recuperação incerta, risco externo, worktree e falta de sessão nativa apresentados no diálogo |
| B — interface Nível 2 e scheduler | Infraestrutura/fixtures; nenhum adaptador de produção certificado |
| B — Codex real | Investigado; autenticação e execução funcional pendentes no ambiente isolado |
| B — detecção/reset/continuação real | Indisponíveis; nenhum limite ou horário simulado na UI |
| B — opt-out/persistência/backoff | Lógica testada; preferência por Dot/Run persiste; jobs simulados sobrevivem a reabertura SQLite |
| C — regressão, sandbox e IPC | Suíte anterior preservada e novos casos; evidências finais abaixo |
| C — CI e compatibilidade | YAML validado localmente; execução remota, GNOME/KDE, Wayland físico e distribuição permanecem pendentes |

Aceite técnico é recomendado para a continuidade no ambiente Linux testado, respeitando bloqueio conservador diante de incerteza. Aceite funcional de Auto Resume **não** é recomendado sem autenticação e demonstração de continuação nativa sem repetição de ações. A ausência de um provedor validado não é convertida em suporte por uma fixture.

**FASE 3 — CONTINUIDADE TÉCNICA APROVADA; AUTO RESUME FUNCIONAL PENDENTE.**

A expressão é o resultado técnico desta entrega sob as condições testadas; não representa auditoria externa, aprovação remota da CI ou decisão do mantenedor sobre distribuição/IPC. A Fase 4 não foi iniciada.

