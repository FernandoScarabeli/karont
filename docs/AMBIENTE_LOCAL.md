# Ambiente local de desenvolvimento

Preparado em 25/10/2026 no Ubuntu 26.04.1, com Node 24.22.1 e npm 11.19.1.
O Node foi baixado de nodejs.org e seu SHA-256 conferido contra o manifesto
oficial. Runtime, cache e configuração desta máquina ficam em `.tools/`, ignorada
pelo Git. O Node do sistema não foi substituído.

Na raiz do repositório, em um terminal Bash:

```bash
source scripts/local-env.sh
npm start
```

Execute o `source` em cada terminal novo antes dos comandos npm. A `.nvmrc`
também declara Node 24 para quem utiliza nvm; o script acima usa a instalação
local já preparada.

## Configuração dos agentes

`.tools/dots.json` tem permissão 0600 e contém o projeto Karont e dois Dots:
Implementador e Revisor. Ambos usam `/usr/local/bin/codex`, perfil `codex` e
argumentos vazios. Auto Resume está desativado nessa configuração, pois ainda
não há adaptador certificado. Não há credenciais nesse arquivo.

O script exporta `EROS_DOTS_CONFIG` apontando para esse JSON. Os demais dados do
aplicativo continuam nos diretórios XDG padrão. Não foi iniciada tarefa de IA
nem alterada a autenticação do Codex; login, se necessário, ocorre pela CLI.

## Validação

```bash
source scripts/local-env.sh
npm run check
npm test
npm run test:desktop
npm run test:e2e
```

Na validação da SPEC-005, checagem de tipos, build e os 33 testes passaram neste
ambiente. O relatório [SPEC-005](SPEC_005_IMPLEMENTACAO.md) lista os comandos,
resultados e evidências mais recentes. Foi corrigido o shim Git do teste de
crash durante rollback para aceitar espaços no caminho do Node. Logs locais
ficam em `.tools/tests.log` e `.tools/desktop.log`.

O teste desktop passou com sandbox efetivo (runtime isolado, Seccomp e
NoNewPrivs), fechamento/reabertura da janela, reconexão e layout compacto.
Evidência: `benchmarks/runs/2026-10-25T18-48-40-474Z/desktop.json`.

O E2E com duas CLIs simuladas também passou, incluindo terminais, diff,
rollback, checkpoints e recuperação após crash. Evidência:
`benchmarks/runs/2026-10-25T18-50-33-636Z/phase1-e2e.json`.
O teste agora aguarda a confirmação de cópia antes de verificar o clipboard.
Essa execução não habilitou a fixture D-Bus de notificações e não comprova
autenticação ou Auto Resume com provedor real. Log: `.tools/e2e.log`.

Em ensaio separado, o ciclo básico com Codex autenticado também passou:
alteração, reconexão da janela, diff e rollback. Consulte
[a validação real e seus limites](VALIDACAO_CLI_REAL.md). Auto Resume continua
indisponível.

Dependências instaladas com `npm ci`, preservando o lockfile. O binário Electron
também foi baixado. O build emite um aviso de chunk acima de 500 kB; não impede
a compilação.
