# Dívidas

1. **Coalescedor percorre o texto caractere a caractere** (`packages/service/src/coalescer.ts`): 10 MB levam ~1,5 s de CPU. Para o chat real (M2) dá conta, mas vale cortar por bytes com `Buffer`/`TextEncoder` e só ajustar a borda do caractere. (M0-B2)
2. **`parseResult` usa o código `invalid_request`** quando o *resultado* do serviço é inválido; o certo seria `internal`. (M0-B1)
3. **Fechar descritores herdados depende de `/bin/bash` e `/proc`** (`packages/desktop/src/main/service.ts`). Sem bash, o serviço é iniciado direto e herda os descritores do Electron. No macOS (depois do v1) será preciso outra solução (`/dev/fd` ou um pequeno launcher nativo). (M0-B4)
4. **Aviso do Chromium no Wayland** (`--ozone-platform=wayland is not compatible with Vulkan`) aparece no stderr do app. É inofensivo, mas vale silenciar desligando o Vulkan ou ajustando a plataforma. (M0-B4)
5. **Textos do diálogo de fechar e da bandeja estão fixos no main** (`packages/desktop/src/main.ts`, `tray.ts`), fora do `i18n/pt-BR.ts` da interface. Quando houver tradução, mover para um catálogo compartilhado. (M1-B3)
6. **Bundle da interface com ~700 kB** (aviso do Vite acima de 500 kB), principalmente xterm. Carregar o terminal sob demanda (`import()` dinâmico) quando fizer sentido. (M1-F2)
7. **`cspStyles.ts` intercepta `appendChild`/`insertBefore`/`append` do app inteiro enquanto há terminal montado** (revisão de código do M1). Funciona, mas toda inserção de DOM do React paga uma busca de ancestrais × terminais ativos, e depende de detalhes internos do xterm 6. Alternativas: renderizador canvas/WebGL do xterm (não injeta `<style>`) ou nonce de CSP. Atualizar o xterm exige repetir a checagem de CSP no Electron. (M1-F2)
8. **Teclas digitadas no instante em que o terminal abre se perdem** (antes do `attach`/foco do xterm). Raro para uma pessoa, mas apareceu no E2E. Guardar a entrada até o terminal ficar pronto. (M1-F5)
9. **Placeholder com frases engraçadas que trocam sozinhas** no campo de mensagem ("faz meu café", "domine o mundo"…). Pedido do dono para depois do M1.

## Do M2
- Testes de `server.test.ts` usam socket Unix e não rodam no sandbox do Codex (pulados com `KARONT_SKIP_SOCKET_TESTS=1`); rodam fora dele no `npm run check`.
- Limite de quadro subiu para 64 MiB para caber até 8 anexos; anexos grandes passam inteiros pela memória do serviço. Se pesar, trocar por envio em pedaços.
- Botão Planejar volta para "Desligado" ao reabrir a conversa (não é guardado).
- Medição de RAM/CPU com resposta chegando e conversa longa: ainda não feita.
- A skill `unslop` não está instalada no Codex; as revisões de UI usaram taste lint + Impeccable.
