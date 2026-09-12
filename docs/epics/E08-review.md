# E08 — Command: `review`

**Goal:** Interactive terminal review to approve or edit segments before treating outputs as final.

## Tasks

- [ ] `polygit review [--lang=<lang>] [--status=pending|stale]`
- [ ] Diff-style view of source vs target
- [ ] Approve / edit / skip actions update DB (`approved`, `manual` source)
- [ ] Non-interactive fallback or clear error when no TTY
- [ ] Ensure review cannot bypass writing policy unexpectedly

## Depends on

- E06
