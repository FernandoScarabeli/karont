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
| 11 | O SPEC-005 verifica comportamentos removidos pelo redesign, além dos seletores antigos: concessão de Dot e confirmação nativa no cadastro de projeto; abertura de conversa livre global por listas de Favoritos/Conversas livres. O cadastro atual envia `dotIds: []` e o processo principal rejeita concessões nessa operação. As verificações incompatíveis foram preservadas, sem bypass por IPC; portanto o E2E completo continua bloqueado. Detalhes abaixo. | `scripts/spec005-e2e.mjs`, `apps/desktop/src/{WorkspaceDesk.tsx,main.ts}` | Orquestrador: reconciliar cobertura com o comportamento vigente em tarefa própria |
| 12 | No sandbox do executor da tarefa 1, Node 24.22.2 retorna `spawnSync getconf EPERM` ao importar `scripts/harness.mjs`. `npm test` terminou com 2 arquivos aprovados e 4 reprovados; a tentativa de `test:desktop` com o helper indicado parou na mesma importação, antes do Electron. | ambiente do executor / harness | Orquestrador: repetir os testes no ambiente gráfico autorizado |

## Mapeamento dos testes de desktop/E2E — Refatoração – Fase 1, tarefa 1

- `desktop-test.mjs`: entrada inicial e janela reaberta esperavam `Daemon conectado` antes de navegar. Agora clicam em **Configurações e ferramentas**, aguardam o mesmo sinal e clicam em **Diagnóstico e laboratório**. As verificações posteriores de reconexão permanecem no diagnóstico aberto.
- `phase1-e2e.mjs`: mesma correção na entrada e nas duas reaberturas. O antigo botão **Laboratório** está na rail oculta; o botão visível **Diagnóstico e laboratório** chega à mesma rota. Os controles de PTY, diagnóstico, aprovações e reconexão são preservados.
- `spec006-e2e.mjs`: cabeçalho antigo **Workspaces** substituído pela navegação atual; **Tarefas** agora é **ToDo**; retorno à conversa usa a busca **Buscar projetos e conversas**; **Vincular a projeto…** agora se chama **Vincular a projeto**. Na reabertura, restauração de conversa, ID, histórico e rascunho é verificada **antes** de abrir o diagnóstico e voltar pela busca.
- `spec005-e2e.mjs`: menu do workspace no rodapé; **Renomear workspace**, campo **Nome do workspace** e botão **Salvar**; projeto no modal **Criar projeto**, campo **Nome**, botão **Escolher…** e envio explícito; conversa aberta diretamente e renomeada, sem modal de criação; terminal acessado por **Terminal e execuções**; troca de conversas pela busca; execuções anteriores pelo diagnóstico. A restauração automática continua verificada antes da navegação ao diagnóstico.

### Verificações sem equivalente no SPEC-005 (#11)

1. `project-cancel`, `project-invalid`, `project-add-valid` e `project-duplicate` ainda exigem o checkbox **Fixture Dot**, `project.dotIds === ['fixture-dot']` e confirmação nativa contendo pasta e Dot. O modal atual só tem nome, ícone e pasta; `saveProject` envia `dotIds: []` e `eros:projects:add` rejeita uma lista não vazia. As interações/verificações antigas permanecem e falharão no primeiro checkbox ausente. Não é possível obter a concessão exigida apenas trocando seletores.
2. A criação atual de conversa usa `dotId: null`. Os testes passam a abrir e renomear a conversa pela UI, mas as Runs e a movimentação do SPEC-005 dependem da concessão acima, que não pode ser criada pelo cadastro atual.
3. **Favoritos** e **Conversas livres** são seções da sidebar do workspace atual, sem botões para as antigas listas globais; **Recentes** aparece na busca. `newChat(null)` mantém o workspace atual, enquanto o teste exige navegação global `workspaceId: null`. Foram mantidos os controles/seletor de lista antigos e as asserções de escopo global, favorito, ausência após movimentação e rascunho. O texto **Conversa local — vincule um projeto para executar um agente.** também não existe mais e sua espera permanece pendente. Substituir essas verificações pelas listas locais ou criar fixtures por IPC mudaria o que é testado.

Os itens #7 e #10 receberam ajustes nesta tarefa, mas não estão encerrados: faltam a execução do CI e a reconciliação do SPEC-005. Nenhuma verificação de segurança, heartbeat, persistência ou ciclo de vida foi removida para obter resultado verde.
