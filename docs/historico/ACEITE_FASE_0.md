# Verificação de aceite — Fase 0

## SPEC-001 — recomendação atual

**ACEITE TÉCNICO RECOMENDADO para a Fase 0 no ambiente Linux validado.** Não é aprovação do orçamento de desempenho ou do protocolo IPC; ambos exigem revisão explícita. Não avançar automaticamente à Fase 1.

- [x] Electron 45 com sandbox real: runtime e kernel do renderer conferidos.
- [x] Desktop integral aprovado, avulso e cinco rodadas comparáveis.
- [x] Fechamento nativo e reabertura preservam daemon e layout/editor persistidos.
- [x] Renderer destruído; mesmo PID/starttime do daemon, heartbeat e streaming continuam.
- [x] Sete testes existentes preservados; nove testes aprovados após duas regressões adicionais.
- [x] Benchmarks RSS/PSS, CPU, abertura/reabertura, streaming, edição e shell sem janela registrados.
- [x] JSONs, imagens novas, metodologia e riscos documentados.

Ambiente: VM Debian 13/KVM, 2 vCPUs/4 GiB, Xvfb X11/D-Bus, sem mudanças no host Ubuntu. [Série de cinco rodadas](../../benchmarks/series/2026-10-23T22-10-53-606Z/manifest.json), [ciclo por PID/starttime](../../benchmarks/spec001/lifecycle.json), [relatório](../../benchmarks/RESULTADOS.md), [revisão atual](REVISAO_FASE_0.md).

Metas experimentais: partida mediana 533,60 ms; total ocioso 363,84 MiB PSS (**381,52 MB**, acima de 200 MB); CPU ociosa ~1,00%, p95 1,66%, sem comprovar <1%; proxy visual mediano 31,30 ms. Essas metas não são garantias nem orçamento aprovado.

Pausa/retomada de processos com SIGSTOP/SIGCONT passou, preservando identidades e recusa de duplicado (73). **Não executados:** suspensão física, X/tray físicos, GNOME/KDE, Wayland, escalas variadas e hardware sob baixa RAM. São pendências de compatibilidade explícitas, sem impedir a recomendação para esta execução Linux, conforme SPEC-001. O host Ubuntu continua bloqueado para execução local e não recebeu aceite nessa combinação.

## Registro anterior — histórico anterior à SPEC-001

Implementação concluída no escopo do protótipo; **aceite integral ainda não concluído**. Não iniciar a Fase 1 com base neste registro.

| Entrega solicitada | Estado e evidência |
|---|---|
| Separar desktop, daemon e contratos | Implementado em `apps/` e `packages/`; build e TypeScript passam |
| Electron + React | Implementado e inspecionado visualmente em execução preliminar; início com sandbox bloqueado no host |
| Daemon independente Node/TypeScript | Validado por processos reais separados do Electron |
| Instância única | Teste de cinco concorrentes, todos recusados com código 73; o PID do servidor é o do launcher após exec |
| Socket restrito | Diretório 0700, socket/sessão 0600; testes de diretório inseguro e symlink passam |
| Protocolo, handshake e autenticação | Proposta implementada e documentada; teste de replay e servidor falso passa; revisão externa pendente |
| Heartbeat básico | Validado com ping, contador, SIGSTOP, timeout e SIGCONT sem reinício |
| Fechar/destruir janela sem matar daemon | Implementado; E2E com sandbox pendente |
| Reabrir/reconectar/restaurar layout | Persistência e reconexão do daemon validadas; ciclo da janela com sandbox pendente |
| Oito painéis + streaming + editor | Implementado; screenshot preliminar disponível; nova execução com sandbox pendente |
| RAM/CPU/início/responsividade | Daemon medido; desktop tem apenas números preliminares descartados para aceite |
| Procedimento de benchmark | Scripts e documentação disponíveis em `docs/BENCHMARKS.md` |

## Testes da implementação inicial (histórico preservado)

- `npm ci`: instalação limpa validada.
- `npm run check`: sem erros TypeScript.
- `npm test`: três testes de integração aprovados, com casos de concorrência, ACLs, handshake/replay, servidor falso, JSON inválido, limites de frame, timeout de autenticação, layout inválido, heartbeat atrasado, reconexão, crash e estado SQLite, WAL/FTS5 e encerramento autenticado.
- `node scripts/benchmark.mjs`: daemon medido com sucesso; 200 round trips, uma rodada local.
- `node scripts/desktop-test.mjs`: falha esperada no preflight do sandbox; JSON contém `passed:false`. A ausência de ambiente compatível é um bloqueio, não um teste aprovado.
- `npm run benchmark:report`: relatório Markdown gerado dos JSONs.
- `npm audit --omit=dev`: nenhuma vulnerabilidade reportada na execução local (não substitui revisão de segurança).

As screenshots foram inspecionadas durante uma execução inicial do Playwright antes de identificar sua flag padrão `--no-sandbox`. Não são prova de sandbox nem do ciclo desktop final. O harness atual exige sandbox e a aplicação recusa essa flag.

## Retomar a validação

