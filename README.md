# Polygit

Local-first CLI for assisted translation. Translation memory, glossary propagation, Git-native workflows, and optional LLM providers — without SaaS lock-in.

> **Status:** Scaffold only. Package metadata, folder layout, and the SQLite schema are in place. CLI commands and LLM connectors are not implemented yet. See [docs/epics](docs/epics/README.md).

## Planned usage

```bash
npx polygit init
npx polygit import sources/readme.md --format=markdown
npx polygit translate fr --provider=claude
npx polygit glossary add "Sign in" "Se connecter" --lang=fr
npx polygit glossary sync --lang=fr
npx polygit review --lang=fr
npx polygit commit
npx polygit status
```

## Project layout (after `init`)

```text
sources/           # original documents (git-tracked)
outputs/<lang>/    # translated documents (mirrors sources/)
.tmconfig.json     # project config
.tm/db.sqlite      # local SQLite (segments, TM, glossary)
```

## Stack

- Node.js 20+ / TypeScript
- CLI: `commander`
- Local DB: `better-sqlite3`

## Development

```bash
npm install
npm run typecheck
npm run build
```

## License

MIT © Marina Camacho
