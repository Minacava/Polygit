import fs from "node:fs";
import path from "node:path";
import { simpleGit } from "simple-git";

export async function ensureGitRepo(projectRoot: string): Promise<boolean> {
  const gitDir = path.join(projectRoot, ".git");
  if (fs.existsSync(gitDir)) return false;
  const git = simpleGit(projectRoot);
  await git.init();
  return true;
}

export async function getStatusPaths(projectRoot: string): Promise<{
  staged: string[];
  modified: string[];
  not_added: string[];
}> {
  const git = simpleGit(projectRoot);
  const status = await git.status();
  return {
    staged: status.staged,
    modified: status.modified,
    not_added: status.not_added,
  };
}

/**
 * Stage only sources/ and outputs/, never .tm/, .env, or secrets.
 */
export async function commitSourcesAndOutputs(
  projectRoot: string,
  message: string,
): Promise<{ committed: boolean; message: string }> {
  const git = simpleGit(projectRoot);
  const status = await git.status();

  const candidates = [
    ...status.not_added,
    ...status.modified,
    ...status.created,
    ...status.deleted,
  ].filter((p) => p.startsWith("sources/") || p.startsWith("outputs/"));

  if (candidates.length === 0) {
    return { committed: false, message: "No changes in sources/ or outputs/ to commit." };
  }

  await git.add(candidates);
  await git.commit(message);
  return { committed: true, message };
}

export async function getDiffSummary(projectRoot: string): Promise<string> {
  const git = simpleGit(projectRoot);
  const diff = await git.diff(["--", "sources/", "outputs/"]);
  const untracked = (await git.status()).not_added.filter(
    (p) => p.startsWith("sources/") || p.startsWith("outputs/"),
  );
  const parts: string[] = [];
  if (diff.trim()) parts.push(diff.trim());
  if (untracked.length) {
    parts.push(`Untracked:\n${untracked.map((p) => `  ${p}`).join("\n")}`);
  }
  return parts.join("\n\n") || "(no diff)";
}
