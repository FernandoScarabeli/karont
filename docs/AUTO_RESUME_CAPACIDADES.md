# Auto Resume — capacidades verificadas

Candidata única: **Codex CLI 0.164.0**, binário já instalado no host. Somente o executável público foi copiado para a VM Debian; HOME e CODEX_HOME da sonda são diretórios temporários vazios. Nenhuma credencial, configuração privada, prompt real ou histórico do host foi copiado. A investigação não habilita uma integração de produção.

## Fontes e evidências

Consulta à documentação oficial e investigação funcional limitada foram realizadas nesta implementação. A documentação atual pode evoluir além da versão instalada; presença no schema local foi conferida separadamente.

- [Comandos oficiais, incluindo resume e exec resume](https://learn.chatgpt.com/docs/developer-commands?surface=cli): seleção de sessão por ID e prompt posterior opcional.
- [Codex App Server oficial](https://learn.chatgpt.com/docs/app-server): thread/start e thread/resume; account/rateLimits/read e account/rateLimits/updated; resetsAt em segundos Unix. Retomar o thread não equivale a completar um turno interrompido ou provar ausência de repetição de ferramentas.
- [Sonda real sanitizada](../benchmarks/spec004/codex-probe.json), reproduzível por `EROS_REAL_CLI=/caminho/absoluto/codex node scripts/codex-continuity-probe.mjs` **na VM descartável**.

| Capacidade | Evidência | Uso no eros |
|---|---|---|
| Versão e CLI em PTY | --version e processo real; tela de autenticação nativa observada | Nível 1 |
| Identificador e continuação | resume aceita ID; schema local contém thread/resume | Documentado; nenhum ID de sessão real recuperável fornecido ao eros |
| Estados estruturados | Geração local do JSON schema e initialize JSON-RPC real | Investigação, sem trocar arquitetura do adaptador PTY |
| Conta/autenticação | account/read respondeu sem conta no HOME isolado | Teste funcional bloqueado |
| Limite de uso | schema contém account/rateLimits/read, rateLimitReachedType e usageLimitExceeded | Não demonstrado com conta/provedor real |
| Reset | schema contém resetsAt; consulta real sem conta retornou erro -32600 | Nenhum horário verificável exibido |
| Continuação da sessão | RPC thread/resume com UUID inexistente retornou erro -32600 | Não comprova retomada nem expiração de sessão existente |
| Erro de autenticação/expiração | Ausência de conta demonstrada; conta expirada não disponível no ensaio | Sem retry automático de autenticação |
| Retomada automática sem repetição | Sem sessão autenticada/tarefa controlada completa | **Indisponível** |

Não foi consumida cota artificialmente para provocar bloqueio. O teste pendente da Fase 2 foi melhor caracterizado: a CLI inicia e oferece autenticação, mas a VM não tem conta. Alteração Git por agente real, rollback da alteração real, fechamento/reabertura com esse agente, continuação nativa e cota/reset permanecem **BLOQUEADOS**, sem contar simuladores como aprovação. A autenticação deve ocorrer pela própria CLI quando houver uma sessão de usuário apropriada; não se transplantam tokens do host.

## Infraestrutura opcional

`ContinuationCapabilities` exige nível 2, sinal estruturado confiável, continuação nativa e comprovação funcional. O reset conhecido exige capacidade adicional. `ContinuationAdapter` oferece validação de sessão/política e continuação tipada. A produção resolve **nenhum adaptador certificado**, inclusive para Codex. O PTY não é analisado por expressões regulares para mudar estado/cota/políticas. O renderer não pode injetar ID de sessão, reset ou sinal de cota.

O agendador pertence ao daemon e persiste intenção em `resume_jobs`. Verifica tarefas a cada 30 segundos, sem depender de BrowserWindow. Datas são absolutas; depois de restart ou mudança de relógio, o prazo é reavaliado e a sessão/política/worktree são validadas novamente. Até três tentativas por intenção, backoff 60/120 segundos somente quando um adaptador confiável garante que nenhum efeito começou. Exceções e tentativa interrompida em crash são incertas e exigem intervenção. O relógio é uma condição de elegibilidade, nunca prova de reset por si só.

Limite confirmado sem reset fica em espera manual; não há tentativa automática por texto ou polling de cota. Cancelamento explícito vence a validação assíncrona em andamento. Uma continuação que já começou não pode ser retroativamente desfeita: o adaptador certificado futuro deverá implementar também interrupção e propriedade de processo antes de habilitação em produção.

`autoResume: false` no JSON privado do Dot veta retomada automática. A Run mantém sua própria preferência persistente; a interface permite impedir Auto Resume por Run e sempre indica **indisponível** nesta entrega. Preferência true não supera falta de suporte nem veto do Dot. Não há concessão automática de nova permissão.

As fixtures comprovam a lógica do eros para limite/reset conhecidos e desconhecidos, falhas, backoff, persistência e cancelamento. Não comprovam um provedor. Integração de produção com App Server exigirá validação autenticada de sessões, retomada, política, erros e efeitos antes de habilitar a capacidade verified.

**Aceite funcional do Auto Resume: PENDENTE/BLOQUEADO.**

O contrato interno do agendador usa timestamps Unix em **milissegundos**, como Date.now(); o campo oficial Codex resetsAt é documentado em **segundos**. Um adaptador futuro deve converter e validar unidades explicitamente. Nenhuma conversão de texto PTY é implementada nesta entrega.
