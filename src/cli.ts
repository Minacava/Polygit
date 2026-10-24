#!/usr/bin/env node
import { config as loadDotenv } from "dotenv";
import { Command } from "commander";
import path from "node:path";
import { runCheck } from "./commands/check.js";
import { runClone } from "./commands/clone.js";
import { runCommit } from "./commands/commit.js";
import { runConfigGet, runConfigSet } from "./commands/config.js";
import { runExportTmx } from "./commands/export-tmx.js";
import { runGlossaryAdd, runGlossarySync } from "./commands/glossary.js";
import { runHooksInstall } from "./commands/hooks.js";
import { runImport } from "./commands/import.js";
import { runInit } from "./commands/init.js";
import { runLog } from "./commands/log.js";
import { runPrune } from "./commands/prune.js";
import { runPublish } from "./commands/publish.js";
import { runReview } from "./commands/review.js";
import { runStatus } from "./commands/status.js";
import { runModelsList, runModelsUse } from "./commands/models.js";
import { runSync } from "./commands/sync.js";
import { runTranslate } from "./commands/translate.js";
import type { SegmentStatus } from "./core/db.js";
import { findProjectRoot } from "./core/project.js";
import { isDocumentFormat } from "./parsers/index.js";
import { getPackageVersion } from "./version.js";
import { isProviderName, redactSecrets, type ProviderName } from "./connectors/index.js";

const projectRoot = findProjectRoot() ?? process.cwd();
loadDotenv({ path: path.join(projectRoot, ".env"), quiet: true });

const program = new Command();

program
  .name("polygit")
  .description(
    "Local-first CLI for assisted translation with TM, glossary propagation, Git, and LLMs.",
  )
  .version(getPackageVersion());

program
  .command("init")
  .description("Create .tmconfig.json, content dirs, and local SQLite DB")
  .option(
    "--preset <name>",
    "Layout preset: vitepress | docusaurus | json-i18n (default: sources→outputs mirror)",
  )
  .option("--source-lang <lang>", "Source language code (e.g. en)")
  .option("--target-langs <list>", "Comma-separated target language codes")
  .option("--content <dirs>", "Comma-separated content root folders")
  .option("--output <dir>", "Folder for translations (outputRoot)")
  .option(
    "--style <preset>",
    "Translation style: academic | startup | technical | marketing | legal",
  )
  .option("--formality <value>", "Formality: formal | informal | auto")
  .action(
    async (opts: {
      preset?: string;
      sourceLang?: string;
      targetLangs?: string;
      content?: string;
      output?: string;
      style?: string;
      formality?: string;
    }) => {
      await runInit(process.cwd(), {
        ...(opts.preset ? { preset: opts.preset } : {}),
        ...(opts.sourceLang !== undefined ? { sourceLang: opts.sourceLang } : {}),
        ...(opts.targetLangs !== undefined ? { targetLangs: opts.targetLangs } : {}),
        ...(opts.content !== undefined ? { content: opts.content } : {}),
        ...(opts.output !== undefined ? { output: opts.output } : {}),
        ...(opts.style !== undefined ? { style: opts.style } : {}),
        ...(opts.formality !== undefined ? { formality: opts.formality } : {}),
        interactive: Boolean(process.stdin.isTTY),
      });
    },
  );

const configCmd = program
  .command("config")
  .description("Get or set values in .tmconfig.json");

configCmd
  .command("get")
  .description("Print a config value")
  .argument(
    "<key>",
    "sourceLang | targetLangs | contentRoots | outputRoot | outputMode | autoTranslate | style.preset | style.formality | style.guide",
  )
  .action((key: string) => {
    runConfigGet(key);
  });

