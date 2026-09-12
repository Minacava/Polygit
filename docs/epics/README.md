# Epics

Work is split into epics by functionality. Check off tasks as they land. All product text (README, CLI help, errors, generated commit messages) stays in **English**.

| ID | Epic | Status |
|----|------|--------|
| [E01](E01-scaffold.md) | Scaffold, package, SQLite schema | In progress |
| [E02](E02-core-segmenter-matcher.md) | Core segmenter + TM matcher | Planned |
| [E03](E03-parsers.md) | Markdown + JSON i18n parsers | Planned |
| [E04](E04-commands-init-import-status.md) | Commands: `init`, `import`, `status` | Planned |
| [E05](E05-llm-connectors.md) | Claude + OpenAI connectors | Planned |
| [E06](E06-translate.md) | Command: `translate` | Planned |
| [E07](E07-glossary.md) | Glossary `add` + `sync` | Planned |
| [E08](E08-review.md) | Command: `review` | Planned |
| [E09](E09-git-commit.md) | Git integration + `commit` | Planned |
| [E10](E10-release-hardening.md) | Docs, npm publish readiness, hardening | Planned |

## Delivery rules

- One PR (or tightly scoped PR series) per epic when possible.
- Run a vulnerability / security audit before opening or updating a PR.
- GitHub contributor attribution: **Marina Camacho** only.
- Enable **Automatically delete head branches** on merge in repo settings.
