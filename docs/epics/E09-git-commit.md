# E09 — Git integration + `commit`

**Goal:** Commit `sources/` and `outputs/` together with clear, auto-generated English messages.

## Tasks

- [ ] Implement `src/git/git.ts` wrapping `simple-git` (or equivalent)
- [ ] `polygit commit [--auto]` — stage sources + outputs, generate message (e.g. segment counts / paths)
- [ ] Without `--auto`, show diff and confirm
- [ ] History should make changed translated segments easy to spot in git blame/diff
- [ ] Never commit `.tm/`, `.env`, or secrets

## Depends on

- E04, E06