configCmd
  .command("set")
  .description("Update a config value (validated like readConfig)")
  .argument(
    "<key>",
    "sourceLang | targetLangs | contentRoots | outputRoot | outputMode | autoTranslate | style.preset | style.formality | style.guide",
  )
  .argument(
    "<value>",
    "New value (comma-separated for lists; true/false for autoTranslate; style preset/formality/guide)",
  )
  .action((key: string, value: string) => {
    runConfigSet(key, value);
  });

program
  .command("clone")
  .description("Clone a GitHub or GitLab repo and optionally run init")
  .argument("<url>", "Git remote URL (https or SSH)")
  .option("--dir <path>", "Target directory (defaults to repo name)")
  .option("--no-init", "Skip polygit init after clone")
  .action(async (url: string, opts: { dir?: string; init?: boolean }) => {
    await runClone(url, {
      ...(opts.dir ? { dir: opts.dir } : {}),
      init: opts.init !== false,
    });
  });

program
  .command("import")
  .description("Import a file, glob, directory, or content root into pending segments")
  .argument("[paths...]", "File(s), directory, or glob under contentRoots")
  .option("--root <dir>", "Import all known files under this directory")
  .option("--format <format>", "markdown | json-i18n | po | yaml | xliff")
  .action((files: string[], opts: { format?: string; root?: string }) => {
    const format = opts.format;
    if (format && !isDocumentFormat(format)) {
      throw new Error(
        `Unsupported format: ${format}. Use markdown, json-i18n, po, yaml, or xliff.`,
      );
    }
    if ((!files || files.length === 0) && !opts.root) {
      throw new Error("Provide a file/glob path or --root=<dir>.");
    }
    runImport(files.length === 1 ? files[0] : files.length > 0 ? files : undefined, {
      ...(format && isDocumentFormat(format) ? { format } : {}),
      ...(opts.root ? { root: opts.root } : {}),
    });
  });

program
  .command("translate")
  .description("Translate pending/stale segments for a language")
  .argument("<lang>", "Target language code (e.g. fr, es)")
  .option("--doc <path>", "Limit to one source document")
  .option("--provider <name>", "claude | openai | ollama | huggingface")
  .option("--model <id>", "Model id/tag for the selected provider")
  .option("--dry-run", "Show plan without writing or calling the LLM", false)
  .option("--accept-fuzzy", "Apply fuzzy TM matches as unapproved drafts (skip LLM)", false)
  .option(
    "--add-lang",
    "Add this language to targetLangs when it is missing",
    false,
  )
  .option(
    "--concurrency <n>",
    "Parallel LLM requests (1-16)",
    (v: string) => {
      const n = Number(v);
      if (!Number.isInteger(n) || n < 1 || n > 16) {
        throw new Error("--concurrency must be an integer from 1 to 16");
      }
      return n;
    },
  )
  .option(
    "--no-branch",
    "Do not auto-create/checkout polygit/<lang>-YYYYMMDD when on main/master",
  )
  .option(
    "--style <preset>",
    "One-off style preset (academic | startup | technical | marketing | legal); overrides config",
  )
  .option(
    "--formality <value>",
    "One-off formality (formal | informal | auto); overrides config",
  )
  .action(
    async (
      lang: string,
      opts: {
        doc?: string;
        provider?: string;
        model?: string;
        dryRun?: boolean;
        acceptFuzzy?: boolean;
        addLang?: boolean;
        concurrency?: number;
        branch?: boolean;
        style?: string;
        formality?: string;
      },
    ) => {
    let provider: ProviderName | undefined;
    if (opts.provider !== undefined) {
      if (!isProviderName(opts.provider)) {
        throw new Error(
          `Unsupported provider: ${opts.provider}. Use claude, openai, ollama, or huggingface.`,
        );
      }
      provider = opts.provider;
    }
    const envConcurrency = process.env.POLYGIT_CONCURRENCY
      ? Number(process.env.POLYGIT_CONCURRENCY)
      : undefined;
    await runTranslate(lang, {
      ...(opts.doc ? { doc: opts.doc } : {}),
      ...(provider !== undefined ? { provider } : {}),
      ...(opts.model ? { model: opts.model } : {}),
      ...(opts.style !== undefined ? { style: opts.style } : {}),
      ...(opts.formality !== undefined ? { formality: opts.formality } : {}),
      dryRun: Boolean(opts.dryRun),
      acceptFuzzy: Boolean(opts.acceptFuzzy),
      addLang: Boolean(opts.addLang),
      ...(typeof opts.concurrency === "number"
        ? { concurrency: opts.concurrency }
        : typeof envConcurrency === "number" &&
            Number.isInteger(envConcurrency) &&
            envConcurrency >= 1 &&
            envConcurrency <= 16
          ? { concurrency: envConcurrency }
          : {}),
      // Commander --no-* defaults branch=true; --no-branch sets branch=false.
      // Do not pass a custom default of false — that made noBranch always true.
      noBranch: opts.branch === false,
    });
  });

