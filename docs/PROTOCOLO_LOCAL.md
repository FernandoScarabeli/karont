# Protocolo local v1 — proposta implementada na Fase 0

## Fronteira de confiança

Socket AF_UNIX de filesystem, sem TCP, em `$XDG_RUNTIME_DIR/eros-<uid>`, ou `/tmp/eros-<uid>` se XDG não estiver disponível. Diretório próprio 0700, socket 0600 e metadados de sessão 0600. O fallback não usa diretório público: o subdiretório é privado e seu dono/modo são verificados. Banco em `$XDG_DATA_HOME/eros` (fallback `~/.local/share/eros`), diretório 0700 e arquivos 0600. Para testes, `EROS_RUNTIME_DIR` e `EROS_DATA_DIR` isolam totalmente as instâncias. Caminhos longos podem exceder o limite de AF_UNIX do Linux; use diretório runtime curto.

Symlinks nos diretórios finais e lock são recusados; o lock usa `O_NOFOLLOW`. Caminhos XDG e seus ancestrais são configuração confiável do usuário, não entrada do renderer. Arquivos SQLite existentes também são verificados. A criação do diretório é atômica; diretórios existentes com dono/modo incorretos são recusados, sem corrigir permissões de terceiros.

O daemon gera segredo aleatório de 256 bits a cada início e grava em `session.json` privado somente após o socket estar pronto. Trata-se de uma capacidade efêmera de IPC, não de credencial de CLI/provedor. Nunca chega ao renderer, argumentos de processo ou logs. Os arquivos são removidos ao encerrar normalmente; após crash o novo dono do flock os substitui. Mesmo usuário pode ler a capacidade: **não há isolamento de processos maliciosos do mesmo UID**, nem proteção contra root. HMAC não muda essa fronteira.

## Handshake mútuo

Codificação UTF-8, um objeto JSON por linha (LF). `H(role, value) = HMAC-SHA256(secret, "eros:1:" + role + ":" + value)`, em hex minúsculo. Comparações constantes para provas de tamanho igual.

1. Servidor gera `Ns`, nonce aleatório de 32 bytes em hex, exclusivo da conexão, e envia `{type:"challenge",version:1,nonce:Ns,proof:H("server", Ns)}`.
2. Cliente lê o segredo privado e verifica a prova. Gera nonce próprio `Nc` de 32 bytes e responde `{type:"authenticate",version:1,nonce:Nc,proof:H("client", Ns + ":" + Nc)}`.
3. Servidor verifica a versão, nonce e prova e responde `{type:"ready",version:1,proof:H("ready", Ns + ":" + Nc)}`.
4. Cliente verifica a prova final antes de disponibilizar o transporte. Ela impede que uma prova antiga de servidor autentique uma sessão nova do cliente.

Sem negociação implícita nem downgrade. Provas de outro papel, versão ou nonce não servem. Nonces são vinculados à conexão; replay do cliente em outra conexão falha. Um endpoint falso sem o segredo não gera a prova final sobre o nonce fresco do cliente. Timeout de autenticação 2 s, limite de 16 conexões simultâneas, 100 mensagens/s por conexão, buffer/frame máximo 64 KiB, fila de escrita limitada a 64 KiB. JSON malformado, contrato inválido ou excesso fecha a conexão. O segredo não é enviado pelo socket e o conteúdo não é criptografado: confidencialidade depende do filesystem e do kernel local.

## Mensagens autenticadas

- `{id,method:"ping"}`: snapshot/heartbeat.
- `{id,method:"snapshot"}`: estado limitado de teste.
- `{id,method:"layout",value:{columns:2|4,editor:string,editorOpen:boolean}}`: salvar SQLite antes de responder.
- `{id,method:"stream",value:boolean}`: iniciar/pausar contador simulado.
- `{id,method:"shutdown"}`: encerrar daemon; disponível apenas no cliente Node de controle, não na ponte renderer.

