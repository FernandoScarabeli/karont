# Orientações para agentes

## Refatoração em andamento

O trabalho atual segue [docs/SPEC_REFATORACAO.md](docs/SPEC_REFATORACAO.md). Leia a spec antes de qualquer tarefa. O estado e as decisões do usuário ficam em [docs/PROGRESSO.md](docs/PROGRESSO.md); problemas encontrados fora do escopo vão para [docs/DIVIDAS.md](docs/DIVIDAS.md).

Papéis: o Claude Code orquestra (planeja, revisa, roda os testes e faz merge); o Codex executa **uma tarefa por vez**, em branch/worktree própria, e implementa somente o que a tarefa pede.

Regras invariantes (resumo da seção 5 da spec; não quebrar sem aprovação do usuário):

1. Electron com `contextIsolation: true`, `nodeIntegration: false` e `sandbox: true`. Nunca usar `--no-sandbox`. Toda mensagem IPC é validada; a UI não acessa recursos do sistema diretamente.
2. O daemon continua um processo Node/TypeScript separado. Não alterar protocolo/handshake (`packages/local/src/wire.ts`), schema do SQLite ou contratos zod (`packages/contracts`). Se for inevitável, pare e explique.
3. O app nunca captura, armazena ou reutiliza credenciais/tokens das CLIs.
4. A UI só mostra capacidades reais; dados demonstrativos e explorações ficam marcados. Sem métricas inventadas.
5. Vocabulário fixo: Workspace, Projeto, Dot, Chat, Run, Tarefa.
6. As regras de design abaixo valem integralmente.
7. Worktree não é sandbox; não prometa isolamento que não existe.
8. Auto Resume permanece desligado.
9. Foco em Linux; evite novas dependências específicas de Linux quando houver alternativa igualmente simples.
10. Nenhuma dependência nova sem justificativa e aprovação do usuário.

Para o executor: não refatore "de passagem", não renomeie fora do escopo, não mexa em arquivos fora da lista permitida da tarefa. Texto de UI, docs e commits em português do Brasil; identificadores em inglês. Ao terminar, responda no formato de relatório da seção 5.1 da spec, dizendo o que rodou de verdade.

## Design do produto

- O trabalho visual é desenvolvido no pen.dev, com o agente nesse ambiente. Use o arquivo `karont.pen` e seu painel de referências e briefing como contexto da direção visual.
- Crie e mantenha um **design system** junto com as telas. Esta é uma entrega obrigatória do redesign e a base das próximas funcionalidades.
- Antes de criar ou alterar interfaces, consulte [docs/design/DESIGN_SYSTEM.md](docs/design/DESIGN_SYSTEM.md), os componentes existentes e os tokens implementados. Reutilize e estenda essa base.
- Documente os valores escolhidos e suas regras de uso: cores semânticas, tipografia, espaçamentos, dimensões, bordas, raios, ícones, identidade dos Dots, estados, layout e movimento.
- No pen.dev, use variáveis para tokens e componentes reutilizáveis com variantes. Na implementação, centralize os tokens e reutilize componentes; evite valores visuais avulsos e duplicação de estilos.
- Toda funcionalidade que introduzir ou modificar padrões visuais deve atualizar o design system na mesma entrega, mantendo documentação, canvas e código coerentes. Registre a justificativa de novos padrões.
- Distinga propostas de decisões validadas e padrões já implementados. Não trate o CSS provisório ou as cores dos painéis de briefing como a identidade definitiva do produto.
- Verifique contraste, foco por teclado, estados além da cor, legibilidade, overflow e comportamento dos painéis em janelas menores. Registre limitações relevantes.
- Preserve os conceitos Workspace, Projeto, Dot, Chat, Run e Tarefa. Controles e indicadores devem refletir capacidades reais; marque explorações futuras e dados demonstrativos claramente.
- Para projetos, consulte também `docs/design/PROJECT_FLOWS.md`, que define os fluxos vigentes e substitui as primeiras pranchas exploratórias. Desenhe as etapas e seus resultados no canvas: entrada, edição, validação, envio, sucesso, erro, cancelamento e recuperação. Uma lista de estados ou uma prancha de hover não substitui as telas dos fluxos.

- Decisão vigente: projeto é criado em modal com somente nome, ícone e pasta raiz; nova conversa abre diretamente um chat vazio. Não adicionar lista, papéis ou autorizações de agentes nesses fluxos, nem modal de criação de chat, para espelhar limitações do contrato atual.
