# Protocolos descobertos

As fixtures sanitizadas ficam em `claude/` e `codex/`. O gravador salva primeiro a troca crua em `scripts/record-fixtures/out/`, ignorada pelo Git, e só depois sanitiza. O JSONL cru pode conter dados pessoais; não deve ser publicado.

## Gravador

```sh
node scripts/record-fixtures/index.ts [claude|codex] [cenario|all]
node scripts/record-fixtures/index.ts --sanitize-existing
```

Cada cenário cria um Projeto temporário com `README.md` e Git. O timeout padrão é 120 segundos (`KARONT_RECORDER_TIMEOUT_MS`); a pergunta do Codex tem limite de 60 segundos. `KARONT_RECORDER_CLAUDE_PERMISSION=always` grava em `claude/comando-permitir-sempre.jsonl`; `KARONT_RECORDER_CODEX_PERMISSION=session` grava em `codex/comando-permitir-sempre.jsonl`.

O modo falso usa transporte em memória:

```sh
KARONT_RECORDER_FAKE=1 KARONT_RECORDER_NO_FIXTURE=1 \
  KARONT_RECORDER_OUT_DIR=/tmp/karont-recorder-fake \
  node scripts/record-fixtures/index.ts claude all
```

Repita com `codex` para validar o outro transporte. `--sanitize-existing` reaplica a sanitização a todas as fixtures JSONL e remove ferramentas MCP de `system.init.tools`, mantendo os nomes das ferramentas nativas.

## Claude Code 2.1.316

Claude 2.1.x tem `fastMode` via `--settings`, mas depende de uso extra na conta; o Karont não oferece por enquanto.

### Inicialização, conversa e interrupção

O comando usado é:

```sh
claude -p --input-format stream-json --output-format stream-json --verbose \
  --include-partial-messages --permission-prompts host \
  --permission-prompt-tool stdio --permission-mode <modo> \
  --model haiku --effort low --tools <ferramentas-do-cenário> --session-id <uuid>
```

`--permission-prompt-tool stdio` é obrigatória junto de `--permission-prompts host`: sem ela, a CLI nega sozinha e emite `system` com `subtype: "permission_denied"`, sem entregar `can_use_tool` ao host.

O host envia uma mensagem por linha, por exemplo `{"type":"user","message":{"role":"user","content":"Diga oi em uma linha."}}`. O host também envia `control_request` com `request.subtype: "initialize"`; a CLI responde com `control_response` e `response.subtype: "success"`. Texto ao vivo vem em `stream_event` (`content_block_delta`/`text_delta`); mensagens completas vêm em `assistant` e o turno termina em `result`. `--session-id <uuid>` inicia uma conversa; a retomada usa outro processo com `--resume <id>`. O mesmo ID aparece em `result.session_id`.

Interrupção: o host envia `{"type":"control_request","request_id":"r1","request":{"subtype":"interrupt"}}`. A gravação real recebeu a resposta de controle e encerrou com `result.subtype: "error_during_execution"`.

