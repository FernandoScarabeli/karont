# KARONT — Spec de refatoração e redesign (v1.1)

> Documento de contexto e instruções para os agentes de código.
> **Fluxo de trabalho: Claude Code CLI = orquestrador (planeja e revisa) · Codex CLI = executor (implementa).**
> Veja a seção 5.1 para os papéis. Onde esta spec diz "o agente", leia: o **Claude** planeja e decide o que
> pedir; o **Codex** só executa a tarefa que receber.
>
> **Instrução para o Claude (orquestrador):** leia **inteiro** antes de pedir qualquer mudança. Depois de ler, responda com:
> (1) um resumo do que entendeu em até 10 linhas, (2) as dúvidas que a seção 10 não resolve,
> (3) o plano da Fase 0. **Não comece a delegar ao Codex antes do usuário confirmar.**
>
> Nos documentos novos, as fases desta spec são chamadas de **"Refatoração – Fase N"**, para não confundir
> com a "Fase 0" histórica (docs em `docs/historico/` após a Fase 1). Decisões do usuário sobre esta spec
> ficam em [PROGRESSO.md](PROGRESSO.md).

---

## 1. Quem é o usuário e o que ele quer

- O usuário é desenvolvedor iniciante/intermediário, trabalha em **vibecoding** (você escreve quase todo o código). Explique decisões em linguagem simples, sem jargão desnecessário, e **pergunte quando houver escolha que ele deveria fazer**.
- Idioma: **português do Brasil** para conversa, commits, docs e textos de UI. Identificadores de código em inglês.
- Objetivo de produto: **centralizar o próprio trabalho diário** num só app desktop: código, design (Figma/Pencil), documentos/texto e afins, com agentes de IA (Claude Code, Codex, Gemini, etc.) trabalhando dentro dele, sem precisar abrir outras ferramentas.
- **Por enquanto o app é para uso pessoal do dono.** Mobile e marketplace de plugins/skills da comunidade ficam para depois (ver seção 9). Não construa nada disso agora.

## 2. Visão do produto (norte, não escopo desta entrega)

Um "harness" de agentes de IA, desktop, rápido e bonito:
1. Conversar/trabalhar com vários agentes (cada CLI configurada é um **Dot**), em várias abas/painéis personalizáveis (2 lado a lado, 4 pequenos etc.).
2. Daemon local que mantém as **Runs** vivas mesmo com a janela fechada (já existe).
3. Ferramentas "nativas" dentro do app (código, texto/docs, design via Pencil/MCP, depois Figma e outras), operadas pelos agentes via MCP/ACP.
4. Painel de **workflows** estilo n8n (nós: gatilho → agente → ação → aprovação humana → saída).
5. **Auto Resume**: quando o limite de uso do provedor acaba, o app detecta quando volta e manda o agente continuar sem intervenção humana.
6. Memória e skills que o agente melhora com o uso (inspirado no Hermes Agent).
7. Futuro: app mobile para controlar o PC remotamente; marketplace comunitário.

**Esta spec cobre apenas a base técnica e visual para chegar lá**: faxina, estrutura, refatoração e redesign. As seções 8 e 9 descrevem o que vem depois, só para você projetar a estrutura sem bloquear o futuro.

## 3. Estado atual do repositório (medido, não suposto)

Repositório: `github.com/FernandoScarabeli/karont` (público, marcado `UNLICENSED`, 3 commits). O nome interno oscila entre **eros** (nome antigo) e **Karont** (nome atual).

Stack: Electron 45 + React 19 + TypeScript + Vite/esbuild · daemon separado em Node 24 · `node-pty` · SQLite (`node:sqlite`, WAL, FTS5) · `zod` para contratos · CodeMirror 6 · xterm.js · lucide-react · Playwright para E2E.

