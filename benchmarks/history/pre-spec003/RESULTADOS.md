# Resultados locais — Fase 0

Gerado em 2026-10-23T22:17:11.220Z. Valores individuais da última execução; quando disponível, a série abaixo consolida pelo menos cinco rodadas. Sem garantia estatística.

Host: Intel(R) Core(TM) i3-10100F CPU @ 3.60GHz, 2 CPUs lógicas, 3.83 GiB RAM; linux 6.12.113+deb13-cloud-amd64; Node v24.21.0; Electron 45.0.0; X11. Consulte os JSONs para a distribuição e os valores brutos.

| Métrica do daemon (um processo Node) | Medição |
|---|---:|
| Início até handshake/ping | 169.76 ms |
| RAM ociosa RSS / PSS | 65.04 / 37.90 MiB |
| CPU ociosa (um núcleo = 100%) | 0.00% |
| RAM streaming RSS / PSS | 65.13 / 37.98 MiB |
| CPU streaming | 0.00% |
| Socket ida e volta p50 / p95 | 0.43 / 0.66 ms |
| Amostras de socket | 200 |

CPU 0,00% significa nenhum tick de CPU contabilizado na janela de aproximadamente 5 s, não ausência absoluta de custo. O streaming deste cenário é somente o contador sintético, sem Electron conectado. O início inclui polling de até 50 ms. O benchmark não mede fsync sob falha elétrica.

## Desktop — verificado com sandbox

[desktop-eight-panels.png](runs/2026-10-23T22-13-41-064Z/desktop-eight-panels.png) · [desktop-compact.png](runs/2026-10-23T22-13-41-064Z/desktop-compact.png) · 

| Cenário | Electron RSS / PSS MiB | Daemon RSS / PSS MiB | CPU Electron / daemon % |
|---|---:|---:|---:|
| idle | 642.51 / 328.37 | 65.20 / 34.84 | 1.33 / 0.33 |
| streaming | 662.35 / 346.35 | 66.49 / 36.14 | 3.65 / 0.33 |
| editor | 705.52 / 386.20 | 68.09 / 37.73 | 73.67 / 3.65 |
| noWindow | 499.57 / 272.86 | 68.63 / 38.28 | 0.00 / 0.00 |

Abertura Electron: 587.80 ms. Reabertura: 339.68 ms. Intervalo de frames p95: 16.70 ms; 0 intervalos acima de 50 ms.

- oito painéis em um renderer
- sandbox efetivo: runtime isolado, filtro seccomp e NoNewPrivs no renderer
- sandbox, contextIsolation e ausência de Node no renderer
- IPC inválido rejeitado
- layout compacto sem overflow horizontal
- fechamento nativo equivalente ao X destrói BrowserWindow; mesmo daemon continua heartbeat e streaming
- segunda execução reabre janela, restaura editor e colunas com mesmo daemon
- pausa simulada e retomada: reconexão, identidades preservadas, singleton continua recusando duplicado
- encerrar Electron preserva daemon independente
- nenhum erro no renderer

## Série SPEC-001 — 5 rodadas válidas

Ambiente: Debian13 QEMU10 KVM 2vCPU 4GiB Xvfb1440x1000x24 DBus software-GPU; host workloads uncontrolled. [Manifesto e JSONs brutos](series/2026-10-23T22-10-53-606Z/manifest.json). p95 entre cinco rodadas é o máximo (nearest-rank); não é intervalo de confiança.

| Tempo | Mediana ms | p95 ms |
|---|---:|---:|
| Partida integrada, processos/perfil novos | 533.60 | 548.72 |
| Shell com daemon pronto | 579.52 | 597.57 |
| Reabertura | 380.24 | 493.60 |
| p95 rAF por rodada | 16.80 | 16.80 |
| Foco até dois rAF (proxy) | 31.30 | 32.20 |

Cache do SO preservado; preflight aquece bibliotecas antes da abertura instrumentada. Xvfb não mede latência física de display.

