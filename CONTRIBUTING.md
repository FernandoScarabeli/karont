# Contributing to Karont

Thanks for your interest! Karont is in **pre-alpha** and is being rebuilt from scratch, so things move fast.

## Before you start

- Read the [specification](docs/SPEC.md): it is the source of truth for what Karont does and how it is built.
- Read [AGENTS.md](AGENTS.md): the non-negotiable rules (security, credentials, accessibility, honest UI) apply to humans and AI agents alike.
- For anything bigger than a small fix, open an issue first so we can agree on the approach.

## Ground rules

- **Never** add code that reads, stores or reuses the credentials or config folders of the CLI agents.
- Keep Electron locked down: `contextIsolation`, `sandbox`, no `nodeIntegration`, strict CSP.
- New dependencies need a short written reason in the pull request.
- The UI is in Brazilian Portuguese for now; code, identifiers and commit messages are in English or Portuguese, matching the surrounding code.
- Tests must not depend on the CLIs installed on your machine; use the fake CLIs and fixtures.

## Workflow

1. Fork and create a branch from `main`.
2. Make focused changes with tests.
3. Run `npm run check` and `npm test` (commands are added in milestone M0).
4. Open a pull request describing what changed, why, and how you tested it.

## Reporting security issues

Please do not open a public issue for security problems. Use GitHub's private vulnerability reporting on this repository.