Arquitetura (decidida — **não mudar**):
```
Electron (janela + UI React)  ⇅ socket local autenticado  Daemon Node independente
                                                          ├─ Runs/fila · SQLite · checkpoints
                                                          ├─ permissões · Auto Resume (desligado)
                                                          └─ PTY gerenciado (CLIs) · Git worktrees
```
Conceitos do domínio (**preservar nomes**): Workspace > Projeto; **Dot** = CLI configurada; **Chat**; **Run** = execução (uma worktree Git por Run); **Tarefa** (Kanban). Veja `docs/ARQUITETURA.md`.

Mapa de tamanho (linhas):

| Área | Linhas | Observação |
|---|---:|---|
| `apps/daemon/src` | ~3.760 | `workspaces.ts` 1.135 e `runs.ts` 1.090: classes grandes demais |
| `apps/desktop/src` | ~7.630 | `WorkspaceDesk.tsx` **1.790** (só 3 componentes, 48 `useState`), `RunDesk.tsx` 815, `main.ts` 541 |
| `packages/contracts` | ~580 | contratos `zod` `.strict()` — **ótimo, manter** |
| `packages/local` | ~460 | cliente do socket, paths, wire |
| `scripts/` | ~3.350 | E2E, benchmarks, VM |
| `tests/` | ~2.210 | ~41 casos em 6 arquivos |
| CSS | ~2.890 | `style.css` 1.837 + `karont.css` 1.007 (remendo por cima do primeiro) + `tokens.css` 43 |

Qualidade geral:
- **Bom**: tipagem limpa (3 `any`, 0 `@ts-ignore`, 0 TODO), SQL parametrizado, mensagens IPC validadas por zod, autenticação do socket com nonce, `umask 077`, limite de conexões, sandbox do Electron ativo, nunca usa `--no-sandbox`, não toca em tokens/credenciais de CLIs.
- **Ruim / dívida**:
  - God component no front (`WorkspaceDesk.tsx`), dois CSS empilhados, tokens quase vazios, cores/valores avulsos.
  - Classes enormes no daemon misturando chats, tarefas e projetos.
  - 11 blocos `catch {}` vazios (alguns legítimos, ex.: erro de socket; revisar todos).
  - Sem ESLint/Biome.
  - ~454 ocorrências do nome antigo "eros" (API `window.eros`, canais IPC `eros:*`, `~/.config/eros`, `EROS_APP_VERSION`, nomes de pacotes, CI, scripts, testes).
  - Higiene do repo: `benchmarks/` com dezenas de execuções geradas (JSON/PNG) versionadas (~84 mil linhas no total do repo); 4 cópias do arquivo "Central de trabalho com IA — ideias do produto*.md" na raiz (uma tem ~326 KB); `.impeccable/review/*.png` versionados.
  - Onboarding ruim: o usuário precisa editar `~/.config/eros/dots.json` na mão com caminhos absolutos.
  - O Chat só guarda mensagens do usuário; a resposta do agente aparece apenas no terminal (limitação conhecida, **fora desta entrega**).
- Só roda em **Linux** (usa `/usr/bin/flock`, sandbox/seccomp, socket unix). Foco Linux é decisão registrada. Windows/macOS ficam para depois.
- `karont.pen` (arquivo do pen.dev com a direção visual) **não está no repo**: está na máquina do usuário. Peça ao usuário o arquivo/prints quando chegar à Fase 3. Referências já versionadas: `docs/design/` (DESIGN_SYSTEM.md, CHAT_FLOWS.md, PROJECT_FLOWS.md, previews/, references/).

Desempenho medido (VM Debian, 2 vCPU, GPU por software — **não é hardware real**): abertura ~0,5 s; frames p95 ~16,7 ms (ok); Electron ocioso ~330 MB PSS (~640 MB RSS); daemon ~38 MB PSS; com a janela "fechada" o Electron ainda ocupa ~275 MB PSS (tray), contra ~38 MB do daemon sozinho. Meta antiga de <200 MB ocioso **não é atingida**. O cenário "editor" mostrou ~77% de CPU no Electron (digitação sintética) — investigar. O renderer fazia polling a cada 250 ms (doc diz que foi tratado; **confirmar**).

