import { execFileSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { requireProjectRoot } from "../core/project.js";

const PRE_COMMIT_NAME = "pre-commit";

/**
 * Pre-commit hook: run `polygit check` via local bin, PATH, or npx --no-install.
 * Never runs sync. Clear error if polygit cannot be found.
 */
const PRE_COMMIT_SCRIPT = `#!/usr/bin/env sh
# Installed by \`polygit hooks install\`.
# Runs the content lint gate only — never auto-translates or auto-approves.
set -e

run_polygit_check() {
  if [ -x "./node_modules/.bin/polygit" ]; then
    exec "./node_modules/.bin/polygit" check
  fi

  if command -v polygit >/dev/null 2>&1; then
    exec polygit check
  fi

  if command -v npx >/dev/null 2>&1; then
    if npx --no-install polygit --help >/dev/null 2>&1; then
      exec npx --no-install polygit check
    fi
  fi

  echo "polygit hooks: polygit was not found." >&2
  echo "Install it in this project (npm install polygit or npm install -D polygit)," >&2
  echo "or install it globally, then retry your commit." >&2
  exit 1
}

run_polygit_check
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
 * Never installs sync. Does not overwrite an existing hook (throws → exit ≠ 0).
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
  fs.chmodSync(hookPath, 0o755);

  console.log(`Installed pre-commit hook at ${hookPath}`);
  console.log("  runs: polygit check (via ./node_modules/.bin/polygit, PATH, or npx)");
  console.log("  note: does not run sync or approve translations");
  return { hooksDir, path: hookPath };
}
