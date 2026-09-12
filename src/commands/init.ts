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

  // Ensure DB schema exists.
  openProjectDb(root).close();

  const createdGit = await ensureGitRepo(root);
  console.log(`Initialized Polygit project in ${root}`);
  console.log(`  created: sources/, outputs/, ${CONFIG_FILENAME}, .tm/db.sqlite`);
  if (createdGit) console.log("  created: git repository");
}