## 4. Objetivo desta entrega

**Não reescrever do zero.** Manter o daemon, contratos, protocolo e testes. Entregar:
1. Repositório limpo e com nome consistente (**Karont**).
2. Front-end reorganizado por funcionalidade (sem arquivos-monstro).
3. Camada de estilos única, baseada em tokens.
4. Visual refeito, tela por tela, seguindo a direção do `karont.pen` + design system atualizado.
5. Base de estrutura pronta para receber painéis de ferramentas e o canvas de workflows depois.

Tudo com **comportamento preservado**: `npm run check`, `npm test` e os E2E continuam passando a cada etapa.

## 5. Regras invariantes (não quebrar, não renegociar sem pedir)

1. **Segurança do Electron**: `contextIsolation: true`, `nodeIntegration: false`, `sandbox: true`; nunca `--no-sandbox`; validar toda mensagem IPC. A UI não acessa recursos do sistema diretamente.
2. **Daemon**: continua processo separado em TypeScript/Node. Não alterar protocolo/handshake, schema do SQLite ou contratos zod **sem aprovação explícita**. Se uma mudança de contrato for inevitável, pare e explique o motivo.
3. **Credenciais**: o app nunca captura, armazena ou reutiliza tokens de assinatura das CLIs. Login acontece na própria CLI.
4. **Honestidade de UI**: controles e indicadores refletem capacidades reais. Dado demonstrativo/exploração futura deve ser marcado claramente. Sem métricas inventadas ("indisponível" quando a CLI não informa).
5. **Vocabulário**: Workspace, Projeto, Dot, Chat, Run, Tarefa. Não renomear.
6. **Regras de design** do `AGENTS.md` e de `docs/design/DESIGN_SYSTEM.md` valem: reutilizar tokens/componentes, documentar novos padrões **na mesma entrega**, checar contraste, foco por teclado, estados além da cor, overflow em janelas pequenas. Decisão vigente: projeto é criado em modal só com nome, ícone e pasta raiz; nova conversa abre direto um chat vazio.
7. **Worktree não é sandbox.** Não prometa isolamento que não existe.
8. **Auto Resume permanece desligado** nesta entrega (ver seção 8).
9. Linux é o foco. Não adicionar código específico de outro SO, mas **evite** novas dependências de Linux onde houver alternativa igualmente simples (para facilitar portar depois).
10. Dependências novas: só com justificativa curta e aprovação do usuário. Preferir o que já existe.

### 5.1 Papéis e fluxo Claude → Codex

**Claude (orquestrador / "cérebro")**
- Conversa com o usuário, tira dúvidas, decide a ordem e **quebra cada fase em tarefas pequenas** (uma tarefa = uma mudança coesa, revisável em poucos minutos, idealmente < ~400 linhas de diff).
- Escreve o prompt de cada tarefa para o Codex (modelo abaixo).
- **Revisa tudo que o Codex entregar**: lê o diff, roda os comandos de verificação ele mesmo (seção 7) e só então aceita ou devolve com correções. Nunca aceita "está pronto/validado" só porque o Codex disse; confere o resultado dos comandos.
- Mantém o estado do trabalho em `docs/PROGRESSO.md` (fase atual, tarefas feitas, em andamento, bloqueios, decisões do usuário) para que o contexto sobreviva entre sessões.
- Escala para o usuário: mudança de contrato/protocolo/schema, itens da seção 10, qualquer dúvida de produto/visual, qualquer tarefa que o Codex não conseguiu concluir depois de **2 tentativas**.

