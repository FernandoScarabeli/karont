<div align="center">

# Karont

**Uma casa bonita no desktop para os agentes de IA que você já usa.**

Converse com Claude Code, Codex e outros agentes de linha de comando num chat de verdade, veja exatamente o que eles mudam nos seus projetos, desfaça com um clique e rode vários lado a lado.

[English](README.md) · [Especificação](docs/SPEC.md) · [Como contribuir](CONTRIBUTING.md) · [Licença MIT](LICENSE)

</div>

---

> **Status: pré-alfa.** O Karont está sendo reconstruído do zero, em público. Ainda não há versão utilizável. Acompanhe os [marcos](#marcos) ou leia a [especificação](docs/SPEC.md).

## Por quê

Agentes como **Claude Code** e **Codex** são poderosos, mas vivem no terminal. Acompanhar uma sessão longa, revisar o que mudou, cuidar de vários agentes ao mesmo tempo ou só ler uma resposta bem formatada é mais difícil do que deveria.

O Karont coloca uma interface de desktop calma e rápida em cima dos agentes que você já tem instalados e logados. Ele não traz IA própria, não pede chave de API e nunca toca nas credenciais dos seus agentes.

## O que ele vai fazer

- 💬 **Chat de verdade com seus agentes**, com a resposta chegando ao vivo e bem formatada.
- 🔎 **Ver o que o agente fez**: cada arquivo lido, edição e comando aparece como um passo compacto dentro da resposta.
- ↩️ **Revisar e desfazer**: em projetos Git, veja o diff de cada resposta e volte os arquivos a como estavam antes dela.
- 🧭 **Projetos e workspaces** para organizar conversas, com uma tela inicial do que está rodando ou precisa de você.
- ⚡ **Vários agentes ao mesmo tempo**, com fila visível e limite configurável.
- 🔌 **Qualquer agente de CLI**: Claude Code, Codex, Gemini CLI, OpenCode e outros são detectados sozinhos; adicione qualquer outro pelo comando.
- 🖥️ **Terminal de verdade** quando você quiser.
- ✅ **Tarefas** num quadro simples, ligadas às conversas.

Depois: orquestração (um agente dividindo o trabalho com outros), aprovações no chat, macOS e Windows.

## Privacidade e segurança

- **Suas credenciais ficam com as suas CLIs.** O Karont só executa os comandos dos agentes; nunca lê, guarda ou reutiliza tokens nem as pastas de configuração deles.
- **Tudo local.** As conversas ficam num arquivo SQLite na sua pasta de dados.
- **App travado:** Electron com isolamento de contexto, sandbox e política de conteúdo restrita; a interface só fala com uma ponte validada para um serviço local que só o seu usuário acessa.
- **Sem promessa falsa:** pasta de projeto não é sandbox, e o app avisa antes de dar acesso total a um agente.

## Requisitos

- Linux (feito no Ubuntu). macOS e Windows estão nos planos.
- Pelo menos um agente de CLI instalado e logado, como o [Claude Code](https://docs.anthropic.com/en/docs/claude-code) ou o [Codex](https://github.com/openai/codex).
- Para desenvolver: Node.js 24+ e npm.

## Marcos

| Marco | O que entrega |
|---|---|
| **M0** Esqueleto | App seguro, serviço local, ponte com streaming, preview no navegador |
| **M1** Agentes | Detecção das CLIs, adicionar qualquer CLI, terminal embutido |
| **M2** Chat de verdade | Respostas ao vivo do Claude Code e do Codex, ações, continuar, parar |
| **M3** Projetos | Pastas com Git opcional, ver mudanças, desfazer, fila de agentes |
| **M4** Navegação | Workspaces, Início, sidebar, busca |
| **M5** Primeira abertura | Onboarding, perfil, configurações |
| **M6** Tarefas | Quadro ligado às conversas |
| **M7** Versão 0.1.0 | AppImage / .deb |

## Licença

[MIT](LICENSE) © 2026 Fernando Scarabeli