Resposta `{id,result:Snapshot}` validada no cliente. IDs inteiros positivos por cliente; somente respostas a solicitações pendentes são aceitas. Campos desconhecidos em comandos/layout são recusados. Sem comandos de shell, caminhos de arquivo ou capacidades genéricas. `Snapshot` inclui PID, uptime, contador de heartbeat, sequência sintética, estado de streaming/layout, RSS e CPU acumulada, além das verificações WAL/FTS5.

Cliente tem prazo de 3 s por chamada e reconecta com novo handshake após falha. Main envia ping a cada 2 s. UI identifica desconexão e tenta novamente; jamais mata/reinicia daemon em função de batimento atrasado. Suspensão do computador pode expirar chamada e exigir reconexão, sem duplicar processos. Watchdog com identidade PID+início e política de retomada continua uma validação futura: não foi criado um supervisor que reinicie processos às cegas.

## Testes e validação pendente

A suíte cobre singleton sob concorrência; modos privados; diretório inseguro/symlink; autenticação ausente, inválida e versão divergente; JSON inválido, tamanho e timeout; heartbeat com SIGSTOP/SIGCONT; reconexão; SIGKILL e recuperação de socket/lock; WAL/FTS5 e persistência. A revisão externa do protocolo e testes nas distribuições alvo continuam necessários antes de adotar esse contrato para capacidades de agentes.

## Correção de ciclo de conexão na revisão

Fechar o cliente durante o handshake agora destrói também o transporte ainda não autenticado e rejeita a solicitação imediatamente, sem aguardar timeout. Rejeições de transporte só afetam chamadas pertencentes àquela conexão; eventos atrasados de uma conexão antiga não limpam indiscriminadamente chamadas de uma nova. O formato do protocolo e sua fronteira de confiança não foram alterados.

## SPEC-001 — validação adicional

Sem alterar o contrato, a execução desktop com sandbox em VM passou por timeout durante pausa SIGSTOP/SIGCONT de main+daemon e reconectou preservando PID/starttime, sem matar o daemon; uma nova tentativa de início foi recusada com 73. Essa é simulação de atraso de execução, não suspensão física. O restante dos testes de autenticação, replay, ACLs, queda e persistência continuou aprovado. A aprovação explícita do protocolo permanece pendente; o aceite técnico do protótipo não a substitui.

## SPEC-002 — extensão proposta para execuções PTY (ainda não aprovada formalmente)

A Fase 1 mantém o socket AF_UNIX, o diretório e os modos privados, o segredo efêmero, o handshake HMAC mútuo v1, o frame JSON/LF de até 64 KiB e a validação Zod. Não há troca de segredo nem canal TCP. O protocolo implementa mensagens tipadas adicionais para `dots.list`, `projects.list`, `runs.list`, `runs.start`, `runs.cancel`, `runs.diff`, `terminal.attach`, `terminal.detachAll`, `terminal.write`, `terminal.resize`, `rollback.preview`, `rollback.apply` e `worktree.remove`. Cada solicitação conserva `id` inteiro; eventos assíncronos usam `{type:"event",event:...}`. O cliente aceita somente respostas a IDs pendentes e eventos validados por schema.

O main process Electron registra canais IPC nomeados por operação, valida remetente, frame principal e URL local antes de encaminhar; o preload expõe capacidades fixas. Executável, argumentos e projeto vêm do JSON privado de dots, não do renderer. O daemon recusa dot sem autorização ao projeto, caminho que não seja raiz Git, CLI não executável, argumentos com NUL e operações inválidas. Execução usa `node-pty` com vetor de argumentos, `cwd` worktree e ambiente filtrado; não há construção de linha shell. A entrada explícita no terminal ainda pode acionar comandos dentro da própria CLI, conforme as aprovações nativas dela.

Eventos `terminal.output` só são enviados após attach, em partes limitadas. Cada Run tem callback de assinatura próprio; reanexar uma sessão não remove a assinatura da outra. O servidor limita envio pendente por conexão; sob pressão, pode descartar entrega em tempo real e a UI deve reconectar para obter o scrollback atual. Respostas de diff/reversão limitam prévias a 100 arquivos/conflitos e sinalizam truncamento; a UI bloqueia rollback quando a prévia está truncada. Cada sessão mantém no processo do daemon até 256 KiB de saída e até 20 sessões concluídas; o buffer não é salvo no SQLite, em RunEvent nem nos logs, e desaparece se o daemon for reiniciado. PIDs, dimensões, estados e tempos da sessão são persistidos. Conteúdo exibido numa CLI pode incluir informação sensível; ele permanece visível ao usuário e temporariamente em memória da aplicação. Eros não lê arquivos de credenciais do provedor nem herda variáveis de ambiente de API para os processos da CLI.

