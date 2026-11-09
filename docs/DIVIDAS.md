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
- Medição (preview, resposta de ~14 mil caracteres): serviço ~1–2% de CPU e 52 MB; aba da interface 12–20% de CPU durante o streaming (antes 60–110%), 0% parada. Repetir no Electron empacotado.
- A skill `unslop` não está instalada no Codex; as revisões de UI usaram taste lint + Impeccable.

## Do M4
- **Pendência depois de reiniciar o serviço:** permissão, pergunta ou plano continuam `pending` na mensagem salva e o chat ainda mostra os botões, mas responder é recusado. A caixa de entrada já não mostra esses itens.
- **Caixa de entrada lê uma mensagem por conversa em erro** a cada recálculo. Só roda em mudança de estado, mas erros acumulados pesam; vale trazer num único SQL.
- **`createSnapshot: sinal já abortado e prazo curto…`** (`git/restore-points.test.ts`) falhou uma vez com a máquina carregada e passou nas seguintes.
- **Painel aberto de conversa cujo projeto mudou de workspace** continua no layout antigo; a sidebar já mostra no lugar novo.
- **Letra duplicada ao nomear workspace:** uma vez o E2E digitou "Trabalho" e a aba mostrou "Trabalhoo". Não se repetiu em mais de 25 rodadas; causa desconhecida (olhar o `WorkspaceDialog`).
- **Busca abre a conversa, mas não rola até a mensagem encontrada**: não existe mecanismo para isso.
- **Conversa solta não muda de workspace:** só projetos têm "Mover para".
- **Composer em painel estreito:** o botão de enviar desce para outra linha quando "Acesso total" está visível.

## Do M3
- **Desfazer e outra conversa no mesmo repositório:** o desfazer recusa se já há turno rodando no repositório, mas um turno de outra conversa que comece *durante* o desfazer pode fotografar os arquivos pela metade. Janela curta; um bloqueio por repositório resolve.
- **Cópia separada sem projeto:** remover o projeto mantém as cópias no disco (a tela avisa), mas elas ficam sem lugar na interface para trazer ou remover.
- **Conversa depois de remover a cópia:** a tela avisa antes, e enviar mensagem cai no erro "A pasta do projeto não existe mais". Vale desabilitar o composer com texto próprio.
- **Cópias não são reaproveitadas:** cada oferta aceita cria uma nova, mesmo havendo outra parada.
- **A oferta de cópia depende do `gitInfo` carregado:** quem envia no primeiro instante da tela pode não ver a oferta.
- **Terminais abertos num projeto** continuam na lista de Conversas, porque `TerminalInfo` não tem `projectId`.
- **Objetos do Git:** cada foto escreve objetos soltos no repositório do usuário. As refs são limpas (50 por conversa), mas o espaço só volta no `git gc` dele. Arquivo grande não ignorado pesa.
- **Submódulos** não são desfeitos; a tela avisa.
- **`Dialog` não devolve o foco ao ser desmontado**, porque o ref já é nulo no cleanup. Os diálogos do M3 ficam sempre montados, com `open` controlado; o certo é corrigir no componente.
- **`conversation.create` não emite evento:** outra janela aberta (preview e app juntos) só vê a conversa nova quando ela muda de estado.
- **Medir o PSS de todos os processos do Electron:** o sandbox impede ler `smaps_rollup` dos filhos; a medição do M3 usa working set.
