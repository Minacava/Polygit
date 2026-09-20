import readline from "node:readline/promises";
import { stdin as input, stdout as output } from "node:process";
import { describeLayout, layoutFromConfig } from "../core/layout.js";
import { readConfig, requireProjectRoot } from "../core/project.js";
import { commitSourcesAndOutputs, getDiffSummary } from "../git/git.js";

export interface CommitOptions {
  yes?: boolean;
  message?: string;
}

export async function runCommit(options: CommitOptions = {}): Promise<void> {
  const root = requireProjectRoot();
  const layout = layoutFromConfig(readConfig(root));
  const diff = await getDiffSummary(root);
  console.log(`Changes under configured roots (${describeLayout(layout)}):\n`);
  console.log(diff);
  console.log("");

  const message =
    options.message ??
    `translate: update content (${new Date().toISOString().slice(0, 10)})`;

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

  const result = await commitSourcesAndOutputs(root, message);
  if (!result.committed) {
    console.log(result.message);
    return;
  }
  console.log(`Committed: ${message}`);
}