| Cenário / escopo | RSS mediana / p95 MiB | PSS mediana / p95 MiB | CPU mediana / p95 % de um núcleo |
|---|---:|---:|---:|
| idle / electron | 643.75 / 646.25 | 328.92 / 330.50 | 1.00 / 1.66 |
| idle / daemon | 65.20 / 65.22 | 34.86 / 34.92 | 0.00 / 0.33 |
| idle / total | 708.96 / 711.32 | 363.84 / 365.35 | 1.00 / 1.66 |
| streaming / electron | 664.22 / 667.09 | 348.15 / 349.80 | 3.66 / 4.98 |
| streaming / daemon | 66.49 / 66.54 | 36.17 / 36.24 | 0.33 / 0.66 |
| streaming / total | 730.76 / 733.62 | 384.32 / 386.04 | 3.99 / 5.65 |
| editor / electron | 705.89 / 708.48 | 386.05 / 389.95 | 76.76 / 83.16 |
| editor / daemon | 68.08 / 68.12 | 37.73 / 37.82 | 3.66 / 3.99 |
| editor / total | 774.01 / 776.55 | 423.78 / 427.67 | 80.43 / 87.13 |
| noWindow / electron | 501.70 / 503.34 | 275.16 / 276.18 | 0.00 / 0.33 |
| noWindow / daemon | 68.87 / 69.20 | 38.58 / 38.98 | 0.00 / 0.33 |
| noWindow / total | 570.46 / 572.53 | 313.74 / 314.90 | 0.00 / 0.67 |

Total é soma das árvores medidas simultaneamente; RSS soma páginas compartilhadas repetidas. Streaming inclui editor aberto; editor adiciona digitação sintética; noWindow mantém streaming e shell/tray sem renderer.

Proposta RAM <200 MB: PSS total ocioso mediano **381.52 MB**. CPU ociosa total mediana **1.00%**. Esses números não aprovam o orçamento: requer revisão explícita, assim como o protocolo IPC.

## Evidência preliminar da interface

A UI foi renderizada e inspecionada em 1440 px e 900 px. Os [oito painéis de fluxo e editor](history/initial-phase0/desktop-eight-panels.png) e a [vista compacta](history/initial-phase0/desktop-compact.png) são de uma execução inicial em que o Playwright adicionou sua flag padrão de desativar sandbox. Essa execução foi descartada para o aceite; o código/harness atuais recusam essa condição.

Nessa execução preliminar foram observados: Electron ocioso ~884 MiB RSS somada / 377 MiB PSS e ~2,16% de um núcleo; com streaming/editor ~903 MiB RSS / 393 MiB PSS; abertura ~526 ms e intervalo rAF p95 ~6,1 ms. Esses valores não são benchmark válido da configuração final; o daemon ainda tinha launcher auxiliar e o renderer consultava a cada 250 ms mesmo ocioso. Não se inferem aprovação do orçamento de memória ou segurança desses números.

## Metas propostas e pendências

Abertura <2 s, RAM ociosa <200 MB, CPU ociosa <1% e feedback <100 ms continuam metas propostas. O daemon isolado apresenta consumo baixo nesta carga. A evidência preliminar do desktop excedeu a proposta de RAM, mesmo considerando PSS. A série válida, quando presente, compara Electron/daemon/total. A soma RSS repete páginas compartilhadas; PSS é apresentada separadamente. A aprovação do orçamento permanece pendente, mesmo após validação funcional.

As cinco rodadas antigas de desktop/daemon não incluem CLI. O E2E SPEC-002 usa CLIs simuladas e não mede serviço pago. GNOME/KDE, X/menus de tray físicos, suspensão real, reinício de sessão e pacote distribuível continuam pendentes. Execuções válidas em X11 virtual são identificadas acima e não provam integração com um compositor físico. [Procedimento de repetição](../docs/BENCHMARKS.md).

## SPEC-002 — repetição dos benchmarks e teste de PTYs

Depois das mudanças da Fase 1, a série de cinco rodadas de `benchmark:series` voltou a executar os cenários desktop/daemon antigos, sem CLI conectada, em Debian 13/KVM e com o mesmo ambiente instrumentado da série histórica. A metodologia continua usando PSS separado por árvore Electron/daemon, amostras simultâneas, Xvfb e carga de host não controlada.