program
  .command("prune")
  .description("Forget documents whose source file was deleted")
  .option("--outputs", "Also delete their translation output files", false)
  .option("--dry-run", "Show what would be pruned", false)
  .action((opts: { outputs?: boolean; dryRun?: boolean }) => {
    runPrune({
      outputs: Boolean(opts.outputs),
      dryRun: Boolean(opts.dryRun),
    });
  });

const glossary = program.command("glossary").description("Manage glossary terms");

glossary
  .command("add")
  .description("Add or update a glossary term")
  .argument("<sourceTerm>", "Source-language term")
  .argument("<targetTerm>", "Target-language term")
  .requiredOption("--lang <lang>", "Target language code")
  .option("--note <note>", "Optional translator note")
  .action((sourceTerm: string, targetTerm: string, opts: { lang: string; note?: string }) => {
    runGlossaryAdd(sourceTerm, targetTerm, {
      lang: opts.lang,
      ...(opts.note ? { note: opts.note } : {}),
    });
  });

glossary
  .command("sync")
  .description("Mark segments using glossary terms as stale")
  .option("--lang <lang>", "Limit to one language")
  .option("--auto-retranslate", "Retranslate stale segments after sync", false)
  .action(async (opts: { lang?: string; autoRetranslate?: boolean }) => {
    await runGlossarySync({
      ...(opts.lang ? { lang: opts.lang } : {}),
      autoRetranslate: Boolean(opts.autoRetranslate),
    });
  });

program
  .command("review")
  .description("Interactively approve or edit translations")
  .requiredOption("--lang <lang>", "Language to review")
  .option("--status <status>", "pending | translated | stale | approved")
  .option(
    "--approve-all",
    "Approve every listed segment that already has a TARGET (no interactive prompt)",
    false,
  )
  .option(
    "--no-branch",
    "Do not auto-create/checkout polygit/<lang>-YYYYMMDD when on main/master",
  )
  .action(
    async (opts: {
      lang?: string;
      status?: string;
      approveAll?: boolean;
      branch?: boolean;
    }) => {
    const status = opts.status as SegmentStatus | undefined;
    if (
      status &&
      status !== "pending" &&
      status !== "translated" &&
      status !== "stale" &&
      status !== "approved"
    ) {
      throw new Error(`Unsupported status: ${status}`);
    }
    await runReview({
      ...(opts.lang ? { lang: opts.lang } : {}),
      ...(status ? { status } : {}),
      approveAll: Boolean(opts.approveAll),
      // Commander --no-* defaults branch=true; --no-branch sets branch=false.
      noBranch: opts.branch === false,
    });
  },
  );

program
  .command("commit")
  .description("Commit translation outputs (and optionally sources)")
  .option("--yes", "Skip confirmation", false)
  .option("--message <message>", "Commit message")
  .option(
    "--ai",
    "Generate the commit message from the diff with the configured LLM",
    false,
  )
  .option(
    "--include-sources",
    "Also stage source edits under contentRoots",
    false,
  )
  .action(async (opts: {
    yes?: boolean;
    message?: string;
    ai?: boolean;
    includeSources?: boolean;
  }) => {
    await runCommit({
      yes: Boolean(opts.yes),
      ai: Boolean(opts.ai),
      includeSources: Boolean(opts.includeSources),
      ...(opts.message ? { message: opts.message } : {}),
    });
  });

