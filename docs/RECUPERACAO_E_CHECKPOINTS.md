# Recuperação e checkpoints — SPEC-004

O daemon continua sendo o único escritor SQLite. A migração v4 amplia o CHECK de `runs.state`, preserva referências, adiciona identidades às sessões e cria `checkpoints`, `operations` e `resume_jobs`. Não foi introduzido supervisor externo. SQLite WAL com synchronous=NORMAL protege transações contra crash de processo; não se promete durabilidade do último commit diante de falha elétrica.

## Estados

| Origem | Destinos permitidos |
|---|---|
| queued | running, paused, cancelled, failed, recovery_needed |
| running | completed, failed, cancelled, recovery_needed, waiting_quota, waiting_approval |
| paused | queued, cancelled, recovery_needed |
| waiting_quota / waiting_approval | running, cancelled, recovery_needed |
| recovery_needed | queued, cancelled |
| failed | queued |
| completed / cancelled | nenhum |

`paused` significa exclusivamente pausa do agendamento ainda não iniciado. Suspensão de processo e pausa interna de CLI não são oferecidas. `waiting_approval` é reservado ao ciclo de execução com suporte futuro; aprovações de rollback continuam sendo operações sobre Runs encerradas, sem fingir que a CLI está aguardando o eros.

Transições usam BEGIN IMMEDIATE, condição de estado anterior, evento auditável e checkpoint na mesma transação. Savepoints permitem compor intenções e transições. Repetir o mesmo estado não grava outro checkpoint. Uma reconciliação de crash pode colocar uma Run anteriormente concluída em recovery_needed quando há operação de rollback incerta: conclusão da CLI não prova conclusão daquela operação posterior.

## Conteúdo e retenção

Há checkpoints antes do início, nas transições, antes/depois de worktree e rollback, em preferência, espera por limite e encerramento ordenado, além do botão Criar checkpoint. Cada registro guarda data, origem, estado, Run/Dot/projeto, referência da worktree, política inicial, preferência, último evento, última operação confirmada e operações pendentes/incertas. Fingerprints incluem HEAD, diff e arquivos não rastreados; o conteúdo desses arquivos não é copiado ao checkpoint. Nenhum token, ambiente, prompt ou saída de terminal entra no snapshot.

Checkpoints são **lógicos**. Não preservam memória, descritores, PTY nem uma sessão interna de agente. Scrollback continua limitado à RAM do daemon. Sessão nativa no snapshot fica nula enquanto não houver adaptador que realmente a forneça. O agendador tem campo próprio de sessão para adaptadores confiáveis; o renderer não pode fornecê-lo.

São retidos os últimos 100 checkpoints automáticos por Run. Manuais e eventos auditáveis são preservados; listagens retornam até 100 registros. Não há timer periódico de checkpoints. Históricos manuais, eventos e operações podem crescer com uso prolongado; não são excluídos silenciosamente. Monitorar disco e definir exportação/retenção auditável é uma pendência, sem prometer retenção ilimitada gratuita.

## Crash e identidade

`settings.daemon.clean` registra início e saída ordenada. Mesmo com saída ordenada, Runs que permanecem running são reconciliadas: o banco nunca prova processo vivo. Intenções pendentes tornam-se uncertain antes de reconstruir a fila por created_at. Runs running e waiting_approval interrompidas entram em recovery_needed; fila não iniciada e pausa do agendamento persistem.

A identidade Linux usa PID, boot_id, starttime de /proc, UID e executável. PID sozinho nunca identifica a execução. A inspeção procura também membros da sessão PTY. `forkpty` cria uma sessão liderada pelo PID retornado; logo após fork, /proc pode ainda mostrar a sessão do pai até setsid/login_tty. A detecção usa a identidade do líder e o escopo de sessão do PTY, evitando associar essa leitura transitória ao daemon inteiro. PIDs reutilizados podem causar bloqueio conservador por escopo de sessão, nunca autorização para matar ou reanexar processo alheio.

O SIGKILL real demonstrou: a CLI normal encerra ao perder o PTY; uma fixture que ignora SIGHUP sobrevive. O eros não reanexa descritores perdidos nem mata automaticamente sobreviventes. A intenção de lançamento é registrada **antes** do spawn; crash entre spawn e gravação da identidade fica incerto, impedindo outro lançamento.

Processos que escapam por setsid/daemonização não são integralmente rastreáveis por esta arquitetura. Isso, efeitos de rede e efeitos fora da worktree continuam riscos residuais explicitados na confirmação. A worktree não é sandbox.

## Retomada manual e operações

O diálogo Retomar apresenta motivo, checkpoint, worktree disponível/modificada, sobreviventes, ausência de continuação nativa e operações incertas. Nova sessão exige confirmação explícita, ausência de sobrevivente conhecido/incerteza controlada, configuração compatível, Dot autorizado e política revalidada. A branch e o common Git directory são conferidos antes do lançamento. A CLI abre na mesma worktree, sem novo prompt automático. Isso não garante que a própria CLI não tenha comportamento de inicialização configurado pelo usuário.

Acesso total interrompido exige nova execução com confirmação nativa; a recuperação não amplia permissões. Cancelamento explícito nunca agenda continuação. Uma Run cancelada com sobrevivente pode continuar tendo um processo externo: cancelar o registro de recuperação não significa matar um processo órfão. Rollback e remoção ficam bloqueados nesse caso.

Chaves de idempotência vinculam operação, Run e tipo. Enqueue, checkpoint e retomada protegem replay com a mesma chave. O preload fornece UUID ao iniciar; clientes legados que omitem a chave de enqueue não têm deduplicação semântica entre novas solicitações independentes. A fila não é recriada em novas Runs no restart. Worktree usa chave determinística por Run; rollback também. Ações SQLite são transacionais; ações Git/OS usam intenção durável e confirmação posterior. Se o daemon cai entre elas, o efeito fica incerto e não é repetido automaticamente.

Não existe promessa exactly once para ações externas arbitrárias. Rollback interrompido parcialmente requer inspeção manual; não há botão para forçar repetição de operações incertas.
