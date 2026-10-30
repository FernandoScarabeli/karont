# Sandbox Linux — investigação P0

## Refatoração – Fase 1: CI e contorno local

No runner Ubuntu 24.04, o workflow executa `node node_modules/electron/install.js` logo após `npm ci` para garantir o binário e, em seguida, `sudo chown root:root node_modules/electron/dist/chrome-sandbox && sudo chmod 4755 node_modules/electron/dist/chrome-sandbox`. O preparo é específico do runner descartável e mantém o sandbox ativo. Localmente, o helper aprovado fica em `/usr/local/lib/karont-dev/chrome-sandbox`: `CHROME_DEVEL_SANDBOX` só é respeitado quando **não existe** `chrome-sandbox` ao lado do executável do Electron. Após `npm ci`, renomeie essa cópia local antes de usar a variável e confira a compatibilidade do helper quando a versão do Electron mudar. Os registros abaixo são históricos; o passo do CI ainda depende da execução pelo orquestrador.

## SPEC-001 — desbloqueio em ambiente separado

**Sandbox validado em VM Debian 13/KVM.** O host Ubuntu descrito abaixo permanece protegido e bloqueado; não foi alterado. A rota usada foi uma VM com kernel próprio e política padrão Debian, sem exceções, SUID ou mudanças em sysctls. AppArmor está carregado no guest (`Y`, contexto `unconfined`), `unprivileged_userns_clone=1`; a sonda `unshare` passou. Os knobs específicos do Ubuntu não são inferidos como desligados: um está ausente e outro inacessível ao usuário do guest, conforme diagnóstico.

Prova efetiva do renderer: preferências sandbox/contextIsolation verdadeiras, Node desativado, runtime sandboxed/contextIsolated verdadeiros, **Seccomp=2 e NoNewPrivs=1**, lançamento sem flags desativadoras. `npm run test:desktop` passou, assim como cinco rodadas completas. Helper baixado permanece usuário comum/0755. [Diagnóstico VM](../benchmarks/spec001/sandbox-diagnostic-vm.json), [resultado final](../benchmarks/desktop-latest.json), [série](../benchmarks/series-latest.json).

Procedimento e scripts: [AMBIENTE_VM_FASE_0.md](AMBIENTE_VM_FASE_0.md). Evidência não equivale a aprovação para instalar perfis/helpers no host; as duas rotas administrativas históricas abaixo **não foram usadas**. Também não prova GNOME/Wayland ou suspensão real. Veja [recomendação atual](REVISAO_FASE_0.md).

## Investigação anterior — histórico do host Ubuntu

## Resultado da revisão

**Bloqueado no host atual.** `npm run test:desktop` foi repetido em 23/10/2026 às 18:46 BRT e retornou **1**, com `passed:false`, `status:blocked`, etapa `native-preflight`. Nenhuma screenshot nova foi gerada. O daemon do ensaio iniciou e autenticou, mas nenhuma etapa Electron ↔ daemon foi considerada aprovada. Veja [JSON da execução](../benchmarks/runs/2026-10-23T21-46-49-880Z/desktop.json) e [diagnóstico de ambiente](../benchmarks/sandbox-diagnostic.json).

A falha não é evidência de incompatibilidade de Electron com Linux/Wayland em geral. É um bloqueio da política de segurança aplicada a este executável de desenvolvimento neste computador. A stack confirmada permanece inalterada.

## Fatos verificados, sem alterações administrativas

- Ubuntu 26.04.1, kernel 7.0.0-38-generic, sessão Wayland; UID 1000.
- Electron **45.0.0**, Playwright **1.64.1**, Node **24.21.0** do lockfile instalado com `npm ci`.
- `sandbox:true`, `contextIsolation:true`, `nodeIntegration:false`, `webSecurity:true` na BrowserWindow. Main recusa flags que desativam sandbox ou usam um só processo. Harness usa `chromiumSandbox:true` explicitamente; o default do Playwright é false.
- `kernel.unprivileged_userns_clone=1`, mas **também** `kernel.apparmor_restrict_unprivileged_userns=1` e `kernel.apparmor_restrict_unprivileged_unconfined=1`. A primeira opção sozinha não assegura que o sandbox consiga usar capabilities no namespace.
- `unshare --user --map-root-user -- true` falhou ao escrever `/proc/self/uid_map`, com `Operation not permitted`.
- Executável e helper do Electron pertencem ao UID 1000 e têm modo **0755**. O helper **não é SUID root**. A busca em `/usr`, `/snap`, `/opt` e `/var/lib/flatpak` não encontrou um `chrome-sandbox` SUID root reaproveitável. `/opt/google/chrome/chrome-sandbox` não existe.
- A montagem que contém o projeto não apresenta `nosuid`; a inexistência de helper configurado, não essa opção de montagem, explica a falha do fallback SUID.
- `/etc/apparmor.d/chrome` cobre `/opt/google/chrome/chrome`, não o Electron no repositório. Não foi tentado executar outro perfil para contornar a política.
- Não foi alterado AppArmor, sysctl, propriedade de arquivos, bit SUID, política de segurança, empacotamento ou configuração global. Não foi usado nenhum argumento que desative sandbox.

## Evidência do kernel na nova tentativa

As linhas abaixo são extratos do journal local de 23/10/2026, correlacionados ao PID do preflight:

```text
18:46:50 apparmor="AUDIT" operation="userns_create" profile="unconfined"
         pid=123699 comm="electron" target="unprivileged_userns"
18:46:50 apparmor="DENIED" operation="capable" profile="unprivileged_userns"
         pid=123705 comm="electron" capability=21 capname="sys_admin"
```

