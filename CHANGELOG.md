# Changelog

## Unreleased

- `review`: interactive `A` / `aa` / `all` approves the current segment and all remaining with a TARGET
- `review --approve-all`: bulk-approve without a TTY prompt
- `translate` / `review`: on `main`/`master`, auto-create `polygit/translate-<lang>-YYYYMMDD` for translation work
- `publish`: reuse that branch and open a PR/MR to main when translations are approved
- `translate` / `review` `--no-branch` to opt out

## 1.2.2

- `translate`: TTY progress bar for LLM segments (`cli-progress`)
- `commit`: interactive message prompt; `--ai` drafts a message from the diff
- `log`: list recent translation commits (`--stat`, `--limit`, `--grep-translate`)
- Docs: README index + full command reference; Cursor paste-prompt example
- Ollama: match untagged model ids to tagged local installs

## 1.2.1

Publishes the current `main` branch to npm. Use this instead of `1.2.0` on the registry.

Highlights (included in this tarball):

- Gettext PO, YAML i18n, and XLIFF 1.2 parsers (`--format=po|yaml|xliff`)
- `check` gate for pre-publish validation
- `export-tmx` to export translation memory as TMX 1.4
- Security/correctness fixes from the 1.1.1 line

## 1.2.0

Version bump that landed on npm from an older commit (Markdown/JSON only). Prefer **1.2.1**.

## 1.1.1

Security and correctness patch release. Users of 1.1.0 should upgrade.

Highlights:

- Restrict forge API tokens to trusted hosts (`github.com` / `gitlab.com`) unless explicitly confirmed
- Stronger secret redaction and safer `clone` / `--branch` validation
- Treat `.tmconfig.json` and document text as untrusted input
- Stable segment IDs so translations survive source inserts/edits
- Markdown parsing fixes (front matter, lists, tables, links)
- Placeholder preservation after LLM translation
- Safer `publish` (restore branch; verify approved outputs on disk)
- HTTP retry/backoff and non-JSON error handling
- Updated default Claude model to `claude-haiku-4-5`

See the GitHub release notes and merged pull requests for details.
