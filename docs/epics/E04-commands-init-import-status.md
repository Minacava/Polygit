# E04 — Commands: `init`, `import`, `status`

**Goal:** Bootstrap a Polygit project, ingest sources, and report coverage.

## Tasks

- [ ] Wire `commander` CLI in `src/cli.ts`
- [ ] `polygit init` — create `sources/`, `outputs/`, `.tmconfig.json`, `.tm/db.sqlite`; init git if missing
- [ ] `polygit import <file> [--format=markdown|json-i18n]` — segment + store as `pending`
- [ ] `polygit status` — pending/stale/approved counts per language and document
- [ ] Config validation for `.tmconfig.json`
- [ ] Manual smoke test on a sample markdown file

## Depends on

- E01, E02, E03