O Electron abortou por SIGTRAP com `The SUID sandbox helper binary was found, but is not configured correctly`. A correlação mostra duas rotas indisponíveis: namespace com as capabilities necessárias e fallback SUID. O código main não chegou a executar. Não há evidência de problema causado pelo conteúdo React, IPC, GPU ou pelo compositor; essas etapas não foram alcançadas.

`aa-status` confirma módulo AppArmor carregado, mas a listagem completa de perfis requer privilégio. A leitura dos perfis do filesystem e dos logs não equivale a uma auditoria completa de todas as regras carregadas. A sonda `unshare` é somente diagnóstico: diferentes executáveis podem ter perfis distintos, logo o aceite depende do Electron real.

## Preparar um ambiente válido

Existem duas rotas administrativas possíveis; nenhuma foi aplicada ou validada nesta revisão:

1. **Sandbox por namespaces:** o administrador deve avaliar uma política AppArmor específica para o executável de teste, com acesso a `userns` e às operações necessárias, seguindo a documentação da distribuição. Manter as restrições globais habilitadas e não usar glob de caminhos amplo. Um perfil `flags=(unconfined)` com `userns` é uma exceção à restrição de namespaces, não confinamento completo do aplicativo; Electron é um runtime de uso geral. Avaliar o risco e a integridade do caminho antes de permitir essa exceção. Não se recomenda instalar uma exceção irrestrita para toda a home ou `node_modules/**`.
2. **Helper SUID confiável existente ou instalado pelo administrador:** Chromium documenta o uso de `CHROME_DEVEL_SANDBOX` para um helper confiável root-owned. O arquivo e seus diretórios precisam impedir alteração por usuário comum, o filesystem precisa permitir SUID e o helper precisa ser compatível com esta versão. Não executar `chown/chmod` recursivos no repositório. Se não existir helper aprovado, sua obtenção/instalação requer uma ação administrativa separada, que não está autorizada neste trabalho.

Uma VM Linux de teste com sandbox de Chromium suportado é outra opção, sem alterar a política deste computador. Isso não constitui validação em Ubuntu/Wayland até repetir nesse ambiente. Não foi criada VM/container, nem gerado pacote distribuível nesta revisão.

Quando um helper **já estiver instalado e aprovado** (exemplo de caminho dedicado), executar como usuário comum, sem sudo:

```bash
stat -Lc '%U %G %a %n' /usr/local/lib/eros-phase0/chrome-sandbox
# Esperado: root root 4755, e diretórios pais não graváveis pelo usuário.
CHROME_DEVEL_SANDBOX=/usr/local/lib/eros-phase0/chrome-sandbox npm run sandbox:diagnose
CHROME_DEVEL_SANDBOX=/usr/local/lib/eros-phase0/chrome-sandbox npm run test:desktop
npm run benchmark:report
```

O caminho acima é exemplo de configuração, **não um helper já instalado**. Não há promessa de sucesso antes de executar o teste. O digest local do helper baixado do Electron 45.0.0 é `f16e2562837856845cfc8ebf4aa7f78b57fdadc6b69130509b1db87ce5d2f869`; ele identifica o artefato observado, não substitui verificação independente de procedência.

Se a rota por namespaces tiver sido preparada para o binário do projeto:

```bash
npm ci
npm run check
npm test
npm run sandbox:diagnose
npm run test:desktop
npm run benchmark
npm run benchmark:report
```

`npm ci` pode substituir o Electron instalado: rever caminho/versão/perfil e repetir os testes após atualização. Não instalar permissões especiais em arquivos que o npm pode substituir.

## Prova mínima exigida pelo harness revisado

O preflight de produção precisa abrir a janela. No Playwright, o teste confere preferências, argumentos, `process.sandboxed`/`process.contextIsolated` reportados pelo preload e o PID real do renderer por `webContents.getOSProcessId()`. Lê `/proc/<pid>/status` e exige **Seccomp=2** (filtro ativo) e **NoNewPrivs=1**. São evidências do renderer real no Linux, além da configuração declarada; não constituem certificação de toda a implementação Chromium.

O teste exercita `BrowserWindow.close()` sem IPC do renderer — mesmo caminho de fechamento que o X segundo a API Electron — e exige zero janelas/renderer, daemon com mesmo PID e avanço de heartbeat/streaming sem janela. Depois reabre pela segunda execução do binário e confere estado persistido. O clique físico no X e o tray do compositor continuam verificações manuais, identificadas separadamente. Esses passos estão preparados, **mas não foram executados neste host** porque o preflight falhou.

## Referências oficiais consultadas

- [Ubuntu: AppArmor e restrições por aplicação](https://documentation.ubuntu.com/security/security-features/privilege-restriction/apparmor/).
- [Ubuntu Security Team: restrição de namespaces e hardening](https://discourse.ubuntu.com/t/understanding-apparmor-user-namespace-restriction/58007).
- [Chromium: AppArmor e builds de desenvolvimento](https://chromium.googlesource.com/chromium/src/+/main/docs/security/apparmor-userns-restrictions.md).
- [Electron: sandbox](https://www.electronjs.org/docs/latest/tutorial/sandbox), [process](https://www.electronjs.org/docs/latest/api/process), [BrowserWindow.close](https://www.electronjs.org/docs/latest/api/browser-window#winclose).
- [Playwright: Electron.launch e chromiumSandbox](https://playwright.dev/docs/api/class-electron#electron-launch).
