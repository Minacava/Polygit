import fs from "node:fs";
import path from "node:path";
import readline from "node:readline/promises";
import { stdin as input, stdout as output } from "node:process";
import {
  defaultLayoutConfig,
  describeLayout,
  ensureLayoutDirs,
  isLayoutPresetName,
  layoutForPreset,
  LAYOUT_PRESET_NAMES,
  normalizeRootPath,
  parseContentRoots,
  type LayoutConfig,
  type LayoutPresetName,
} from "../core/layout.js";
import {
  assertSourceNotInTargets,
  CONFIG_FILENAME,
  DEFAULT_CONFIG,
  findProjectRoot,
  openProjectDb,
  parseAutoTranslate,
  parseBoolFlag,
  parseLangCsv,
  parseSourceLang,
  writeConfig,
  type TmConfig,
} from "../core/project.js";
import { ensureGitRepo } from "../git/git.js";

const PROJECT_GITIGNORE = `# polygit local state — do not commit
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
# POLYGIT_CLAUDE_MODEL=claude-haiku-4-5
# POLYGIT_OPENAI_MODEL=gpt-4o-mini

# Forge tokens for \`polygit publish\`
GITHUB_TOKEN=
# GH_TOKEN=
GITLAB_TOKEN=
# GL_TOKEN=
`;

export type InitPrompt = (question: string) => Promise<string>;

export interface InitOptions {
  preset?: string;
  /** BCP-47 source language (e.g. en). */
  sourceLang?: string;
  /** Comma-separated target languages. */
  targetLangs?: string;
  /** Comma-separated content root folders. */
  content?: string;
  /** Output root folder (mirror mode) or translations folder hint. */
  output?: string;
  /**
   * Injected prompt for tests / custom UIs. When set, init asks interactively
   * even without a TTY.
   */
  prompt?: InitPrompt;
  /**
   * Force interactive / non-interactive mode (tests). Default: true when a
   * prompt is injected or stdin is a TTY.
   */
  interactive?: boolean;
}

function resolveLayout(presetName?: string): LayoutConfig {
  if (!presetName) return defaultLayoutConfig();
  if (!isLayoutPresetName(presetName)) {
    throw new Error(
      `Unknown preset "${presetName}". Use one of: ${LAYOUT_PRESET_NAMES.join(", ")}.`,
    );
  }
  return layoutForPreset(presetName as LayoutPresetName);
}

function createReadlinePrompt(): InitPrompt {
  const rl = readline.createInterface({ input, output });
  const prompt: InitPrompt = async (question) => {
    const answer = await rl.question(question);
    return answer;
  };
  (prompt as InitPrompt & { close?: () => void }).close = () => rl.close();
  return prompt;
}

async function askUntilValid(
  prompt: InitPrompt,
  question: string,
  parse: (raw: string) => string | string[] | boolean,
): Promise<string | string[] | boolean> {
  for (;;) {
    const raw = await prompt(question);
    try {
      return parse(raw);
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      console.error(`  ${message}`);
    }
  }
}

interface ResolvedInitFields {
  sourceLang: string;
  targetLangs: string[];
  contentRoots: string[];
  outputRoot: string;
  outputMode: LayoutConfig["outputMode"];
  autoTranslate: boolean;
  usedDefaultsWithoutTty: boolean;
}

async function resolveInitFields(
  layout: LayoutConfig,
  options: InitOptions,
): Promise<ResolvedInitFields> {
  const flagSource = options.sourceLang !== undefined;
  const flagTargets = options.targetLangs !== undefined;
  const flagContent = options.content !== undefined;
  const flagOutput = options.output !== undefined;
  const allFlags = flagSource && flagTargets && flagContent && flagOutput;

  let sourceLang = flagSource
    ? parseSourceLang(options.sourceLang)
    : DEFAULT_CONFIG.sourceLang;
  let targetLangs = flagTargets ? parseLangCsv(options.targetLangs ?? "", "targetLangs") : [];
  let contentRoots = flagContent
    ? parseContentRoots(
        (options.content ?? "")
          .split(",")
          .map((s) => s.trim())
          .filter(Boolean),
      )
    : [...layout.contentRoots];
  let outputRoot = flagOutput
    ? normalizeRootPath((options.output ?? "").trim() || DEFAULT_CONFIG.outputRoot)
    : layout.outputRoot;
  let autoTranslate = false;

  if (allFlags) {
    assertSourceNotInTargets(sourceLang, targetLangs);
    return {
      sourceLang,
      targetLangs,
      contentRoots,
      outputRoot,
      outputMode: layout.outputMode,
      autoTranslate: false,
      usedDefaultsWithoutTty: false,
    };
  }

  const hasInjectedPrompt = typeof options.prompt === "function";
  // Programmatic callers (clone, tests) stay non-interactive unless they opt in.
  // The CLI passes interactive: process.stdin.isTTY for the guided wizard.
  const interactive =
    options.interactive !== undefined
      ? options.interactive
      : hasInjectedPrompt;

  if (!interactive) {
    assertSourceNotInTargets(sourceLang, targetLangs);
    console.warn(
      "Non-interactive shell: using defaults for unset init options " +
        `(sourceLang=${sourceLang}, targetLangs=[${targetLangs.join(", ")}], ` +
        `content=${contentRoots.join(",")}, output=${outputRoot}, autoTranslate=false). ` +
        "Pass --source-lang / --target-langs / --content / --output to customize.",
    );
    return {
      sourceLang,
      targetLangs,
      contentRoots,
      outputRoot,
      outputMode: layout.outputMode,
      autoTranslate: false,
      usedDefaultsWithoutTty: true,
    };
  }

  const prompt = options.prompt ?? createReadlinePrompt();
  const shouldClose = !options.prompt;
  try {
    if (!flagSource) {
      sourceLang = (await askUntilValid(
        prompt,
        `? Source language (the language you write in) [${DEFAULT_CONFIG.sourceLang}]: `,
        (raw) => {
          const trimmed = raw.trim();
          return parseSourceLang(trimmed === "" ? DEFAULT_CONFIG.sourceLang : trimmed);
        },
      )) as string;
    }

    if (!flagTargets) {
      targetLangs = (await askUntilValid(
        prompt,
        "? Target languages (comma-separated): ",
        (raw) => parseLangCsv(raw, "targetLangs"),
      )) as string[];
    }

    if (!flagContent) {
      const defaultContent = layout.contentRoots.join(",") || "sources";
      contentRoots = (await askUntilValid(
        prompt,
        `? Folder with source files [${defaultContent}]: `,
        (raw) => {
          const trimmed = raw.trim();
          const parts = (trimmed === "" ? defaultContent : trimmed)
            .split(",")
            .map((s) => s.trim())
            .filter(Boolean);
          return parseContentRoots(parts);
        },
      )) as string[];
    }

    if (!flagOutput) {
      const defaultOutput = layout.outputRoot || "outputs";
      outputRoot = (await askUntilValid(
        prompt,
        `? Folder for translations [${defaultOutput}]: `,
        (raw) => {
          const trimmed = raw.trim();
          return normalizeRootPath(trimmed === "" ? defaultOutput : trimmed);
        },
      )) as string;
    }

    autoTranslate = (await askUntilValid(
      prompt,
      "? Translate new files automatically? (y/N): ",
      (raw) => {
        const trimmed = raw.trim();
        if (trimmed === "") return false;
        return parseBoolFlag(trimmed, "autoTranslate");
      },
    )) as boolean;

    assertSourceNotInTargets(sourceLang, targetLangs);
    // Persist only after validation (autoTranslate already boolean).
    parseAutoTranslate(autoTranslate);

    return {
      sourceLang,
      targetLangs,
      contentRoots,
      outputRoot,
      outputMode: layout.outputMode,
      autoTranslate,
      usedDefaultsWithoutTty: false,
    };
  } finally {
    if (shouldClose) {
      const closer = prompt as InitPrompt & { close?: () => void };
      closer.close?.();
    }
  }
}

