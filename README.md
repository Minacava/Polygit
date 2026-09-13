# Polygit

**Local-first CLI for assisted translation.**

Keep sources and translations in Git. Reuse a translation memory. Enforce a glossary. Call an LLM only when the TM misses — **Claude**, **OpenAI**, **Ollama (local)**, or **Hugging Face**.

Translate on your machine → approve in the terminal → open a **GitHub PR** or **GitLab MR** for remote review.

---

## Install

```bash
npm install -g polygit
# or one-off:
npx polygit <command>
```

Requires **Node.js 20+**.

---

## Use case 1 — Translate locally with Ollama (no API key)

```bash
# 0. Install and start Ollama, then pull a model
#    https://ollama.com
ollama pull llama3.2
ollama serve          # if it is not already running

# 1. Create a Polygit project
mkdir my-docs && cd my-docs
polygit init

# 2. Add a source file
cp /path/to/intro.md sources/intro.md

# 3. Import segments
polygit import sources/intro.md --format=markdown

# 4. Pick Ollama as default provider + model
polygit models use ollama llama3.2

# 5. Translate (TM first, then Ollama on misses)
polygit translate fr

# 6. Review in the terminal (edits are written to outputs/)
polygit review --lang=fr

# 7. Commit sources + outputs together
polygit commit --yes
```

`init` creates `.env.example` and a `.gitignore` that ignores `.env` and `.tm/`. Copy `.env.example` → `.env` only if you later add cloud keys or forge tokens.

---

## Use case 2 — Contribute translations via PR / MR

```bash
# 1. Fork the upstream repo on GitHub or GitLab, then clone YOUR fork
polygit clone https://github.com/YOU/docs.git
cd docs

# 2. Configure a provider (Ollama local, or a cloud key in .env)
cp .env.example .env
# Optional cloud: ANTHROPIC_API_KEY / OPENAI_API_KEY / HF_TOKEN
# Forge token for publish:
#   GITHUB_TOKEN=...   or   GITLAB_TOKEN=...
polygit models use ollama llama3.2   # example

# 3. Import → translate → approve everything you will publish
polygit import sources/intro.md --format=markdown
polygit translate fr
polygit review --lang=fr

# 4. Push a branch and open a PR (GitHub) or MR (GitLab)
polygit publish --lang=fr --yes
```

**Publish gate:** every translated segment for that language must be **approved** in `review` (or pass `--allow-unapproved`).

Push uses your normal Git credentials (SSH / HTTPS). Opening the PR/MR uses `GITHUB_TOKEN` / `GH_TOKEN` or `GITLAB_TOKEN` / `GL_TOKEN`.

If you cannot push to upstream: work on **your fork**; the PR/MR opens from the fork.

---

## Use case 3 — Team workflow (Claude / OpenAI + glossary)

```bash
polygit init
cp .env.example .env
# Set ANTHROPIC_API_KEY or OPENAI_API_KEY

polygit import sources/intro.md --format=markdown
polygit models use claude claude-3-5-haiku-latest
polygit translate fr

# Prefer consistent product terms
polygit glossary add "Sign in" "Se connecter" --lang=fr
polygit glossary sync --lang=fr --auto-retranslate

# Re-check stale / new machine output
polygit review --lang=fr --status=stale
polygit commit --yes
polygit publish --lang=fr --yes
```

---

## Second language

Segment work is **per language**. After French is done you can still run:

```bash
polygit translate es
polygit review --lang=es
```

Segments already translated for `fr` are translated again for `es` when `es` has no translation yet (or when a segment is marked stale).

---

## Commands (quick reference)

| Command | What it does |
| --- | --- |
| `init` | Create `sources/`, `outputs/`, `.tmconfig.json`, `.tm/`, `.gitignore`, `.env.example` |
| `clone <url>` | Clone a repo and run `init` (unless `--no-init`) |
| `import <file>` | Split a file under `sources/` into segments |
| `translate <lang>` | TM exact → TM fuzzy → LLM; write `outputs/<lang>/` |
| `models list` | Show effective models (+ local Ollama tags) |
| `models use <provider> <model>` | Save model **and** set default provider |
| `glossary add` / `glossary sync` | Preferred terms; sync marks stale (optional retranslate) |
| `review --lang=<lang>` | Approve / edit in the terminal (updates `outputs/`) |
| `commit` | Commit only `sources/` + `outputs/` |
| `publish` | After approval: commit → push branch → GitHub PR or GitLab MR |
| `status` | Pending / stale / translated / approved counts per document |

### Useful flags

```bash
polygit translate fr --provider=ollama --model=mistral --dry-run
polygit translate fr --doc=sources/intro.md
polygit review --lang=fr --status=translated
polygit publish --lang=fr --draft --yes
polygit publish --lang=fr --allow-unapproved   # skip local approval (not recommended)
```

---

## Providers & models

| Provider | Auth | Default model |
| --- | --- | --- |
| `claude` | `ANTHROPIC_API_KEY` | `claude-3-5-haiku-latest` |
| `openai` | `OPENAI_API_KEY` | `gpt-4o-mini` |
| `ollama` | none (local) | `llama3.2` (or the only installed tag) |
| `huggingface` | `HF_TOKEN` | `meta-llama/Meta-Llama-3-8B-Instruct` |

**How Polygit chooses a model**

1. `--model` on the command  
2. `.tmconfig.json` → `models.<provider>` (from `models use`)  
3. Env `POLYGIT_CLAUDE_MODEL` / `POLYGIT_OPENAI_MODEL` / `POLYGIT_OLLAMA_MODEL` / `POLYGIT_HF_MODEL`  
4. Ollama: auto-pick if exactly one local model; interactive picker if several  
5. Built-in default  

```bash
polygit models list
polygit models list --provider=ollama
polygit models use ollama qwen2.5:7b
```

---

## Configuration

### `.tmconfig.json` (created by `init`)

```json
{
  "sourceLang": "en",
  "targetLangs": ["fr"],
  "defaultProvider": "ollama",
  "models": {
    "ollama": "llama3.2"
  }
}
```

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

Polygit does **not** log you into GitHub/GitLab. It reuses Git + a forge token.

| Action | What you need |
| --- | --- |
| `clone` public repo | Nothing special |
| `clone` private repo | Git credentials with read access |
| Local work | No forge account |
| `publish` | Git push access **and** `GITHUB_TOKEN` or `GITLAB_TOKEN` |

Non-`github.com` remotes are treated as **GitLab** (including self-hosted).

---

## Supported formats

| Format | Flag |
| --- | --- |
| Markdown | `--format=markdown` |
| JSON i18n (leaf strings) | `--format=json-i18n` |

---

## Develop from this repo

```bash
git clone https://github.com/Minacava/Polygit.git
cd Polygit
npm install
npm run build
npm test
```

---

## License

[MIT](LICENSE) © Marina Camacho
