# Retomar o trabalho (outro computador ou nova sessão)

Guia para o orquestrador (Claude Code) continuar a refatoração sem o contexto da conversa anterior. Leia este arquivo inteiro antes de agir. Última atualização: 2026-10-30, com a Fase 3 planejada.

## 1. O que ler, nesta ordem

1. [SPEC_REFATORACAO.md](SPEC_REFATORACAO.md): a spec (papéis, regras invariantes, fases).
2. [PROGRESSO.md](PROGRESSO.md): o estado atual, as **decisões do usuário (1–21)** e o comando padrão do Codex.
3. [PLANO_FASE_3.md](PLANO_FASE_3.md): a fase atual (redesign). Os planos das Fases 1 e 2 são só referência.
4. [DIVIDAS.md](DIVIDAS.md): problemas conhecidos, para não "descobrir" de novo.
5. [BASELINE.md](BASELINE.md): números de referência.

## 2. Onde parou

- **Refatoração – Fase 1 concluída** (PR #2, merge em `main` em 2026-10-30).
- **Refatoração – Fase 2 concluída** (PR #3, CI verde). Se o PR ainda não teve merge, peça ao usuário para fazê-lo (o orquestrador não tem permissão) e depois atualize `refactor/fase-3-design` a partir de `main`.
- **Próximo passo: Fase 3, Etapa A, no chat de design.** Siga o [PLANO_FASE_3.md](PLANO_FASE_3.md): receba as referências do usuário, salve e anote em `docs/design/references/`, pergunte o que incomoda, proponha 2 ou 3 direções e só depois mexa em código. O usuário vai criar um `karont.pen` novo no pen.dev (decisão 21).
- Para mostrar o que mudou numa tela: `npm run visual -- <nome>` antes e depois e `node scripts/visual-snapshot.mjs --compare <a> <b>`.
- Os E2E locais precisam do PC livre (DIVIDAS #23). A intermitência #15 do spec006 foi resolvida na Fase 2.

- **Preview web (decisão 22):** `npm run preview:web` e abrir `http://127.0.0.1:5180/preview.html`. Sobe a ponte (`apps/desktop/src/preview/bridge.ts`, Electron sem janela; precisa do helper do sandbox, que o script acha sozinho) e o Vite em modo dev. Portas fixas 5180/5181. Mudanças no renderer aparecem sem reiniciar; mudanças no `main/` ou na ponte exigem reiniciar o comando. O resultado final ainda é conferido no Electron (`npm run visual`).

## 3. Preparar a máquina

```bash
git clone git@github.com:FernandoScarabeli/karont.git && cd karont
git switch refactor/fase-3-design
# Node 24 (o projeto exige >=24). Sem root, via fnm:
curl -fsSL https://fnm.vercel.app/install | bash -s -- --skip-shell
export PATH="$HOME/.local/share/fnm:$PATH"; eval "$(fnm env --shell bash)"; fnm install 24; fnm use 24
node -v   # precisa mostrar v24.x antes de qualquer medição
npm ci
node node_modules/electron/install.js   # baixa o binário do Electron
npm run check && npm test               # devem passar (42 testes)
```

Testes que abrem o app (`test:desktop`, `test:e2e`) no Ubuntu exigem o helper do sandbox do Electron. **Nunca** desligar o sandbox.
1. O usuário instala o helper uma vez, com sudo:
   ```bash
   sudo install -d -o root -g root -m 0755 /usr/local/lib/karont-dev
   sudo install -o root -g root -m 4755 node_modules/electron/dist/chrome-sandbox /usr/local/lib/karont-dev/chrome-sandbox
   ```
2. Depois de cada `npm ci`, renomear a cópia do npm, porque o Chromium ignora a variável se ela existir:
   ```bash
   mv node_modules/electron/dist/chrome-sandbox node_modules/electron/dist/chrome-sandbox.local-desativado
   ```
3. Rodar os testes com a variável:
   ```bash
   CHROME_DEVEL_SANDBOX=/usr/local/lib/karont-dev/chrome-sandbox npm run test:desktop
   ```
4. Rodar os E2E um por um (`node scripts/phase1-e2e.mjs`, `spec005-e2e.mjs`, `spec006-e2e.mjs`): o `test:e2e` para no primeiro que falha.

O CI do GitHub já prepara o helper sozinho e deve estar verde.

## 4. Como trabalhar (combinado com o usuário)

- **Usuário:** dev iniciante/intermediário, em vibecoding. Respostas **curtas e simples**, em português. Detalhes técnicos vão para os docs, não para o chat. Decisões são apresentadas com uma recomendação pronta, para ele responder "ok".
- **Fluxo:** o Claude planeja, escreve a tarefa, roda o Codex, revisa o diff, roda os testes **ele mesmo**, faz o commit na branch da tarefa e o fast-forward na branch da fase, faz o push e confere o CI. Uma tarefa do Codex por vez, cada uma em worktree própria (`~/karont-worktrees/fase-N-tarefa-M`, branch `refactor/fase-N-tarefa-M`).
- **Codex:** usar `gpt-6-luna` com `xhigh`. Tarefas escritas em **blocos numerados**, cada um com um critério de "pronto". O comando exato está em PROGRESSO ("Comando padrão do Codex"). Ele precisa sempre ter:
  - `-c approval_policy="never"`: a config do usuário tem `approvals_reviewer = "auto_review"`, que aprovaria sozinha comandos fora do sandbox;
  - `-s workspace-write`, nunca o modo que desliga o sandbox;
  - `--add-dir <repo>/.git/worktrees/<tarefa>`, para `git mv`/`git rm --cached` funcionarem.
- O Codex **não faz commit** e **não consegue rodar os E2E** no sandbox dele (`spawnSync getconf EPERM`). Antes de chamá-lo, o orquestrador roda na worktree `npm ci` e o download do Electron, porque o Codex não tem rede.
- Depois de 2 tentativas sem sucesso do Codex, o orquestrador termina a tarefa em partes menores ou leva ao usuário.
- Ações que o usuário precisa autorizar explicitamente: merge com CI vermelho, push forçado, mudança de contrato/protocolo/schema não listada nas decisões, dependência nova.

## 5. Armadilhas já encontradas

- **Fast-forward que tira arquivos do índice apaga esses arquivos da pasta** onde o merge acontece. Ao integrar uma tarefa assim, restaure os arquivos ignorados a partir da worktree (`git ls-files --others --ignored --exclude-standard` + `rsync --files-from`).
- Os testes gravam em `benchmarks/*-latest.json` (versionados) e em `benchmarks/runs|spec005|spec006/` (ignorados). Desfaça a mudança nos `*-latest.json` antes de commitar.
- Em seletores do Playwright: um controle dentro de `<label>` herda o texto inteiro do label (DIVIDAS #13); um `<summary>` não tem papel `button`; e `getByLabel` pode casar com botões de mesmo `aria-label`. Prefira `getByRole(..., { name, exact: true })` e confira o markup.
- O rascunho do Chat tem uma corrida (DIVIDAS #14), e o spec006 já falhou de forma intermitente no CI (DIVIDAS #15). Se falhar de novo, a evidência fica no artefato do CI (`benchmarks/spec006/.../falha.png`).
- O histórico foi reescrito em 2026-10-30. Hashes de commit antigos (anteriores a essa data) não existem mais.
