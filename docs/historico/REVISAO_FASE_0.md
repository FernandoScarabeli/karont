# Revisão técnica — Fase 0

## SPEC-001 — resultado atual (23/10/2026)

**Recomendação: ACEITE TÉCNICO da Fase 0 no ambiente Linux testado.** O bloqueio P0 foi superado em VM Debian 13/KVM, com kernel próprio, sem alterar AppArmor/sysctls ou instalar helper privilegiado no Ubuntu principal. O aceite do orçamento de desempenho e do protocolo IPC continua dependendo de revisão explícita. Não iniciar Fase 1 automaticamente.

- Electron 45 iniciou com `sandbox:true`, `contextIsolation:true`, `nodeIntegration:false`; runtime sandboxed/isolated, Seccomp=2 e NoNewPrivs=1 no renderer real. Sem flags desativadoras no lançamento. Helper npm continua UID 1000/0755.
- `npm ci`, `npm run check`, `npm test` aprovados na VM: **9 testes, zero falhas/ignorados**, preservando os sete existentes. O check e nove regressões também passaram novamente no host.
- `npm run test:desktop` aprovado avulso e **cinco rodadas desktop completas** aprovadas na série. Cinco benchmarks do daemon concluídos; diagnóstico e geração de relatório executados, além de benchmark isolado pelo comando npm.
- Todos os ciclos fechar/reabrir preservaram PID **e starttime** do daemon, layout/editor persistidos e reconexão. Renderer real presente antes e ausente depois; árvore shell passou de sete para seis processos em todas as rodadas. Pausa SIGSTOP/SIGCONT de main+daemon provocou timeout e recuperou conexão; nova tentativa de daemon continuou recusada com 73. Isso não comprova suspensão física.

Evidências: [manifesto de cinco rodadas](../../benchmarks/series/2026-10-23T22-10-53-606Z/manifest.json), [identidades do ciclo](../../benchmarks/spec001/lifecycle.json), [desktop final](../../benchmarks/runs/2026-10-23T22-13-41-064Z/desktop.json), [diagnóstico guest](../../benchmarks/spec001/sandbox-diagnostic-vm.json), [ambiente e hashes](../../benchmarks/spec001/environment.json), [resultados](../../benchmarks/RESULTADOS.md). Screenshots novas constam do JSON de cada rodada; as antigas permanecem históricas.

### Correções e extensão de validação

O gerador anterior conferia somente parte da prova de sandbox. Poderia aceitar um documento `passed:true` com preferências/contextIsolation contraditórios ou argumentos inseguros. O gate compartilhado agora verifica preferências, runtime, PID positivo, seccomp/NoNewPrivs e argumentos; nova regressão cobre essas contradições. A série usa o mesmo gate e recusa menos de cinco rodadas ou ambientes divergentes. Não houve mudança no protocolo ou no produto para fazer o teste passar.

O harness agora separa partida integrada com perfil/processos novos de abertura instrumentada e reabertura; amostra Electron/daemon em paralelo, registra total e mede digitação ativa em cenário próprio. Adicionou pausa/retomada simulada com identidade PID+starttime e singleton após timeout. Não se alteraram Electron/React/daemon, isolamento, políticas globais ou stack. As correções anteriores de cancelamento, PID e relatório foram preservadas.

### Desempenho e investigação de RAM

| Métrica | Mediana | p95 |
|---|---:|---:|
| Partida integrada, caches do SO preservados | 533,60 ms | 548,72 ms |
| Abertura com daemon pronto | 579,52 ms | 597,57 ms |
| Reabertura | 380,24 ms | 493,60 ms |
| Electron ocioso PSS | 328,92 MiB | 330,50 MiB |
| Daemon ocioso PSS no cenário desktop | 34,86 MiB | 34,92 MiB |
| Total ocioso PSS | 363,84 MiB | 365,35 MiB |
| Total ocioso RSS (páginas compartilhadas repetidas) | 708,96 MiB | 711,32 MiB |
| CPU ociosa total, 100%=um núcleo | ~1,00% | 1,66% |
| Intervalo rAF p95 por rodada | 16,80 ms | 16,80 ms |
| Foco até dois rAF, 50 interações | 31,30 ms | 32,20 ms |

RAM total mediana equivale a **381,52 MB**, acima da proposta <200 MB. CPU curta perto de 1% e p95 1,66% não demonstram cumprir estritamente <1%. Abertura cumpre a comparação experimental <2 s; o proxy visual fica <100 ms, mas Xvfb não mede latência física. p95 de cinco rodadas é o máximo, sem garantia estatística.

