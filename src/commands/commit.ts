import readline from "node:readline/promises";
import { stdin as input, stdout as output } from "node:process";
import type { TranslationProvider } from "../connectors/index.js";
import { describeLayout, layoutFromConfig } from "../core/layout.js";
import { readConfig, requireProjectRoot } from "../core/project.js";
import { commitSourcesAndOutputs, getDiffSummary } from "../git/git.js";
import {
  defaultCommitMessage,
  generateCommitMessage,
} from "./commit-message.js";

export interface CommitOptions {
  yes?: boolean;
  message?: string;
  /** Generate the commit message with the configured LLM from the diff. */
  ai?: boolean;
  /** Also stage source edits under contentRoots (default: outputs only). */
  includeSources?: boolean;
  /** Test seam: inject LLM provider for --ai. */
  providerInstance?: TranslationProvider;
}

export async function runCommit(options: CommitOptions = {}): Promise<void> {
  const root = requireProjectRoot();
  const layout = layoutFromConfig(readConfig(root));
  const diff = await getDiffSummary(root);
  console.log(`Changes under configured roots (${describeLayout(layout)}):\n`);
  console.log(diff);
  console.log("");

  if (diff.trim() === "(no diff)") {
    console.log("Nothing to commit.");
    return;
  }

  const message = await resolveCommitMessage(root, diff, options);
  if (message === null) {
    console.log("Aborted.");
    return;
  }

  if (!options.yes) {
    if (!process.stdin.isTTY) {
      throw new Error("Non-interactive shell: pass --yes to commit without confirmation.");
    }
    const rl = readline.createInterface({ input, output });
    try {
      const answer = (
        await rl.question(`Commit with message:\n  ${message}\nProceed? [y/N] > `)
      )
        .trim()
        .toLowerCase();
      if (answer !== "y" && answer !== "yes") {
        console.log("Aborted.");
        return;
      }
    } finally {
      rl.close();
    }
  }

  const result = await commitSourcesAndOutputs(root, message, {
    includeSources: Boolean(options.includeSources),
  });
  if (!result.committed) {
    console.log(result.message);
    return;
  }
  console.log(`Committed: ${message}`);
}

/** Returns null when the user declines an AI-proposed message. */
async function resolveCommitMessage(
  root: string,
  diff: string,
  options: CommitOptions,
): Promise<string | null> {
  if (options.message?.trim()) {
    return options.message.trim();
  }

  const fallback = defaultCommitMessage();

  if (options.ai) {
    console.log("Generating commit message with configured LLM…");
    const generated = await generateCommitMessage({
      diff,
      projectRoot: root,
      ...(options.providerInstance
        ? { providerInstance: options.providerInstance }
        : {}),
    });
    console.log(`  proposed: ${generated}`);

    if (options.yes || !process.stdin.isTTY) {
      return generated;
    }

    const rl = readline.createInterface({ input, output });
    try {
      const answer = (
        await rl.question("Use this message? [Y/n/e=edit] > ")
      )
        .trim()
        .toLowerCase();
      if (answer === "n" || answer === "no") {
        return null;
      }
      if (answer === "e" || answer === "edit") {
        const edited = (await rl.question(`Edit message [${generated}]: `)).trim();
        return edited || generated;
      }
      return generated;
    } finally {
      rl.close();
    }
  }

  if (options.yes || !process.stdin.isTTY) {
    return fallback;
  }

  const rl = readline.createInterface({ input, output });
  try {
    const typed = (
      await rl.question(`Commit message [${fallback}]: `)
    ).trim();
    return typed || fallback;
  } finally {
    rl.close();
  }
}
