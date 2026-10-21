# polygit

[![npm version](https://img.shields.io/npm/v/polygit.svg)](https://www.npmjs.com/package/polygit)

**Local-first CLI for assisted translation.**

Keep sources and translations in Git. Reuse a translation memory. Enforce a glossary. Call an LLM only when the TM misses — **Claude**, **OpenAI**, **Ollama (local)**, or **Hugging Face**.

Translate on your machine → approve in the terminal → open a **GitHub PR** or **GitLab MR** for remote review.

## Index

1. [Install](#install)
2. [Use cases](#use-cases)
3. [Quick start](#quick-start)
4. [Paste into Cursor (example)](#paste-into-cursor-example)
5. [Command reference](#command-reference)
   - [init](#init) · [clone](#clone) · [import](#import) · [translate](#translate)
   - [models](#models) · [glossary](#glossary) · [review](#review)
   - [commit](#commit) · [log](#log) · [publish](#publish)
   - [status](#status) · [check](#check) · [export-tmx](#export-tmx)
6. [Providers & models](#providers--models)
7. [Configuration](#configuration)
8. [Access & permissions](#access--permissions)
9. [Supported formats](#supported-formats)
10. [License](#license)

---

## Install

Published on npm: [polygit](https://www.npmjs.com/package/polygit)

```bash
# Project-local (recommended)
npm install -D polygit
npx polygit --help

# Or global
npm install -g polygit
polygit --help
```

Requires **Node.js 20+**.

---

## Use cases

polygit fits anywhere translations should live **next to the source, in Git**, be reviewed by a human, and avoid paying an LLM twice for the same sentence.

| Scenario | Why polygit fits | Setup |
| --- | --- | --- |
| **Documentation sites** (VitePress, Docusaurus, plain Markdown) | Presets map your `docs/` tree; translations land where the framework expects them | `init --preset=vitepress` |
| **App UI strings** (JSON i18n files) | Every string leaf is a segment; keys and structure are preserved | `init --preset=json-i18n` |
| **Scientific & academic writing** (papers, abstracts, lab protocols, grant summaries) | Keep drafts in Git; lock domain terms in the glossary; run Ollama locally so unpublished work never leaves the lab | `glossary add` + `models use ollama` → `translate` → `review` |
| **Sensitive or internal content** | Run fully local with Ollama — nothing leaves your machine | `models use ollama <tag>` |
| **Contributing translations upstream** | Clone your fork, translate, approve, open a PR/MR in one flow | `clone` → `publish` |
| **Consistent product terminology** | Glossary terms are injected into prompts; changing a term marks affected segments stale | `glossary add` / `sync` |
| **Lower LLM cost on changing content** | Exact translation-memory hits are reused; only new text goes to the LLM | `translate <lang>` |

> **Current limits:** Supported formats are Markdown, JSON i18n, Gettext PO, YAML i18n, and XLIFF 1.2. Complex Markdown (tables, lists, front matter) is segmented best-effort — review those files carefully. Always approve output in `review` before publishing.

---

## Quick start

### Private, offline translation (Ollama)

```bash
ollama pull llama3.2 && ollama serve   # if needed

mkdir my-docs && cd my-docs
npx polygit init
mkdir -p sources && cp /path/to/intro.md sources/intro.md

npx polygit import sources/intro.md --format=markdown
npx polygit models use ollama llama3.2
npx polygit translate fr          # on main → creates polygit/translate-fr-YYYYMMDD
npx polygit review --lang=fr      # approve; then hints to publish
npx polygit publish --lang=fr --yes   # push branch + open PR to main
npx polygit log --stat
```

`translate` / `review` auto-create a **`polygit/translate-<lang>-YYYYMMDD`** branch when you are on `main`/`master`, so translation work stays off the default branch. When everything is approved, `publish` pushes that branch and opens a **PR/MR into main**. Use `--no-branch` to stay on `main` if you really want to.

`init` creates `.tmconfig.json`, `sources/`, `outputs/`, `.tm/`, `.gitignore`, and `.env.example`. Copy `.env.example` → `.env` only if you add cloud keys or forge tokens.

### Contribute upstream (PR / MR)

```bash
npx polygit clone https://github.com/YOU/docs.git
cd docs
cp .env.example .env   # add GITHUB_TOKEN or GITLAB_TOKEN for publish
npx polygit models use ollama llama3.2
npx polygit import sources/intro.md --format=markdown
npx polygit translate fr && npx polygit review --lang=fr
npx polygit publish --lang=fr --yes
```

### Second language

Work is **per language**. After `fr` you can run `translate es` / `review --lang=es` without re-init. Segments missing `es` (or marked stale) are translated again.

---

## Paste into Cursor (example)

Copy the block below into a **Cursor Agent** chat in your project. Change `es` (or `fr` / `ca`) and the model if you want. The agent should install polygit locally, put your README under `sources/`, import, translate, and leave outputs ready for review.

````md
Use polygit in this repo to translate the project README.

1. If needed: `npm install -D polygit@latest` (Node 20+).
2. Run `npx polygit init` if `.tmconfig.json` is missing.
3. Ensure Ollama is running (`ollama serve`) and a model is available, e.g. `ollama pull llama3.2`.
4. Create `sources/` if needed and copy the root `README.md` to `sources/readme.md`
   (do not invent content — use the real README).
5. Run:
   - `npx polygit import sources/readme.md --format=markdown`
   - `npx polygit models use ollama llama3.2`
   - `npx polygit translate es`
6. Show me `npx polygit status --lang=es` and list files under `outputs/es/`.
7. Do **not** run `review` or `commit` unless I ask — leave translations for me to approve.

If Ollama is unavailable, stop and tell me how to set `HF_TOKEN` / `ANTHROPIC_API_KEY` instead.
````

Optional follow-up after you like the draft:

```text
Run npx polygit review --lang=es interactively is not needed —
instead summarize what changed in outputs/es/readme.md,
then npx polygit commit --ai --yes and npx polygit log --stat.
```

---

## Command reference

Jump: [init](#init) · [clone](#clone) · [import](#import) · [translate](#translate) · [models](#models) · [glossary](#glossary) · [review](#review) · [commit](#commit) · [log](#log) · [publish](#publish) · [status](#status) · [check](#check) · [export-tmx](#export-tmx)

### `init`

Create a polygit project in the current directory.

```bash
polygit init
polygit init --preset=vitepress      # docs/ + in-place-locale
polygit init --preset=docusaurus
polygit init --preset=json-i18n      # locales/ + in-place-locale
```

| Flag | Description |
| --- | --- |
| `--preset <name>` | Layout preset: `vitepress` \| `docusaurus` \| `json-i18n`. Default: `sources/` → `outputs/<lang>/` mirror |

Creates: `.tmconfig.json`, content dirs, `.tm/db.sqlite`, `.gitignore`, `.env.example`.

### `clone`

Clone a GitHub/GitLab repo and run `init` (unless disabled).

```bash
polygit clone https://github.com/YOU/docs.git
polygit clone git@gitlab.com:org/docs.git --dir=./docs
polygit clone https://github.com/YOU/docs.git --no-init
```

| Flag | Description |
| --- | --- |
| `--dir <path>` | Target directory (default: repo name) |
| `--no-init` | Skip `polygit init` after clone |

### `import`

Import files into the translation DB as pending segments.

```bash
polygit import sources/intro.md --format=markdown
polygit import "docs/**/*.md"
polygit import --root=docs --format=markdown
polygit import sources/messages.po
polygit import locales/en.yml --format=yaml
```

| Flag / arg | Description |
| --- | --- |
| `<path>` | File or glob under `contentRoots` |
| `--root <dir>` | Import all known files under this directory |
| `--format <fmt>` | `markdown` \| `json-i18n` \| `po` \| `yaml` \| `xliff` |

### `translate`

Translate pending/stale segments for a language. TM exact hits first; fuzzy skips to LLM unless `--accept-fuzzy`. On a TTY, shows a progress bar for LLM segments.

```bash
polygit translate fr
polygit translate fr --provider=ollama --model=mistral
polygit translate fr --doc=sources/intro.md
polygit translate fr --dry-run
polygit translate fr --accept-fuzzy
```

| Flag / arg | Description |
| --- | --- |
| `<lang>` | Target language code (`fr`, `es`, `ca`, …) |
| `--doc <path>` | Limit to one source document |
| `--provider <name>` | `claude` \| `openai` \| `ollama` \| `huggingface` |
| `--model <id>` | One-off model override |
| `--dry-run` | Plan only — no writes, no LLM calls |
| `--accept-fuzzy` | Apply fuzzy TM as unapproved drafts (skip LLM) |
| `--no-branch` | Do not auto-create/checkout `polygit/translate-<lang>-…` when on main/master |

### `models`

List and select LLM models (saved in `.tmconfig.json`).

```bash
polygit models list
polygit models list --provider=ollama
polygit models use ollama llama3.2
polygit models use claude claude-haiku-4-5
polygit models use huggingface BSC-LT/salamandra-7b-instruct
```

| Subcommand | Description |
| --- | --- |
| `list [--provider=…]` | Show effective models (+ local Ollama tags) |
| `use <provider> <model>` | Save model **and** set `defaultProvider` |

### `glossary`

Preferred terminology injected into LLM prompts. Sync marks matching segments stale.

```bash
polygit glossary add "Sign in" "Se connecter" --lang=fr
polygit glossary add "API key" "clé API" --lang=fr --note="product term"
polygit glossary sync --lang=fr
polygit glossary sync --lang=fr --auto-retranslate
```

| Subcommand | Flags | Description |
| --- | --- | --- |
| `add <source> <target>` | `--lang` (required), `--note` | Add/update a term |
| `sync` | `--lang`, `--auto-retranslate` | Mark glossary-linked segments stale; optionally retranslate |

### `review`

Interactively approve or edit translations. Writes approved text back to output files. `--lang` is required.

At the start of the session polygit prints this key table (and the prompt is `Action [a/e/s/q] >`):

| Key | Action | Meaning |
| --- | --- | --- |
| `a` | approve | Keep the current TARGET and mark it approved |
| `e` | edit | Type a new TARGET, then save and approve |
| `s` | skip | Leave this segment unchanged (Enter also skips) |
| `q` | quit | Stop the review session |

```bash
polygit review --lang=fr
polygit review --lang=fr --status=translated
polygit review --lang=fr --status=stale
```

| Flag | Description |
| --- | --- |
| `--lang <lang>` | Language to review (**required**) |
| `--status <s>` | Filter: `pending` \| `translated` \| `stale` \| `approved` |
| `--no-branch` | Do not auto-create/checkout `polygit/translate-<lang>-…` when on main/master |

When no unapproved segments remain, review prints a reminder to run `polygit publish --lang=<lang> --yes` (opens a PR to main).

### `commit`

Commit only configured content roots (e.g. `sources/` + `outputs/`). Never stages `.tm/` or `.env`.

```bash
# Explicit message (scripts / CI)
polygit commit --message "translate(fr): add intro" --yes

# Interactive: type a message (Enter = dated default), then confirm
polygit commit

# LLM drafts a one-line message from the diff
polygit commit --ai
polygit commit --ai --yes
```

| Flag | Description |
| --- | --- |
| `--message <msg>` | Fixed commit message |
| `--ai` | Generate message from the diff via the configured LLM; in TTY you can accept, edit (`e`), or decline |
| `--yes` | Skip “Proceed?” confirmation (required when stdin is not a TTY) |

| Mode | When to use |
| --- | --- |
| `--message` + `--yes` | You already know the message |
| Interactive `commit` | You want to type/review the message |
| `--ai` | Let the model draft `translate(fr): …` from the diff |

### `log`

Show recent Git commits that touch translation roots.

```bash
polygit log
polygit log --stat
polygit log --limit 10
polygit log --grep-translate
```

| Flag | Description |
| --- | --- |
| `--limit <n>` | Max commits (default `20`) |
| `--stat` | List files changed in each commit |
| `--grep-translate` | Also include commits whose subject matches `translate:` / `translate(` |

### `publish`

After local approval: commit (if needed) → push the translation branch → open a **GitHub PR or GitLab MR into main** (or `--target-branch`).

If you already ran `translate`/`review` on `polygit/translate-<lang>-…`, publish reuses that branch instead of creating a second one.

```bash
polygit publish --lang=fr --yes
polygit publish --lang=fr --draft --yes
polygit publish --lang=fr --forge=gitlab --yes
polygit publish --lang=fr --title="French docs" --body="…" --yes
polygit publish --lang=fr --allow-unapproved   # not recommended
```

| Flag | Description |
| --- | --- |
| `--lang <lang>` | Language being published (**required**) |
| `--forge <kind>` | `github` \| `gitlab` (required for Enterprise/self-hosted) |
| `--confirm-forge-host` | Allow tokens to a non-github.com / non-gitlab.com host |
| `--branch <name>` | Source branch to push |
| `--target-branch <name>` | Base branch for the PR/MR |
| `--title` / `--body` | PR/MR title and description |
| `--draft` | Open as draft |
| `--yes` | Skip commit confirmation |
| `--allow-unapproved` | Skip the local-approval gate |

**Gate:** every segment for that language must be **approved** in `review` (unless `--allow-unapproved`). Push uses your Git credentials; opening the PR/MR needs `GITHUB_TOKEN` / `GH_TOKEN` or `GITLAB_TOKEN` / `GL_TOKEN`.

### `status`

Show layout roots and per-document / per-language counts.

```bash
polygit status
polygit status --lang=fr
```

| Flag | Description |
| --- | --- |
| `--lang <lang>` | Focus on one language |

### `check`

CI gate: exit non-zero if any segment is pending or stale for a language.

```bash
polygit check --lang=fr
```

| Flag | Description |
| --- | --- |
| `--lang <lang>` | Language to check (**required**) |

### `export-tmx`

Export translation memory as TMX 1.4.

```bash
polygit export-tmx --lang=fr
polygit export-tmx --lang=fr --out=tm-fr.tmx
```

| Flag | Description |
| --- | --- |
| `--lang <lang>` | Target language (**required**) |
| `--out <path>` | Output file (default `tm-<lang>.tmx`) |

---

## Providers & models

| Provider | Auth | Default model |
| --- | --- | --- |
| `claude` | `ANTHROPIC_API_KEY` | `claude-haiku-4-5` |
| `openai` | `OPENAI_API_KEY` | `gpt-4o-mini` |
| `ollama` | none (local) | `llama3.2` (or the only installed tag) |
| `huggingface` | `HF_TOKEN` | `meta-llama/Meta-Llama-3-8B-Instruct` |

**How polygit chooses a model**

1. `--model` on the command  
2. `.tmconfig.json` → `models.<provider>` (from `models use`)  
3. Env `POLYGIT_CLAUDE_MODEL` / `POLYGIT_OPENAI_MODEL` / `POLYGIT_OLLAMA_MODEL` / `POLYGIT_HF_MODEL`  
4. Ollama: auto-pick if exactly one local model; interactive picker if several  
5. Built-in default  

Untagged Ollama ids (e.g. `llama3.2`) match tagged installs (e.g. `llama3.2:latest`).

---

## Configuration

### `.tmconfig.json` (created by `init`)

```json
{
  "sourceLang": "en",
  "targetLangs": ["fr"],
  "contentRoots": ["sources"],
  "outputMode": "mirror",
  "outputRoot": "outputs",
  "defaultProvider": "ollama",
  "models": {
    "ollama": "llama3.2"
  }
}
```

| Field | Meaning |
| --- | --- |
| `contentRoots` | Where source files live (default `["sources"]`) |
| `outputMode` | How translations are written (see below) |
| `outputRoot` | Used when `outputMode` is `mirror` (default `outputs`) |

| `outputMode` | Example for `docs/getting-started.md` → `fr` |
| --- | --- |
| `mirror` | `locales/fr/getting-started.md` (with `"outputRoot": "locales"`) |
| `sidecar` | `docs/getting-started.fr.md` |
| `in-place-locale` | `docs/fr/getting-started.md` |

Paths outside `contentRoots` fail with a clear error — add the folder to config or pass `--root`.

### `.env` (from `.env.example`)

```bash
ANTHROPIC_API_KEY=
OPENAI_API_KEY=
HF_TOKEN=
# OLLAMA_HOST=http://127.0.0.1:11434

GITHUB_TOKEN=
GITLAB_TOKEN=
```

**Do not commit `.env` or `.tm/`.** `init` adds them to `.gitignore`.

---

## Access & permissions

polygit does **not** log you into GitHub/GitLab. It reuses Git + a forge token.

| Action | What you need |
| --- | --- |
| `clone` public repo | Nothing special |
| `clone` private repo | Git credentials with read access |
| Local work | No forge account |
| `publish` | Git push access **and** `GITHUB_TOKEN` or `GITLAB_TOKEN` |

Only **github.com** and **gitlab.com** are trusted automatically for forge API tokens. Enterprise or self-hosted remotes require `--forge=github|gitlab` and either `--confirm-forge-host` or a `forgeHosts` entry in `.tmconfig.json`. API calls always use HTTPS.

---

## Supported formats

| Format | Flag / extensions |
| --- | --- |
| Markdown | `--format=markdown` (`.md`, `.markdown`) |
| JSON i18n (leaf strings) | `--format=json-i18n` (`.json`) |
| Gettext PO | `--format=po` (`.po`, `.pot`) |
| YAML i18n (`key: value`) | `--format=yaml` (`.yaml`, `.yml`) |
| XLIFF 1.2 | `--format=xliff` (`.xliff`, `.xlf`) |

---

## License

[MIT](LICENSE) © Marina Camacho
