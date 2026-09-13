# Polygit

**Local-first CLI for assisted translation.**  
Keep sources and translations in Git, reuse a translation memory, enforce a glossary, and call Claude or OpenAI only when you need them — no SaaS CAT tool required.

Translate locally, approve in the terminal, then open a **GitHub pull request** or **GitLab merge request** for remote review and merge. Works with `github.com`, `gitlab.com`, and self-hosted GitLab.

Polygit is aimed at freelancers, small teams, and open-source projects that translate documentation, websites, or app strings without standing up extra infrastructure.

---

## Why Polygit

| Problem | What Polygit does |
| --- | --- |
| Heavy or paid platforms (MateCat, Trados, …) | Runs on your machine as a small CLI |
| Translations drift when terminology changes | Glossary sync marks affected segments project-wide |
| Translation history lives in a black box | Sources + outputs are normal Git commits |
| Every sentence hits an LLM | Exact / fuzzy TM matches first; LLM is the fallback |
| No bridge from local CAT work to team review | `publish` opens a GitHub PR or GitLab MR after local approval |

---

## Requirements

- **Node.js 20+**
- A Git repository (Polygit can initialize one on `init`, or clone with `polygit clone`)
- Optional: an LLM backend when translation memory has no match (see [LLM providers](#llm-providers))
- Optional (for `publish`): `GITHUB_TOKEN` / `GH_TOKEN` or `GITLAB_TOKEN` / `GL_TOKEN`, plus normal Git credentials to push

---

## Install

```bash
# One-off
npx polygit <command>

# Global install
npm install -g polygit
polygit <command>
```

From a clone of this repository:

```bash
npm install
npm run build
npm link   # optional: exposes `polygit` on your PATH
```

---

## Quick start

### Local project

```bash
# 1. Create a Polygit project in the current directory
npx polygit init

# 2. Add a source document
mkdir -p sources
cp ./docs/intro.md sources/intro.md

# 3. Import and segment it
npx polygit import sources/intro.md --format=markdown

# 4. Configure an LLM provider (only needed when TM has no match)
cp .env.example .env
# Edit .env and set ANTHROPIC_API_KEY or OPENAI_API_KEY

# 5. Translate to French
npx polygit translate fr --provider=claude

# 6. Review, then commit sources + outputs together
npx polygit review --lang=fr
npx polygit commit --yes
```

Translated files appear under `outputs/fr/`, mirroring the `sources/` tree.

### Clone → translate → remote approval (GitHub or GitLab)

Polygit detects the forge from your `origin` remote URL (`github.com` → GitHub PR; anything else → GitLab MR, including self-hosted).

```bash
# 1. Clone and init
npx polygit clone https://gitlab.com/your-group/docs.git
# or: npx polygit clone https://github.com/you/docs.git
cd docs

# 2. Configure LLM + forge token in .env
cp .env.example .env
# ANTHROPIC_API_KEY / OPENAI_API_KEY
# GITLAB_TOKEN (or GITHUB_TOKEN)

# 3. Translate and approve locally
npx polygit import sources/intro.md --format=markdown
npx polygit translate fr --provider=claude
npx polygit review --lang=fr

# 4. Push a branch and open a PR (GitHub) or MR (GitLab)
npx polygit publish --lang=fr --yes
```

Flow: **local review** gates quality → **remote PR/MR** gates merge.

---

## How it works

```text
sources/                 Original documents (Markdown, JSON i18n, …)
outputs/<lang>/          Generated translations (same relative paths)
.tmconfig.json           Project settings (languages, default provider, …)
.tm/db.sqlite            Local SQLite: segments, TM, glossary
.env                     API keys (never commit this file)
```

1. **Import** splits each document into **segments** (sentence/block units) with stable IDs.
2. **Translate** looks up the translation memory (exact, then fuzzy). Misses go to the configured LLM.
3. **Glossary** terms are tracked across documents. Updating a term can mark every affected segment as stale.
4. **Commit / publish** versions `sources/` and `outputs/` together. `publish` also pushes a branch and opens a GitHub pull request or GitLab merge request.

Everything stays on disk. There is no Polygit cloud database.

---

## Commands

| Command | Purpose |
| --- | --- |
| `init` | Bootstrap `sources/`, `outputs/`, config, and local SQLite |
| `clone` | Clone a GitHub/GitLab repo and run `init` |
| `import` | Segment a source file |
| `translate` | Translate via TM + optional LLM |
| `glossary` | Add terms / mark stale after terminology changes |
| `review` | Local interactive approval |
| `commit` | Commit `sources/` + `outputs/` together |
| `publish` | Local gate → push branch → GitHub PR or GitLab MR |
| `status` | Coverage counts per document |

---

### `init`

Bootstrap a project.

```bash
npx polygit init
```

Creates `sources/`, `outputs/`, `.tmconfig.json`, and `.tm/db.sqlite`. Initializes a Git repo if one is not already present.

---

### `clone`

Clone a GitHub or GitLab repository, then run `init` in the new directory (unless `--no-init`).

```bash
npx polygit clone https://gitlab.com/group/docs.git
npx polygit clone git@github.com:you/docs.git --dir=./work
npx polygit clone https://gitlab.example.com/team/app.git --no-init
```

| Option | Description |
| --- | --- |
| `--dir=<path>` | Target directory (defaults to the repo name) |
| `--no-init` | Skip `polygit init` after clone |

---

### `import`

Parse a file under `sources/` into segments (`pending`).

```bash
npx polygit import sources/intro.md --format=markdown
npx polygit import sources/en.json --format=json-i18n
```

| Option | Description |
| --- | --- |
| `--format=markdown\|json-i18n` | Parser to use (required when it cannot be inferred) |

---

### `translate`

Translate pending segments for a language. Writes files under `outputs/<lang>/`.

```bash
npx polygit translate fr
npx polygit translate fr --doc=sources/intro.md --provider=claude
npx polygit translate es --provider=openai --dry-run
```

| Option | Description |
| --- | --- |
| `--doc=<path>` | Limit work to one source file |
| `--provider=claude\|openai\|ollama\|huggingface` | LLM used when TM misses |
| `--dry-run` | Show what would be translated without writing |

Lookup order: **TM exact → TM fuzzy → LLM**.

---

### `glossary`

Maintain preferred terminology per language.

```bash
# Add or update a term
npx polygit glossary add "Sign in" "Se connecter" --lang=fr
npx polygit glossary add "workspace" "espace de travail" --lang=fr --note="Product UI label"

# Propagate terminology changes
npx polygit glossary sync --lang=fr
npx polygit glossary sync --lang=fr --auto-retranslate
```

`glossary sync` finds segments (and related TM usage) that contain updated terms and marks them **stale**. With `--auto-retranslate`, Polygit re-runs translation for those segments only.

---

### `review`

Interactive terminal review before treating outputs as final.

```bash
npx polygit review --lang=fr
npx polygit review --lang=fr --status=stale
```

Approve, edit, or skip segments. Useful after a bulk translate or a glossary sync.

---

### `commit`

Commit `sources/` and `outputs/` together.

```bash
npx polygit commit          # show diff, then confirm
npx polygit commit --yes    # commit without interactive confirm
```

Example generated message:

```text
translate: update sources/outputs (2026-09-12)
```

Local database files (`.tm/`) and `.env` are never staged by this command.

---

### `publish`

After **local** review approval: commit translation changes (if any), push a branch, and open a **GitHub pull request** or **GitLab merge request** for remote approval.

```bash
npx polygit publish --lang=fr --yes
npx polygit publish --lang=fr --draft --branch=translate/fr
npx polygit publish --lang=fr --allow-unapproved   # skip local gate (not recommended)
```

| Option | Description |
| --- | --- |
| `--lang=<lang>` | Language label for branch/title |
| `--branch=<name>` | Source branch to push (default: `polygit/translate-<lang>-<date>`) |
| `--target-branch=<name>` | Base branch (default: remote `HEAD`, usually `main`) |
| `--title` / `--body` | PR/MR title and description |
| `--draft` | Open as draft |
| `--yes` | Skip confirmation |
| `--allow-unapproved` | Allow publish when segments are not locally approved |

Requires a forge token in `.env` (`GITHUB_TOKEN` / `GH_TOKEN`, or `GITLAB_TOKEN` / `GL_TOKEN`). Git push still uses your normal Git credentials (SSH key or credential helper).

**Forge detection** (from `origin`):

| Remote host | Opens |
| --- | --- |
| `github.com` | Pull request |
| `gitlab.com` or any other host (e.g. self-hosted GitLab) | Merge request |

---

### `status`

Coverage overview per language and document.

```bash
npx polygit status
```

Shows counts for **pending**, **stale**, **translated**, and **approved** segments.

---

## Access & permissions

Polygit does **not** log you into GitHub/GitLab or grant access you do not already have. It reuses normal Git + a forge API token.

| Action | What you need |
| --- | --- |
| `clone` a **public** repo | Nothing special — plain `git clone` |
| `clone` a **private** repo | Git credentials with **read** access (SSH key, HTTPS PAT, or credential helper) |
| Local work (`import` / `translate` / `review` / `commit`) | No forge account required |
| `publish` (push + open PR/MR) | Git credentials with **write** (push) **and** `GITHUB_TOKEN` or `GITLAB_TOKEN` with permission to create PRs/MRs |

If you **cannot push** to the upstream repo (common for open-source contributions):

1. Fork the project on GitHub/GitLab into your account.
2. `polygit clone` **your fork** (or add your fork as `origin` / a push remote).
3. Translate and `polygit publish` — the PR/MR opens **from your fork** (or from a branch you can push).
4. Maintainers merge after remote review.

Without push access, Polygit can still translate and commit **locally**; only `publish` will fail until credentials and permissions are in place.

---

## Configuration

### `.tmconfig.json`

Created by `init`. Typical fields:

```json
{
  "sourceLang": "en",
  "targetLangs": ["fr", "es"],
  "defaultProvider": "claude"
}
```

### `.env`

Copy from `.env.example`:

```bash
ANTHROPIC_API_KEY=your_key_here
OPENAI_API_KEY=your_key_here
HF_TOKEN=your_hf_token_here
# OLLAMA_HOST=http://127.0.0.1:11434

# For polygit publish (GitHub PR or GitLab MR)
GITHUB_TOKEN=
GITLAB_TOKEN=
```

Only set the provider(s) and forge token(s) you use. **Do not commit `.env`.**

### LLM providers

Polygit uses a small pluggable provider interface. Lookup order is always **TM exact → TM fuzzy → LLM**.

| Provider | Flag / config | Auth | Default model | Notes |
| --- | --- | --- | --- | --- |
| Claude | `--provider=claude` | `ANTHROPIC_API_KEY` | `claude-3-5-haiku-latest` | Anthropic Messages API |
| OpenAI | `--provider=openai` | `OPENAI_API_KEY` | `gpt-4o-mini` | Chat Completions API |
| Ollama | `--provider=ollama` | None (local) | `llama3.2` | Requires [Ollama](https://ollama.com/) installed and running (`ollama serve`) |
| Hugging Face | `--provider=huggingface` | `HF_TOKEN` | `meta-llama/Meta-Llama-3-8B-Instruct` | HF Inference Providers (OpenAI-compatible router) |

Set the default in `.tmconfig.json`:

```json
{
  "defaultProvider": "ollama"
}
```

Override the model with environment variables:

| Variable | Provider |
| --- | --- |
| `POLYGIT_CLAUDE_MODEL` | Claude |
| `POLYGIT_OPENAI_MODEL` | OpenAI |
| `POLYGIT_OLLAMA_MODEL` | Ollama (must be pulled locally, e.g. `ollama pull llama3.2`) |
| `POLYGIT_HF_MODEL` | Hugging Face |
| `OLLAMA_HOST` | Ollama base URL (default `http://127.0.0.1:11434`) |

**Local-first with Ollama:**

```bash
ollama pull llama3.2
ollama serve   # if not already running
npx polygit translate fr --provider=ollama
```

Adding a new cloud or local backend: implement `TranslationProvider` in `src/connectors/` (or reuse `createChatCompletionsProvider` for OpenAI-compatible APIs) and register it in `createProvider`.

---

## Supported formats

| Format | Flag | Notes |
| --- | --- | --- |
| Markdown | `--format=markdown` | Docs and README-style content |
| JSON i18n | `--format=json-i18n` | Leaf string values; keys and structure preserved |

---

## Security & privacy

- Translation memory and glossary live in **local SQLite** (`.tm/db.sqlite`).
- LLM calls go directly from your machine to the provider you configure.
- Keep API keys in `.env` only. `.gitignore` excludes `.env`, `.tm/`, and related local state.
- Prefer reviewing sensitive copy before sending it to a third-party model.
- Forge tokens (`GITHUB_TOKEN`, `GITLAB_TOKEN`) are used only for opening PRs/MRs; they are never written into commits.

---

## Contributing

Issues and pull requests are welcome. Please open an issue before large changes.

```bash
git clone https://github.com/Minacava/Polygit.git
cd Polygit
npm install
npm run typecheck
npm test
```

Tests live under `test/`, mirroring `src/` (`test/core`, `test/parsers`, `test/connectors`, `test/forge`) plus a CLI smoke test. Run them with `npm test` (builds first, then `node --test`).

---

## License

[MIT](LICENSE) © Marina Camacho
