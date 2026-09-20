#!/usr/bin/env node
import { config as loadDotenv } from "dotenv";
import { Command } from "commander";
import path from "node:path";
import { runClone } from "./commands/clone.js";
import { runCommit } from "./commands/commit.js";
import { runGlossaryAdd, runGlossarySync } from "./commands/glossary.js";
import { runImport } from "./commands/import.js";
import { runInit } from "./commands/init.js";
import { runPublish } from "./commands/publish.js";
import { runReview } from "./commands/review.js";
import { runStatus } from "./commands/status.js";
import { runModelsList, runModelsUse } from "./commands/models.js";
import { runTranslate } from "./commands/translate.js";
import type { DocumentFormat, SegmentStatus } from "./core/db.js";
import { findProjectRoot } from "./core/project.js";
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
  .action(async (opts: { preset?: string }) => {
    await runInit(process.cwd(), opts.preset ? { preset: opts.preset } : {});
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
  .description("Import a file, glob, or content root into pending segments")
  .argument("[path]", "File or glob under contentRoots (e.g. docs/**/*.md)")
  .option("--root <dir>", "Import all known files under this directory")
  .option("--format <format>", "markdown | json-i18n")
  .action((file: string | undefined, opts: { format?: string; root?: string }) => {
    const format = opts.format as DocumentFormat | undefined;
    if (format && format !== "markdown" && format !== "json-i18n") {
      throw new Error(`Unsupported format: ${format}`);
    }
    if (!file && !opts.root) {
      throw new Error("Provide a file/glob path or --root=<dir>.");
    }
    runImport(file, {
      ...(format ? { format } : {}),
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
  .action(async (lang: string, opts: { doc?: string; provider?: string; model?: string; dryRun?: boolean; acceptFuzzy?: boolean }) => {
    let provider: ProviderName | undefined;
    if (opts.provider !== undefined) {
      if (!isProviderName(opts.provider)) {
        throw new Error(
          `Unsupported provider: ${opts.provider}. Use claude, openai, ollama, or huggingface.`,
        );
      }
      provider = opts.provider;
    }
    await runTranslate(lang, {
      ...(opts.doc ? { doc: opts.doc } : {}),
      ...(provider !== undefined ? { provider } : {}),
      ...(opts.model ? { model: opts.model } : {}),
      dryRun: Boolean(opts.dryRun),
      acceptFuzzy: Boolean(opts.acceptFuzzy),
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
  .action(async (opts: { lang?: string; status?: string }) => {
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
    });
  });

program
  .command("commit")
  .description("Commit configured content roots and translation outputs")
  .option("--yes", "Skip confirmation", false)
  .option("--message <message>", "Commit message")
  .action(async (opts: { yes?: boolean; message?: string }) => {
    await runCommit({
      yes: Boolean(opts.yes),
      ...(opts.message ? { message: opts.message } : {}),
    });
  });

program
  .command("publish")
  .description(
    "After local review: commit, push a branch, and open a GitHub PR or GitLab MR",
  )
  .requiredOption("--lang <lang>", "Language being published")
  .option("--forge <kind>", "github | gitlab (override host detection)")
  .option("--branch <name>", "Source branch name to push")
  .option("--target-branch <name>", "Base branch for the PR/MR (default: remote HEAD)")
  .option("--title <title>", "PR/MR title")
  .option("--body <body>", "PR/MR description")
  .option("--draft", "Open as draft", false)
  .option("--yes", "Skip confirmation", false)
  .option("--allow-unapproved", "Skip the local-approval gate (not recommended)", false)
  .action(
    async (opts: {
      lang?: string;
      forge?: string;
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

async function main(): Promise<void> {
  try {
    await program.parseAsync(process.argv);
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.error(`Error: ${redactSecrets(message)}`);
    process.exitCode = 1;
  }
}

void main();
