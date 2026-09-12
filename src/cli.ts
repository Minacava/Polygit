#!/usr/bin/env node
import { config as loadDotenv } from "dotenv";
import { Command } from "commander";
import path from "node:path";
import { runCommit } from "./commands/commit.js";
import { runGlossaryAdd, runGlossarySync } from "./commands/glossary.js";
import { runImport } from "./commands/import.js";
import { runInit } from "./commands/init.js";
import { runReview } from "./commands/review.js";
import { runStatus } from "./commands/status.js";
import { runTranslate } from "./commands/translate.js";
import type { DocumentFormat, SegmentStatus } from "./core/db.js";
import { findProjectRoot } from "./core/project.js";
import { redactSecrets } from "./connectors/index.js";

const projectRoot = findProjectRoot() ?? process.cwd();
loadDotenv({ path: path.join(projectRoot, ".env"), quiet: true });

const program = new Command();

program
  .name("polygit")
  .description(
    "Local-first CLI for assisted translation with TM, glossary propagation, Git, and LLMs.",
  )
  .version("0.1.0");

program
  .command("init")
  .description("Create sources/, outputs/, .tmconfig.json, and local SQLite DB")
  .action(async () => {
    await runInit();
  });

program
  .command("import")
  .description("Parse a file under sources/ into pending segments")
  .argument("<file>", "Path under sources/")
  .option("--format <format>", "markdown | json-i18n")
  .action((file: string, opts: { format?: string }) => {
    const format = opts.format as DocumentFormat | undefined;
    if (format && format !== "markdown" && format !== "json-i18n") {
      throw new Error(`Unsupported format: ${format}`);
    }
    runImport(file, format ? { format } : {});
  });

program
  .command("translate")
  .description("Translate pending/stale segments for a language")
  .argument("<lang>", "Target language code (e.g. fr, es)")
  .option("--doc <path>", "Limit to one source document")
  .option("--provider <name>", "claude | openai")
  .option("--dry-run", "Show plan without writing or calling the LLM", false)
  .action(async (lang: string, opts: { doc?: string; provider?: string; dryRun?: boolean }) => {
    const provider = opts.provider as "claude" | "openai" | undefined;
    if (provider && provider !== "claude" && provider !== "openai") {
      throw new Error(`Unsupported provider: ${provider}`);
    }
    await runTranslate(lang, {
      ...(opts.doc ? { doc: opts.doc } : {}),
      ...(provider ? { provider } : {}),
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
  .option("--lang <lang>", "Language to review")
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
  .description("Commit sources/ and outputs/ together")
  .option("--yes", "Skip confirmation", false)
  .option("--message <message>", "Commit message")
  .action(async (opts: { yes?: boolean; message?: string }) => {
    await runCommit({
      yes: Boolean(opts.yes),
      ...(opts.message ? { message: opts.message } : {}),
    });
  });

program
  .command("status")
  .description("Show pending/stale/translated/approved counts")
  .action(() => {
    runStatus();
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