A árvore observada tem main, três zygotes, GPU, serviço de rede e um renderer. Após fechamento, somente o renderer desaparece; o shell mantém cerca de 275,16 MiB PSS mediano. Antes do CodeMirror, Electron já usa 328,92 MiB; streaming/editor aberto usa 348,15 MiB e digitação intensiva 386,05 MiB. Logo, o editor sozinho não explica o custo base, e o fechamento não libera toda a árvore por desenho. O buffer de painéis é limitado; CodeMirror é carregado sob demanda; polling já é adaptativo. Não foi demonstrado vazamento contínuo, nem atribuído causalmente o custo de React/polling sem profiler. A digitação sintética inclui muitos eventos e gravações, chegando a ~80% de um núcleo no total; não representa custo ocioso. Não foram aplicadas otimizações especulativas ou redução de segurança. Comparar com os 377 MiB históricos não permite alegar melhoria: ambiente e metodologia mudaram.

### Limitações e compatibilidade

Validado: Debian 13.7, kernel 6.12.113+deb13-cloud-amd64, KVM 2 vCPU/4 GiB, X11 virtual Xvfb 1440×1000×24, D-Bus, GPU por software; digitação e viewport 900 px. Carga do host e caches não controlados. Não validado: GNOME/KDE, Wayland, clique físico X/tray, suspensão ACPI/logind, escalas diversas, hardware real sob pressão de memória e pacote distribuível. Nenhum desses itens foi marcado aprovado por existência de script. O Ubuntu principal continua bloqueado para o binário local; a VM constitui a execução Linux válida permitida pela SPEC.

Arquivos desta etapa: `scripts/desktop-test.mjs`, `harness.mjs`, `report.mjs`, novos `desktop-proof.mjs`, `benchmark-series.mjs`, `scripts/vm/*.sh`, `tests/review.test.mjs`, comando `benchmark:series`, documentos existentes atualizados e novo [procedimento VM](../AMBIENTE_VM_FASE_0.md). JSONs/logs/screenshots em `benchmarks/runs/`, `series/` e `spec001/`; histórico anterior em `history/pre-spec001/`. Não houve integração de CLIs/APIs, reconstrução, commit, publicação ou avanço de fase.

## Revisão anterior — histórico (bloqueio no host Ubuntu)

23/10/2026. Escopo: revisar implementação existente, corrigir problemas demonstrados e repetir validações possíveis. Não houve reconstrução, integração de agente/API, mudança de stack ou avanço à Fase 1.

## Decisão de aceite

**Bloqueado.** O critério P0 exige Electron com sandbox real e `npm run test:desktop` aprovado integralmente. Isso não ocorreu. A última tentativa desktop, às **18:50:40 BRT**, abortou no preflight por SIGTRAP. O JSON mantém `passed:false`, `status:blocked`, `stage:native-preflight`, `checks:[]`, `artifacts:[]`.

[Resultado atual do desktop](../../benchmarks/desktop-latest.json) · [rodada imutável](../../benchmarks/runs/2026-10-23T21-50-40-657Z/desktop.json) · [kernel](../../benchmarks/sandbox-kernel.txt) · [diagnóstico e requisitos de ambiente](../SANDBOX_LINUX.md).

## Achados e correções

| Achado | Evidência e ação |
|---|---|
| Sandbox indisponível para o executável atual | Kernel registra transição para `unprivileged_userns` e recusa de `sys_admin`; helper npm UID 1000/0755, sem SUID root. Não houve alteração administrativa. Bloqueio mantido |
| Benchmark aceitava PID inexistente como RAM/CPU zero | Novo teste falhou com `Missing expected rejection` antes da correção. Amostragem agora exige processo vivo antes/depois e identidade PID + starttime igual; término durante a janela também é testado |
| Cliente fechado durante handshake continuava conectado até timeout | Reproduzido com servidor Unix que não envia desafio; teste falhou antes da correção. `close()` agora destrói também o transporte ainda não autenticado. Falhas só rejeitam chamadas da própria conexão |
| Leitura de memória de processos alheios na amostragem | Código anterior lia smaps de todos os processos. Agora lê memória somente da árvore medida, evitando overhead desnecessário; a metodologia anterior foi preservada como histórico |
| Teste desktop usava botão IPC em vez de fechamento nativo | Teste alterado para `BrowserWindow.close()`, equivalente ao X na API. Acrescentadas asserções de ausência de renderer, mesmo PID do daemon e avanço de streaming/heartbeat sem janela. Preparado, mas não executado aqui por bloqueio P0 |
| Preferências e argumentos não bastavam como prova de sandbox | Harness passou a exigir runtime `sandboxed/contextIsolated` do preload, Seccomp=2 e NoNewPrivs=1 no PID real do renderer. A ponte expõe só dois booleanos adicionais, sem capacidades nativas. Essas verificações não foram alcançadas nesta execução |
| Relatório atribuía qualquer falha desktop ao sandbox | Agora registra etapa e causa; teste verifica que falha de restauração não se transforma em diagnóstico de sandbox e que `passed:true` sem prova de sandbox não é aprovado |
| Imagens antigas poderiam se confundir com nova evidência | Histórico inicial arquivado antes de sobrescrever JSONs. Rodadas novas têm diretório próprio e lista dos artefatos realmente produzidos. Nenhuma imagem antiga foi reutilizada como aceite |

