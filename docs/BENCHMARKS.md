# Benchmarks reproduzíveis — Fase 0

## Preparação

Use Linux, Node 24+, dependências do Electron e **sandbox Chromium funcional**. Instale as dependências com `npm ci`, compile com `npm run build`. Registre modelo de CPU, RAM, GPU/driver, distribuição, kernel, compositor, sessão GNOME/KDE e Wayland/X11, modo de energia, frequência/quantidade de monitores e carga concorrente. Os scripts registram CPU/RAM, versões, kernel, distribuição e tipo de display; GPU/driver/compositor e condições externas precisam ser acrescentados manualmente ao relatório de uma comparação controlada.

O host de implementação é Ubuntu 26.04.1, Wayland, i3-10100F e 30 GiB de RAM utilizável. Ele não autoriza o sandbox do binário Electron baixado no projeto. Não desative sandbox, AppArmor ou outras proteções para obter números. Em um ambiente bloqueado, o relatório desktop deve falhar e manter o impedimento visível. A preparação específica do sandbox deve seguir a distribuição e a [documentação Chromium sobre restrições de namespaces](https://chromium.googlesource.com/chromium/src/+/main/docs/security/apparmor-userns-restrictions.md).

## Executar

```bash
npm run check
npm test
npm run sandbox:diagnose  # diagnóstico somente; não aprova sandbox
npm run benchmark
npm run test:desktop
npm run benchmark:report
```

Os dois últimos comandos de medição geram `benchmarks/daemon-latest.json` e `benchmarks/desktop-latest.json`; o gerador produz [RESULTADOS.md](../benchmarks/RESULTADOS.md). O resultado desktop registra `passed:false` e o erro de preflight quando o sandbox não está disponível, retornando código de saída não zero. Não considere esse cenário aprovado. As screenshots são gravadas durante a suíte desktop e podem pertencer a execução anterior: confira o JSON e sua data antes de usá-las como evidência.

Os scripts criam diretórios efêmeros `karont-bench-*` em `/tmp`, usando overrides XDG exclusivos. Iniciam processos próprios e encerram apenas os PIDs iniciados por eles, sem tocar em uma instância normal do usuário. Em interrupção abrupta do script, o daemon é intencionalmente independente e pode sobreviver: use os caminhos isolados daquele ensaio em `KARONT_RUNTIME_DIR`/`KARONT_DATA_DIR` com `npm run daemon:status` e `npm run daemon:stop`. Não mate processos por nome.

## Cenários e definições

**Daemon isolado:** do spawn até autenticação/ping (resolução de polling 50 ms); 5 s ocioso e 5 s de streaming sintético; 200 round trips sequenciais, espaçados em pelo menos 12 ms para respeitar o limite de 100 mensagens/s. O limite de transporte não é uma meta de throughput; não reduza essa pausa sem alterar o propósito do ensaio.

**Electron real com Playwright:** preflight com o executável de produção; lançamento com `chromiumSandbox:true` e verificação da ausência de `--no-sandbox`; readiness até texto de daemon conectado (daemon já iniciado); oito painéis; abertura do CodeMirror e edição; troca de colunas; 3 s ocioso, 3 s streaming/editor; 2,5 s de intervalos rAF e foco até próximo paint (proxy limitado de responsividade); screenshot ampla e 900 px; fechamento nativo por BrowserWindow.close (mesmo caminho do X, sem IPC do renderer); confirmação de zero BrowserWindows e renderers, com avanço de heartbeat e streaming no mesmo daemon; 3 s sem janela; segunda execução do binário, reabertura e restauração do editor/colunas; saída do Electron com daemon ainda vivo. O JSON registra checagens e tempos. rAF mede cadência agendada, não GPU frame time nem latência de cada tecla. O modo compacto é secundário; o produto é desktop-first.

**Recursos:** leitura de `/proc/<pid>/stat`, `status` e `smaps_rollup`, com ticks obtidos de `getconf CLK_TCK`. RSS é memória residente; a soma das árvores Electron inclui páginas compartilhadas repetidas. PSS distribui proporcionalmente páginas compartilhadas (quando disponível). CPU usa delta de tempo user+system dividido por tempo decorrido; 100% = um núcleo lógico. Processos filhos finalizados durante a janela podem não entrar no delta: esse método é apropriado aos processos estáveis do ensaio, não a cargas com muitos subprocessos curtos. O daemon usa um único processo; a árvore Electron inclui main, renderer, GPU e utilitários, separadamente do daemon. Harness de teste e daemon não entram na soma Electron.

Cada cenário é amostrado em sequência. Os números locais são de uma única rodada, com outras aplicações do usuário ativas; não garantem metas. Zero ticks de CPU em 5 s não significa custo zero. Não foi integrado CLI/modelo, e não há consumo atribuído a eles.

## Repetição semanal e comparação

Para comparar mudanças, execute pelo menos cinco rodadas no mesmo hardware, sessão gráfica e modo de energia, salvando os JSONs com data e revisão do código antes da próxima rodada sobrescrever `*-latest.json`. Registre mediana e p95 entre rodadas e preserve outliers com suas condições. Diferencie início frio de início com cache; o início medido do daemon não inclui boot/login, e o início Electron do harness ocorre com daemon ativo. Faça também partida integrada `npm start` em perfil sem daemon para medir a experiência fria completa.

Repita em GNOME/KDE e Wayland/X11. Manualmente: fechar pelo X e pelo tray; verificar ausência de renderer com janela destruída; reabrir pelo tray e pela segunda execução; suspender/retomar o PC (um timeout deve reconectar sem matar ou duplicar daemon); testar zoom/teclado, edição prolongada e janela menor. A suíte automática substitui parte das ações, mas não comprova integração real de tray em todos os desktops.

As metas originais (<2 s abertura, <200 MB RAM ociosa, <1% CPU ociosa, <100 ms feedback) são propostas, não garantias nem critérios já aprovados. Defina com o mantenedor se o orçamento usa PSS/RSS, MiB/MB e inclui todo o shell mais daemon antes de aprovar desempenho. Não avance à Fase 1 com base em uma única rodada favorável.

## Alterações da metodologia na revisão

O diagnóstico repetível `npm run sandbox:diagnose` lê configuração e executa uma sonda de namespace, mas **não é um teste de aceite** e não altera proteções. [SANDBOX_LINUX.md](SANDBOX_LINUX.md) descreve o bloqueio atual, evidências do kernel e os requisitos administrativos/ambiente alternativo.

O teste desktop passou a exigir evidência do runtime do preload e de `/proc/<renderer>/status` (Seccomp=2 e NoNewPrivs=1), além de preferências e argumentos. Falhas são classificadas pela etapa; um erro de restauração ou persistência não pode virar diagnóstico genérico de sandbox. Preflight falho continua retornando código 1 e `passed:false`.

Novos artefatos desktop ficam em `benchmarks/runs/<data-UTC>/`; o JSON lista somente as screenshots produzidas naquela execução. Rodadas do daemon também mantêm cópia em `runs/`. Os arquivos `*-latest.json` continuam atalhos para a execução mais recente. A evidência inicial foi arquivada em `benchmarks/history/initial-phase0/` antes de sobrescrever os atalhos. Imagens históricas nunca aprovam a execução nova.

A amostragem agora recusa PID ausente, encerrado ou reutilizado durante a janela, em vez de produzir zero RAM/CPU. Usa PID e campo starttime de `/proc/<pid>/stat`, também para o delta de CPU dos filhos. Lê RSS/PSS apenas da árvore alvo; a versão anterior lia memória de processos não relacionados, aumentando a janela medida. Os números anteriores foram preservados como histórico; essa diferença metodológica deve ser considerada ao comparar CPU. O encerramento do daemon pelo harness usa o ChildProcess criado por ele, sem sinal por PID cru que pudesse ter sido reutilizado.

## SPEC-001 — cinco rodadas com sandbox (atual)

O procedimento foi executado em [VM Debian/KVM](AMBIENTE_VM_FASE_0.md), separada do Ubuntu principal. Os resultados válidos estão em [RESULTADOS.md](../benchmarks/RESULTADOS.md) e [series-latest.json](../benchmarks/series-latest.json). O histórico pré-SPEC foi preservado em `benchmarks/history/pre-spec001/`; os ~377 MiB antigos continuam inválidos para aceite.

```bash
npm ci
npm run check
npm test
npm run sandbox:diagnose
npm run test:desktop
npm run benchmark:series
npm run benchmark
npm run benchmark:report
```

Em ambiente sem display físico, use o wrapper `scripts/vm/validate-guest.sh` **dentro do guest**. Ele configura Xvfb/D-Bus e identifica as condições da execução. `KARONT_BENCH_ROUNDS` pode aumentar a série; valores menores que cinco são recusados. Cada rodada executa desktop e daemon em sequência, com saída/JSON próprios. Falhas encerram a série com código não zero, manifesto incompleto e evidência preservada; somente séries com cinco ou mais sucessos e prova completa do sandbox são agregadas.

Atualização dos cenários anteriores: o preflight agora usa perfil e daemon próprios novos, medindo partida integrada até janela pronta e ping autenticado, **sem limpar caches do SO**. É início frio de processos/perfil, não de cache ou de boot. A abertura Playwright é medida separadamente com daemon pronto e bibliotecas aquecidas pelo preflight. Uma reabertura usa a segunda execução real do binário.

Electron e daemon são amostrados **simultaneamente** em cada cenário (antes eram sequenciais), com total RSS/PSS/CPU explícito. `idle`: oito painéis parados, editor ainda fechado. `streaming`: oito painéis e editor aberto. `editor`: mesma carga mais 25 linhas digitadas pelo teclado sintético, com pausas de 100 ms entre linhas; a janela de recursos é de aproximadamente 3 s durante a digitação. Isso não simula velocidade humana e explica carga elevada de CPU; não representa custo ocioso do CodeMirror. `noWindow`: renderer ausente, shell/tray e streaming do daemon ativos. O harness não mede menu de tray interativo.

Mediana e p95 usam amostras entre rodadas; p95 é nearest-rank (`ceil(n*0,95)-1`), portanto, com cinco valores, corresponde ao máximo. Para foco até dois rAF são agregadas 50 interações. A cadência é amostrada por 2,5 s por rodada. São proxies agendados em Xvfb, não medição fotônica de tela/teclado nem garantia de feedback de toda ação. PSS pode variar com compartilhamento e processos externos; não se somam RSS como memória física exclusiva. CPU curta tem resolução de ticks e valores próximos de 1% não asseguram cumprir estritamente `<1%`.

A série preserva o uso de Chromium multiprocessado e todas as proteções. RAM ociosa total mediana de **363,84 MiB PSS / 381,52 MB** excedeu a proposta de 200 MB. Não houve otimização de produto nem alegação de redução contra os ~377 MiB históricos: ambientes, sandbox e metodologia são diferentes. O custo da árvore Electron domina; investigar tuning ou arquitetura adicional exige comparações controladas, sem reduzir segurança. O orçamento e o contrato IPC permanecem sujeitos à aprovação explícita.
