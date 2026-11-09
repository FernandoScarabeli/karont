# M6-F0d — retomada da borda, fluidez e expressões

2026-11-09. Trabalho retomado a pedido do dono depois da interrupção do Claude.

## Resumo

As alterações sem commit de `~/karont-worktrees/m6-f0-prototipo` foram copiadas para a worktree `.worktrees/m6-f0d-retomada`, branch `m6-f0d-retomada`, baseada em `93b56e3`. A worktree original foi preservada.

- Borda calculada pelo matiz e luminância do corpo: clareia tons escuros e escurece tons claros, com contraste mínimo de 1,5:1 contra o corpo. Olhos mantêm pelo menos 4,5:1.
- Laço de desenho por `requestAnimationFrame`, sem o limite anterior de 30/20 fps. Encerra quando as molas assentam e pausa fora da tela ou com a aba oculta. Flutuação e sinais usam CSS. Isso descreve a implementação; desempenho real ainda não foi medido.
- Feliz, triste, dançando, surpreso, bravo, confuso e apaixonado. Onze humores ao todo; Feliz substitui Terminou no protótipo.
- Protótipo `#dot` disponível também no modo `preview`, para avaliação com build de produção.
- Na revisão da retomada: acompanhamento ao vivo da preferência de movimento reduzido; remoção da camada permanente dos ícones estáticos; redesenho ao trocar tamanho; nenhum ResizeObserver nos desenhos congelados; cálculo da órbita somente enquanto trabalha; cursor de fala sem piscar quando há redução de movimento.
- Testes novos para posicionamento dos olhos, pálpebras e contorno. Sem dependências novas.

## Arquivos alterados

- `packages/ui/src/App.tsx`
- `packages/ui/src/components/ColorPicker/color.ts` e `color.test.mjs`
- `packages/ui/src/dev/DotPrototype.tsx`
- `packages/ui/src/dot/EyeTracker.tsx`, `EyeTracker.module.css`, `veil.ts`, `face.ts` e `face.test.mjs`
- `packages/ui/src/i18n/pt-BR.ts`
- Este relatório.

## Comandos executados e resultados

Com Node 24.22.2 no PATH, na worktree de retomada:

- `npm run typecheck`: passou.
- `npm run lint`: passou; permanece um aviso informativo anterior em `packages/service/src/search.test.ts:176`.
- `npm run test -w @karont/ui`: passou nos 49 arquivos de teste.
- `node --test --test-isolation=none packages/ui/src/dot/*.test.mjs packages/ui/src/components/ColorPicker/*.test.mjs`: 25 testes passaram.
- `KARONT_DISABLE_AGENT_DETECTION=1 npm run check`: typecheck e lint passaram; rodada de testes teve seis arquivos com falha no serviço e um no desktop. A primeira execução também encontrou uma expectativa incorreta no teste novo do rosto (a perspectiva reduz ligeiramente a altura do olho); corrigida, e todos os testes da interface passaram na repetição.
- Reproduções com `--test-isolation=none`: testes Git receberam `spawnSync git EPERM`; a integração da ponte recebeu `listen EPERM` no socket Unix. Logs em `/tmp/karont-m6-service.log` e `/tmp/karont-m6-bridge.log` (temporários).
- `npm run build`: passou, UI e três alvos do desktop. Avisos anteriores de PostCSS e chunk acima de 500 kB. A primeira tentativa falhou ao escrever o cache Vite no node_modules compartilhado, somente leitura. Resolvido com diretório local de links às dependências já instaladas, sem instalação nem alteração no original.
- `git diff --check`: passou.
- Lint da skill taste executado: apontou padrões existentes fora do escopo e falsos positivos em controles de cor e texto oculto acessível. Não foi aplicado redesenho geral. O seletor de cor usa gradientes para representar a cor escolhida; não são enfeites.

Os testes de ColorPicker e do pano já estavam no script de testes da branch do protótipo; a impressão inicial de ausência veio da leitura do package.json da branch principal de trabalho.

## Validação pendente

Não foram executados Electron, E2E, inspeção visual no navegador ou medição de FPS/CPU. As instruções do AGENTS.md proíbem contornar o sandbox para executar Electron/E2E/sockets, e os testes confirmaram EPERM. Nenhuma afirmação de FPS ou economia de CPU foi validada visualmente.

Para validar em terminal fora deste sandbox, na raiz desta worktree:

```bash
npm run preview:web:prod
```

Abrir `http://127.0.0.1:5173/#dot`; conferir as sete amostras e cor livre, os onze humores, tamanhos pequenos, teclado, troca de preferência de movimento reduzido e aba oculta. Medir em produção antes de declarar a fluidez aprovada. O preview não foi iniciado por esta retomada.
