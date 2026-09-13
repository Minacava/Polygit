import fs from "node:fs";
import path from "node:path";
import {
  CONFIG_FILENAME,
  DEFAULT_CONFIG,
  findProjectRoot,
  openProjectDb,
  writeConfig,
} from "../core/project.js";
import { ensureGitRepo } from "../git/git.js";

const PROJECT_GITIGNORE = `# Polygit local state — do not commit
.tm/
.env
.env.*
!.env.example
`;

const PROJECT_ENV_EXAMPLE = `# Copy to .env and fill in only what you use.
# Never commit real API keys or tokens.

# Cloud LLM providers (optional — only when TM has no match)
ANTHROPIC_API_KEY=
OPENAI_API_KEY=

# Local models via Ollama (install + ollama serve; no API key)
# Prefer: polygit models use ollama <tag>
# OLLAMA_HOST=http://127.0.0.1:11434
# POLYGIT_OLLAMA_MODEL=llama3.2

# Hugging Face Inference Providers
HF_TOKEN=
# HUGGINGFACE_TOKEN=   # alias for HF_TOKEN
# Prefer: polygit models use huggingface <org/model>
# POLYGIT_HF_MODEL=meta-llama/Meta-Llama-3-8B-Instruct

# Optional cloud model overrides (or use \`polygit models use\`)
# POLYGIT_CLAUDE_MODEL=claude-3-5-haiku-latest
# POLYGIT_OPENAI_MODEL=gpt-4o-mini

# Forge tokens for \`polygit publish\`
GITHUB_TOKEN=
# GH_TOKEN=
GITLAB_TOKEN=
# GL_TOKEN=
`;

export async function runInit(cwd = process.cwd()): Promise<void> {
  const existing = findProjectRoot(cwd);
  if (existing && path.resolve(existing) === path.resolve(cwd)) {
    console.log(`Polygit project already initialized at ${existing}`);
    return;
  }

  const root = path.resolve(cwd);
  fs.mkdirSync(path.join(root, "sources"), { recursive: true });
  fs.mkdirSync(path.join(root, "outputs"), { recursive: true });
  fs.mkdirSync(path.join(root, ".tm"), { recursive: true });

  if (!fs.existsSync(path.join(root, CONFIG_FILENAME))) {
    writeConfig(root, { ...DEFAULT_CONFIG });
  }

  const gitignorePath = path.join(root, ".gitignore");
  if (!fs.existsSync(gitignorePath)) {
    fs.writeFileSync(gitignorePath, PROJECT_GITIGNORE, "utf8");
  }

  const envExamplePath = path.join(root, ".env.example");
  if (!fs.existsSync(envExamplePath)) {
    fs.writeFileSync(envExamplePath, PROJECT_ENV_EXAMPLE, "utf8");
  }

  // Ensure DB schema exists.
  openProjectDb(root).close();

  const createdGit = await ensureGitRepo(root);
  console.log(`Initialized Polygit project in ${root}`);
  console.log(
    `  created: sources/, outputs/, ${CONFIG_FILENAME}, .tm/db.sqlite, .gitignore, .env.example`,
  );
  if (createdGit) console.log("  created: git repository");
}
