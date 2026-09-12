# Polygit

**Local-first CLI for assisted translation.**  
Keep sources and translations in Git, reuse a translation memory, enforce a glossary, and call Claude or OpenAI only when you need them — no SaaS CAT tool required.

Polygit is aimed at freelancers, small teams, and open-source projects that translate documentation, websites, or app strings without standing up extra infrastructure.

---

## Why Polygit

| Problem | What Polygit does |
| --- | --- |
| Heavy or paid platforms (MateCat, Trados, …) | Runs on your machine as a small CLI |
| Translations drift when terminology changes | Glossary sync marks affected segments project-wide |
| Translation history lives in a black box | Sources + outputs are normal Git commits |
| Every sentence hits an LLM | Exact / fuzzy TM matches first; LLM is the fallback |

---

## Requirements

- **Node.js 20+**
- A Git repository (Polygit can initialize one on `init`)
- Optional: an API key for [Anthropic (Claude)](https://www.anthropic.com/) or [OpenAI](https://openai.com/) when translating without a TM hit

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
npx polygit commit
```

Translated files appear under `outputs/fr/`, mirroring the `sources/` tree.

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
4. **Commit** versions `sources/` and `outputs/` together with a clear, auto-generated message.

Everything stays on disk. There is no Polygit cloud database.

---

## Commands

### `init`

Bootstrap a project.

```bash
npx polygit init
```

Creates `sources/`, `outputs/`, `.tmconfig.json`, and `.tm/db.sqlite`. Initializes a Git repo if one is not already present.

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
| `--provider=claude\|openai` | LLM used when TM misses |
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
npx polygit commit --auto   # commit without interactive confirm
```

Example generated message:

```text
translate: 12 segments updated in outputs/fr/intro.md
```

Local database files (`.tm/`) and `.env` are never staged by this command.

---

### `status`

Coverage overview per language and document.

```bash
npx polygit status
```

Shows counts for **pending**, **stale**, **translated**, and **approved** segments.

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
```

Only set the provider(s) you use. **Do not commit `.env`.**

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

Tests live under `test/`, mirroring `src/` (`test/core`, `test/parsers`, `test/connectors`) plus a CLI smoke test. Run them with `npm test` (builds first, then `node --test`).

---

## License

[MIT](LICENSE) © Marina Camacho