**Codex (executor)**
- Recebe **uma tarefa por vez**, com escopo e critérios claros. Lê `AGENTS.md` (o repo já tem um) e esta spec.
- Implementa só o que foi pedido. **Não** refatora "de passagem", não renomeia fora do escopo, não adiciona dependências, não altera contratos/protocolo/schema, não mexe em arquivos fora da lista permitida.
- Se achar um problema fora do escopo, **anota** em `docs/DIVIDAS.md` e segue.
- Ao terminar, devolve um relatório curto no formato abaixo, dizendo **o que rodou de verdade** e o que não conseguiu rodar.

**`AGENTS.md`**: o Codex lê esse arquivo automaticamente. Ele deve apontar para esta spec (ex.: `docs/SPEC_REFATORACAO.md`) e resumir as regras invariantes da seção 5. A primeira tarefa da Fase 0 é atualizar o `AGENTS.md` com isso (sem apagar as regras de design que já existem).

**Isolamento**: cada tarefa do Codex roda em **branch própria ou worktree própria** (`refactor/fase-N-tarefa-X`). O Claude só faz merge depois de revisar e rodar os testes. Nada vai direto para `main`.

**Modelo de prompt de tarefa (Claude → Codex)**
```
TAREFA: <título curto>        FASE: <N>        BRANCH: <nome>

Contexto (2–4 linhas): por que esta tarefa existe e como se encaixa na fase.

Objetivo: <o que deve estar diferente no final, em 1–3 frases>

Arquivos que PODE alterar: <lista/globs>
Arquivos que NÃO pode alterar: contratos (packages/contracts), protocolo (packages/local/src/wire.ts),
schema/migrações do banco, e qualquer outro fora da lista acima.

Passos sugeridos: <1..n, curtos>

Regras: seguir AGENTS.md e docs/SPEC_REFATORACAO.md (seção 5). Sem dependências novas.
Sem mudar comportamento visível (Fases 1–2) / mudando só o que a tarefa descreve (Fase 3).

Critérios de aceite (verificáveis):
- [ ] npm run check passa
- [ ] npm test passa
- [ ] <critério específico, ex.: nenhum arquivo em features/chat > 400 linhas>
- [ ] <critério visual, se houver: prints antes/depois em 1440 px e 900 px>

Ao terminar, responda EXATAMENTE neste formato:
1. Resumo (máx. 5 linhas)
2. Arquivos alterados (lista)
3. Comandos que você REALMENTE rodou e o resultado de cada um (cole a saída final)
4. O que NÃO conseguiu rodar/verificar e por quê
5. Dúvidas ou problemas encontrados (inclusive os fora de escopo, já anotados em docs/DIVIDAS.md)
```

**Checklist de revisão do Claude antes de aceitar uma tarefa**
- [ ] O diff só toca arquivos permitidos; nada de mudança "criativa" fora do escopo.
- [ ] `npm run check` e `npm test` rodados **pelo Claude** e verdes (E2E ao fim de cada fase, ou pelo usuário se faltar sessão gráfica).
- [ ] Sem cor/valor avulso novo no CSS; sem `any`/`@ts-ignore`/`catch {}` novos.
- [ ] Contratos, protocolo e schema intactos (ou aprovação do usuário registrada em `docs/PROGRESSO.md`).
- [ ] Texto de UI em português, nomes do domínio preservados (Workspace, Projeto, Dot, Chat, Run, Tarefa).
- [ ] Docs atualizadas na mesma tarefa quando houver mudança visual ou de estrutura.
- [ ] Commit(s) pequeno(s), em português, sem misturar refatoração com mudança visual.

**Quando o Codex errar**: o Claude devolve com o erro concreto (saída do comando, trecho do diff) e uma correção objetiva; após 2 tentativas sem sucesso, o Claude refaz a tarefa em partes menores ou escala ao usuário. Não insistir no mesmo prompt.

## 6. Plano em fases

