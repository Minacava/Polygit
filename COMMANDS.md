# polygit — command reference

Full flags and examples. For the product overview, see [README.md](README.md).

Jump: [init](#init) · [clone](#clone) · [import](#import) · [translate](#translate) · [models](#models) · [glossary](#glossary) · [review](#review) · [commit](#commit) · [log](#log) · [publish](#publish) · [status](#status) · [check](#check) · [export-tmx](#export-tmx)

---

## `init`

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

Creates: `.tmconfig.json`, content dirs, `.tm/db.sqlite`, `.gitignore`, `.env.example`. Initializes a Git repo if needed.

---

## `clone`

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

---

## `import`

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

---

## `translate`

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

---

## `models`

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

---

## `glossary`

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

---

## `review`

Interactively approve or edit translations. Writes approved text back to output files. `--lang` is required.

At the start of the session polygit prints this key table (prompt: `Action [a/A/e/s/q] >`):

| Key | Action | Meaning |
| --- | --- | --- |
| `a` | approve | Keep the current TARGET and mark it approved |
| `A` | approve-all | Approve this and all remaining segments that have a TARGET (`aa` / `all` also work) |
| `e` | edit | Type a new TARGET, then save and approve |
| `s` | skip | Leave this segment unchanged (Enter also skips) |
| `q` | quit | Stop the review session |

```bash
polygit review --lang=fr
polygit review --lang=fr --status=translated
polygit review --lang=fr --status=stale
polygit review --lang=fr --approve-all
```

| Flag | Description |
| --- | --- |
| `--lang <lang>` | Language to review (**required**) |
| `--status <s>` | Filter: `pending` \| `translated` \| `stale` \| `approved` |
| `--approve-all` | Approve every listed segment that already has a TARGET (no interactive prompt) |
| `--no-branch` | Do not auto-create/checkout `polygit/translate-<lang>-…` when on main/master |

When no unapproved segments remain, review prints a reminder to run `polygit publish --lang=<lang> --yes` (opens a PR to main).

---

## `commit`

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

---

## `log`

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

---

## `publish`

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

---

## `status`

Show layout roots and per-document / per-language counts.

```bash
polygit status
polygit status --lang=fr
```

| Flag | Description |
| --- | --- |
| `--lang <lang>` | Focus on one language |

---

## `check`

CI gate: exit non-zero if any segment is pending or stale for a language.

```bash
polygit check --lang=fr
```

| Flag | Description |
| --- | --- |
| `--lang <lang>` | Language to check (**required**) |

---

## `export-tmx`

Export translation memory as TMX 1.4.

```bash
polygit export-tmx --lang=fr
polygit export-tmx --lang=fr --out=tm-fr.tmx
```

| Flag | Description |
| --- | --- |
| `--lang <lang>` | Target language (**required**) |
| `--out <path>` | Output file (default `tm-<lang>.tmx`) |
