# E06 — Command: `translate`

**Goal:** Translate pending segments using TM first, then LLM; write `outputs/<lang>/`.

## Tasks

- [ ] `polygit translate <lang> [--doc=<path>] [--provider=claude|openai] [--dry-run]`
- [ ] Lookup order: TM exact → TM fuzzy → LLM
- [ ] Store `translations` rows and update TM usage counts
- [ ] Write reconstructed documents under `outputs/<lang>/`
- [ ] Respect glossary terms in LLM prompts when present
- [ ] Dry-run mode prints plan without writes or API calls when possible

## Depends on

- E02, E03, E04, E05