Regras de trabalho em todas as fases:
- Uma branch por fase (`refactor/fase-N-nome`), commits pequenos e descritivos em português.
- Depois de **cada** etapa: `npm run check && npm test`. Ao fim de cada fase: `npm run test:desktop` e `npm run test:e2e` (precisam de sessão gráfica; se não rodarem no ambiente, diga isso claramente e peça ao usuário para rodar — **não declare "validado" sem ter rodado**).
- Mostre ao usuário o que mudou (resumo curto + prints quando for visual) antes de seguir para a próxima fase.
- Não misture refatoração estrutural e mudança visual no mesmo commit.
- Se encontrar bug, anote em `docs/DIVIDAS.md` (crie) em vez de resolver de passagem, a menos que bloqueie a tarefa.

### Fase 0 — Linha de base (sem editar código)
- Instalar dependências (`npm ci`), rodar `check`, `test`, `test:desktop`, `test:e2e`, `benchmark`.
- Registrar em `docs/BASELINE.md`: o que passou, o que falhou, tempos, memória, ambiente. Se algo falha **antes** de você mexer, isso é a linha de base, não responsabilidade sua, mas informe.
- Salvar esta spec em `docs/SPEC_REFATORACAO.md` e atualizar o `AGENTS.md` para apontar para ela (seção 5.1), preservando as regras de design existentes. Criar `docs/PROGRESSO.md` e `docs/DIVIDAS.md`.
- Entregar o plano detalhado da Fase 1 já quebrado em tarefas no formato da seção 5.1, e as perguntas abertas.
- **Critério de aceite**: `BASELINE.md`, `PROGRESSO.md` e `DIVIDAS.md` criados; `AGENTS.md` atualizado; usuário confirmou.

### Fase 1 — Faxina e identidade
1. **Renomear eros → Karont** em tudo, com cuidado:
   - pacotes (`eros-phase-zero`, `@eros/*` se houver), `window.eros` → `window.karont`, canais IPC `eros:*` → `karont:*`, `EROS_*` env vars e `EROS_APP_VERSION`, textos de CI/scripts/testes.
   - Diretório de config `~/.config/eros` → `~/.config/karont`, **com compatibilidade**: se só existir o antigo, ler dele (e/ou migrar com cópia, nunca apagar o antigo sozinho). Documentar.
   - Faça em commits separados por área (contratos/daemon, desktop, scripts/testes/CI, docs). Rode os testes entre eles.
2. **Higiene do repo**:
   - `.gitignore` para `benchmarks/runs/`, `benchmarks/series/`, `benchmarks/spec*/`, `benchmarks/history/**/*.png|*.json` e demais saídas geradas. **Manter** `benchmarks/RESULTADOS.md` e um resumo `latest` pequeno. Use `git rm --cached`, **não apague arquivos do disco**.
   - Ajustar o job de CI que faz upload de `benchmarks/runs/` e `benchmarks/spec005/` (continua válido como artefato de CI, só não precisa ser versionado).
   - Os 4 arquivos "Central de trabalho com IA — ideias do produto*.md": comparar (`diff`), mover para `docs/produto/` com nomes sem espaços/parênteses, e **perguntar** ao usuário antes de remover duplicatas.
   - `.impeccable/review/*.png`: perguntar se ainda são necessários.
3. **Qualidade**: adicionar linter+formatter (Biome **ou** ESLint+Prettier — recomende um e peça aprovação), scripts `lint`/`format:check`, incluir no CI. Revisar os 11 `catch {}` vazios: cada um recebe um comentário do porquê ser ignorado ou passa a tratar/logar.
4. **Licença**: **não escolha sozinho.** Apresente opções (MIT, Apache-2.0, AGPL, manter privado/UNLICENSED) com prós e contras em linguagem simples e deixe o usuário decidir. Atualize o README (que diz "marcado como privado" mas o repo é público).
5. **README**: nome único, status real, instruções curtas. Documentar o passo de `dots.json` e abrir issue/nota em `docs/DIVIDAS.md` sobre onboarding manual (**melhorar o onboarding é item da Fase 4**, não desta).
- **Critério de aceite**: `grep -ri eros` só encontra referências históricas intencionais (docs antigas/changelog/compat de config); CI verde; repo sem artefatos gerados versionados; linter rodando.