Preparar um ambiente Linux com suporte ao sandbox do Electron seguindo a política da distribuição, sem flags que desativem proteção. Executar `npm run test:desktop` e `npm run benchmark:report`. Confirmar tray e X nativos manualmente em GNOME/KDE, testar suspensão/retomada, repetir benchmarks e aprovar protocolo e orçamento de recursos. A licença também permanece pendente; nenhuma escolha foi presumida.

## Arquivos entregues

```text
README.md                              instruções, escopo e estado real
package.json / package-lock.json       dependências e comandos reproduzíveis
tsconfig.json                          TypeScript estrito
.gitignore / .npmrc / .prettierrc.json   ambiente e formatação
apps/daemon/
  package.json
  src/entry.ts                         launcher e lock de instância
  src/server.ts                        socket, autenticação, heartbeat e SQLite
apps/desktop/
  package.json / index.html
  src/main.ts / preload.ts             shell e ponte IPC restrita
  src/renderer.tsx / style.css          laboratório com oito painéis
  src/Editor.tsx / tray-icon.ts         editor sob demanda e ícone nativo
packages/contracts/
  package.json / src/index.ts          schemas e tipos compartilhados
packages/local/
  package.json
  src/paths.ts / wire.ts / client.ts    transporte, autenticação e diretórios
scripts/
  build.mjs                            build Node/Electron/Vite
  daemon-control.mjs                   status e encerramento autenticado
  harness.mjs                          isolamento de processos e amostragem
  benchmark.mjs / desktop-test.mjs      medições e verificação de ciclo desktop
  report.mjs                           relatório legível a partir de JSON
tests/daemon.test.mjs                  três suítes de integração
docs/ARQUITETURA.md                    cópia do documento (2) recebido
docs/PLANO_DE_IMPLEMENTACAO.md         cópia do documento (3) recebido
DECISOES_FASE_0.md                escolhas e limitações
docs/PROTOCOLO_LOCAL.md                contrato e fronteira de confiança
docs/BENCHMARKS.md                     como repetir medições
ACEITE_FASE_0.md                  este registro
benchmarks/
  daemon-latest.json / desktop-latest.json
  RESULTADOS.md
  desktop-eight-panels.png / desktop-compact.png  imagens preliminares, sem aceite
```

`dist/` contém os builds locais e está ignorado pelo Git; `node_modules/` é regenerável. Os quatro documentos originais não foram alterados. O Git local foi inicializado em `main`, sem commit ou publicação remota. Logs de execução locais estão ignorados.

## Revisão técnica de 23/10/2026

O histórico anterior (JSONs, relatório e imagens) foi preservado em `benchmarks/history/initial-phase0/`. **P0 continua bloqueado**: o preflight nativo retornou 1/SIGTRAP por falha do sandbox do host. O resultado novo tem `passed:false`, `status:blocked`, etapa `native-preflight` e nenhuma imagem nova. Ver [investigação e requisitos](../SANDBOX_LINUX.md).

Na revisão, `npm ci`, `npm run check` e `npm test` foram repetidos com sucesso: **sete testes** aprovados. Três são os testes anteriores do daemon; os quatro novos cobrem PID inexistente, cancelamento de handshake, término de processo durante a amostra e classificação fiel de falhas/prova de sandbox no relatório. Os dois primeiros defeitos foram reproduzidos em testes que falharam antes da correção e passaram depois.

O benchmark isolado do daemon foi repetido. Os valores atuais estão em [RESULTADOS.md](../../benchmarks/RESULTADOS.md); não substituem medições desktop. Não foi realizada qualquer nova validação visual ou comparação de RAM do Electron.

### P1: evidência real e passos ainda bloqueados

| Passo | Revisão atual |
|---|---|
| Daemon sem duplicatas | Reexecutado com sucesso: cinco concorrentes recusados; autenticação e heartbeat válidos |
| Electron conectar ao daemon | Bloqueado antes de executar o main; não aprovado |
| Oito painéis e editor | Sem execução nova com sandbox; não aprovado |
| Modificar e persistir layout | Persistência/reconexão do daemon retestadas; interface gráfica pendente |
| Fechar pelo X | Harness agora usa caminho nativo `BrowserWindow.close()`, documentado como equivalente ao X; não executado aqui. Clique físico no X continua pendente |
| Janela destruída, mesmo daemon ativo, heartbeat/streaming avançando, sem renderer | Asserções adicionadas ao E2E; não executadas por causa do bloqueio P0 |
| Reabrir e restaurar estado | Teste existente mantido e limitado por timeout; não executado com sandbox neste host |
| Sair do shell mantendo daemon independente | Código e asserção mantidos; não aprovado nesta revisão sem execução desktop |

A implementação do teste não é evidência de sucesso. **Aceite final da Fase 0 negado enquanto `npm run test:desktop` não passar integralmente em ambiente válido.** Não houve avanço à Fase 1.

Arquivos adicionados nesta revisão: `scripts/sandbox-diagnose.mjs`, `tests/review.test.mjs`, `docs/SANDBOX_LINUX.md`, `REVISAO_FASE_0.md` e artefatos de diagnóstico/histórico em `benchmarks/`. Os demais arquivos foram ajustados pontualmente; consultar o registro da revisão.
