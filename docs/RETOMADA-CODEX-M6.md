# Retomada do M6 pelo Codex

Registro de 2026-11-09 para continuar o trabalho em outra sessão.

## Por que o Codex assumiu

O Claude estava no M6-F0d (fluidez, borda e expressões do Dot) quando seu executor foi interrompido pelo limite de uso da API. Fernando pediu ao Codex para localizar onde havia parado e continuar. Depois aprovou o plano de persistência e Configurações do Dot e mandou implementá-lo. Por fim, pediu este registro, uma branch própria, commit e push.

## O que foi recuperado e feito

1. Localizadas alterações sem commit na worktree `/home/Fernando/karont-worktrees/m6-f0-prototipo`, baseada em `93b56e3`. O original foi preservado; a retomada ocorreu em `.worktrees/m6-f0d-retomada`.
2. Recuperados borda calculada pela cor do corpo, animação sem o limite anterior de 30/20 fps e sete expressões novas: feliz, triste, dançando, surpreso, bravo, confuso e apaixonado. Onze humores no protótipo; feliz substitui terminou.
3. Revisados movimento reduzido, redesenho ao trocar tamanho, observadores dos desenhos estáticos, camadas de animação e cálculo da órbita. Acrescentados testes de rosto e contorno. O protótipo abre em `#dot` também no preview de produção.
4. Implementados banco e Configurações do Dot: migração 22, `dot.get`, `dot.update`, evento `dot.updated`, nome, cor, ativação e três eixos de personalidade. Nome inicial Dot, grafite, ativado e eixos em 50.
5. Criada Configurações › Dot: preview imediato da cor, botão Salvar escolhido pelo dono, Cancelar, confirmação ao sair com edição pendente, tratamento de falhas e sincronização entre janelas preservando a edição local.
6. Mantida a decisão 37: sem salinha. A identidade e as preferências ficam nas Configurações. Personalidade e ativação ainda não estão ligadas ao chat; a tela informa a limitação da personalização das respostas.
7. Registrado o código em `038a851` e integrado na branch de marco `m6-dot` em `5acfacc`. A branch de entrega solicitada é `feat/m6-dot-identidade-configuracoes`, criada a partir dessa integração, contendo todo esse histórico. A `main` permanece sem essa entrega.

Detalhes de implementação: [relatório F0d](RELATORIO-M6-F0D.md) e [relatório B1/F1](RELATORIO-M6-B1-F1.md).

## Verificações reais

- Tipos, lint e build da UI/main/preload/serviço passaram.
- Testes da interface passaram nos 50 arquivos.
- Testes focados de contrato, migração e banco: 24 passaram; serviço Dot e edição local/remota: cinco passaram. Depois da integração na pasta principal, tipos e seis testes focados de contrato/serviço/edição passaram novamente.
- `npm run check` não ficou completamente verde: seis arquivos do serviço e um do desktop falharam no ambiente restrito. Reproduções mostraram `EPERM` ao executar subprocessos Git e abrir sockets Unix.
- Não foram executados Electron/E2E, validação visual nem medição real de fluidez/CPU. Não considerar essas verificações aprovadas.
- Sem dependências novas, sem leitura de credenciais das CLIs e sem publicação de PR ou merge na `main`.

## Como conferir quando voltar

Na raiz do projeto, na branch de entrega, com Node 24:

```bash
npm run preview:web:prod
```

Abrir `http://127.0.0.1:5173/` → engrenagem → Dot. Alterar e salvar, recarregar para conferir persistência, testar Cancelar e a confirmação ao sair com alterações. Abrir duas abas para conferir sincronização. Expressões ficam em `http://127.0.0.1:5173/#dot`.

Antes do PR, repetir testes completos/E2E e medir fluidez em ambiente que permita Electron e sockets.

## Próximo trabalho

B2/F2: conectar identidade, rosto, ativação e personalidade às conversas reais com Agente, preservando o Dot ao trocar de CLI e mantendo Terminal sem Dot. Depois vêm memórias com aprovação, sugestões de personalidade, crachá e saudações. O detalhamento vigente está nas decisões 36 e 37 de [PROGRESSO.md](PROGRESSO.md).
