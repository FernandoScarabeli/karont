# Schema JSON-RPC do Codex

Gerado offline com o Codex CLI `0.166.0`. `ClientRequest.json` inclui também os campos experimentais usados para ativar o modo Plan:

```sh
codex app-server generate-json-schema --experimental --out packages/service/src/agents/fixtures/codex/schema
```

O schema `ClientRequest.json` contém `TurnStartParams.collaborationMode`, incluindo `mode: "plan"`, além do método `collaborationMode/list`. `ServerRequest.json` descreve o pedido experimental `item/tool/requestUserInput`; `ServerNotification.json` descreve `item/plan/delta`, o item `plan` e `turn/plan/updated`. Na captura real, o plano veio como item `plan` com deltas, sem `turn/plan/updated`. Os demais arquivos guardam apenas as estruturas necessárias às conversas, aos turnos, às aprovações e ao JSON-RPC. Schemas individuais sem relação com esses fluxos foram omitidos.