export async function runInit(
  cwd = process.cwd(),
  options: InitOptions = {},
): Promise<void> {
  const existing = findProjectRoot(cwd);
  if (existing && path.resolve(existing) === path.resolve(cwd)) {
    console.log(`polygit project already initialized at ${existing}`);
    return;
  }

  const root = path.resolve(cwd);
  const layout = resolveLayout(options.preset);
  const fields = await resolveInitFields(layout, options);

  // Explicit flags override preset layout roots/mode pieces already applied above.
  const finalLayout: LayoutConfig = {
    contentRoots: fields.contentRoots,
    outputMode: fields.outputMode,
    outputRoot: fields.outputRoot,
  };

  ensureLayoutDirs(root, finalLayout);
  fs.mkdirSync(path.join(root, ".tm"), { recursive: true });

  if (!fs.existsSync(path.join(root, CONFIG_FILENAME))) {
    const config: TmConfig = {
      ...DEFAULT_CONFIG,
      sourceLang: fields.sourceLang,
      targetLangs: fields.targetLangs,
      contentRoots: [...fields.contentRoots],
      outputMode: fields.outputMode,
      outputRoot: fields.outputRoot,
      autoTranslate: fields.autoTranslate,
    };
    writeConfig(root, config);
  }

  ensureGitignore(root);

  const envExamplePath = path.join(root, ".env.example");
  if (!fs.existsSync(envExamplePath)) {
    fs.writeFileSync(envExamplePath, PROJECT_ENV_EXAMPLE, "utf8");
  }

  openProjectDb(root).close();

  const createdGit = await ensureGitRepo(root);
  console.log(`Initialized polygit project in ${root}`);
  console.log(`  layout: ${describeLayout(finalLayout)}`);
  console.log(`  sourceLang: ${fields.sourceLang}`);
  console.log(
    `  targetLangs: ${fields.targetLangs.length ? fields.targetLangs.join(", ") : "(none)"}`,
  );
  console.log(`  autoTranslate: ${fields.autoTranslate}`);
  if (fields.autoTranslate) {
    console.log(
      "  note: autoTranslate is saved now; it takes effect once `polygit sync` is available.",
    );
  }
  if (options.preset) console.log(`  preset: ${options.preset}`);
  console.log(`  created: ${CONFIG_FILENAME}, .tm/db.sqlite, .gitignore, .env.example`);
  if (createdGit) console.log("  created: git repository");
}

/** Create or merge polygit ignore rules into an existing .gitignore. */
function ensureGitignore(root: string): void {
  const gitignorePath = path.join(root, ".gitignore");
  const required = [".tm/", ".env", ".env.*", "!.env.example"];
  if (!fs.existsSync(gitignorePath)) {
    fs.writeFileSync(gitignorePath, PROJECT_GITIGNORE, "utf8");
    return;
  }
  const current = fs.readFileSync(gitignorePath, "utf8");
  const lines = new Set(
    current
      .split(/\r?\n/)
      .map((l) => l.trim())
      .filter(Boolean),
  );
  const missing = required.filter((rule) => {
    if (rule === ".env.*") return ![...lines].some((l) => l === ".env.*" || l === ".env.local");
    return !lines.has(rule);
  });
  if (missing.length === 0) return;
  const addition =
    (current.endsWith("\n") || current.length === 0 ? "" : "\n") +
    "\n# polygit local state\n" +
    missing.join("\n") +
    "\n";
  fs.appendFileSync(gitignorePath, addition, "utf8");
}
