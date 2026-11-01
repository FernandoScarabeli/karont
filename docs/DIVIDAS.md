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
- Cartões de permissão/pergunta/plano do **Codex** testados só com fixtures; falta teste real na interface.
- Anexar arquivo e branch do Git no composer: não feitos (sem suporte no serviço).
- Links do markdown ficam inertes (falta canal para abrir no navegador do sistema).
- Linha do tempo: prévia do texto mostra markdown cru (`**`) e caminhos absolutos; encurtar para relativo à pasta.
- `conversationSendParamsSchema` duplicado entre `conversations.ts` e `methods.ts` (unificar).
- Bundle da UI com 806 kB (avisos do Vite); dividir.
- Testes de `server.test.ts` travam no sandbox do Codex e deixam processos `codex-linux-sandbox` órfãos na máquina; encerrar e evitar (timeout no teste).
- Medição de RAM/CPU com resposta chegando e conversa longa: ainda não feita.