Riscos para revisão: (1) cliente autenticado do mesmo UID pode iniciar CLIs autorizadas e enviar entrada a uma sessão enquanto detém o segredo local; a capacidade não isola processos maliciosos do mesmo usuário; (2) terminal genérico não distingue texto comum de token digitado nem controla comandos/aprovações internos; (3) scrollback pode conter saída sensível em RAM, embora não seja persistido em histórico; (4) eventos descartados sob backpressure exigem attach/reconexão; (5) limite de 100 solicitações/s também restringe entrada/redimensionamentos; (6) worktree não impede acesso da CLI a caminhos externos; (7) mensagens novas não recebem criptografia adicional e dependem das permissões do socket/kernel já descritas.

Esta extensão é documentação de implementação e risco da SPEC-002. **Não representa a revisão formal ou aprovação do protocolo**, que continua pendente.

## SPEC-003 — extensão proposta, revisão formal pendente

Preservados handshake, versão de transporte, limites, ACLs e fronteira de confiança do mesmo UID. Novos métodos autenticados: `approvals.list` (até 100), `approvals.decide` (`approvalId` UUID e `allow` booleano), `diagnostics` (lista técnica limitada). `runs.start` aceita `permissionMode` (`ask|auto|full|readOnly`, padrão `ask`) e `elevatedConfirmed` (padrão falso). O daemon recusa capacidade ausente e acesso total sem concessão, antes de criar Run, e revalida o perfil antes de lançar o PTY. Respostas passam por schema no cliente. Eventos `approval.updated` são tipados; stdout não pode produzi-los.

`rollback.preview` retorna `approvalId` quando elegível e gera pedido persistido. `approvals.decide` consome somente pedido pendente e registra decisão/resultado; conflitos são checados novamente. `rollback.apply` conserva compatibilidade, exigindo `confirmed:true` e pedido pendente emitido pelo daemon. Repetição de decisão é rejeitada. Estados terminais: denied, applied, failed. Eventos append-only registram as transições; pedido falho exige nova prévia.

Ponte Electron adicional: aprovações, diagnóstico, prévia/cópia/salvamento de relatório, preferência de notificação e foco da Run. Main aplica a mesma validação de janela/frame/URL; comandos sem argumentos recusam dados inesperados, preferência aceita somente booleano e IDs/decisões usam Zod estrito. Nenhuma operação permite shell livre, variáveis de ambiente ou caminho de escrita fornecido pelo renderer. Salvar usa diálogo nativo e relatório gerado no main. Acesso total exige diálogo nativo mesmo se o renderer enviar confirmação verdadeira; origem é revalidada após o diálogo.

Riscos novos: cliente autenticado do mesmo UID ainda pode conceder permissões explicitamente; o daemon não distingue pessoa de processo desse UID. Configuração e executável locais são confiáveis, e help não comprova integridade do binário. Opções Codex afetam suas capacidades nativas, não constituem isolamento de hooks/MCP. As listagens de aprovações contêm IDs/contexto de projetos, disponíveis somente ao cliente local autenticado. Relatórios limitam fontes e mascaram padrões conhecidos, mas exigem revisão antes de compartilhar. Notificações usam conteúdo fixo; sucesso do envio não comprova exibição. Preferências e último erro do main não são capacidades de execução. Migração v3 adiciona `approvals` e modo persistido; não adiciona retomada durável de PTY.

A integração Linux e os testes não substituem revisão formal do protocolo, que permanece pendente.

As respostas/eventos estendidos exigem main e daemon da mesma build. Componentes antigos falham pela validação estrita, sem downgrade ou reinício automático de sessões. A atualização do daemon deve ser feita depois de concluir as Runs; recuperação de PTY entre builds/restarts não é prometida.

