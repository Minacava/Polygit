# E02 — Core segmenter + TM matcher

**Goal:** Split documents into stable-ID segments and match against translation memory (exact, then fuzzy).

## Tasks

- [ ] Implement `src/core/segmenter.ts` (stable IDs from position + content on first import)
- [ ] Persist / reconcile segments on re-import (detect moved vs changed text)
- [ ] Implement `src/core/matcher.ts` exact TM lookup
- [ ] Add fuzzy TM matching with a clear similarity threshold
- [ ] Unit tests for ID stability and match ranking
- [ ] Security review: no path traversal when reading project files

## Depends on

- E01
