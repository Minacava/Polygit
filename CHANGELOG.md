# Changelog

## Unreleased

- Warn with the opening line number when a `$$` math block is unclosed, and keep the following document content available for translation. Closed math blocks remain raw.

## 1.2.8

Demo-blocking and high-severity fixes from the 1.2.7 re-test:

- Fix (NEW-01): keep original gaps between sentences (`\n`, hard breaks); treat VitePress `::: tip` / `:::` containers, `$$…$$` math fences, and setext underlines as structure (no longer flattened into one line)
- Fix (NEW-02): glossary/style-stale segments skip TM exact reuse so `--auto-retranslate` reaches the LLM with the new term
- Fix (NEW-03): `translate` checks source `content_hash` before any LLM call; regenerates missing output files even when nothing is pending
- Fix (PG-23): YAML-quote frontmatter values that contain `: ` or other special characters so VitePress/Docusaurus still parse

## 1.2.7

Audit fixes from the 1.2.6 review (PG-01…PG-44):

- Fix (PG-01): `import` glob / `--root` skips managed translation outputs (no more `docs/fr/fr/...`)
- Fix (PG-02): refuse to write outputs when the source changed since import; match translations by source text
- Fix (PG-03): publish / review “all approved” counts segments without a translation row
- Fix (PG-05): re-key segment ids on source edits so identical re-imports stay unchanged
- Fix (PG-04): `check` fails on broken placeholders; `--require-approved` fails on unapproved translations
- Fix (PG-06): translate continues after LLM errors, writes partial outputs, exits 1
- Fix (PG-07): `translate --dry-run` no longer creates/checkouts a work branch
- Fix (PG-08/09): safer quote stripping; strip `<think>` blocks and translation preambles
- Fix (PG-10/11): stronger placeholder checks; failed checks mark `needs_fix` and keep source on disk
- Fix (PG-12): TM exact reuse only from approved entries; review updates TM
- Fix (PG-28): reject truncated Claude/OpenAI completions (`max_tokens` / `finish_reason=length`)
- Schema v7: `translations.status` includes `needs_fix`; `translation_memory.approved`
- Fix (PG-13): glossary sync stales only the term’s language and retranslates each affected lang
- Fix (PG-14): `prune` / sync remove deleted sources; check reports DELETED
- Fix (PG-15): translate writes skeleton outputs for empty docs; warn on unterminated front matter
- Fix (PG-16): `import` accepts directories and multiple paths
- Fix (PG-17): skip unknown formats; transactional import; skip JSON identifier values
- Fix (PG-24): review defaults to unapproved; `--status pending` = missing row; confirm bulk approve
- Fix (PG-25): `translate` requires `--add-lang` when the language is outside targetLangs
- Fix (PG-18..23): Markdown fences (`~~~` / length), `1)` lists, blockquotes, ref defs, MDX/JSX, `{#id}`, indented code, CRLF preserve; sentence split via `Intl.Segmenter`
- Fix (PG-26/29): normalize `OLLAMA_HOST`; auto-pick a single tagged default Ollama variant
- Fix (PG-30): SQLite `busy_timeout = 5000`
- Fix (PG-31): HTTP timeouts throw a clear origin + timeout error (no silent retry-forever)
- Fix (PG-32): work-branch date uses local calendar day
- Fix (PG-33): forge token trust via `POLYGIT_FORGE_HOSTS` / `--confirm-forge-host` (not repo `forgeHosts`)
- Fix (PG-34): `check --hook` warns on NEW/CHANGED; pre-commit uses it; `commit` stages outputs only (`--include-sources` opt-in)
- Fix (PG-35): CI runs on `release/**` with Node 20/22 matrix + CLI smoke
- Fix (PG-36): npm publish runs typecheck/test/build and `--provenance`; omit `dist/**/*.map` from the tarball
- Fix (PG-37..44): path `..` segment checks; URL userinfo redaction; `import --root` refuses unknown roots; `translate --concurrency` / `POLYGIT_CONCURRENCY`

## 1.2.6

