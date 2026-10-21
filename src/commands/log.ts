import { describeLayout, layoutFromConfig } from "../core/layout.js";
import { readConfig, requireProjectRoot } from "../core/project.js";
import {
  listTranslationCommits,
  type TranslationCommit,
} from "../git/git.js";

export interface LogOptions {
  /** Max commits to show (default 20). */
  limit?: number;
  /** Include changed file paths per commit. */
  stat?: boolean;
  /**
   * Also include commits whose message matches translate: / translate(
   * even if path filtering misses them.
   */
  grepTranslate?: boolean;
}

export async function runLog(options: LogOptions = {}): Promise<void> {
  const root = requireProjectRoot();
  const config = readConfig(root);
  const layout = layoutFromConfig(config);
  const limit = Math.max(1, options.limit ?? 20);

  const commits = await listTranslationCommits(root, {
    limit,
    ...(options.grepTranslate ? { grepTranslate: true } : {}),
    ...(options.stat ? { includeFiles: true } : {}),
  });

  if (commits.length === 0) {
    console.log(
      `No translation commits found under ${describeLayout(layout)}.`,
    );
    console.log("Hint: run polygit commit after translating, then polygit log.");
    return;
  }

  console.log(
    `Translation commits (${commits.length}, roots: ${describeLayout(layout)}):\n`,
  );
  for (const c of commits) {
    printCommit(c, Boolean(options.stat));
  }
}

function printCommit(c: TranslationCommit, showFiles: boolean): void {
  const date = c.date.slice(0, 10);
  console.log(`${c.hashShort}  ${date}  ${c.author}`);
  console.log(`  ${c.message}`);
  if (showFiles && c.files && c.files.length > 0) {
    for (const f of c.files) {
      console.log(`    ${f}`);
    }
  }
  console.log("");
}
