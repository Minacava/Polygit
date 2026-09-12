# E07 — Glossary `add` + `sync`

**Goal:** Maintain per-language terms and propagate changes by marking affected segments stale (optional auto-retranslate).

## Tasks

- [ ] `polygit glossary add <source_term> <target_term> --lang=<lang> [--note="..."]`
- [ ] Upsert glossary rows; rebuild `glossary_usage` links
- [ ] `polygit glossary sync [--lang=<lang>] [--auto-retranslate]`
- [ ] On term change, mark matching segments (and related TM hits as needed) as `stale`
- [ ] With `--auto-retranslate`, re-run translate for affected segments only
- [ ] Tests for cross-document propagation

## Depends on

- E04, E06