O `claude --help` disponível nesta worktree lista `plan` entre os valores de `--permission-mode`. A troca durante a sessão usa o pedido de controle `set_permission_mode`, documentado pela [API de permissões do Agent SDK](https://code.claude.com/docs/en/agent-sdk/permissions): `{"type":"control_request","request_id":"r3","request":{"subtype":"set_permission_mode","mode":"plan"}}`. A CLI confirma com `control_response` de subtipo `success`. As fixtures existentes não capturam essa troca; o fake do serviço responde a esse pedido para testar a sequência. Assim, o serviço entra em plano sem reiniciar e volta ao modo escolhido antes de permitir `ExitPlanMode`. Se uma versão futura da CLI não confirmar o pedido, a entrada em plano pode ser retomada por processo novo com `--permission-mode plan --resume <id>`.

### Permissão, pergunta, plano e tarefas

O pedido real de Bash chega assim, com `input.command` e `input.description`. `permission_suggestions` trouxe três alternativas: `addRules` para `localSettings`, `addDirectories` para `session` e `setMode` para `session`.

```json
{"type":"control_request","request_id":"r2","request":{"subtype":"can_use_tool","tool_name":"Bash","input":{"command":"...","description":"..."},"permission_suggestions":[{"type":"addRules","rules":[{"toolName":"Bash","ruleContent":"..."}],"behavior":"allow","destination":"localSettings"}]}}
```

Permitir uma vez: a resposta `control_response` tem `response.subtype: "success"`, o mesmo `request_id` e `response: {"behavior":"allow","updatedInput":{"command":"...","description":"..."}}`. Negar: `response: {"behavior":"deny","message":"..."}`; não há `updatedInput`.

**Permitir sempre** foi capturado. O host seleciona a sugestão `addRules` de `localSettings` e a devolve em `response.updatedPermissions`, junto com `behavior: "allow"` e o `updatedInput` original:

```json
{"behavior":"allow","updatedInput":{"command":"...","description":"..."},"updatedPermissions":[{"type":"addRules","rules":[{"toolName":"Bash","ruleContent":"..."}],"behavior":"allow","destination":"localSettings"}]}
```

`AskUserQuestion` aparece como `assistant` com `tool_use`, seguido de `control_request/can_use_tool` para `AskUserQuestion`. O `input` contém `questions`; a resposta real do host permite a ferramenta e devolve `updatedInput` com `questions` e `answers`, mapeando o texto da pergunta para a opção escolhida.

`ExitPlanMode` aparece como `tool_use` e depois `control_request/can_use_tool` com `tool_name: "ExitPlanMode"`, `input: {}` e sugestões vazias. Ao aprovar, o host troca primeiro para o modo de acesso da conversa e responde com `behavior: "allow"` e `updatedInput: {}`. Ao ajustar, responde `behavior: "deny"` com o comentário do usuário em `message`; a CLI segue no modo plano. O cenário real também teve `Write` antes de `ExitPlanMode` para preparar o plano.

Tarefas são chamadas nativas em `assistant.message.content`: `TaskCreate` com `input.subject`/`input.description` e `TaskUpdate` com `input.taskId`/`input.status`. A captura real criou duas tarefas e atualizou ambas para `completed`; não houve `TodoWrite`.

`system.init.tools` nas capturas reais também tinha ferramentas MCP do ambiente. Elas foram removidas das fixtures; as ferramentas nativas do cenário foram preservadas.

### Modos Karont e erro

| Modo Karont | Configuração Claude Code | Limite observado |
| --- | --- | --- |
| Só leitura | `--permission-mode dontAsk` e ferramentas explicitamente limitadas a leitura, por exemplo `Read,Glob,Grep` | A lista de ferramentas é o que evita expor Bash/escrita. |
| Pode editar (pede permissão para comandos) | `--permission-mode acceptEdits` ou `manual`, com `--permission-prompts host --permission-prompt-tool stdio` | Ferramentas que a política aprova automaticamente não geram `can_use_tool`; o host decide as demais. |
| Liberado | `--permission-mode bypassPermissions` com o opt-in de bypass exigido pela CLI | Remove confirmações; não isola a pasta do Projeto. |

O serviço usa `dontAsk` com `--tools Read,Glob,Grep,WebSearch,WebFetch,AskUserQuestion,ExitPlanMode,TaskCreate,TaskUpdate,TodoWrite` no modo Só leitura. Isso limita as ferramentas disponíveis melhor que `default`, permite as interações com o usuário e os itens de tarefas, e o host nega automaticamente qualquer outra ferramenta que escreva ou rode comandos. Para erro de login, as fixtures não contêm uma saída real desse tipo: o adaptador usa uma heurística restrita ao texto de erro (`not logged in`, `please log in`, `authentication required`, `logged out` ou OAuth expirado/inválido). Ele não consulta arquivos ou pastas de credenciais.

A retomada real lembrou `jatobá` após `--resume`. O cenário de erro usa `cwd` inexistente e registra `ENOENT` antes de gerar. O resultado de um turno usa `result.subtype`; a falha de início aparece em stderr.

## Codex 0.166.0

### Inicialização e conversa

O processo é `codex app-server --stdio`, com JSON-RPC por linha. A conversa real passou por `initialize` com `capabilities.experimentalApi: true`, `initialized`, `model/list`, `thread/start` e `turn/start`. O ID da conversa vem de `result.thread.id`; o ID do turno vem de `result.turn.id` ou `turn/started`. Texto ao vivo chega em `item/agentMessage/delta`; o turno termina em `turn/completed`.

O gravador mantém a seleção de modelo mini/nano/spark se listado, depois o padrão (ou `KARONT_RECORDER_CODEX_MODEL`), e escolhe o menor esforço anunciado. O app-server não informa preços. O gravador não envia `serviceTier: "fast"`.

### Confirmação do tier rápido

O schema gerado do app-server 0.166 contém `serviceTier` na resposta de `thread/start` e `threadSettings.serviceTier` em `ThreadSettingsUpdatedNotification` (`thread/settings/updated`). A captura real em `codex/continuar.jsonl` registra essa notificação com `serviceTier: "default"` para uma conversa iniciada sem Fast. O adaptador compara confirmações explícitas com o tier anunciado pelo modelo (por exemplo, `priority`): igualdade confirma `on`; outro valor, inclusive `default` ou `null`, confirma `off`. Sem o campo de confirmação, o adaptador mantém o estado solicitado.

Ainda não há captura real de uma inicialização que solicite `priority`; no sandbox, o `app-server` não iniciou para gravar esse caso. O fake de Codex usa o tier solicitado como confirmação por padrão e permite simular uma resposta `default` para cobrir a recusa.

`ClientRequest.json` foi gerado com `--experimental`; essa versão do schema revela `turn/start.params.collaborationMode`, incluindo `mode: "plan"`. O gravador envia esse modo para pergunta, plano e tarefas.

### Aprovação, input e plano

Pedidos do servidor são JSON-RPC com `id`, `method` e `params`; o host responde com o mesmo `id` e um `result`. Os eventos reais de comando confirmaram `item/commandExecution/requestApproval`: `{"decision":"accept"}` permite uma vez, `{"decision":"acceptForSession"}` permite na sessão e `{"decision":"decline"}` nega. O fixture de sessão é escrito automaticamente em `comando-permitir-sempre.jsonl`.

O pedido estruturado de pergunta foi capturado como `item/tool/requestUserInput`. `params` continha `threadId`, `turnId`, `itemId`, `questions`, `isBlocking` e `autoResolutionMs`; cada pergunta tinha `id`, `header`, `question`, `isOther`, `isSecret` e `options`. A resposta real foi um resultado JSON-RPC com `answers: {"<id>": {"answers": ["<opção>"]}}`.

O schema traz `turn/plan/updated`, mas ele não apareceu nas gravações Codex 0.166.0. O plano real chegou por itens: `item/started` com `item.type: "plan"`, várias notificações `item/plan/delta` com `threadId`, `turnId`, `itemId` e `delta`, e `item/completed` com `item.type: "plan"` e o texto final em `item.text`. O texto observado continha dois passos numerados.

Nas capturas cruas recentes, o cenário `plano` enviou `collaborationMode: "plan"` e completou o item `plan`, mas o gravador antigo esperava `turn/plan/updated`; por isso não enviou a mensagem de aprovação. O cenário `tarefas` também completou um item `plan` com duas tarefas marcadas como pendentes, mas a mesma validação rígida impediu o segundo turno. O serviço agora inicia o turno de aprovação com `collaborationMode: "default"` e um pedido explícito para executar o plano. Para ajustar, envia o comentário em um novo `turn/start` com `collaborationMode: "plan"`. As fixtures preservam a resposta gravada do plano para validar essas duas formas de envio; a saída do segundo turno ainda não representa uma execução real.

Não há pedido JSON-RPC separado para aprovar um plano no schema observado. O host demonstra aprovação enviando a segunda mensagem em `turn/start` com modo de colaboração `default`; para ajustar, inicia a mensagem em modo `plan`. Para tarefas, o plano é texto livre, não uma lista de tarefas com enum de status.

### Interrupção, retomada, erro e modos Karont

O host interrompe com `turn/interrupt` e `{threadId,turnId}`. A resposta real foi `{}` e o servidor emitiu `turn/completed` com status `interrupted`. `thread/resume` recebe `{threadId,cwd}`; a retomada real lembrou `jatobá`. O erro usa `cwd` inexistente e `ENOENT` antes de iniciar turno ou geração.

| Modo Karont | `sandbox` | `approvalPolicy` | Limite observado |
| --- | --- | --- | --- |
| Só leitura | `read-only` | `never` | Não concede escalada de escrita. |
| Pode editar (pede permissão para comandos) | `workspace-write` | `untrusted` | Comandos não confiáveis pedem aprovação; o sandbox permite editar o Projeto. |
| Liberado | `danger-full-access` | `never` | Sem sandbox/aprovação automática; a pasta do Projeto não fica isolada. |

## Mapa para as partes da mensagem do Karont

| Parte | Claude Code 2.1.316 | Codex 0.166.0 |
| --- | --- | --- |
| Texto | `stream_event` com `text_delta`; texto final em `assistant`/`result`. | `item/agentMessage/delta`; texto final em item `agentMessage`. |
| Pensamento | Bloco `thinking` em `assistant` e deltas `thinking_delta`. | Item `reasoning` em `item/started`/`item/completed`, com `summary`/`content`. |
| Ação | Blocos `tool_use` como `Read`, `Bash` e `Write`, pareados com `tool_result`. | Itens como `commandExecution`, com saída e estado em `item/*`. |
| Permissão | `control_request/can_use_tool`; host responde `allow`/`deny` em `control_response`; `updatedPermissions` registra “permitir sempre”. | Pedido JSON-RPC como `item/commandExecution/requestApproval`; resultado `accept`, `acceptForSession` ou `decline`. |
| Pergunta | `AskUserQuestion` via `can_use_tool`; resposta escolhida em `updatedInput.answers`. | `item/tool/requestUserInput`; resposta JSON-RPC em `result.answers`. |
| Plano | `ExitPlanMode` via `can_use_tool`; o host aprova com `allow`. | Item `plan` transmitido por `item/plan/delta` e fechado por `item/completed`. A aprovação é a próxima mensagem do host. |
| Tarefas | `TaskCreate`/`TaskUpdate`; chamadas com `subject`, `description`, `taskId` e `status`. | Etapas numeradas dentro do texto do item `plan`; a gravação pendente precisa confirmar a atualização para concluído. |
| Erro | Evento `system`/`result` da CLI ou stderr de inicialização, como `ENOENT`. | `turn/completed`/erro JSON-RPC quando há turno; stderr `ENOENT` quando o processo nem inicia. |

## Auditoria das gravações reais mais recentes

| Cenário | Claude Code | Codex |
| --- | --- | --- |
| `texto` | Exercitou deltas e resultado final. | Exercitou `item/agentMessage/delta` e `turn/completed`. |
| `leitura` | Exercitou `Read`. | Exercitou `commandExecution` lendo `README.md`. |
| `comando-permitido` | Exercitou `can_use_tool`/`Bash`; fixtures de permitir uma vez e sempre. | Exercitou `requestApproval`/`accept` e `acceptForSession`. |
| `comando-negado` | Exercitou `can_use_tool`/`Bash` com `deny`. | Exercitou `requestApproval`/`decline`. |
| `pergunta` | Exercitou `AskUserQuestion` e resposta em `updatedInput.answers`. | Exercitou `item/tool/requestUserInput` e resposta `result.answers`. |
| `plano` | Exercitou `ExitPlanMode` aprovado. | Parcial: item `plan` com dois passos; regravar para capturar o segundo turno de aprovação. |
| `tarefas` | Exercitou duas `TaskCreate` e duas `TaskUpdate`. | Parcial: item `plan` com duas tarefas pendentes; regravar para capturar a atualização após aprovação. |
| `continuar` | `--resume` lembrou `jatobá`. | `thread/resume` lembrou `jatobá`. |
| `parar` | `control_request/interrupt` e resultado interrompido. | `turn/interrupt` e status `interrupted`. |
| `erro` | Falha de início `ENOENT`, sem geração. | Falha de início `ENOENT`, sem geração. |

## Dados de edição e ferramentas especiais

As fixtures reais disponíveis não contêm chamadas Claude `Edit`, `MultiEdit`, `Write`, `Task` com ações filhas ou ferramentas MCP, nem itens Codex `fileChange`, `mcpToolCall`, `collabAgentToolCall` ou `imageGeneration`. `claude/acoes-especiais.jsonl` e `codex/acoes-especiais.jsonl` são fixtures de teste construídas com os formatos documentados no adaptador Claude e nos schemas Codex desta pasta; elas não são gravações de CLI.

- Claude `Edit` usa `input.file_path`, `old_string` e `new_string`; `MultiEdit` usa `input.file_path` e `input.edits[]`; `Write` usa `input.file_path` e `content`. O serviço converte esses dados em `output` JSON no formato `[{ path, kind, diff }]`, com diff unificado. `Write` representa criação com `kind: "add"` e todas as linhas prefixadas com `+`.
- Claude `Task` usa `description` como título e `prompt` como entrada. Chamadas com `parent_tool_use_id` igual ao ID da ferramenta `Task` recebem o `parentId` da parte do subagente. Ferramentas MCP seguem `mcp__<servidor>__<ferramenta>`; o serviço separa servidor/ferramenta, conserva os valores de entrada e registra o resultado da ferramenta.
- Codex `fileChange.changes[]` contém `FileUpdateChange { path, kind, diff }`, com `kind` como variante marcada (`{ type: "add" | "update" | "delete" }`); o serviço conserva essa forma no JSON. Também aceita o formato legado indexado por caminho.
- Codex `mcpToolCall` fornece `server`, `tool`, `arguments` e `result`; `imageGeneration` fornece `savedPath` e `revisedPrompt`. A imagem guarda apenas o caminho e o prompt revisado; leitura e validação do arquivo ficam para outra tarefa.
- Entradas e saídas são limitadas a 8 KiB e 64 KiB, respectivamente. Quando há truncamento, `truncated` fica `true`; a lista JSON de diffs continua válida.
- O schema preserva `actionType: "subagent" | "mcp" | "image"` e os campos opcionais `parentId`, `server` e `tool`; a F24 consome esses dados para agrupar ações de subagentes e detalhar MCP/imagem.

## Subagentes do Codex (app-server 0.166.0)

O schema foi gerado fora do repositório com `codex app-server generate-json-schema --experimental --out /tmp/karont-m2-b12-codex-schema`.

- `collabAgentToolCall` tem `id`, `senderThreadId`, `receiverThreadIds`, `status`, `tool` e `agentsStates` como campos obrigatórios. `prompt`, `model` e `reasoningEffort` são opcionais e podem ser `null`.
- `tool` aceita `spawnAgent`, `sendInput`, `resumeAgent`, `wait`, `closeAgent`, `sendMessage`, `followupTask`, `interruptAgent` e `listAgents`. O status da chamada é `inProgress`, `completed`, `failed` ou `interrupted`.
- `agentsStates` é um mapa por thread receptora. Cada estado tem `status` (`pendingInit`, `running`, `interrupted`, `completed`, `errored`, `shutdown` ou `notFound`) e pode ter uma `message`.
- `item/started` inclui `threadId`, `turnId`, `startedAtMs` e `item`; `item/completed` inclui os mesmos identificadores, `completedAtMs` e `item`. O schema gerado não contém a notificação `item/updated`.
- Na captura real do Codex 0.166 (`gpt-5.6-terra`), o início do subagente chega em `item/started` com `item.type: "subAgentActivity"`, `kind: "started"`, `agentThreadId`, `agentPath`, `model`, `reasoningEffort` e `startedAtMs`. A mesma atividade também pode chegar em `item/completed` ainda com `kind: "started"`; isso não conclui a ação. O encerramento vem em outro item `subAgentActivity`, com ID próprio e `kind: "completed"`, associado pelo mesmo `agentThreadId`.
- Os itens do filho são transmitidos na conexão principal com `params.threadId` igual a `agentThreadId`: `commandExecution`, `fileChange`, `mcpToolCall` e outros itens de ação recebem `parentId` da ação de subagente. `agentMessage` do filho não vira texto principal; seu texto final acumulado vai para a saída do subagente. O `reasoning` do filho pode ser ignorado, e `turn/completed` da thread filha não encerra o turno principal.
- Um `collabAgentToolCall` `wait` com `receiverThreadIds: []` é só a espera do agente principal e não cria ação. `spawnAgent`/`sendInput` com threads receptoras continuam usando o vínculo da B12 entre thread e ação.
- `codex/subagente.jsonl` e `codex/subagente-em-progresso.jsonl` continuam como fixtures sintéticos da B12: cobrem associação por `collabAgentToolCall`, exemplo de ação filha e encerramento antes da conclusão. `codex/subagente-real.jsonl` complementa esses casos com uma captura real sanitizada do fluxo `subAgentActivity` e da thread filha; IDs são fictícios e `/tmp/karont-teste-grande` foi substituído por `/tmp/projeto`.

## Subagentes (Claude Code 2.1.x)

- A ferramenta do subagente se chama `Agent` (não `Task`) nas versões 2.1.x. Entrada: `subagent_type`, `description`, `prompt`, `run_in_background`. `Task` continua aceito para CLIs antigas.
- As ações do subagente chegam como `assistant`/`user` normais com `parent_tool_use_id` igual ao ID do `tool_use` do `Agent`. Esse ID é o `parentId` da parte filha.
- O resultado final do subagente vem no `tool_result` do `Agent`, com um quadro do harness em volta do relatório; o adaptador guarda só o relatório.
- Eventos `system` com `subtype` `task_started`, `task_progress`, `task_updated` e `task_notification` acompanham o subagente. Não geram partes: o adaptador os ignora.
- `claude/subagente-agent.jsonl` é uma fixture sanitizada desse fluxo, gerada a partir de uma captura real com ids e caminhos fictícios.

## Armadilhas

- Claude precisa de `--permission-prompt-tool stdio` com `--permission-prompts host`; sem a primeira flag, pode negar antes de enviar `can_use_tool`.
- Texto do agente pedindo permissão ou listando opções não prova que houve um evento estruturado. Valide a requisição e a resposta do host.
- Codex 0.166.0 transmitiu plano como item `plan`; não exija `turn/plan/updated` para este caminho.
- Gere o schema Codex com `--experimental`, senão `turn/start.collaborationMode` fica oculto.
- IDs de sessão/thread/turno são preservados com UUID fictício consistente. Caminhos pessoais, e-mails, tokens e campos de conta/organização são redigidos; nomes de ferramentas MCP são removidos ou substituídos. O JSONL cru continua fora do Git.
