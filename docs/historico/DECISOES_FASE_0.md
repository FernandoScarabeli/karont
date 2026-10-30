# Decisões técnicas — Fase 0

## Origem e status

Os nomes README.md, docs/ARQUITETURA.md e docs/PLANO_DE_IMPLEMENTACAO.md não existiam no diretório recebido. Os documentos `(1)`, `(2)` e `(3)` tinham respectivamente esse conteúdo e foram copiados para os caminhos pedidos. Os quatro originais foram preservados. O documento maior inclui histórico superado; as confirmações de 23/10/2026 nos documentos menores e o pedido atual prevalecem.

**Confirmado pelo produto:** Electron, React, TypeScript, Vite; daemon independente Node/TypeScript; Linux principal; SQLite WAL/FTS5; destruir/recriar BrowserWindow; CodeMirror sob demanda. Não há autorização para escolher a licença definitiva (MIT e Apache continuam sugestões).

**Propostas implementadas para avaliação, sem converter em decisão definitiva do produto:** um renderer para oito componentes; protocolo JSON delimitado por LF; HMAC-SHA256 mútuo; flock; Node 24 com SQLite nativo; layout mínimo persistido no daemon; polling adaptativo 1 Hz parado / 4 Hz em streaming / 0,5 Hz oculto. Heartbeat do cliente main a cada 2 segundos, timeout de resposta 3 segundos. Não há reinício automático diante de heartbeat ausente.

**Em aberto:** aprovação final do protocolo; orçamento de recursos e metodologia de aceite; distribuição e sandbox nas distribuições alvo; tray no GNOME/KDE; licença; CLI Nível 2 (fora desta fase).

## Processos e responsabilidade

- `apps/desktop`: main com ciclo de janela/tray e cliente do socket; preload com quatro métodos específicos; renderer React sem Node e sem segredo.
- `apps/daemon`: único escritor SQLite, estado do teste, heartbeat e contador sintético. Independente do Electron e sem SDK de IA.
- `packages/contracts`: schemas Zod de solicitações, layout e respostas.
- `packages/local`: enquadramento, autenticação, diretórios privados e cliente reutilizado pelos testes.

O launcher TypeScript usa `process.execve` para substituir a si próprio por `flock --no-fork`, que o substitui pelo servidor Node mantendo o descritor bloqueado. Resta **um processo Node** no daemon, sem supervisor residente. É uma escolha Linux/Node 24; `process.execve` e `node:sqlite` ainda podem emitir aviso experimental nesta linha do Node. O lock é do kernel e liberado inclusive em SIGKILL. Nunca se remove o arquivo de lock: remover um inode bloqueado permitiria locks concorrentes. Só o dono do lock remove socket/metadados órfãos.

`app.requestSingleInstanceLock` protege o shell Electron, separadamente. Fechar a janela destrói a BrowserWindow; main e tray continuam. Abrir pelo tray ou executar `npm start` novamente recria a janela. Sair pelo menu encerra o shell, preservando o daemon. `npm run daemon:stop` solicita encerramento autenticado do daemon.

## Persistência limitada à Fase 0

Migração inicial idempotente com `user_version=1`, tabela de configurações e tabela FTS5 de verificação. WAL e transações curtas; apenas layout (2/4 colunas), abertura do editor e seu texto são persistidos. CodeMirror é carregado por import dinâmico. Não há explorador de arquivos: o editor manipula somente um documento de teste de até 16.000 caracteres. A UI aguarda confirmação de gravação; o botão de fechar aguarda sua fila. Em encerramento abrupto do renderer, apenas mudanças já confirmadas têm garantia de persistência.

Não são persistidos streaming/heartbeat (estado efêmero do daemon), nem tamanho/posição da janela. Os oito painéis mantêm somente cinco linhas derivadas do contador; nenhuma lista cresce indefinidamente. Streaming simulado avança um lote a cada 250 ms, inclusive sem janela aberta; o timer de streaming é suspenso quando pausado. Isso é carga sintética leve e não representa uma CLI real nem prova desempenho com grandes históricos.

