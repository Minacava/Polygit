# E01 — Scaffold, package, SQLite schema

**Goal:** Publishable TypeScript package skeleton with empty module folders and a working local DB schema.

## Tasks

- [x] Create `package.json` for `polygit` (`npx polygit`)
- [x] Add TypeScript config, `.gitignore`, MIT license, `.env.example`
- [x] Create folder layout: `src/commands`, `src/core`, `src/connectors`, `src/parsers`, `src/git`, `sources/`, `outputs/`
- [x] Implement [`src/core/db.ts`](../../src/core/db.ts) with tables: `documents`, `segments`, `translations`, `translation_memory`, `glossary`, `glossary_usage`
- [x] Export public types from `src/index.ts`
- [x] Add CLI stub entry (`src/cli.ts`) so the package builds
- [x] Document epics under `docs/epics/`
- [ ] Confirm schema + scaffold with maintainer before implementing commands/connectors

## Out of scope

- Real command implementations
- LLM connectors
- Segmenter / matcher / parsers
