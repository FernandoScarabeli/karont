# Plano — Refatoração – Fase 2 (estrutura de pastas e quebra dos arquivos grandes)

Branch da fase: `refactor/fase-2-estrutura`. Cada tarefa roda em worktree própria (`~/karont-worktrees/fase-2-tarefa-N`, branch `refactor/fase-2-tarefa-N`), é revisada pelo orquestrador e entra na branch da fase por fast-forward. Um PR por fase, para `main`.

Regras comuns a todas as tarefas (não repetidas abaixo): seguir `AGENTS.md` e `docs/SPEC_REFATORACAO.md` seção 5; **nada visível muda** (se um pixel mudar, é bug desta fase); sem dependências novas; sem store global (decisão 18); não alterar `packages/**`, `apps/daemon/**`, schema nem protocolo; nenhum texto de UI, `aria-label`, classe CSS ou regra CSS muda; problemas fora do escopo vão para `docs/DIVIDAS.md`; relatório final no formato da seção 5.1. Critérios sempre presentes: `npm run check`, `npm run format:check` e `npm test` passam; o orquestrador roda a comparação visual (T1) e os E2E antes de integrar.

## Situação medida (2026-10-30)

| Arquivo | Linhas | Observação |
|---|---:|---|
| `WorkspaceDesk.tsx` | 1.790 | 48 `useState`; contém `ChatView` (~720 linhas, l. 1029) e `FormDialog` (l. 1755) |
| `TaskDesk.tsx` | 1.031 | `TaskCreationDialog`, `TaskDesk`, `TaskCard`, `TaskDetailsDialog` |
| `RunDesk.tsx` | 817 | `TerminalPane` + `RunDesk`; importa `xterm.css` |
| `main.ts` | 585 | janela, bandeja, daemon, notificações e todos os `ipcMain.handle` juntos; 1 `any` (l. 276) |
| `renderer.tsx` | 341 | bootstrap + `LegacyWorkbench` (laboratório, faz polling — DIVIDAS #5, não mexer) |
| `api.ts` | 247 | tipos `Ui*` e o `KarontBridge`; o `preload.ts` não é checado contra esse tipo |

## Estrutura alvo

```
apps/desktop/src/
  main/          # processo principal: index.ts (bootstrap), window, tray, tray-icon, daemon, ipc, notifications, diagnostics
  preload/       # preload.ts — implementa KarontBridge (satisfies)
  shared/        # bridge.ts — tipo KarontBridge e tipos Ui* usados pelo preload e pelo renderer
  renderer/
    main.tsx     # entrada do Vite (antigo renderer.tsx, só bootstrap)
    app/         # App, rotas, LegacyWorkbench
    features/
      workspace/ # WorkspaceDesk, sidebar, home, modal de projeto, hooks
      chat/      # ChatView e partes, hooks
      runs/      # RunDesk, TerminalPane, diff/rollback
      tasks/     # TaskDesk, diálogos, cartão
      editor/    # Editor (CodeMirror)
      attention/ # Attention
      continuity/# ContinuityControls
    components/  # FormDialog e outros reutilizáveis já existentes
    lib/         # api.ts (reexporta os tipos de shared/), utilitários
    styles/      # tokens.css, style.css, karont.css (sem mudar conteúdo; consolidação é Fase 3)
```

Desvio da spec, com justificativa: `shared/` não estava na estrutura alvo. O tipo do `window.karont` precisa ser visto pelo preload e pelo renderer; deixá-lo em `renderer/lib` faria o preload importar do renderer.

## Armadilhas conhecidas

- **Ordem do CSS.** Hoje o `xterm.css` entra antes de `tokens.css`/`style.css`/`karont.css`, porque `renderer.tsx` importa `RunDesk` antes deles. Mudar a ordem dos imports muda a cascata e pode mudar pixels. Toda tarefa preserva essa ordem; a comparação visual pega se não.
- **Saídas do build.** `scripts/build.mjs` gera `dist/desktop/main.cjs`, `preload.cjs` e `notifications.cjs`; `package.json` (`start`), os scripts de E2E e `tests/phase2.test.mjs` dependem desses nomes. Os caminhos de entrada mudam; os de saída **não**.
- **`__dirname` no main.** `main.ts` acha o `index.html` por `path.join(__dirname, '../renderer/index.html')`. Como a saída continua em `dist/desktop/`, isso não muda, mas qualquer outro caminho relativo precisa ser conferido.
- **Ordem de efeitos no main.** `app.setName`/`app.setPath` e `migrateLegacyDirs()` rodam antes de qualquer outra coisa (ver T5 da Fase 1). Ao dividir o `main.ts`, módulos importados não podem ter efeitos colaterais no topo que rodem antes disso.

## Ordem e dependências

```
T1 comparação visual (orquestrador)  →  T2 mover arquivos  →  T3 tipar o bridge
  →  T4 dividir main.ts  →  T5 componentes compartilhados
  →  T6 ChatView  →  T7 WorkspaceDesk  →  T8 TaskDesk  →  T9 RunDesk
  →  T10 renderer/app  →  T11 docs e verificação final (orquestrador)
```

T2 vem antes das quebras para que cada quebra seja um diff pequeno dentro da pasta certa, em vez de mover e dividir ao mesmo tempo.

---

### T1 — Rede de segurança: comparação visual (orquestrador)

- **Executor:** orquestrador. Precisa rodar o app várias vezes para estabilizar a captura, o que o Codex não consegue no sandbox dele.
- **Objetivo:** `scripts/visual-snapshot.mjs`, com base em `scripts/redesign-e2e.mjs` e no `harness.mjs`. Abre o app com dados fixos (projeto, conversa, tarefa e Run de fixture), relógio fixo (`page.clock`) e fontes carregadas, e grava em `artifacts/visual/<nome>/` (pasta ignorada, decisão 6) um PNG e o DOM normalizado de cada tela: home em 1440, 1000 e 840 px; chat; modal de projeto; tarefas e detalhes de tarefa; Run com terminal e diff; atenção; diagnóstico; laboratório. Modo `--compare <a> <b>`: diz quais telas diferem (PNG byte a byte e DOM), sem dependência nova.
- **Aceite:** duas capturas seguidas em `main`, sem nenhuma mudança, dão diferença zero (sem isso a comparação não serve). Linha de base de `main` salva em `artifacts/visual/main/`. Script `npm run visual` no `package.json`.
- **Pode alterar:** `scripts/visual-snapshot.mjs`, `package.json` (só o script), `docs/PROGRESSO.md`.

### T2 — Mover os arquivos para a estrutura alvo (sem dividir nada)

- **Objetivo:** `git mv` de cada arquivo para o lugar da estrutura alvo, ajustando só imports, as entradas de `scripts/build.mjs` e o `src` do `apps/desktop/index.html`. `renderer.tsx` vira `renderer/main.tsx`; `main.ts` vira `main/index.ts`. Nenhuma linha de lógica muda; nenhum arquivo é dividido.
- **Pode alterar:** `apps/desktop/**`, `scripts/build.mjs`.
- **Aceite:** `git diff -M --stat` mostra renomeações com similaridade alta; saídas em `dist/` com os mesmos nomes; ordem dos imports de CSS preservada; comparação visual zero.

### T3 — Tipar o `window.karont` num lugar só

- **Objetivo:** mover `KarontBridge` e os tipos `Ui*` para `shared/bridge.ts`; `renderer/lib/api.ts` reexporta (os imports dos componentes não mudam além do caminho). No `preload.ts`, o objeto passado a `exposeInMainWorld` usa `satisfies KarontBridge`, e os erros que isso revelar são corrigidos **só nos tipos** (se revelar um comportamento errado, anota em DIVIDAS e para). Remover o `any` de `main/index.ts` (l. 276) com o tipo correto do valor de cada handler.
- **Pode alterar:** `apps/desktop/src/shared/**`, `preload/**`, `renderer/lib/**`, imports em `renderer/**`, `main/index.ts` (só o `any`).
- **Aceite:** `grep -rnE ': any|as any|<any>' apps/desktop/src` vazio; o JS gerado do preload é o mesmo (comparar `dist/desktop/preload.cjs` antes/depois, ignorando sourcemap).

### T4 — Dividir o processo principal

- **Objetivo:** quebrar `main/index.ts` em `window.ts` (criar/abrir janela, URL confiável), `tray.ts` (bandeja e `updateTray`), `daemon.ts` (cliente, `ensureDaemon`, heartbeat), `ipc.ts` (registro de todos os `ipcMain.handle`, `authorize`, `noValue`, schemas zod da UI), `diagnostics.ts`. `index.ts` fica só com o bootstrap, na mesma ordem de hoje. Estado compartilhado (janela, run alvo, conjuntos de runs) passa explicitamente ou fica num módulo `state.ts`, sem variável global nova escondida.
- **Pode alterar:** `apps/desktop/src/main/**`.
- **Aceite:** nenhum arquivo do main acima de ~250 linhas; mesmos canais IPC (comparar a lista de `ipcMain.handle` antes/depois); mesma validação; `test:desktop` e os 3 E2E passam (orquestrador).

### T5 — Componentes compartilhados

- **Objetivo:** extrair `FormDialog` (e outros componentes genéricos que já se repetem entre `WorkspaceDesk` e `TaskDesk`, se houver) para `renderer/components/`, um por arquivo. Só extrair o que **já existe**; criar a biblioteca de componentes é Fase 3.
- **Pode alterar:** `renderer/components/**`, `renderer/features/workspace/WorkspaceDesk.tsx`, `renderer/features/tasks/TaskDesk.tsx`.
- **Aceite:** markup gerado idêntico (DOM da T1); nada duplicado entre os dois arquivos que tenha virado componente.

### T6 — Tirar o Chat do `WorkspaceDesk`

- **Objetivo:** `ChatView` e `deliveriesByMessage` vão para `features/chat/`, quebrados em partes por responsabilidade (cabeçalho, lista de mensagens, composer, etc.) e com o estado agrupado em hooks (`useChatDraft`, `useChatMessages`, ou o que o código pedir). Manter exatamente a lógica do rascunho (DIVIDAS #14 é uma corrida conhecida: não corrigir aqui, não piorar).
- **Pode alterar:** `renderer/features/chat/**`, `renderer/features/workspace/WorkspaceDesk.tsx`.
- **Aceite:** nenhum arquivo de `features/chat` acima de ~400 linhas; spec006 (que exercita o Chat) passa 3 vezes seguidas localmente.

### T7 — Quebrar o `WorkspaceDesk`

- **Objetivo:** dividir o restante em sidebar, home, modal de projeto e o que mais o código mostrar; agrupar os `useState` em hooks por assunto (`useWorkspaces`, `useProjects`, `useChats`, `useNavigation`...). Os hooks devolvem o mesmo estado e fazem as mesmas chamadas, na mesma ordem.
- **Pode alterar:** `renderer/features/workspace/**`.
- **Aceite:** nenhum arquivo acima de ~400 linhas; `WorkspaceDesk.tsx` só compõe as partes; mesmas chamadas ao `window.karont` no carregamento (conferir pelo log do daemon ou contagem nos E2E).

### T8 — Quebrar o `TaskDesk`

- **Objetivo:** `TaskCreationDialog`, `TaskCard`, `TaskDetailsDialog` e `eventLabel` em arquivos próprios em `features/tasks/`; estado do quadro em hook (`useTasks`).
- **Pode alterar:** `renderer/features/tasks/**` e o import de `TaskCreationDialog` em `features/workspace`.
- **Aceite:** nenhum arquivo acima de ~400 linhas.

### T9 — Quebrar o `RunDesk`

- **Objetivo:** `TerminalPane`, painel de diff/rollback e lista de Runs em arquivos próprios em `features/runs/`; estado em hooks. O polling de 3 s (DIVIDAS #5) continua igual: trocar por eventos é mudança de comportamento, não desta fase. O import de `xterm.css` continua sendo avaliado antes dos estilos do app.
- **Pode alterar:** `renderer/features/runs/**`.
- **Aceite:** nenhum arquivo acima de ~400 linhas; phase1-e2e (que exercita Runs) passa.

### T10 — Bootstrap e app

- **Objetivo:** `renderer/main.tsx` fica só com o `createRoot` e os imports de estilo; o roteamento vai para `app/App.tsx` e o `LegacyWorkbench` para `app/LegacyWorkbench.tsx` (ou `features/lab/`, se ficar mais claro). Polling do laboratório inalterado.
- **Pode alterar:** `renderer/main.tsx`, `renderer/app/**`.
- **Aceite:** ordem efetiva do CSS idêntica (ver a T1); comparação visual zero.

### T11 — Documentação e verificação final (orquestrador)

- **Objetivo:** atualizar `docs/ARQUITETURA.md` (nova estrutura), `docs/design/DESIGN_SYSTEM.md` (caminho de `tokens.css`), a seção 11 da spec só se ela for lida como referência viva (senão, nota em PROGRESSO), `AGENTS.md` se citar caminhos. Rodar o roteiro da seção 7 da spec inteiro, inclusive `benchmark` (comparar com `BASELINE.md`), e a comparação visual final contra `artifacts/visual/main/`.
- **Aceite:** nenhum arquivo de UI acima de ~400 linhas (`wc -l`); diff visual zero; E2E verdes local e no CI; PROGRESSO e RETOMAR atualizados; PR da fase aberto.

## Decisões

Registradas como decisões 18–20 em PROGRESSO.

- **18. Estado:** só hooks por feature, sem store global (usuário, 2026-10-30).
- **19. Pasta `shared/`** para o tipo do bridge (orquestrador; justificativa acima).
- **20. "Diff visual nulo"** é medido pela T1: PNG idêntico byte a byte e DOM idêntico, nas telas listadas. Se a T1 mostrar que a captura não estabiliza em PNG (fonte, antialias), o critério passa a ser DOM idêntico + PNG conferido a olho pelo orquestrador, e isso é registrado aqui (orquestrador).