## Parecer técnico das operações SPEC-004

Revisão interna específica do contrato e das novas operações; **não é auditoria externa**. A revisão formal do protocolo completo continua pendente. Socket privado, autenticação mútua, framing, validação de origem no main, isolamento do renderer e sandbox permanecem obrigatórios. As mensagens ampliadas exigem main/daemon da mesma build; validação estrita recusa incompatibilidades, sem downgrade silencioso.

| Operação | Entrada permitida | Autoridade e proteção |
|---|---|---|
| checkpoints.list | runId UUID | Leitura limitada a 100 resumos, sem snapshot privado |
| checkpoints.create | runId, operationId UUID | Daemon gera conteúdo; transação e chave idempotente |
| recovery.inspect | runId | Daemon calcula estado, worktree, riscos e alternativas; cliente não declara sucesso |
| runs.pause | runId | Somente queued→paused; não envia sinal a processo |
| runs.resume | runId, operationId, newSessionConfirmed boolean | Estado elegível, autorização Dot/projeto, configuração, política e worktree revalidados; processo sobrevivente/incerteza bloqueiam; chave protege replay |
| runs.autoResume | runId, enabled boolean | Preferência persistente; não certifica adaptador nem concede permissão |
| runs.start (extensão) | operationId UUID opcional | Cliente desktop usa chave; replay vinculado à mesma Run/contexto/política; caminho legado sem chave documentado |

Não existem campos de command, executable, args, snapshot, state, resetAt ou sessionId para recuperação. Schemas Zod estritos recusam propriedades adicionais. O renderer não escreve checkpoints nem escolhe comandos de continuação. Confirmação true autoriza somente uma nova sessão sob a política já permitida; acesso total interrompido exige novo fluxo com confirmação nativa. Cliente autenticado do mesmo UID continua sendo parte da fronteira confiável e pode confirmar suas próprias ações: o socket não comprova intenção humana.

Os eventos `run.updated` preservam os nove estados. `continuity.notice` aceita somente quatro categorias fixas (quota.confirmed, auto_resume.scheduled, run.resumed, resume.failed), Run e ID de evento emitido pelo daemon; títulos de notificação são fixos no main. Stdout do PTY continua restrito a saída terminal e não altera capacidades, políticas, checkpoints ou scheduler.

A inspeção não disponibiliza caminhos de worktree, conteúdo de checkpoints, argumentos privados ou credenciais ao renderer. O retorno contém resumos, booleanos de disponibilidade e avisos fixos. Todos os comandos continuam restritos ao frame principal da BrowserWindow corrente e à URL local exata. Respostas e eventos novos são validados também pelo cliente Node.

Replay de criação de checkpoint, enqueue e retomada com a mesma chave e transições concorrentes foram exercitados. Socket sem autenticação, payloads com comandos/estados/sessões/reset inventados e ausência de confirmação são recusados. Falha entre efeito Git/OS e confirmação SQLite fica incerta, sem replay automático. Um UUID é identificador de operação, não credencial de autorização.

Riscos residuais: processos do mesmo UID podem acessar os dados locais; PID/starttime são observações sujeitas a mudanças entre leituras; não há pidfd, supervisor ou isolamento de descendentes que mudam de sessão. Não é oferecido reattach de PTY após morte do daemon. Revalidação do Git reduz alterações de escopo, sem eliminar corridas com processos externos do usuário. Fingerprints têm limites de leitura (diff 8 MiB, arquivo não rastreado 2 MiB); inspeção incompleta falha conservadoramente. A migração desativa FKs apenas para reconstruir runs em transação e verifica referências após reativação; backups e recuperação de corrupção física não fazem parte desta fase.

Notificações são deduplicadas no main por evento/sessão durante reinícios do daemon; notificações não são confirmação de execução nem de leitura humana. Se o próprio main reiniciar, sua memória de entregas não persiste: títulos podem ser submetidos novamente. Uma outbox durável com confirmação D-Bus não foi implementada; não se promete exactly once de notificações.