| Cenário (mediana PSS MiB) | Electron | Daemon | Total | Total p95 |
|---|---:|---:|---:|---:|
| Ocioso | 336,16 | 37,79 | 373,97 | 377,66 |
| Streaming + editor | 353,01 | 37,84 | 390,86 | 393,15 |
| Digitação no editor | 389,92 | 40,61 | 430,24 | 433,83 |
| Janela destruída (tray + daemon) | 276,12 | 42,03 | 318,23 | 320,13 |

Comparada à mediana histórica SPEC-001 no mesmo tipo de VM, a mediana ociosa cresceu **10,13 MiB PSS** (363,84 → 373,97 MiB); `noWindow` cresceu 4,49 MiB. É uma regressão pequena mas observável, compatível com o carregamento da nova interface e componentes de terminal; não foi feita atribuição causal por profiler. A CPU mediana ociosa ficou em 1,66% de um núcleo (p95 1,99%), acima da mediana histórica de 1,00%. Valores próximos a 1% dependem da resolução dos ticks e não aprovam limite estrito.

Partida integrada: mediana 571,61 ms; abertura Playwright com daemon pronto: 625,98 ms; reabertura: 454,94 ms. A cadência rAF p95 mediana ficou em 16,80 ms. A proposta RAM de 200 MB continua acima da mediana medida.

Manifesto e os dez JSONs brutos: [série final 2026-10-23T23-46-03-673Z](series/2026-10-23T23-46-03-673Z/manifest.json). A quinta rodada também tem [prova final do sandbox e ciclo](runs/2026-10-23T23-48-52-955Z/desktop.json).

### Dois terminais e janela fechada

Execução E2E única em Debian 13/KVM (2 vCPU/4 GiB), Xvfb 1440×1000, D-Bus e GPU por software; Playwright instrumenta o processo Electron; janela, daemon e CLIs foram medidos separadamente por PSS. Cada amostra durou ~2,5 s. A carga do host não foi controlada. Os totais incluem o processo Electron/tray sem janela quando fechado e as CLIs indicadas; PSS é aproximado.

| Estado | Electron PSS | Daemon PSS | CLI A + B PSS | Total PSS | CPU total (% de um núcleo) |
|---|---:|---:|---:|---:|---:|
| Janela ociosa, sem CLI | 379,36 MiB | 40,92 MiB | — | 420,29 MiB | 1,20% |
| Dois PTYs ativos | 437,91 MiB | 36,96 MiB | 17,83 + 17,83 MiB | 510,54 MiB | 1,99% |
| Janela destruída, daemon + dois PTYs vivos | 348,33 MiB | 37,08 MiB | 17,84 + 17,84 MiB | 421,09 MiB | 0,00% |

Na referência histórica SPEC-001, a mediana total ociosa era 363,84 MiB PSS. Esta amostra E2E ociosa ficou 56,45 MiB acima, enquanto a série final de cinco rodadas sem agentes ficou 10,13 MiB acima. A diferença reforça a limitação de comparar uma única rodada instrumentada com uma mediana. A referência de 200 MB permanece meta histórica, sem ser limite de aceite. Para RSS, os totais medidos foram 792,40 / 1.017,52 / 828,40 MiB nos três estados; soma RSS repete páginas compartilhadas.

A CPU observada inclui polling, renderer e carga dos harnesses. Na janela fechada, a amostra registrou 0,00% (nenhum tick no intervalo), não ausência absoluta de custo. As CLIs nessa tabela são simuladores locais, sem modelo, conta ou serviço pago. A série acima mede o laboratório/daemon sem agentes; este E2E mede ainda os dois processos CLI.

Evidências: [JSON e PIDs/branches](runs/2026-10-23T23-44-56-394Z/phase1-e2e.json), [dois terminais](runs/2026-10-23T23-44-56-394Z/phase1-two-terminals.png), [reconexão](runs/2026-10-23T23-44-56-394Z/phase1-reconnected.png). O teste verifica os mesmos PIDs antes e depois de destruir/recriar a janela e valida que a sessão reaberta voltou ao mesmo daemon; isso não testa recuperação após crash do daemon.
