# Handoff para o orquestrador

Você é o Claude Code que vai construir o Karont do zero a partir da [SPEC.md](SPEC.md). O repositório foi recriado sem histórico em 2026-10-31; uma versão anterior do projeto existiu e foi jogada fora de propósito. **Não tente recuperar nem imitar o código antigo**: use só as lições abaixo.

## O dono
- Fernando Scarabeli. Dev iniciante/intermediário, trabalha em "vibecoding".
- **Respostas curtas e simples, em português.** Detalhe técnico vai para os docs, não para o chat. Decisões vêm com uma recomendação pronta, para ele responder "ok".
- Ele quer **ver** o produto andando: mostre no preview do navegador cedo e com frequência.
- Ele prefere recomeçar a remendar. Ele se frustra com processo longo sem nada usável: priorize chegar ao M2 (chat de verdade) rápido.

## Como trabalhar
- Branch por marco (`m0-esqueleto`, `m1-agentes`…) e uma worktree por tarefa do executor (`~/karont-worktrees/<marco>-<tarefa>`). Merge na `main` ao fim de cada marco, com CI verde.
- **Dois executores Codex diferentes** (um para o serviço/back, outro para a interface/front), **uma tarefa por vez**.
- Tarefas em blocos numerados, cada um com critério de "pronto", lista de arquivos permitidos e as regras do `AGENTS.md`.
- Ciclo de testes: na tarefa, só os rápidos (typecheck, lint, `node:test`, 1 E2E de fumaça). Completos só antes do merge do marco. Medir o tempo; se passar de ~3 min por rodada, simplificar.
- Registre decisões do dono em `docs/PROGRESSO.md` (numeradas) e problemas fora do escopo em `docs/DIVIDAS.md`.

### Comando do executor (Codex)
```bash
W=~/karont-worktrees/<tarefa>
cd "$W" && codex exec -m gpt-6-luna -c model_reasoning_effort="xhigh" \
  -c approval_policy="never" -C "$W" -s workspace-write \
  --add-dir "<repo>/.git/worktrees/<tarefa>" \
  -o <ref>/resposta.md - < <ref>/tarefa.md > <ref>/codex.log 2>&1
```
- `approval_policy="never"` é obrigatório: a config do dono tem `approvals_reviewer = "auto_review"`, que aprovaria comandos fora do sandbox.
- `--add-dir` da pasta git da worktree, para `git mv`/`git add` funcionarem.
- O Codex **não tem rede**: rode `npm ci` (e o download do Electron) na worktree antes de chamá-lo.
- O Codex **não roda** Electron, E2E nem sockets Unix no sandbox dele (`EPERM`). Você roda.
- Guarde `tarefa.md`, `resposta.md` e `codex.log` numa pasta `<tarefa>-ref` fora da worktree.

### Ambiente da máquina (Ubuntu)
- Node 24 (via nvm, já no `PATH`).
- Sandbox do Electron nos testes: o dono instalou um helper com SUID em `/usr/local/lib/karont-dev/chrome-sandbox`. Rode os testes com `CHROME_DEVEL_SANDBOX=/usr/local/lib/karont-dev/chrome-sandbox` e, **depois de cada `npm ci`**, renomeie `node_modules/electron/dist/chrome-sandbox` (o Chromium ignora a variável se esse arquivo existir). Se a versão do Electron mudar, o helper precisa ser reinstalado pelo dono com sudo:
  ```bash
  sudo install -o root -g root -m 4755 node_modules/electron/dist/chrome-sandbox /usr/local/lib/karont-dev/chrome-sandbox
  ```
- O dono tem `claude` (2.1.316) e `codex` (0.166.0) em `~/.local/bin`.
- Design: o dono usa o pen.dev com um `karont.pen` de **referências visuais** fora do repositório. As ferramentas `mcp__pencil__*` só funcionam com o app do pen.dev aberto. Não publique prints de outros produtos no repositório (é open source).

## Lições aprendidas (não repita estes erros)
1. **Comece pelo chat de verdade.** A versão anterior mostrava a resposta da IA só num terminal; o dono queria balões como no ChatGPT/Claude. Confirme fluxos com ele em texto antes de codar telas.
2. **Socket com streaming:** a versão anterior derrubava o cliente quando o buffer passava de 64 KiB e descartava eventos acima de 48 KiB. Respeite `drain`, limite por mensagem e agrupe deltas.
3. **Carga no serviço:** telas que agregam dados (contagens por projeto/workspace) não podem disparar dezenas de requisições em paralelo nem recarregar a cada evento de conversa. Uma por vez, só com a tela visível, agrupando recargas.
4. **CSS global vaza.** Regras antigas em `header`, `h1`, `select`, `.icon` quebraram todas as telas novas. Escopo desde o dia 1.
5. **xterm só desenha o que está visível.** Testes que leem o texto do terminal precisam rolá-lo para a vista (`scrollIntoViewIfNeeded`) antes.
6. **Vite embute fontes pequenas como `data:`**: a CSP precisa de `font-src 'self' data:` senão a fonte não carrega no app (só no preview).
7. **Nomes acessíveis:** um ícone com `aria-label` dentro de um botão muda o nome do botão ("Projeto X Rodando"); isso quebrou testes e leitores de tela.
8. **Executor remove `aria-label` para agradar o linter** — proíba na tarefa.
9. **Executor reutiliza estado com outro significado** (ex.: usou "mostrar mais" como "abrir histórico"). Revise o diff procurando isso.
10. **Não use `git checkout <arquivo>`** para desfazer um ajuste seu numa worktree com mudanças do executor ainda não commitadas: você apaga o trabalho dele. Commite antes ou edite à mão. (O `codex.log` guarda o diff final, se precisar recuperar.)
11. **Testes não podem depender da máquina:** as CLIs reais do dono apareceram nos testes quando a detecção ficou ligada.
12. **Limites globais em testes:** um limite de concorrência ajustado para um E2E quebrou o teste de fila de outro. Ajuste por teste, não no harness inteiro.
13. **E2E e o PC do dono:** no Wayland, o app só escreve na área de transferência com a janela em foco; se o dono estiver usando o PC, testes de "copiar" falham. Peça o PC livre ou evite depender do clipboard.
14. **Flags das CLIs mudam:** confira `--help` da versão instalada antes de escrever um adaptador e grave fixtures da saída real.
15. **Mostre cedo:** o preview no navegador (Vite + ponte HTTP/SSE) foi a ferramenta mais útil para o dono pedir ajustes.

## Primeiro passo
1. Leia a SPEC inteira.
2. Proponha ao dono o plano do M0 em poucas linhas (com a lista de tarefas back/front) e espere o "ok".
3. Crie `docs/PROGRESSO.md` e `docs/DIVIDAS.md`.