### Fase 2 — Estrutura de pastas e quebra dos arquivos-monstro (sem mudar visual)
Estrutura alvo do desktop (ajuste se encontrar motivo, e explique):
```
apps/desktop/src/
  main/            # processo principal Electron (main.ts, tray, notificações, ipc)
  preload/         # preload.ts (superfície mínima e tipada)
  renderer/
    app/           # bootstrap, providers, roteamento/navegação
    features/
      workspace/   # home, sidebar, navegação, modal de projeto
      chat/        # ChatView e partes
      runs/        # RunDesk, terminal, diff, rollback
      tasks/       # Kanban
      editor/      # CodeMirror
      diagnostics/ attention/ continuity/
    components/    # componentes visuais reutilizáveis (Button, Dialog, Menu, Tabs...)
    lib/           # api.ts (cliente IPC tipado), hooks, utilitários
    styles/        # tokens.css + base/reset (ver Fase 3)
```
Tarefas:
1. Quebrar `WorkspaceDesk.tsx` (1.790 linhas) em telas/componentes por responsabilidade; extrair `FormDialog` e afins para `components/`. Meta: nenhum arquivo de UI > ~400 linhas.
2. Reduzir os 48 `useState`: agrupar em hooks por feature (`useChat`, `useProjects`…); se precisar de store global, **proponha** (ex.: `zustand`) e espere aprovação.
3. Quebrar `RunDesk.tsx` e `main.ts` de forma análoga.
4. Tipar o `window.karont` (preload) em um único lugar compartilhado; evitar `any`.
5. **Sem mudar nada visível.** Se uma tela mudar de pixel, é bug desta fase.
- **Critério de aceite**: testes/E2E verdes; diff visual nulo (prints Playwright antes/depois das telas principais); nenhum arquivo de UI gigante; imports organizados.

### Fase 3 — Estilos e redesign visual
1. **Primeiro a base**: consolidar `style.css` + `karont.css` em: `styles/tokens.css` (completo: cores, tipografia, espaçamento, raios, bordas, sombras, z-index, durações/easings, tamanhos de ícone) + CSS por componente/feature (co-localizado, escopado — peça aprovação entre CSS Modules ou arquivos planos com `@layer`). Zero cor/valor hardcoded fora de `tokens.css`.
2. **Biblioteca de componentes** mínima e documentada: Button (variantes/estados), IconButton, Input/Textarea, Dialog, Menu/Popover, Tabs, Tooltip, Badge/StatusPill, Card, EmptyState, Toast. Cada um com estados: hover, foco, ativo, desabilitado, erro, carregando.
3. **Pedir ao usuário** `karont.pen` / prints / referências da direção visual desejada **antes** de redesenhar. Não invente identidade nova. A paleta atual do doc é "base provisória" (dark, compacto, separação tonal, foco `#89ADFF`).
4. Refazer **tela por tela**, na ordem: (a) shell + sidebar/navegação, (b) home, (c) chat, (d) runs/terminal/diff, (e) tarefas, (f) diagnóstico/atenção. A cada tela: prints (1440 px e ~900 px), checklist de contraste/foco/overflow, e **atualizar `docs/design/DESIGN_SYSTEM.md` na mesma entrega** (inclusive o que é "implementado" vs "proposta").
5. Fontes: aplicar `font-code` de fato no terminal e no CodeMirror (item pendente documentado).
6. Movimento: microinterações discretas, respeitar `prefers-reduced-motion`.
7. **Desempenho conta como requisito visual**: sem layout shift, sem re-render desnecessário, listas longas virtualizadas, e nada de polling no renderer (use eventos).
- **Critério de aceite**: um único conjunto de estilos; zero valores hardcoded fora dos tokens (verificar com grep); DESIGN_SYSTEM.md fiel ao código; E2E verdes; contraste AA nos pares principais; navegação completa por teclado nas telas refeitas.

