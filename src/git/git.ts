import fs from "node:fs";
import path from "node:path";
import { simpleGit } from "simple-git";
import {
  gitPathPrefixes,
  pathMatchesPrefixes,
} from "../core/layout.js";
import { readConfig } from "../core/project.js";
import { assertSafeCloneUrl, assertSafeGitBranch } from "./validate.js";

export { assertSafeCloneUrl, assertSafeGitBranch, isValidGitBranchName } from "./validate.js";

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
  try {
    const branch = await git.revparse(["--abbrev-ref", "HEAD"]);
    return branch.trim();
  } catch {
    // Empty repo (init without commits) has no HEAD yet.
    return "HEAD";
  }
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
  const safeBranch = assertSafeGitBranch(branch);
  const git = simpleGit(projectRoot);
  if (create) {
    await git.checkoutLocalBranch(safeBranch);
  } else {
    await git.checkout(safeBranch);
  }
}

export async function pushBranch(
  projectRoot: string,
  branch: string,
  remote = "origin",
  setUpstream = true,
): Promise<void> {
  const safeBranch = assertSafeGitBranch(branch);
  const git = simpleGit(projectRoot);
  if (setUpstream) {
    await git.push(remote, safeBranch, ["--set-upstream"]);
  } else {
    await git.push(remote, safeBranch);
  }
}

export interface TranslationCommit {
  hash: string;
  hashShort: string;
  date: string;
  author: string;
  message: string;
  files?: string[];
}

export interface ListTranslationCommitsOptions {
  limit?: number;
  /** Include file paths changed in each commit. */
  includeFiles?: boolean;
  /**
   * Also keep commits whose subject matches translate: / translate(
   * (union with path-filtered commits, then re-sorted).
   */
  grepTranslate?: boolean;
}

/**
 * Recent commits that touch configured translation roots (and optionally
 * messages matching translate: / translate().
 */
export async function listTranslationCommits(
  projectRoot: string,
  options: ListTranslationCommitsOptions = {},
): Promise<TranslationCommit[]> {
  const git = simpleGit(projectRoot);
  const limit = Math.max(1, options.limit ?? 20);
  const prefixes = translationPrefixes(projectRoot);
  const pathArgs = prefixes.map((p) => `${p}/`);
  const fetchLimit = Math.max(limit * 3, limit);

  const byHash = new Map<string, TranslationCommit>();

  for (const c of await parseGitLog(git, [
    "log",
    `-n${fetchLimit}`,
    "--format=%H%x09%cI%x09%an%x09%s",
    "--",
    ...pathArgs,
  ])) {
    byHash.set(c.hash, c);
  }

  if (options.grepTranslate) {
    for (const c of await parseGitLog(git, [
      "log",
      `-n${fetchLimit}`,
      "--extended-regexp",
      "--grep=translate(:|\\()",
      "--format=%H%x09%cI%x09%an%x09%s",
    ])) {
      if (!byHash.has(c.hash)) byHash.set(c.hash, c);
    }
  }

  const sorted = [...byHash.values()]
    .sort((a, b) => (a.date < b.date ? 1 : a.date > b.date ? -1 : 0))
    .slice(0, limit);

  if (options.includeFiles) {
    for (const c of sorted) {
      c.files = await listCommitFiles(git, c.hash, pathArgs);
    }
  }

  return sorted;
}

async function parseGitLog(
  git: ReturnType<typeof simpleGit>,
  args: string[],
): Promise<TranslationCommit[]> {
  try {
    const raw = await git.raw(args);
    if (!raw.trim()) return [];
    return raw
      .trim()
      .split("\n")
      .filter(Boolean)
      .map((line) => {
        const [hash, date, author, ...msgParts] = line.split("\t");
        const full = hash ?? "";
        return {
          hash: full,
          hashShort: full.slice(0, 7),
          date: date ?? "",
          author: author ?? "",
          message: msgParts.join("\t").trim(),
        };
      })
      .filter((c) => c.hash.length > 0);
  } catch {
    return [];
  }
}

async function listCommitFiles(
  git: ReturnType<typeof simpleGit>,
  hash: string,
  pathPrefixes: string[],
): Promise<string[]> {
  try {
    const raw = await git.raw([
      "show",
      "--name-only",
      "--pretty=format:",
      hash,
      "--",
      ...pathPrefixes,
    ]);
    return raw
      .split("\n")
      .map((l) => l.trim())
      .filter(Boolean);
  } catch {
    return [];
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
  const safeUrl = assertSafeCloneUrl(url);
  const git = simpleGit();
  await git.clone(safeUrl, targetDir);
}
