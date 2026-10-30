# Retomar o trabalho (outro computador ou nova sessão)

Guia para o orquestrador (Claude Code) continuar a refatoração sem o contexto da conversa anterior. Leia este arquivo inteiro antes de agir. Última atualização: 2026-10-30, ao fim da tarefa T7 da Fase 1.

## 1. O que ler, nesta ordem

1. [SPEC_REFATORACAO.md](SPEC_REFATORACAO.md): a spec (papéis, regras invariantes, fases).
2. [PROGRESSO.md](PROGRESSO.md): o estado atual, as **decisões do usuário (1–17)** e o comando padrão do Codex.
3. [PLANO_FASE_1.md](PLANO_FASE_1.md): as tarefas da fase atual (T1–T11).
4. [DIVIDAS.md](DIVIDAS.md): problemas conhecidos, para não "descobrir" de novo.
5. [BASELINE.md](BASELINE.md): números de referência.

## 2. Onde parou

- Branch da fase: `refactor/fase-1-faxina` (já no GitHub). Ainda **não há PR** da Fase 1; ele será aberto ao fim da fase, para `main`.
- Concluídas: T1, T1b, T2, T3, a reescrita do histórico e a renomeação eros → Karont (T4 a T7). Detalhes em PROGRESSO.
- **Próxima: T8**, configurar o Biome sem formatar nada (dependência nova já aprovada, decisão 2). Depois T9 a T11, na ordem do plano. Lembretes:
  - T8 (Biome) e T9 (formatação em massa) são **commits separados**; a T9 não leva nenhuma outra mudança.
  - A licença continua `UNLICENSED` (decisão 14).
- O CI tem duas falhas intermitentes nos E2E (DIVIDAS #15 e #20). Se falhar, veja o log e rode de novo só o job; se for outra etapa, investigue.

## 3. Preparar a máquina

```bash
git clone git@github.com:FernandoScarabeli/karont.git && cd karont
git switch refactor/fase-1-faxina
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
- **Fluxo:** o Claude planeja, escreve a tarefa, roda o Codex, revisa o diff, roda os testes **ele mesmo**, faz o commit na branch da tarefa e o fast-forward na branch da fase, faz o push e confere o CI. Uma tarefa do Codex por vez, cada uma em worktree própria (`~/karont-worktrees/fase-1-tarefa-N`, branch `refactor/fase-1-tarefa-N`).
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
