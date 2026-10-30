# Dívidas e problemas fora de escopo

Problemas encontrados durante a refatoração ([SPEC_REFATORACAO.md](SPEC_REFATORACAO.md)) que não são resolvidos na tarefa em que apareceram. Cada item diz onde foi visto e em que fase deve ser tratado, quando isso já está definido.

| # | Item | Onde | Quando tratar |
|---|---|---|---|
| 1 | Onboarding manual: o usuário precisa editar `~/.config/eros/dots.json` à mão, com caminhos absolutos. | daemon / config | Refatoração – Fase 4 (tela de Dots) |
| 2 | O Chat só guarda as mensagens do usuário; a resposta do agente aparece apenas no terminal. | chat | Fora desta entrega |
| 3 | CPU alta (~77%) do Electron no cenário "editor" com digitação sintética (medido na VM). | desktop / editor | Refatoração – Fase 4 (investigar) |
| 4 | Electron com a janela fechada ocupa ~275 MB PSS (tray), contra ~38 MB do daemon sozinho. | desktop / main | Refatoração – Fase 4 (decisão do usuário) |
| 5 | O renderer ainda faz polling: `RunDesk.tsx` recarrega as Runs a cada 3 s (`setInterval`). O polling de 250 ms citado na spec não existe mais. | `apps/desktop/src/RunDesk.tsx:312` | Refatoração – Fase 3 (trocar por eventos) |
| 6 | 11 blocos `catch {}` vazios: `main.ts:75,393,406`, `RunDesk.tsx:114`, `auto-resume.ts:133`, `continuity.ts:155`, `permissions.ts:49`, `diagnostics.ts:57`, `runs.ts:606,700,787`. | desktop / daemon | Refatoração – Fase 1 |
| 7 | O Electron não abre com sandbox no Ubuntu (host e CI do GitHub): `chrome-sandbox` não é SUID root e o AppArmor restringe user namespaces. Localmente há contorno (ver [BASELINE.md](BASELINE.md)); **no CI os testes de desktop nunca passam**. | ambiente / `.github/workflows/linux.yml` | Refatoração – Fase 1 |
| 10 | `test:desktop` e `test:e2e` estão desatualizados desde o redesign (`ef277d9`): esperam `Daemon conectado` na primeira tela, texto que agora só existe na tela de diagnóstico. | `scripts/desktop-test.mjs`, `scripts/phase1-e2e.mjs` | Refatoração – Fase 1 |
| 8 | `npm run benchmark` e `test:desktop` gravam em arquivos versionados (`benchmarks/*-latest.json`, `benchmarks/runs/`). | scripts | Refatoração – Fase 1 (higiene) |
| 9 | O build do Vite avisa sobre um chunk maior que 500 kB e uma diretiva `"use client"` ignorada. | build | Avaliar na Refatoração – Fase 3 |
