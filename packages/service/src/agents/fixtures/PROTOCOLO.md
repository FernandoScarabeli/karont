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

`ExitPlanMode` aparece como `tool_use` e depois `control_request/can_use_tool` com `tool_name: "ExitPlanMode"`, `input: {}` e sugestões vazias. O host aprova com `control_response` contendo `behavior: "allow"` e `updatedInput: {}`. O cenário real também teve `Write` antes de `ExitPlanMode` para preparar o plano.

Tarefas são chamadas nativas em `assistant.message.content`: `TaskCreate` com `input.subject`/`input.description` e `TaskUpdate` com `input.taskId`/`input.status`. A captura real criou duas tarefas e atualizou ambas para `completed`; não houve `TodoWrite`.

`system.init.tools` nas capturas reais também tinha ferramentas MCP do ambiente. Elas foram removidas das fixtures; as ferramentas nativas do cenário foram preservadas.

### Modos Karont e erro

| Modo Karont | Configuração Claude Code | Limite observado |
| --- | --- | --- |
| Só leitura | `--permission-mode dontAsk` e ferramentas explicitamente limitadas a leitura, por exemplo `Read,Glob,Grep` | A lista de ferramentas é o que evita expor Bash/escrita. |
| Pode editar (pede permissão para comandos) | `--permission-mode acceptEdits` ou `manual`, com `--permission-prompts host --permission-prompt-tool stdio` | Ferramentas que a política aprova automaticamente não geram `can_use_tool`; o host decide as demais. |
| Liberado | `--permission-mode bypassPermissions` com o opt-in de bypass exigido pela CLI | Remove confirmações; não isola a pasta do Projeto. |

A retomada real lembrou `jatobá` após `--resume`. O cenário de erro usa `cwd` inexistente e registra `ENOENT` antes de gerar. O resultado de um turno usa `result.subtype`; a falha de início aparece em stderr.

## Codex 0.166.0

### Inicialização e conversa

O processo é `codex app-server --stdio`, com JSON-RPC por linha. A conversa real passou por `initialize` com `capabilities.experimentalApi: true`, `initialized`, `model/list`, `thread/start` e `turn/start`. O ID da conversa vem de `result.thread.id`; o ID do turno vem de `result.turn.id` ou `turn/started`. Texto ao vivo chega em `item/agentMessage/delta`; o turno termina em `turn/completed`.

O gravador mantém a seleção de modelo mini/nano/spark se listado, depois o padrão (ou `KARONT_RECORDER_CODEX_MODEL`), e escolhe o menor esforço anunciado. O app-server não informa preços. O gravador não envia `serviceTier: "fast"`.

`ClientRequest.json` foi gerado com `--experimental`; essa versão do schema revela `turn/start.params.collaborationMode`, incluindo `mode: "plan"`. O gravador envia esse modo para pergunta, plano e tarefas.

### Aprovação, input e plano

Pedidos do servidor são JSON-RPC com `id`, `method` e `params`; o host responde com o mesmo `id` e um `result`. Os eventos reais de comando confirmaram `item/commandExecution/requestApproval`: `{"decision":"accept"}` permite uma vez, `{"decision":"acceptForSession"}` permite na sessão e `{"decision":"decline"}` nega. O fixture de sessão é escrito automaticamente em `comando-permitir-sempre.jsonl`.

O pedido estruturado de pergunta foi capturado como `item/tool/requestUserInput`. `params` continha `threadId`, `turnId`, `itemId`, `questions`, `isBlocking` e `autoResolutionMs`; cada pergunta tinha `id`, `header`, `question`, `isOther`, `isSecret` e `options`. A resposta real foi um resultado JSON-RPC com `answers: {"<id>": {"answers": ["<opção>"]}}`.

O schema traz `turn/plan/updated`, mas ele não apareceu nas gravações Codex 0.166.0. O plano real chegou por itens: `item/started` com `item.type: "plan"`, várias notificações `item/plan/delta` com `threadId`, `turnId`, `itemId` e `delta`, e `item/completed` com `item.type: "plan"` e o texto final em `item.text`. O texto observado continha dois passos numerados.

Nas capturas cruas recentes, o cenário `plano` enviou `collaborationMode: "plan"` e completou o item `plan`, mas o gravador antigo esperava `turn/plan/updated`; por isso não enviou a mensagem de aprovação. O cenário `tarefas` também completou um item `plan` com duas tarefas marcadas como pendentes, mas a mesma validação rígida impediu o segundo turno. O gravador agora detecta o item concluído, envia a aprovação em um `turn/start` com uma mensagem explícita de aprovação e, para tarefas, exige em seguida um item/atualização de plano com duas etapas marcadas como concluídas. Os dois cenários precisam ser regravados para registrar o segundo turno real.

Não há pedido JSON-RPC separado para aprovar um plano no schema observado. O host demonstra aprovação enviando a segunda mensagem em `turn/start`. Para tarefas, o plano é texto livre, não uma lista de tarefas com enum de status; a validação verifica as duas etapas e seus marcadores textuais.

### Interrupção, retomada, erro e modos Karont

O host interrompe com `turn/interrupt` e `{threadId,turnId}`. A resposta real foi `{}` e o servidor emitiu `turn/completed` com status `interrupted`. `thread/resume` recebe `{threadId,cwd}`; a retomada real lembrou `jatobá`. O erro usa `cwd` inexistente e `ENOENT` antes de iniciar turno ou geração.

| Modo Karont | `sandbox` | `approvalPolicy` | Limite observado |
| --- | --- | --- | --- |
| Só leitura | `read-only` | `never` | Não concede escalada de escrita. |
| Pode editar (pede permissão para comandos) | `workspace-write` | `on-request` | Comandos dentro da política podem rodar sem pedido; escaladas são aprovadas pelo host. |
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

## Armadilhas

- Claude precisa de `--permission-prompt-tool stdio` com `--permission-prompts host`; sem a primeira flag, pode negar antes de enviar `can_use_tool`.
- Texto do agente pedindo permissão ou listando opções não prova que houve um evento estruturado. Valide a requisição e a resposta do host.
- Codex 0.166.0 transmitiu plano como item `plan`; não exija `turn/plan/updated` para este caminho.
- Gere o schema Codex com `--experimental`, senão `turn/start.collaborationMode` fica oculto.
- IDs de sessão/thread/turno são preservados com UUID fictício consistente. Caminhos pessoais, e-mails, tokens e campos de conta/organização são redigidos; nomes de ferramentas MCP são removidos ou substituídos. O JSONL cru continua fora do Git.
