# SPEC-005 Ajuste 01 — restaurar conversa livre global

Data: 25/10/2026. Status: **implementada e validada**.
Escopo: correção pontual da Fase 4A. Não abre a Fase 4B.

## Objetivo

Manter selecionada, após recarregar ou reabrir a janela, a conversa livre global
que estava aberta. A navegação deve continuar apontando para essa conversa com
`workspaceId: null` e `projectId: null`.

## Problema reproduzido

1. Criar ou abrir uma conversa livre global pela lista **Conversas livres**.
2. Confirmar que `window.eros.navigation()` retorna o ID da conversa e os dois
   escopos como `null`.
3. Recarregar a interface ou fechar e abrir a janela.
4. A conversa e seu histórico continuam no banco, mas a seleção é substituída
   pelo workspace padrão e `chatId: null`.

Na inicialização de `apps/desktop/src/WorkspaceDesk.tsx`, a navegação salva é
considerada válida somente se `workspaceId` existir na lista de workspaces.
Uma conversa global tem `workspaceId: null`, então essa validação a rejeita e
grava o fallback, mesmo quando o daemon já validou a conversa salva. O resultado
é perda da seleção, não perda dos dados da conversa.

## Requisitos funcionais

- Tratar uma navegação global válida como válida mesmo sem workspace. Para este
  ajuste, o caso válido é uma conversa existente com
  `workspaceId === null`, `projectId === null` e `chatId` correspondente.
- Na restauração, preservar o mesmo `chatId` e carregar seus detalhes, mensagens
  e rascunho sem alterar o escopo global.
- Não gravar o workspace padrão como fallback apenas porque o workspace salvo é
  `null` quando há uma conversa global selecionada.
- Continuar normalizando para o workspace padrão quando a navegação salva aponta
  para workspace, projeto ou conversa inexistente/incompatível.
- Manter o comportamento existente para conversas de projeto e conversas livres
  dentro de workspace.
- Abrir conversa pelas listas **Conversas livres**, **Favoritos** ou **Recentes**
  deve produzir a mesma restauração global quando a conversa não pertence a
  workspace.
- Não alterar conteúdo, IDs, favoritos, rascunhos, mensagens, Runs ou permissões.

## Requisitos técnicos

- Corrigir a validação/normalização no bootstrap de `WorkspaceDesk`; não mascarar
  o problema limpando `chatId` ou mudando o escopo persistido no daemon.
- Validar o contexto da conversa selecionada, não inferir validade apenas de
  `workspaceId`. Reutilizar as APIs e schemas existentes.
- Evitar corrida entre o bootstrap da navegação e o carregamento de detalhes da
  conversa. Uma navegação inválida deve usar o fallback atual; uma global válida
  deve chegar ao estado React antes de o efeito de seleção carregar o chat.
- Preservar operações por IPC nomeado e manter a validação de contexto no daemon.
- Adicionar uma regressão automatizada usando a fixture/E2E existente, sem
  provedor pago nem rede.

## Critérios de aceite

1. Abrir uma conversa livre global, recarregar a UI e confirmar que a mesma
   conversa continua selecionada, com `workspaceId` e `projectId` nulos.
2. Fechar e reabrir a janela do Electron e confirmar o mesmo resultado, com
   conteúdo e rascunho intactos e sem criar Run.
3. Fazer o fluxo por pelo menos uma lista global (favoritos ou recentes) e
   confirmar que a restauração permanece global.
4. Confirmar que uma navegação para workspace/projeto/conversa removidos continua
   caindo no fallback válido e que uma conversa de projeto ainda restaura seu
   contexto correto.
5. Confirmar que abrir conversa global não atualiza a navegação para o workspace
   padrão durante o bootstrap.
6. Rodar `npm run check`, `npm test`, `npm run test:desktop` e `npm run test:e2e`;
   registrar os resultados e a evidência da regressão no relatório
   `docs/SPEC_005_IMPLEMENTACAO.md`.

## Fora de escopo

Não redesenhar telas nem alterar a identidade visual. O visual atual continua
provisório e o dia dedicado a mudanças visuais permanece reservado. Não iniciar
Kanban/Fase 4B, Auto Resume, provider de IA, migração de dados ou alterações no
fluxo de autorização.

## Instrução para o subagente

Leia esta spec e a implementação atual antes de editar. Corrija somente a
restauração da conversa livre global e acrescente a regressão automatizada
descrita acima. Preserve todas as alterações locais já existentes; não faça
reset, checkout destrutivo ou limpeza de arquivos fora do escopo. Use
`source scripts/local-env.sh` antes dos comandos do projeto. Atualize o
relatório SPEC-005 com a correção e evidências. No resumo final, informe os
arquivos alterados, causa corrigida e resultados reais dos quatro comandos de
validação. Não faça redesign visual nem avance para Kanban.