program
  .command("log")
  .description("Show recent commits that touch translation content roots")
  .option("--limit <n>", "Max commits to show", "20")
  .option("--stat", "List files changed in each commit", false)
  .option(
    "--grep-translate",
    "Also include commits whose message matches translate: / translate(",
    false,
  )
  .action(
    async (opts: { limit?: string; stat?: boolean; grepTranslate?: boolean }) => {
      const parsed = Number.parseInt(String(opts.limit ?? "20"), 10);
      await runLog({
        limit: Number.isFinite(parsed) ? parsed : 20,
        stat: Boolean(opts.stat),
        grepTranslate: Boolean(opts.grepTranslate),
      });
    },
  );

program
  .command("publish")
  .description(
    "After local review: commit, push a branch, and open a GitHub PR or GitLab MR",
  )
  .requiredOption("--lang <lang>", "Language being published")
  .option(
    "--forge <kind>",
    "github | gitlab (required for Enterprise/self-hosted hosts)",
  )
  .option(
    "--confirm-forge-host",
    "Allow sending forge tokens to a non-github.com / non-gitlab.com host",
    false,
  )
  .option("--branch <name>", "Source branch name to push")
  .option("--target-branch <name>", "Base branch for the PR/MR (default: remote HEAD)")
  .option("--title <title>", "PR/MR title")
  .option("--body <body>", "PR/MR description")
  .option("--draft", "Open as draft", false)
  .option("--yes", "Skip commit confirmation", false)
  .option("--allow-unapproved", "Skip the local-approval gate (not recommended)", false)
  .action(
    async (opts: {
      lang?: string;
      forge?: string;
      confirmForgeHost?: boolean;
      branch?: string;
      targetBranch?: string;
      title?: string;
      body?: string;
      draft?: boolean;
      yes?: boolean;
      allowUnapproved?: boolean;
    }) => {
      if (opts.forge && opts.forge !== "github" && opts.forge !== "gitlab") {
        throw new Error(`Unsupported forge: ${opts.forge}. Use github or gitlab.`);
      }
      await runPublish({
        ...(opts.lang ? { lang: opts.lang } : {}),
        ...(opts.forge === "github" || opts.forge === "gitlab"
          ? { forge: opts.forge }
          : {}),
        confirmForgeHost: Boolean(opts.confirmForgeHost),
        ...(opts.branch ? { branch: opts.branch } : {}),
        ...(opts.targetBranch ? { targetBranch: opts.targetBranch } : {}),
        ...(opts.title ? { title: opts.title } : {}),
        ...(opts.body ? { body: opts.body } : {}),
        draft: Boolean(opts.draft),
        yes: Boolean(opts.yes),
        allowUnapproved: Boolean(opts.allowUnapproved),
      });
    },
  );


const models = program.command("models").description("List and select LLM models");

models
  .command("list")
  .description("Show effective models and local Ollama installs")
  .option("--provider <name>", "Limit to one provider")
  .action(async (opts: { provider?: string }) => {
    let provider: ProviderName | undefined;
    if (opts.provider !== undefined) {
      if (!isProviderName(opts.provider)) {
        throw new Error(
          `Unsupported provider: ${opts.provider}. Use claude, openai, ollama, or huggingface.`,
        );
      }
      provider = opts.provider;
    }
    await runModelsList(provider ? { provider } : {});
  });

models
  .command("use")
  .description("Save the default model for a provider in .tmconfig.json")
  .argument("<provider>", "claude | openai | ollama | huggingface")
  .argument("<model>", "Model id or Ollama tag")
  .action(async (provider: string, model: string) => {
    await runModelsUse(provider, model);
  });

