# Linha de base — Refatoração – Fase 0

Medido em 2026-10-30, na branch `refactor/fase-0-baseline` (sem mudança de código em relação a `main`, commit `8c8ed9a`). Resultados brutos ficam fora do git, em `~/karont-baseline/2026-10-30/` na máquina do usuário.

## Ambiente

| Item | Valor |
|---|---|
| Máquina | Hardware real (não VM): Intel Core Ultra 9 285K, 24 threads, 30 GiB RAM |
| Sistema | Ubuntu 26.04.1 LTS, kernel 7.0.0-38, sessão Wayland |
| Node | v24.22.2 (via fnm) |
| Electron | 45.0.0 |
| Carga | **PC não ocioso**: Docker Desktop (VM de 5 GB), IntelliJ e Firefox abertos, ~45% de CPU somada. Load average ~0,4–0,7. |

As medições anteriores do projeto (VM Debian, 2 vCPU, GPU por software) não são diretamente comparáveis com estas.

## Resultado dos comandos

| Comando | Resultado | Tempo |
|---|---|---|
| `npm ci` | OK, 0 vulnerabilidades | 10,6 s |
| `npm run check` | OK | 1,4 s |
| `npm test` | OK, **42/42** | 11,2 s |
| `npm run test:desktop` | **Falha** (ver abaixo) | 11,9 s |
| `npm run test:e2e` | **Falha** (ver abaixo) | 18,0 s |
| `npm run benchmark` | OK, 3 rodadas | — |

### Por que `test:desktop` e `test:e2e` falham

São duas camadas de falha, ambas anteriores a esta refatoração:

1. **Sandbox do Electron no host.** O Ubuntu restringe user namespaces via AppArmor, e o `chrome-sandbox` instalado pelo npm não é SUID root. O Electron aborta antes de abrir (sem desligar o sandbox, corretamente). O **CI do GitHub falha no mesmo ponto** (`native-preflight`, run `40253587872`, em `main`): nenhuma execução recente do CI passou dos testes de desktop.
   - Contorno local adotado (sem desligar proteções): helper root `4755` em `/usr/local/lib/karont-dev/chrome-sandbox`, apontado por `CHROME_DEVEL_SANDBOX`. O Chromium **só respeita essa variável quando não existe `chrome-sandbox` ao lado do executável**, então a cópia do npm foi renomeada para `node_modules/electron/dist/chrome-sandbox.local-desativado`. Um `npm ci` restaura a cópia e exige repetir o renome.
2. **Testes desatualizados em relação à UI.** Com o sandbox resolvido, o app abre e funciona (tela inicial com "Nova conversa", Projetos, Conversas livres). Os dois testes esperam o texto `Daemon conectado` na primeira tela, mas depois do redesign (`ef277d9`) esse texto só aparece na tela de diagnóstico. Falham por timeout em `scripts/desktop-test.mjs:105` e em `scripts/phase1-e2e.mjs`.

Consequência: **não há linha de base verde para os testes de desktop e E2E**, nem métricas de memória/tempo do Electron em hardware real.

## Benchmark do daemon (`npm run benchmark`)

Mede só o daemon (não abre o Electron). Três rodadas; mediana. Os valores foram estáveis entre as rodadas.

| Métrica | R1 | R2 | R3 | **Mediana** |
|---|---:|---:|---:|---:|
| Inicialização | 108,1 ms | 109,2 ms | 107,4 ms | **108,1 ms** |
| Memória ociosa (PSS) | 48,7 MiB | 48,8 MiB | 48,8 MiB | **48,8 MiB** |
| Memória ociosa (RSS) | 71,4 MiB | 71,5 MiB | 71,5 MiB | **71,5 MiB** |
| CPU ociosa (1 núcleo) | 0% | 0% | 0,2% | **0%** |
| Memória em streaming (PSS) | 48,8 MiB | 48,8 MiB | 48,8 MiB | **48,8 MiB** |
| Ida e volta IPC p50 | 0,22 ms | 0,40 ms | 0,36 ms | **0,36 ms** |
| Ida e volta IPC p95 | 0,44 ms | 0,53 ms | 0,48 ms | **0,48 ms** |

O PSS (~49 MiB) é maior que os ~38 MiB medidos na VM. Pode ser diferença de ambiente (Node, kernel, bibliotecas); não foi investigado. **Refazer com o PC ocioso** antes de usar estes números como limite rígido.

## Contagens de código (para acompanhar a refatoração)

| Item | Valor |
|---|---|
| Ocorrências de "eros" como palavra (fora de `node_modules`, `dist`, `.git`) | ~1.021 no total; ~538 fora de `benchmarks/` |
| Arquivos com "eros" | 185 |
| `catch {}` vazios | 11 (lista em [DIVIDAS.md](DIVIDAS.md)) |
| Polling no renderer | `RunDesk.tsx` a cada 3 s (o de 250 ms não existe mais) |
| Maiores arquivos | `WorkspaceDesk.tsx` 1.790 · `style.css` 1.837 · `workspaces.ts` 1.135 · `runs.ts` 1.090 · `karont.css` 1.007 · `RunDesk.tsx` 815 · `main.ts` 541 |
| `benchmarks/` versionado | 498 arquivos, 124 MB no disco |

## Avisos do build

O Vite avisa sobre um chunk acima de 500 kB e uma diretiva `"use client"` ignorada. Não bloqueiam.
