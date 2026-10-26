# SPEC-006 — Ajuste 02: evidência sanitizada

Somente fixtures locais, callbacks simulados e CLIs sintéticas; sem conta autenticada,
provider pago ou dados reais. Nenhuma instrumentação ou injeção de falha em produção.

- `original-failure.txt`: trecho do log original recuperado do histórico local de execução
  em 2026-10-25T21:26:38.861Z; caminhos pessoais substituídos por `<repo>`.
- `before.json`: 30 execuções isoladas sequenciais antes da alteração (11 falhas),
  seguidas de uma suíte completa (35/36; mesma asserção falhou).
- `directed-before.json`: os dois cenários determinísticos falharam antes da correção.
  Timestamp fixo e UUID da tentativa anterior lexicograficamente maior; segundo cenário
  também recua o relógio. A escrita de retry retornou `sent`, mas a consulta deu `uncertain`.
- `after.json`: validação sequencial final; regressões, 30 repetições do teste original e
  três suítes completas. Inclui auditoria de novos diretórios de fixtures e daemons.
- `validation.json`: check, E2E integrado e diff; somente códigos de saída e contagens.
- `final-check.json`: check e diff sequenciais após as repetições finais.
- `preliminary-after.json`: primeira rodada pós-correção, também 30/30 e três suítes
  aprovadas. Sua auditoria coincidiu com E2E em andamento e não demonstra resíduos;
  a aceitação de limpeza usa a rodada sequencial final em `after.json`. O primeiro
  check em `validation.json` teve a mesma sobreposição; ver `final-check.json`.
- `repeat.py`: harness reproduzível; executar da raiz do repositório após
  `source scripts/local-env.sh` e `npm run build`, com argumento `before`, `after` ou
  `validation` ou `final-check`. `before` identifica o momento da medição; não restaura código antigo.
  Não persiste stdout/stderr arbitrários. Timeout de 240 s por comando.

A entrega original falhou em `tests/workspaces.test.mjs:430:12`: consulta do último
estado depois do callback de retry já retornar `sent`. Não houve PTY real, IPC,
encerramento de CLI nem corrida entre eventos nesse teste síncrono.

A ordem antiga usava `updated_at DESC, operation_id DESC` para exibição e
`created_at DESC, operation_id DESC` para proteção contra nova entrega. Timestamps
em milissegundos empatam; UUIDs aleatórios não ordenam tentativas. Assim, a entrega
anterior incerta podia vencer a consulta. A tabela SQLite existente é uma rowid table:
as tentativas são inseridas e não reordenadas. As três consultas agora usam a ordem
de inserção (`rowid`); os timestamps continuam sendo metadados de relógio. Testes
cobrem também recuo de relógio, VACUUM e reabertura. Não há mudança de schema.

`sent` continua significando retorno normal do callback de escrita ao terminal.
Exceção continua produzindo `uncertain`; intenção pendente recuperada também.
O callback real (`RunManager.write`) chama `active.process.write` de forma síncrona;
não espera reconhecimento semântico da CLI. O teste original não depende de Run
pronta, processo vivo ou prompt interativo: injeta Run running e callback ativo.

As auditorias comparam `/tmp/eros-*` e PIDs com o inventário inicial; não removem
recursos preexistentes. Ausência de novos diretórios inclui os sockets das fixtures.
A busca de processos cobre daemons novos e comandos ligados a diretórios novos;
não é uma prova geral contra todo vazamento possível no sistema. Repetições não
provam ausência de todas as corridas de PTY real ou providers autenticados.