O main também recusa flags que desativem camadas do sandbox e execução em processo único. O contrato HMAC, stack e modelo de persistência não foram substituídos. Nenhuma falha funcional do daemon foi encoberta como problema de ambiente.

## Verificações executadas

| Comando/verificação | Resultado real |
|---|---|
| `npm ci` | Sucesso, usando lockfile existente |
| `npm run check` | Sucesso, sem erro TypeScript |
| `npm test` | **7 aprovados, 0 falhas, 0 ignorados**; build incluído |
| Regressões antes das correções | Dois testes falharam conforme esperado: PID inexistente e cancelamento de handshake |
| `npm run sandbox:diagnose` | Diagnóstico concluído, sem alterações; isso não aprova sandbox |
| `npm run test:desktop` | **Falhou com código 1**, sandbox-host no preflight; não ignorado nem convertido em sucesso |
| `node scripts/desktop-test.mjs` após build final | Mesma falha de sandbox-host; relatório final preservado em `runs/` |
| `npm run benchmark` e repetição com script após build final | Daemon medido; última rodada com 200 chamadas de socket |
| `npm run benchmark:report` | Relatório atualizado a partir dos JSONs atuais |

As sete verificações automatizadas incluem os três testes prévios do daemon (concorrência, acesso restrito, autenticação/replay, heartbeat com SIGSTOP/SIGCONT, reconexão, SIGKILL/recuperação, SQLite WAL/FTS5 e shutdown) e quatro regressões da revisão. Não representam sete testes desktop. O bloqueio impede alcançar as etapas P1 da janela, mesmo que o daemon isolado esteja validado.

## Medições novas e histórico

Mesmo computador, uma rodada local por cenário; outras aplicações do usuário estavam ativas. Mudança metodológica: coleta de PSS limitada à árvore alvo e recusa de PID inválido. Não há amostra desktop nova válida.

| Daemon isolado | Histórico inicial | Última revisão |
|---|---:|---:|
| Início até handshake/ping | 112,37 ms | 115,91 ms |
| RAM ociosa RSS | 63,06 MiB | 63,09 MiB |
| RAM ociosa PSS | 33,14 MiB | 33,02 MiB |
| CPU ociosa na janela | 0,00% | 0,00% |
| CPU streaming | 0,19% | 0,20% |
| IPC p95 (200 chamadas) | 0,56 ms | 0,49 ms |

CPU=100% representa um núcleo lógico; zero é ausência de ticks contabilizados em aproximadamente 5 s, não consumo absoluto nulo. Essas diferenças não demonstram ganho estatisticamente significativo. O streaming é sintético, sem modelo/CLI. Os ~377 MiB PSS anteriores do Electron continuam evidência histórica descartada para aceite; não foram otimizados ou revalidados nesta revisão.

[Resultado bruto atual do daemon](../../benchmarks/daemon-latest.json) · [relatório atual](../../benchmarks/RESULTADOS.md) · [procedimento reproduzível](../BENCHMARKS.md) · [histórico anterior](../../benchmarks/history/initial-phase0/RESULTADOS.md).

## Arquivos da revisão

- Runtime: `packages/local/src/client.ts`; `apps/desktop/src/main.ts`, `preload.ts`, `renderer.tsx`.
- Harness/relatórios: `scripts/harness.mjs`, `desktop-test.mjs`, `benchmark.mjs`, `report.mjs`; novo `scripts/sandbox-diagnose.mjs`; comando `sandbox:diagnose` em `package.json`.
- Testes: novo `tests/review.test.mjs`.
- Documentação: novos `docs/SANDBOX_LINUX.md` e este registro; ajustes no README, ACEITE, BENCHMARKS, DECISOES e PROTOCOLO_LOCAL.
- Evidências: JSONs/relatório atuais, diagnóstico, extratos do kernel, `benchmarks/runs/` e histórico preservado.

`docs/ARQUITETURA.md`, `docs/PLANO_DE_IMPLEMENTACAO.md`, documentos originais do produto, lockfile e servidor do daemon foram preservados. Não foi criado commit nem publicado conteúdo remoto.

## O que falta para o aceite

Preparar um ambiente permitido para o sandbox, com política específica aprovada pelo administrador ou helper confiável compatível, **sem desligar proteções globais**. Repetir os comandos de [SANDBOX_LINUX.md](../SANDBOX_LINUX.md), exigir sucesso integral do E2E e confirmar manualmente X/tray no compositor. Depois repetir benchmarks desktop, revisar o orçamento de RAM e registrar o resultado. Enquanto isso, não aprovar P0/P1 nem iniciar Fase 1.
