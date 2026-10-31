# Dívidas

1. **Coalescedor percorre o texto caractere a caractere** (`packages/service/src/coalescer.ts`): 10 MB levam ~1,5 s de CPU. Para o chat real (M2) dá conta, mas vale cortar por bytes com `Buffer`/`TextEncoder` e só ajustar a borda do caractere. (M0-B2)
2. **`parseResult` usa o código `invalid_request`** quando o *resultado* do serviço é inválido; o certo seria `internal`. (M0-B1)
3. **Fechar descritores herdados depende de `/bin/bash` e `/proc`** (`packages/desktop/src/main/service.ts`). Sem bash, o serviço é iniciado direto e herda os descritores do Electron. No macOS (depois do v1) será preciso outra solução (`/dev/fd` ou um pequeno launcher nativo). (M0-B4)
4. **Aviso do Chromium no Wayland** (`--ozone-platform=wayland is not compatible with Vulkan`) aparece no stderr do app. É inofensivo, mas vale silenciar desligando o Vulkan ou ajustando a plataforma. (M0-B4)
