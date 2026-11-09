# M6 B1/F1 — identidade e Configurações do Dot

Implementação autorizada pelo dono em 2026-11-09 após o plano desta conversa.

## Entrega

- Migração 22 cria `dots` com identidade estável, nome, cor, ativação, três eixos de personalidade e datas. Um Dot padrão; a tabela admite outros no futuro. Padrão: Dot, grafite, ativado e eixos em 50.
- Contratos Zod `dot.get`, `dot.update` (campos parciais, personalidade completa) e evento `dot.updated`; normalização de nome/cor e atualização transacional. Sem CLI ou dependência nova.
- Configurações › Dot com preview, nome, seletor completo de cor, personalidade e ativação. Salvar confirma tudo, Cancelar restaura, erros mantêm a edição. Mudanças pendentes bloqueiam a navegação com diálogo; gravação em andamento impede descartar. Eventos atualizam a tela sem polling, preservando campos editados localmente.
- A tela informa que personalização das respostas ainda não está disponível. Conexão ao chat e aplicação de personalidade/ativação são B2/F2. Memórias e saudações ficam para as tarefas seguintes; sem salinha.
- Proteção de navegação adicionada ao contexto existente; estilos com escopo, tokens, nomes acessíveis e sliders nativos por teclado. Preview usa movimento reduzido conforme preferência.
- Biome ignora também `dist-preview`, artefato que o build do protótipo produz. `.worktrees/` ignorada para não incluir a cópia de desenvolvimento no repositório.

## Arquivos

Contrato: novo `dot.ts` e testes, métodos, eventos e exportações. Serviço: migração e testes de banco, `dot.ts`, teste de persistência/migração/eventos e handlers. Interface: seção Dot e CSS Module, estado de edição com testes, navegação, Configurações e catálogo pt-BR. Documentação: progresso e este relatório. Também consolida as alterações anteriores do F0d, descritas no relatório próprio.

## Verificação executada

- `npm run typecheck`: passou.
- `npm run lint`: passou, com informação preexistente em `search.test.ts`. O build `dist-preview` precisou ser excluído da análise; antes disso, o lint tentava analisar código minificado gerado.
- `npm run test -w @karont/ui`: 50 arquivos passaram.
- Testes focados com `node --test --test-isolation=none`: migração, banco e contrato, 24 passaram; após adicionar teste de evento, serviço Dot + estado de edição, cinco passaram.
- `npm run build`: passou, UI, main, preload e serviço. Avisos conhecidos de PostCSS e bundle.
- `KARONT_DISABLE_AGENT_DETECTION=1 npm run check`: tipos, lint, contrato e UI passaram. Permanecem seis arquivos com falha no serviço e um no desktop, os mesmos da retomada anterior. As reproduções identificaram EPERM para subprocessos Git e socket Unix. Não houve tentativa de contornar o sandbox.
- `git diff --check`: passou.

## Pendências de validação

Não executados: preview visual, medição de CPU/FPS e E2E/Electron, conforme limite do sandbox e AGENTS.md. Não afirmar aprovação visual nem desempenho medido. Fora deste ambiente, abrir `npm run preview:web:prod`, acessar Configurações › Dot e conferir Salvar, Cancelar, navegação com edição pendente, falha de gravação, teclado, movimento reduzido e duas janelas. Repetir os testes completos antes do PR para `main`.
