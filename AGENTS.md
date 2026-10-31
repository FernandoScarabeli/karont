# Regras para agentes (Claude, Codex e outros)

Leia antes de qualquer tarefa: [docs/SPEC.md](docs/SPEC.md) (o que construir) e, se você for o orquestrador, [docs/HANDOFF.md](docs/HANDOFF.md) (como trabalhar e o que já se aprendeu). O estado atual e as decisões do dono ficam em [docs/PROGRESSO.md](docs/PROGRESSO.md).

## Papéis

- **Orquestrador (Claude Code):** planeja, escreve as tarefas, roda o executor, revisa o diff, **roda os testes ele mesmo**, faz commit/merge/push e fala com o dono.
- **Executor (Codex):** faz **uma tarefa por vez**, numa worktree própria, só nos arquivos permitidos, e responde com o relatório da seção "Relatório".

## Regras invariantes (mudar só com o ok do dono)

1. Nunca ler, guardar ou reutilizar credenciais/tokens das CLIs de IA, nem ler as pastas de configuração delas.
2. Electron com `contextIsolation: true`, `nodeIntegration: false`, `sandbox: true` e CSP restrita. Nunca `--no-sandbox`. A interface só fala com a ponte validada.
3. A interface só mostra o que é real. Nada de métrica inventada.
4. Pasta de projeto não é sandbox: nunca prometa isolamento.
5. Vocabulário da interface: **Agente, Terminal, Workspace, Projeto, Conversa, Mensagem, Tarefa**.
6. Dependência nova só com motivo escrito e ok do dono.
7. Interface, docs e commits em português do Brasil; identificadores em inglês.
8. CSS com escopo e tokens; nenhuma regra global em elementos (`header`, `h1`, `button`, `select`…); nenhuma cor/medida solta fora dos tokens.
9. Acessibilidade: foco por teclado, nomes acessíveis corretos, estados além da cor, contraste AA.
10. Testes não dependem das CLIs instaladas na máquina (use as CLIs falsas e a variável que desliga a detecção).

## Para o executor

- Não refatore "de passagem", não renomeie fora do escopo, não mexa em arquivos fora da lista da tarefa.
- **Não remova `aria-label`, `role` ou classes existentes para agradar o linter.** Se o linter reclamar de `aria-label` num `div`, use `role="group"`/`"region"`.
- Ícone com rótulo (`role="img"`) dentro de botão: esconda com `aria-hidden` e passe o estado no botão com `aria-description`, senão o nome do botão muda.
- Você não consegue rodar Electron, E2E nem sockets Unix no seu sandbox: rode o que der, registre o resto e não tente contornar o sandbox.

## Para o executor da interface (front)
- **Sempre** use a skill de frontend **taste** para construir as telas.
- A skill **unslop** não está no ambiente do executor: o orquestrador roda a revisão com ela e devolve os achados numa correção, que você aplica.
- Se a **taste** não estiver disponível, diga no relatório.

## Relatório (resposta do executor)

1. Resumo. 2. Arquivos alterados. 3. Comandos rodados **de verdade** e resultados. 4. O que não rodou e por quê. 5. Dúvidas e problemas.