program
  .command("status")
  .description("Show pending/stale/translated/approved counts")
  .option("--lang <lang>", "Show per-language translation status")
  .action((opts: { lang?: string }) => {
    runStatus(opts.lang ? { lang: opts.lang } : {});
  });

program
  .command("sync")
  .description(
    "Import NEW/CHANGED sources and translate them (always left unapproved)",
  )
  .option("--lang <lang>", "Target language (default: all targetLangs)")
  .option("--provider <name>", "claude | openai | ollama | huggingface")
  .option("--model <id>", "Model id/tag for the selected provider")
  .option(
    "--style <preset>",
    "One-off style preset (academic | startup | technical | marketing | legal); overrides config",
  )
  .option(
    "--formality <value>",
    "One-off formality (formal | informal | auto); overrides config",
  )
  .option("--dry-run", "Show plan without importing or translating", false)
  .action(
    async (opts: {
      lang?: string;
      provider?: string;
      model?: string;
      style?: string;
      formality?: string;
      dryRun?: boolean;
    }) => {
      let provider: ProviderName | undefined;
      if (opts.provider !== undefined) {
        if (!isProviderName(opts.provider)) {
          throw new Error(
            `Unsupported provider: ${opts.provider}. Use claude, openai, ollama, or huggingface.`,
          );
        }
        provider = opts.provider;
      }
      await runSync({
        ...(opts.lang ? { lang: opts.lang } : {}),
        ...(provider !== undefined ? { provider } : {}),
        ...(opts.model ? { model: opts.model } : {}),
        ...(opts.style !== undefined ? { style: opts.style } : {}),
        ...(opts.formality !== undefined ? { formality: opts.formality } : {}),
        dryRun: Boolean(opts.dryRun),
      });
    },
  );

program
  .command("check")
  .description(
    "CI gate: fail on NEW/CHANGED sources, pending/stale segments, missing outputs, or broken placeholders",
  )
  .option("--lang <lang>", "Language to check (default: all targetLangs)")
  .option("--json", "Print machine-readable JSON to stdout", false)
  .option(
    "--require-approved",
    "Fail when translated segments are not yet approved",
    false,
  )
  .option(
    "--hook",
    "Pre-commit mode: warn on NEW/CHANGED sources instead of failing",
    false,
  )
  .action((opts: {
    lang?: string;
    json?: boolean;
    requireApproved?: boolean;
    hook?: boolean;
  }) => {
    runCheck({
      ...(opts.lang ? { lang: opts.lang } : {}),
      json: Boolean(opts.json),
      requireApproved: Boolean(opts.requireApproved),
      hook: Boolean(opts.hook),
    });
  });

const hooks = program.command("hooks").description("Opt-in Git hooks for polygit");

hooks
  .command("install")
  .description("Install a pre-commit hook that runs polygit check (never overwrites)")
  .action(() => {
    runHooksInstall();
  });

program
  .command("export-tmx")
  .description("Export translation memory for a language as TMX 1.4")
  .requiredOption("--lang <lang>", "Target language code")
  .option("--out <path>", "Output file (default: tm-<lang>.tmx)")
  .action((opts: { lang: string; out?: string }) => {
    runExportTmx({
      lang: opts.lang,
      ...(opts.out ? { out: opts.out } : {}),
    });
  });

async function main(): Promise<void> {
  try {
    await program.parseAsync(process.argv);
  } catch (err) {
    const alreadyPrinted =
      err !== null &&
      typeof err === "object" &&
      (err as { alreadyPrinted?: boolean }).alreadyPrinted === true;
    if (!alreadyPrinted) {
      const message = err instanceof Error ? err.message : String(err);
      console.error(`Error: ${redactSecrets(message)}`);
    }
    process.exitCode = 1;
  }
}

void main();