- Fix: `status` on-disk count excludes managed translation outputs; pluralize as "1 file" / "N files" (no `file(s)`)
- Fix: strip wrapping quotes (including curly/guillemets) and markdown fences from LLM translations
- Shorter auto work branches: `polygit/<lang>-YYYYMMDD` (legacy `polygit/translate-…` still recognized)

## 1.2.5

- Fix: strip echoed `<TRANSLATION_DOCUMENT>` delimiters from LLM translations (and tell the model not to copy them)
- Fix: `--no-branch` no longer defaults to on — auto `polygit/translate-*` branches work again on main/master
- Fix: placeholder check allows translated Markdown link/image text; only destinations (URLs/paths) must match
- Fix: `status` without `--lang` reports approved counts from translations (not segment rows that never become approved)

## 1.2.4

- `style.paths` / `style.langs` overlays (max 64 each): resolve CLI > longest path prefix > lang > global; fingerprint per document so only affected rows go STALE
- Optional `style.guide` (project `.md` / `.txt`, max 8 KB via `resolveInsideProject`): delimited in the system prompt; tone/word-choice only; control chars and delimiter tags stripped; content included in `style_hash`
- Schema v6: `style_hash` on `translations` and `translation_memory` (v5→v6 keeps rows; NULL = unset style)
- Style fingerprint: exact TM reuse only when `style_hash` matches; style changes mark mismatched translations STALE (`check` reports `style changed`); retranslate leaves them unapproved
- Projects without `style` never mark translations stale for style
- Configurable translation style: `.tmconfig.json` `style.preset` (`academic` | `startup` | `technical` | `marketing` | `legal`) and `style.formality` (`formal` | `informal` | `auto`); closed-list validation in `readConfig` / `config set`
- `translate` / `sync` `--style` / `--formality` one-off overrides (CLI wins over config); omitted style keeps the legacy system prompt unchanged
- `init` asks for a style preset (Enter = none) and accepts `--style` / `--formality`; `config get|set style.preset` / `style.formality`
- `hooks install`: pre-commit resolves `./node_modules/.bin/polygit`, then PATH, then `npx --no-install`; clear error if missing; refuse-overwrite exits non-zero
- `check`: print the failure summary once (no duplicated `Error:` line)
- `check` / `sync`: skip symlinks under contentRoots with `skipped symlink: …` (do not fail the gate)
- `sync`: import NEW/CHANGED sources and translate them; translations stay unapproved (publish still requires review)
- `hooks install`: opt-in pre-commit via `git rev-parse --git-path hooks` (mode 0755) running only `polygit check`; never overwrites; never runs sync
- Docs: GitHub Actions example running `polygit check` on pull requests
- `init`: guided setup on TTY; flags `--source-lang`, `--target-langs`, `--content`, `--output` (flags override `--preset`); non-TTY keeps defaults with a warning
- `config get` / `config set` for `sourceLang`, `targetLangs`, `contentRoots`, `outputRoot`, `outputMode`, `autoTranslate`
- Config field `autoTranslate` (default `false`); use with `sync` in your workflow — does not install hooks
- `check`: real content lint — NEW (unimported), CHANGED (SHA-256 since import), pending/stale, and missing outputs; optional `--lang` (defaults to all `targetLangs`); `--json` for CI
- Schema v5: `documents.content_hash` (migration from v4 preserves existing rows; null hash = CHANGED until re-import)
- `isManagedOutputPath`: detect sidecar / in-place-locale outputs by language so they are not reported as NEW

## 1.2.3

- `review`: interactive `A` / `aa` / `all` approves the current segment and all remaining with a TARGET
- `review --approve-all`: bulk-approve without a TTY prompt
- `translate` / `review`: on `main`/`master`, auto-create `polygit/translate-<lang>-YYYYMMDD` for translation work
- `publish`: reuse that branch and open a PR/MR to main when translations are approved
- `translate` / `review` `--no-branch` to opt out
- Docs: rewrite README (hook + features); full flags in `COMMANDS.md`
- CI: expand test files with `find`; drop flaky coverage reporter on Node 20

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
