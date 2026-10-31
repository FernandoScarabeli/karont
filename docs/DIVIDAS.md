# Dívidas

1. **Coalescedor percorre o texto caractere a caractere** (`packages/service/src/coalescer.ts`): 10 MB levam ~1,5 s de CPU. Para o chat real (M2) dá conta, mas vale cortar por bytes com `Buffer`/`TextEncoder` e só ajustar a borda do caractere. (M0-B2)
2. **`parseResult` usa o código `invalid_request`** quando o *resultado* do serviço é inválido; o certo seria `internal`. (M0-B1)
