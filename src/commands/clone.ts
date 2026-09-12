import fs from "node:fs";
import path from "node:path";
import { runInit } from "./init.js";
import { cloneRepository } from "../git/git.js";
import { detectForgeFromRemoteUrl } from "../forge/index.js";

export interface CloneOptions {
  dir?: string;
  init?: boolean;
}

/**
 * Clone a GitHub or GitLab repository, then optionally run `polygit init`.
 */
export async function runClone(url: string, options: CloneOptions = {}): Promise<void> {
  let forgeLabel = "git";
  try {
    forgeLabel = detectForgeFromRemoteUrl(url).kind;
  } catch {
    // Still allow cloning unrecognized remotes; publish will require a known forge.
  }

  const fallbackName =
    url
      .replace(/\.git$/i, "")
      .split("/")
      .filter(Boolean)
      .pop() ?? "project";
  const targetDir = path.resolve(process.cwd(), options.dir ?? fallbackName);

  if (fs.existsSync(targetDir) && fs.readdirSync(targetDir).length > 0) {
    throw new Error(`Target directory is not empty: ${targetDir}`);
  }

  console.log(`Cloning ${forgeLabel} repository into ${targetDir}…`);
  await cloneRepository(url, targetDir);
  console.log(`Cloned ${url}`);

  if (options.init !== false) {
    await runInit(targetDir);
    console.log(`\nNext steps:`);
    console.log(`  cd ${targetDir}`);
    console.log(`  # add files under sources/, then:`);
    console.log(`  polygit import sources/<file> --format=markdown`);
    console.log(`  polygit translate <lang> --provider=claude`);
    console.log(`  polygit review --lang=<lang>`);
    console.log(`  polygit publish --lang=<lang>`);
  }
}
