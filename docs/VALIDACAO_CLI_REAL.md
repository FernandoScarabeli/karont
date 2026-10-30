# Validação básica com Codex real — 25/10/2026

Resultado: **aprovado para o ciclo básico de execução, reconexão, diff e rollback**.
Codex CLI 0.164.0, já autenticado via ChatGPT, executado pelo daemon em PTY
com perfil `codex`, argumentos vazios e modo `ask`. Electron iniciado pelo
Playwright com `chromiumSandbox: true`, sem flags para desativar sandbox.

Foi criado um repositório temporário com `probe.txt` contendo `before\n`.
A tarefa solicitou alterar somente esse arquivo para `after\n`, sem rede,
instalação de dependências ou commit. A confiança na pasta temporária foi
confirmada na tela nativa da CLI. O Codex executou a alteração e respondeu
`KARONT_PROBE_DONE`.

Verificações realizadas:

- Fechar a BrowserWindow destruiu a janela; reabrir preservou o PID e a sessão
  do Codex, ainda em estado `running`.
- Após encerrar explicitamente a sessão, o diff registrou somente `probe.txt`,
  com a alteração esperada.
- O diff foi aberto na interface e o rollback confirmado no diálogo.
- O arquivo voltou a `before\n` e a aprovação de rollback ficou `applied`.
- Daemon, CLI e interface de teste foram encerrados; o repositório temporário
  foi removido. Nenhuma alteração do agente foi feita no Karont.

Evidência sanitizada: `benchmarks/real-cli/desktop-validation.json`.
Não foram exportados tokens, conteúdo da conta ou histórico de sessões.

## Limites deste resultado

Não houve pedido de aprovação de comando sensível pela CLI durante essa tarefa.
A confirmação de confiança da pasta não equivale a esse teste. Os demais modos
de permissão não foram exercitados. Continuação nativa após perda do daemon,
detecção de cota/reset e Auto Resume continuam pendentes. Este ensaio complementa
as evidências históricas bloqueadas das SPEC-003/004; não as reescreve nem
constitui aceite funcional completo de todos os critérios dessas fases.
