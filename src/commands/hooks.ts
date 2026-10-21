import { execFileSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { requireProjectRoot } from "../core/project.js";

const PRE_COMMIT_NAME = "pre-commit";

const PRE_COMMIT_SCRIPT = `#!/usr/bin/env sh
# Installed by \`polygit hooks install\`.
# Runs the content lint gate only — never auto-translates or auto-approves.
set -e
polygit check
`;

function resolveHooksDir(projectRoot: string): string {
  let raw: string;
  try {
    raw = execFileSync("git", ["rev-parse", "--git-path", "hooks"], {
      cwd: projectRoot,
      encoding: "utf8",
      stdio: ["ignore", "pipe", "pipe"],
    }).trim();
  } catch (err) {
    const detail = err instanceof Error ? err.message : String(err);
    throw new Error(
      `Not a Git repository (or git is unavailable). Run "git init" first.\n${detail}`,
    );
  }
  return path.isAbsolute(raw) ? raw : path.resolve(projectRoot, raw);
}

/**
 * Opt-in: install a pre-commit hook that runs `polygit check` only.
 * Never installs sync. Does not overwrite an existing hook.
 */
export function runHooksInstall(): { hooksDir: string; path: string } {
  const root = requireProjectRoot();
  const hooksDir = resolveHooksDir(root);
  fs.mkdirSync(hooksDir, { recursive: true });

  const hookPath = path.join(hooksDir, PRE_COMMIT_NAME);
  if (fs.existsSync(hookPath)) {
    throw new Error(
      `Hook already exists: ${hookPath}\n` +
        `Refusing to overwrite. Remove or rename it, then re-run "polygit hooks install".`,
    );
  }

  fs.writeFileSync(hookPath, PRE_COMMIT_SCRIPT, { encoding: "utf8", mode: 0o755 });
  // Ensure executable even if umask cleared bits from mode.
  fs.chmodSync(hookPath, 0o755);

  console.log(`Installed pre-commit hook at ${hookPath}`);
  console.log("  runs: polygit check");
  console.log("  note: does not run sync or approve translations");
  return { hooksDir, path: hookPath };
}
