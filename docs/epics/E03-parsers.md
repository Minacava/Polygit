# E03 — Parsers (Markdown + JSON i18n)

**Goal:** Parse supported source formats into segment streams and write translated documents back out.

## Tasks

- [ ] Implement `src/parsers/markdown.ts` (block/sentence segmentation suitable for docs)
- [ ] Implement `src/parsers/json-i18n.ts` (leaf string values, preserve structure/keys)
- [ ] Shared parser interface used by `import` / `translate` output writers
- [ ] Round-trip fixtures (parse → translate stubs → serialize)
- [ ] Reject unsupported / binary files with clear English errors

## Depends on

- E01, E02
