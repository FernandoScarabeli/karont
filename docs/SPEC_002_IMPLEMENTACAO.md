# SPEC-002 — implementação da Fase 1

**Estado:** fluxo funcional implementado e verificado em Debian 13/KVM. A revisão formal da extensão IPC e testes em desktops Linux físicos continuam pendentes. Na data desta entrega, nenhum trabalho da Fase 2 havia sido iniciado. A evolução posterior está registrada na [SPEC-003](SPEC_003_IMPLEMENTACAO.md).

## O que foi entregue

- O daemon Node/TypeScript mantém uma fila persistente de Runs, com até duas CLIs PTY em execução ao mesmo tempo. Estados: `queued`, `running`, `completed`, `failed` e `cancelled`.
- A migração SQLite avança de `user_version=1` para `2` sem recriar o banco da Fase 0. Ela adiciona `dots`, `projects`, `runs`, `sessions`, `run_events`, `worktrees` e `file_changes`.
- Dots e projetos vêm de JSON privado no XDG Config Home. O exemplo em [`config/dots.example.json`](../config/dots.example.json) traz dois dots de demonstração sem credenciais.
- Cada execução cria branch e Git worktree próprios. O processo recebe executável absoluto, vetor de argumentos, `cwd` da worktree e ambiente filtrado; não há montagem de comando shell.
- A UI usa xterm.js em dois painéis, com entrada, redimensionamento, scrollback em memória do daemon (256 KiB por sessão), histórico, status, diffs, prévia de rollback e confirmação.
- Fechar e destruir a `BrowserWindow` remove a assinatura de eventos da janela; daemon, PTYs e CLIs seguem ativos. Ao reabrir, o aplicativo anexa às mesmas sessões e pede o scrollback mantido no daemon.
- Rollback compara hashes antes de permitir a confirmação e registra `rollback.applied`. Um conflito impede a reversão; ela afeta somente arquivos conhecidos dentro daquela worktree.
- O preload expõe operações IPC nomeadas. Main valida janela, frame principal e URL local; contratos Zod limitam método, argumentos, tamanho e destino. Assinaturas de evento são mantidas por Run, para reconectar uma sem derrubar a outra.
- O laboratório da Fase 0 continua disponível para regressões e comparação.

## Executar

Requisitos: Linux, Node.js 24+, Git, Python 3 e ferramentas C/C++ (`build-essential` em Debian/Ubuntu). `node-pty` compila um addon nativo durante `npm ci`. O Electron requer uma sessão gráfica e um ambiente em que o sandbox Chromium funcione; não use `--no-sandbox`.

```bash
npm ci
mkdir -p ~/.config/eros
cp config/dots.example.json ~/.config/eros/dots.json
chmod 600 ~/.config/eros/dots.json
```

Edite `~/.config/eros/dots.json`: troque `root` pela raiz absoluta de um repositório Git; ajuste `executable` para o caminho absoluto da CLI (`command -v codex`, por exemplo); e confira `projectIds`. Cada dot somente pode iniciar em projetos explicitamente listados. A configuração deve pertencer ao usuário e não pode ser acessível por grupo/outros. Não ponha tokens, senhas ou chaves nesse JSON.

```bash
npm run build
npm start
```

O primeiro login é feito no próprio terminal/CLI. O eros não captura nem reutiliza tokens de assinatura. O processo da CLI é do mesmo usuário e pode ler a configuração de autenticação que a própria CLI mantém em `$HOME`.

Para testar sem provedor pago, os testes criam repositório temporário e duas CLIs Node simuladas. Para rodar a validação Electron com sandbox em Linux headless:

```bash
npm run check
npm test
xvfb-run -a dbus-run-session -- npm run test:desktop
xvfb-run -a dbus-run-session -- npm run test:e2e
```

O sandbox precisa estar disponível no kernel/ambiente. Os testes não desativam o sandbox nem corrigem permissões privilegiadas automaticamente.

## Continuidade e limites

O ciclo fechar/reabrir é suportado enquanto o daemon permanecer vivo. PIDs, estado, identidade da sessão, dimensão e histórico de eventos ficam no SQLite; o scrollback é apenas RAM limitada do daemon e não contém log/histórico durável. Um restart ou crash do daemon encerra a sessão PTY e marca Runs `running` como `failed`; retomada após crash pertence à Fase 3.

Git worktree isola alterações de código entre Runs, mas não é uma sandbox de segurança: a CLI pode acessar outros caminhos permitidos ao mesmo usuário e executar efeitos externos. O terminal genérico não entende cada ação do agente nem controla suas aprovações; continue usando a própria CLI. Rollback não desfaz comandos, chamadas de rede, mudanças fora da worktree ou outros efeitos que o eros não registrou.

O scrollback pode conter conteúdo sensível durante a vida do daemon. Ele não é gravado no SQLite, em `RunEvent` ou nos logs. O ambiente da CLI é filtrado pelo daemon; a CLI conserva acesso às credenciais já configuradas por ela sob a conta do usuário. A fronteira IPC continua sendo local ao mesmo UID, conforme descrito em [`PROTOCOLO_LOCAL.md`](PROTOCOLO_LOCAL.md).

## Testes e evidências

Na execução final, `npm run check` e `npm test` passaram com **11 testes** (nove anteriores preservados e dois testes da Fase 1). Em Debian 13/KVM, o `test:desktop` preservou sandbox Chromium efetivo (`seccomp=2`, `NoNewPrivs=1`) e ciclo Fase 0; o `test:e2e` iniciou duas CLIs/PTys, destruiu a janela, verificou os mesmos PIDs ativos, reabriu, recuperou saída e entrada, produziu diff e confirmou rollback. Depois foram repetidas cinco rodadas dos benchmarks desktop e do daemon. As CLIs simuladas não usaram conta nem API externa.

- [Teste desktop final e prova de sandbox](../benchmarks/runs/2026-10-23T23-48-52-955Z/desktop.json)
- [Manifesto da série final de cinco rodadas](../benchmarks/series/2026-10-23T23-46-03-673Z/manifest.json)
- [Resultado E2E e amostras PSS/CPU](../benchmarks/runs/2026-10-23T23-44-56-394Z/phase1-e2e.json)
- [Dois terminais simultâneos](../benchmarks/runs/2026-10-23T23-44-56-394Z/phase1-two-terminals.png)
- [Janela reaberta](../benchmarks/runs/2026-10-23T23-44-56-394Z/phase1-reconnected.png)
- CI para Linux/Node 24: [`.github/workflows/linux.yml`](../.github/workflows/linux.yml). O workflow está configurado; não foi disparado contra um remoto nesta sessão.

Resultados e comparação com a mediana histórica da Fase 0 estão em [`benchmarks/RESULTADOS.md`](../benchmarks/RESULTADOS.md). A série de referência sem agentes marcou 373,97 MiB PSS ocioso (mediana); o E2E com dois PTYs marcou 510,54 MiB numa amostra única. O cenário, instrumentação e número de amostras diferem, então os valores ficam reportados separadamente.

## Protocolo e pendências

A extensão SPEC-002 está documentada em [`PROTOCOLO_LOCAL.md`](PROTOCOLO_LOCAL.md), com métodos, validações e riscos. O canal AF_UNIX, segredo e handshake v1 foram preservados. **A extensão ainda aguarda revisão formal; implementação e teste não equivalem a aprovação do protocolo.** Compatibilidade com GNOME/KDE, Wayland/X11 físico, tray nativo e pacote distribuível também não foi verificada.
