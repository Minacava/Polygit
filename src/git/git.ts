import fs from "node:fs";
import path from "node:path";
import { simpleGit } from "simple-git";
import {
  gitPathPrefixes,
  pathMatchesPrefixes,
} from "../core/layout.js";
import { readConfig } from "../core/project.js";

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

function translationPrefixes(projectRoot: string): string[] {
  return gitPathPrefixes(readConfig(projectRoot));
}

function isTranslationPath(relPath: string, prefixes: string[]): boolean {
  return pathMatchesPrefixes(relPath, prefixes);
}

/**
 * Stage only configured contentRoots (+ outputRoot for mirror), never .tm/, .env, or secrets.
 */
export async function commitSourcesAndOutputs(
  projectRoot: string,
  message: string,
): Promise<{ committed: boolean; message: string }> {
  const git = simpleGit(projectRoot);
  const status = await git.status();
  const prefixes = translationPrefixes(projectRoot);

  const candidates = [
    ...status.not_added,
    ...status.modified,
    ...status.created,
    ...status.deleted,
  ].filter((p) => isTranslationPath(p, prefixes));

  if (candidates.length === 0) {
    return {
      committed: false,
      message: `No changes under ${prefixes.join(", ")} to commit.`,
    };
  }

  await git.add(candidates);
  await git.commit(message);
  return { committed: true, message };
}

export async function getDiffSummary(projectRoot: string): Promise<string> {
  const git = simpleGit(projectRoot);
  const prefixes = translationPrefixes(projectRoot);
  const diffArgs = ["--", ...prefixes.map((p) => `${p}/`)];
  const diff = await git.diff(diffArgs);
  const untracked = (await git.status()).not_added.filter((p) =>
    isTranslationPath(p, prefixes),
  );
  const parts: string[] = [];
  if (diff.trim()) parts.push(diff.trim());
  if (untracked.length) {
    parts.push(`Untracked:\n${untracked.map((p) => `  ${p}`).join("\n")}`);
  }
  return parts.join("\n\n") || "(no diff)";
}

export async function getRemoteUrl(
  projectRoot: string,
  remote = "origin",
): Promise<string | null> {
  const git = simpleGit(projectRoot);
  try {
    const url = (await git.remote(["get-url", remote]))?.trim();
    return url || null;
  } catch {
    return null;
  }
}

export async function getCurrentBranch(projectRoot: string): Promise<string> {
  const git = simpleGit(projectRoot);
  const branch = await git.revparse(["--abbrev-ref", "HEAD"]);
  return branch.trim();
}

export async function getDefaultRemoteBranch(
  projectRoot: string,
  remote = "origin",
): Promise<string> {
  const git = simpleGit(projectRoot);
  try {
    const sym = await git.raw(["symbolic-ref", `refs/remotes/${remote}/HEAD`]);
    const match = sym.trim().match(/refs\/remotes\/[^/]+\/(.+)$/);
    if (match?.[1]) return match[1];
  } catch {
    // fall through
  }
  const branches = await git.branch(["-r"]);
  if (branches.all.includes(`${remote}/main`)) return "main";
  if (branches.all.includes(`${remote}/master`)) return "master";
  return "main";
}

export async function checkoutBranch(
  projectRoot: string,
  branch: string,
  create = false,
): Promise<void> {
  const git = simpleGit(projectRoot);
  if (create) {
    await git.checkoutLocalBranch(branch);
  } else {
    await git.checkout(branch);
  }
}

export async function pushBranch(
  projectRoot: string,
  branch: string,
  remote = "origin",
  setUpstream = true,
): Promise<void> {
  const git = simpleGit(projectRoot);
  if (setUpstream) {
    await git.push(remote, branch, ["--set-upstream"]);
  } else {
    await git.push(remote, branch);
  }
}

export async function hasUncommittedTranslationChanges(
  projectRoot: string,
): Promise<boolean> {
  const git = simpleGit(projectRoot);
  const status = await git.status();
  const prefixes = translationPrefixes(projectRoot);
  const paths = [
    ...status.not_added,
    ...status.modified,
    ...status.created,
    ...status.deleted,
    ...status.staged,
  ];
  return paths.some((p) => isTranslationPath(p, prefixes));
}

export async function cloneRepository(
  url: string,
  targetDir: string,
): Promise<void> {
  const git = simpleGit();
  await git.clone(url, targetDir);
}