### Fase 4 — Daemon: organização e primeiros ganhos práticos
1. Dividir `WorkspaceManager` (`workspaces.ts`) em módulos por domínio (projetos, chats/mensagens, tarefas) mantendo a **mesma fachada pública** e o mesmo contrato IPC. Idem para `runs.ts` se fizer sentido (só se os testes cobrirem).
2. **Onboarding de Dots**: tela simples para adicionar/editar uma CLI (nome, caminho do executável com detecção via `command -v`, projetos permitidos), em vez de editar JSON à mão. Respeitar permissões `0600` do arquivo e a regra de nunca guardar credenciais.
3. Investigar e documentar (sem mudar comportamento sem aprovação): (a) CPU alta no cenário "editor", (b) custo do Electron com janela fechada — opções: manter como está; encerrar o Electron ao fechar a janela e deixar o daemon notificar via `notify-send`/D-Bus; processo auxiliar só para o tray. **Apresente números e peça decisão.**
- **Critério de aceite**: mesmo contrato; testes verdes (+ testes novos para o que for extraído); tela de Dots funcionando e coberta por E2E.

## 7. Roteiro de verificação (a cada fase)
```
npm ci
npm run check
npm test
npm run test:desktop     # precisa de sessão gráfica + sandbox do Electron
npm run test:e2e         # idem
npm run benchmark        # comparar com docs/BASELINE.md (memória/tempo não podem piorar sem justificativa)
```
Relatório curto ao usuário ao fim de cada fase: o que mudou, o que foi testado (e **como**), o que **não** foi testado, riscos, próximos passos.

## 8. Roadmap pós-refatoração (CONTEXTO — **não implementar agora**)

Projete a estrutura para não bloquear estes itens:

**A. Painéis de ferramentas.** Cada ferramenta (editor de texto/markdown, canvas de design Pencil, depois Figma etc.) deve ser um *painel* que o layout consegue posicionar (lado a lado, 4 pequenos...). Pense em uma interface `Panel` (id, título, ícone, componente, estado serializável) para o layout restaurar ao reabrir. Ferramentas conversam com agentes via **MCP** (e ACP quando fizer sentido). Pencil: canvas MCP bidirecional, arquivos `.pen` ficam no repositório. Figma: existe MCP oficial, mas **verificar o que ele realmente permite (ler/escrever)** antes de prometer.

**B. Painel de workflows (estilo n8n).** Nós: Gatilho · Agente (AI) · Ação · Humano (aprovação) · Saída; painel lateral de configuração com saída ao vivo; estimativa de tempo/custo; execução "passo X de N". O `ARQUITETURA.md` já reserva **React Flow** (`@xyflow/react`, licença MIT) para isso. **Não embutir o n8n**: a licença dele (Sustainable Use) restringe distribuição a uso gratuito e não comercial e não é open source — usar só como inspiração visual. Mapeamento natural com o que já existe: nó "AI" = Run; nó "Humano" = aprovação (estado `waiting_approval`); executor = o próprio daemon (fila, checkpoints, estados). Primeira fatia sugerida: Gatilho → Agente → Aprovação humana, salvo como JSON.

**C. Auto Resume.** Situação: o `apps/daemon/src/auto-resume.ts` já tem um agendador conservador (máx. 3 tentativas, valida fingerprint da worktree, só age com sinal estruturado de adaptador confiável) e está **desligado** porque nenhuma CLI expõe esse sinal de forma verificada. Fatos (pesquisados): o **Claude Code CLI já tem auto-continue nativo** (v2.1.234, ligado por padrão para sessões interativas com assinatura claude.ai; precisa da sessão aberta; re-arma no máx. 2 vezes; ainda para em prompts de permissão) e o app Desktop tem um checkbox equivalente; existem ferramentas de comunidade (ex.: `claude-powernap`) que dependem de endpoint não documentado. Diferencial possível do Karont: funcionar com **várias CLIs**, com a janela fechada, sobrevivendo a reinício. Direção futura: (1) para Claude Code, apenas **mostrar** o estado "aguardando reset" e impedir que o PC durma (inibidor de suspensão); (2) para outras CLIs, modo **opcional** que lê a mensagem de limite conhecida, agenda e pede confirmação antes de enviar "continue", com teto de tentativas e escopo de permissões pré-aprovado para runs noturnas. Decisão de design pendente — **não implementar sem nova spec**.

