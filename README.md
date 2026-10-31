<div align="center">

# Karont

**A beautiful desktop home for the AI coding agents you already use.**

Chat with Claude Code, Codex and other CLI agents in a real chat interface, see exactly what they change in your projects, undo it with one click, and run several of them side by side.

[Português](README.pt-BR.md) · [Specification](docs/SPEC.md) · [Contributing](CONTRIBUTING.md) · [MIT License](LICENSE)

</div>

---

> **Status: pre-alpha.** Karont is being rebuilt from scratch in the open. There is no usable release yet. Follow the [milestones](#roadmap) or read the [specification](docs/SPEC.md) to see where it is going.

## Why

AI coding agents like **Claude Code** and **Codex** are powerful, but they live in the terminal. Following a long session, reviewing what changed, juggling several agents at once, or simply reading a nicely formatted answer is harder than it should be.

Karont puts a calm, fast desktop interface on top of the agents you already have installed and logged in. It does not ship its own AI, it does not ask for API keys, and it never touches your agents' credentials.

## What it will do

- 💬 **Real chat with your agents.** Answers stream into the conversation with proper formatting: headings, lists, code blocks, tables.
- 🔎 **See what the agent did.** Every file read, edit and command shows up as a compact, expandable step inside the answer.
- ↩️ **Review and undo.** In Git projects, see the diff of each answer and restore the files to how they were before it.
- 🧭 **Projects and workspaces.** Organize conversations by folder and by area (Personal, Work…), with a home view of everything that is running or needs you.
- ⚡ **Several agents at once.** Keep Claude Code on one project and Codex on another, with a visible queue and a configurable limit.
- 🔌 **Bring any CLI agent.** Claude Code, Codex, Gemini CLI, OpenCode and others are detected automatically; add any other by its command.
- 🖥️ **A real terminal when you want one.** Open a plain shell in any project, right next to your chats.
- ✅ **Tasks.** A simple board that turns messages into tasks and tasks into conversations.

Later: orchestration (one agent splitting work across others), in-chat approvals, macOS and Windows.

## How it works

```
┌──────────────── Karont (Electron) ────────────────┐
│  React UI  ──►  validated bridge  ──►  main       │
└───────────────────────────┬───────────────────────┘
                            │ local socket (same user only)
┌───────────────────────────▼───────────────────────┐
│  Local service (Node)                              │
│  • runs your CLIs in structured mode               │
│    (claude -p --output-format stream-json,         │
│     codex exec --json) and streams the answer      │
│  • terminals, Git restore points, SQLite           │
│  • keeps working when the window is closed         │
└────────────────────────────────────────────────────┘
```

## Privacy and security

- **Your credentials stay with your CLIs.** Karont only runs the agent commands. It never reads, stores or reuses their tokens or config folders.
- **Local only.** Conversations live in a SQLite file in your user data folder. Nothing is sent anywhere by Karont itself; your agents talk to their own providers as they normally do.
- **Locked-down app.** Electron runs with context isolation, sandbox and a strict content security policy. The UI cannot touch your system directly; everything goes through a validated bridge to a local service that only your user can reach.
- **No false promises.** A project folder is not a sandbox. When you give an agent full access, Karont tells you so before it starts.

## Requirements

- Linux (developed on Ubuntu). macOS and Windows are planned.
- At least one CLI agent installed and logged in, for example [Claude Code](https://docs.anthropic.com/en/docs/claude-code) or [Codex](https://github.com/openai/codex).
- For development: Node.js 24+ and npm.

## Getting started (development)

The first milestone is not out yet. Once it lands:

```bash
git clone https://github.com/FernandoScarabeli/karont.git
cd karont
npm install
npm run dev            # desktop app
npm run preview:web    # UI in the browser with live reload, talking to the real local service
```

## Roadmap

| Milestone            | What you get                                                        |
| -------------------- | ------------------------------------------------------------------- |
| **M0** Skeleton      | Secure app shell, local service, streaming bridge, browser preview  |
| **M1** Agents        | Automatic CLI detection, add any CLI, built-in terminal             |
| **M2** Real chat     | Streaming answers from Claude Code and Codex, actions, resume, stop |
| **M3** Projects      | Folders with optional Git, review changes, undo, agent queue        |
| **M4** Navigation    | Workspaces, home, sidebar, search                                   |
| **M5** First run     | Onboarding, profile, settings                                       |
| **M6** Tasks         | Board linked to conversations                                       |
| **M7** Release 0.1.0 | AppImage / .deb                                                     |

The full plan is in [docs/SPEC.md](docs/SPEC.md).

## Contributing

Ideas, bug reports and pull requests are welcome. Read [CONTRIBUTING.md](CONTRIBUTING.md) first. This project is built with AI coding agents under human review; the rules they follow are in [AGENTS.md](AGENTS.md).

## License

[MIT](LICENSE) © 2026 Fernando Scarabeli
