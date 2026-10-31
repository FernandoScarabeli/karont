# Progresso

Repositório recriado do zero em 2026-10-31.

## Estado
- **M0 (esqueleto)** — em andamento na branch `m0-esqueleto`.
  - [x] T0 Base do repositório (workspaces, TypeScript, Biome, pastas) — orquestrador
  - [x] B1 Contrato (schemas zod) — executor back
  - [x] F1 Tokens, fonte e componentes base — executor front
  - [x] B2 Serviço: socket com streaming + SQLite com migrações — executor back
  - [x] F2 Moldura vazia — executor front
  - [ ] B3 Ponte do preview web (HTTP + SSE) — executor back
  - [ ] B4 Electron seguro + ponte de canal único — executor back
  - [ ] E2E de fumaça + CI — orquestrador

## Decisões do dono

1. Recomeçar do zero, sem histórico (2026-10-31).
2. Licença MIT, repositório público.
3. Chat de verdade (resposta da IA no chat, não no terminal); agente trabalha direto na pasta, com desfazer pelo Git; "Agente" no lugar de "Dot"; banco novo; ponte feita para streaming; markdown seguro (dependência a aprovar no M2).
4. Referências visuais ficam fora do repositório (`karont.pen` do dono, no pen.dev).
5. Plano do M0 aprovado (2026-10-31), com estas escolhas:
   - CSS Modules para escopo (já vem no Vite).
   - Fonte Geist via `@fontsource/geist-sans` e `@fontsource/geist-mono` (arquivos locais, sem rede).
   - Build: Vite para interface, preload e main; `tsc` só para checagem de tipos; sem `electron-vite`; empacotador só no M7.
   - Banco no M0: só mecanismo de migrações + tabela `settings`; demais tabelas nos marcos que usarem.

6. `lucide-react` aprovado para ícones (2026-10-31). Motivo: o design do `karont.pen` já usa os ícones Lucide; são SVGs locais.
7. Fonte não fica presa só à Geist: pode haver uma segunda fonte (ex.: títulos/marca), escolhida pelo dono (2026-10-31).
8. Cor de marca: o padrão é o **marfim** (`#F3EEE3`, "branco papel"), e a pessoa poderá escolher outra cor de destaque (2026-10-31). Proposta do orquestrador, aguardando ok: lista curta de cores prontas (marfim, magenta, turquesa, lima…), com contraste garantido; salva em `settings`; tela no M5. No M0 basta o token `--k-color-brand` ser único e trocável.
9. Segunda fonte: **Instrument Serif** na marca e nos títulos grandes; o resto em Geist (2026-10-31). Dependência `@fontsource/instrument-serif` aprovada.

## Notas técnicas
- Pacotes: `packages/contract`, `packages/service`, `packages/desktop`, `packages/ui`. Versões fixas (sem `^`).
- Node 24 roda `.ts` direto (type stripping): testes e serviço em dev rodam sem build. Por isso o TS usa `erasableSyntaxOnly` (sem `enum`/`namespace`) e imports com extensão `.ts`.
- TypeScript 7.0.2 (compilador nativo).
- Electron 45.2.1 traz Node 24.22.1 com `node:sqlite`: o serviço pode rodar como `ELECTRON_RUN_AS_NODE=1` no app empacotado.
- Tokens de cor vêm da "Direção A · Lua" do `karont.pen`. Só `--k-color-danger` (`#EF7B73`) não estava no design: proposta do orquestrador, ajustável.
- Biome usa `"preset": "recommended"` (o `biome migrate` tinha trocado para `none`, o que desliga as regras).
