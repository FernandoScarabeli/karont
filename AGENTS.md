# Orientações para agentes

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
