# Changelog

## 1.2.0

Feature release on top of 1.1.1.

Highlights:

- Add Gettext PO, YAML i18n, and XLIFF 1.2 parsers (`--format=po|yaml|xliff`)
- Add `check` gate for pre-publish validation
- Add `export-tmx` to export translation memory as TMX 1.4
- Align package version with the npm `1.2.0` release line

See the GitHub release notes and merged pull requests for details.

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
