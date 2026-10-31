# Progresso

Repositório recriado do zero em 2026-10-31.

## Estado
- **M0 (esqueleto)** — concluído e na `main` (PR #1, 2026-10-31).
- **M1 (agentes)** — em andamento na branch `m1-agentes`.
  - [x] B1 Detecção de agentes + CLIs do usuário (serviço e contrato)
  - [x] B2 Terminal no serviço (`node-pty`, eventos com backpressure, sobrevive à janela)
  - [x] F1 Configurações › Agentes (lista, detectar de novo, adicionar/remover CLI)
  - [x] F2 Nova conversa com seletor (agentes "em breve" + Terminal) e Terminal na interface (xterm)
  - [x] B3 Fechar a janela: perguntar / segundo plano (bandeja) / fechar tudo
  - [x] F3 Configurações › Geral ("Ao fechar a janela")
  - [x] B4 Escolher pasta (diálogo nativo), pastas recentes, terminal com comando inicial
  - [x] F4 Campo de mensagem único (composer) + botão de pasta + cabeçalho do terminal
  - [ ] F5 Conversas lado a lado (dividir, redimensionar, arrastar para os cantos, layout salvo)
  - [x] Fonte de títulos: **Sora** no lugar da Instrument Serif (entra no F4)
  - [ ] E2E + PR (orquestrador)

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
8. Cor de marca: o padrão é o **marfim** (`#F3EEE3`, "branco papel"), e a pessoa escolhe outra cor de destaque numa lista pronta (aprovado em 2026-10-31). Lista: marfim `#F3EEE3`, magenta `#FF4F8B`, turquesa `#2DD4C4`, lima `#C6F135`, azul elétrico `#5B8CFF`, coral `#FF7A59` (todas com contraste AA com texto `#0F0F10` e sobre o fundo). A escolha fica salva em `settings` e a tela entra no M5. No M0 basta o token `--k-color-brand` ser único e trocável. Estados nunca dependem só da cor (sempre texto ou ícone junto).
9. Segunda fonte: **Sora** na marca e nos títulos grandes; o resto em Geist (escolhida em 2026-10-31, no lugar da Instrument Serif, que o dono não gostou). Dependência `@fontsource-variable/sora` aprovada; `@fontsource/instrument-serif` removida.

10. Fluxo de trabalho: o orquestrador só coordena; todo código é feito pelo Codex `gpt-6-luna` em `xhigh` (2026-10-31).
11. `main` protegida: só por PR com o CI "Checagens e testes" verde; sem force push nem exclusão; vale para admins (2026-10-31).

12. Fluxos do M1 aprovados (2026-10-31):
    - Engrenagem → **Configurações**, começando pela seção **Agentes** (lista ✓/✗, detectar de novo, adicionar/remover CLI). Outras seções virão.
    - Não há botão "Novo terminal": **"Nova conversa" abre com um seletor** de agentes (Claude Code, Codex, Gemini…) **ou Terminal**. No M1 só o Terminal funciona; os agentes aparecem como "em breve" até o M2.
    - **Fechar a janela pergunta**: "Fechar tudo" (encerra agentes, terminais e o serviço) ou "Deixar rodando em segundo plano" (esconde a janela, fica um ícone na bandeja). Caixa "Lembrar minha escolha"; dá para mudar nas Configurações.
    - Terminais vivem no serviço: com o app em segundo plano ou a janela reaberta, o terminal continua e mostra as últimas linhas.
    - `@xterm/addon-fit` aprovado (ajusta o terminal ao tamanho da área).

13. Tarefas de front: o Codex usa a skill **taste** para construir; a revisão com a skill **unslop** é feita pelo orquestrador (o Codex não tem essa skill) e volta como correção para o Codex aplicar (2026-10-31). Regra em `AGENTS.md`.

14. Pedidos do dono antes do PR do M1 (2026-10-31):
    - **Instrument Serif sai** (o dono não gostou); nova fonte de títulos a escolher numa página de comparação.
    - **Campo de mensagem único** para tudo (agentes e Terminal), no estilo das referências: texto em cima; embaixo à esquerda seletor + pasta; à direita enviar redondo marfim. No Terminal o texto é um comando opcional que roda ao abrir. Sem botões que ainda não funcionam (microfone, anexar ficam para quando funcionarem; anexar no M2).
    - **Botão de pasta** abre o seletor de pastas nativo do sistema; o app lembra as pastas recentes. Arquivos entram pelo "anexar" no M2.
    - **Cabeçalho do terminal** redesenhado.
    - **Conversas lado a lado**: botão "Dividir"; divisórias arrastáveis; arrastar uma conversa para um canto reorganiza a tela; layout salvo. Feito já no M1 com terminais. Dependência `react-resizable-panels` aprovada.

15. Codex sempre no **modo rápido** (`-c service_tier="fast"`), pedido do dono (2026-10-31).

## Notas técnicas
- Pacotes: `packages/contract`, `packages/service`, `packages/desktop`, `packages/ui`. Versões fixas (sem `^`).
- Node 24 roda `.ts` direto (type stripping): testes e serviço em dev rodam sem build. Por isso o TS usa `erasableSyntaxOnly` (sem `enum`/`namespace`) e imports com extensão `.ts`.
- TypeScript 7.0.2 (compilador nativo).
- Electron 45.2.1 traz Node 24.22.1 com `node:sqlite`: o serviço pode rodar como `ELECTRON_RUN_AS_NODE=1` no app empacotado.
- Tokens de cor vêm da "Direção A · Lua" do `karont.pen`. Só `--k-color-danger` (`#EF7B73`) não estava no design: proposta do orquestrador, ajustável.
- Biome usa `"preset": "recommended"` (o `biome migrate` tinha trocado para `none`, o que desliga as regras).
- Preview web: `npm run preview:web` na raiz → http://127.0.0.1:5173/. Reaproveita um serviço já rodando; se não houver, inicia um em modo dev (`KARONT_DEV=1`) e o encerra ao sair.
- Rodar o app: `npm run start:desktop` (com `CHROME_DEVEL_SANDBOX=/usr/local/lib/karont-dev/chrome-sandbox`). E2E: `npm run test:e2e` (mesma variável). Rodada completa local: ~6 s de checagens + ~2 s de E2E.
- O E2E usa `chromiumSandbox: true`: o Playwright passa `--no-sandbox` ao Electron por padrão.
- O serviço destacado é iniciado por um `bash` mínimo que fecha os descritores herdados acima de 2. O Chromium deixa caches da GPU e sockets internos sem CLOEXEC, e o serviço os seguraria por horas (isso também travava o `app.close()` do Playwright).
- `node-pty` 1.1.0 usa N-API: o mesmo binário roda no Node 24 e no Electron (`ELECTRON_RUN_AS_NODE`). O npm 12 bloqueia scripts de instalação; `node-pty` está liberado em `allowScripts` no `package.json` da raiz (precisa de python3, make e g++).
- Terminal e CSP: o xterm 6 injeta `<style>` (Viewport, DomRenderer) e um `setAttribute("style")`. Com `style-src 'self'` isso é bloqueado. `packages/ui/src/terminal/cspStyles.ts` desvia esses estilos para `adoptedStyleSheets` (não passam pelo `style-src`) sem afrouxar a CSP. Validado no Electron: zero violações. Ao atualizar o xterm, refazer essa checagem.