**D. Memória e skills auto-aprimoráveis.** Direção: seguir o padrão aberto `agentskills.io` (compatível com Hermes Agent e outras CLIs), com a aba "Evolução" mostrando **diff do que a IA mudou na própria skill** e permitindo aprovar/reverter. Auto-melhoria é recente e com poucos casos de produção: tratar como experimento.

## 9. Fora de escopo (por enquanto)
Mobile · marketplace/plugins da comunidade · suporte a Windows/macOS · respostas estruturadas e streaming dentro do Chat · Auto Resume · canvas de workflow · integração com Figma/Pencil · Rust/Tauri (o daemon separado permite trocar o shell depois; a decisão atual é **Electron**).

## 10. Perguntas abertas (levar ao usuário; não decidir sozinho)
1. **Licença** do repositório (e se o repo deve ficar público por enquanto).
2. Nome final: confirmar **Karont** em tudo (inclusive pasta de config e prefixo IPC).
3. **Direção visual**: enviar `karont.pen` ou prints atualizados; confirmar se a paleta dark atual segue.
4. CSS: CSS Modules ou arquivos planos com `@layer`? Biome ou ESLint+Prettier? Store global (zustand) ou só hooks?
5. Os 4 arquivos de ideias na raiz e as imagens de `.impeccable/`: manter, mover ou remover?
6. Com a janela fechada: manter o Electron na bandeja (como hoje, ~275 MB) ou encerrar e notificar pelo daemon (muito mais leve, perde o ícone da bandeja)?
7. Qual será a **primeira ferramenta nativa** depois da refatoração (editor de docs/markdown, Pencil, ou o painel de workflows)?

## 11. Referências no repositório
`README.md` · `AGENTS.md` · `docs/ARQUITETURA.md` · `docs/design/DESIGN_SYSTEM.md`, `PROJECT_FLOWS.md`, `CHAT_FLOWS.md` · `docs/PROTOCOLO_LOCAL.md` · `docs/AUTO_RESUME_CAPACIDADES.md` · `docs/RECUPERACAO_E_CHECKPOINTS.md` · `docs/SANDBOX_LINUX.md` · `docs/VALIDACAO_CLI_REAL.md` · `benchmarks/RESULTADOS.md` · `.github/workflows/linux.yml`.
Código-chave: `apps/daemon/src/{server,runs,workspaces,continuity,auto-resume,permissions,database}.ts` · `packages/contracts/src/index.ts` · `packages/local/src/{wire,client,paths}.ts` · `apps/desktop/src/{main,preload,renderer,WorkspaceDesk,RunDesk,TaskDesk}.ts(x)`.

## 12. Definição de pronto (da entrega inteira)
- [ ] Nome único (Karont), com compatibilidade de config antiga documentada.
- [ ] Repo sem artefatos gerados versionados; licença decidida pelo usuário; linter ativo no CI.
- [ ] Nenhum arquivo de UI gigante; estrutura por feature; `window.karont` tipado.
- [ ] Um único sistema de estilos baseado em tokens; zero valores avulsos.
- [ ] Telas principais refeitas conforme direção aprovada; `DESIGN_SYSTEM.md` fiel ao código.
- [ ] `check`, `test`, `test:desktop`, `test:e2e` verdes (ou lacunas declaradas explicitamente).
- [ ] Memória/tempo de abertura iguais ou melhores que `BASELINE.md`.
- [ ] `docs/DIVIDAS.md` com tudo o que ficou para depois.