Nenhum adaptador, credencial de CLI, provedor pago, terminal PTY, fila de Runs, permissão de agentes ou funcionalidade da Fase 1 foi implementado. Os controles de segurança são reais para esta superfície limitada; não há alegação de sandbox de futuros agentes.

## Segurança e limites

Ver [PROTOCOLO_LOCAL.md](../PROTOCOLO_LOCAL.md). O Electron exige `contextIsolation=true`, `sandbox=true`, `nodeIntegration=false`, `webSecurity=true`; recusa a flag `--no-sandbox`. IPC exige remetente da BrowserWindow atual, frame principal e URL exata do HTML local; apenas comandos específicos e argumentos validados são permitidos. Não há canal genérico de filesystem/shell. Novas janelas, navegação, webviews e solicitações de permissões são recusadas. CSP bloqueia rede e scripts externos; `unsafe-inline` é permitido só em estilos por causa do CodeMirror.

Foi consultada a [documentação oficial de segurança do Electron](https://www.electronjs.org/docs/latest/tutorial/security), a [API BrowserWindow](https://www.electronjs.org/docs/latest/api/browser-window) e a [API SQLite do Node](https://nodejs.org/api/sqlite.html). `sandbox:true` nas preferências não prova, por si só, que uma execução de teste não recebeu `--no-sandbox`; a suíte verifica também os argumentos efetivos.

## Limitação encontrada no computador de implementação

Ubuntu 26.04.1 / Wayland: o helper `chrome-sandbox` baixado pelo npm não é SUID root e o host recusa o mapeamento de user namespace. Iniciar a aplicação com sandbox aborta com SIGTRAP antes do código main. Não foram alteradas configurações globais, permissões SUID ou regras AppArmor. É necessário preparar um ambiente Electron com sandbox autorizado pela distribuição para concluir o E2E desktop.

Uma execução preliminar do Playwright exibiu a UI e permitiu inspeção visual, mas o Playwright adicionou `--no-sandbox` por padrão. Essa evidência foi identificada e **não vale como aceite de segurança, ciclo desktop ou benchmark definitivo**. O harness agora usa `chromiumSandbox:true`, verifica os argumentos e faz preflight com o executável de produção. As imagens existentes são dessa inspeção preliminar e não provam sandbox ativo.

## Revisão técnica posterior na mesma Fase 0

Sem mudança de stack ou escopo. Foram corrigidos cancelamento de conexão durante handshake e amostragem de processo inexistente/encerrado. O harness passou a verificar o sandbox real no renderer (runtime e seccomp/NoNewPrivs), fechar pelo caminho nativo equivalente ao X e registrar etapa/artefatos específicos por rodada. O preload expõe apenas dois indicadores booleanos de runtime adicionais aos quatro métodos existentes, sem segredo ou API nativa genérica. O main recusa também flags que desliguem camadas do sandbox, não apenas `--no-sandbox`.

O diagnóstico do kernel confirma transição AppArmor para `unprivileged_userns` e recusa de `sys_admin`. O sandbox continua bloqueado neste host; nenhuma mudança global ou instalação SUID foi feita. Preparação de política específica ou helper aprovado depende de administração autorizada. Não se trata de aprovação automática de uma exceção AppArmor. Ver [investigação P0](../SANDBOX_LINUX.md) e [registro da revisão](REVISAO_FASE_0.md).

## SPEC-001 — validação sem mudança de stack

A validação foi deslocada para VM descartável Debian/KVM com kernel próprio, preservando AppArmor e políticas do host. Não foi adotada exceção administrativa, helper SUID, container privilegiado ou flag de bypass. O protocolo não mudou. A série de cinco rodadas e nove testes passaram; [aceite técnico recomendado](ACEITE_FASE_0.md) no ambiente testado. Orçamento de RAM/CPU e aprovação explícita do protocolo continuam abertos: RAM medida excede a meta preliminar. [Ambiente reproduzível](../AMBIENTE_VM_FASE_0.md).
