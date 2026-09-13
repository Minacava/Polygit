import readline from "node:readline/promises";
import { stdin as input, stdout as output } from "node:process";
import { openProjectDb, requireProjectRoot } from "../core/project.js";
import {
  countApprovedTranslations,
  countUnapprovedTranslations,
} from "../core/repository.js";
import {
  checkoutBranch,
  commitSourcesAndOutputs,
  getCurrentBranch,
  getDefaultRemoteBranch,
  getDiffSummary,
  getRemoteUrl,
  hasUncommittedTranslationChanges,
  pushBranch,
} from "../git/git.js";
import { createForgeClient, detectForgeFromRemoteUrl } from "../forge/index.js";

export interface PublishOptions {
  /** Override forge detection (github | gitlab). */
  forge?: "github" | "gitlab";
  lang?: string;
  branch?: string;
  title?: string;
  body?: string;
  draft?: boolean;
  yes?: boolean;
  /** Skip local-approval gate (not recommended). */
  allowUnapproved?: boolean;
  targetBranch?: string;
}

/**
 * Local approval → commit → push branch → open GitHub PR or GitLab MR.
 */
export async function runPublish(options: PublishOptions = {}): Promise<void> {
  if (!options.lang) {
    throw new Error(
      `Language is required. Pass --lang=<code> (e.g. polygit publish --lang=fr).`,
    );
  }

  const root = requireProjectRoot();

  // Approval gates first (before remote/forge auth errors).
  const db = openProjectDb(root);
  let unapproved = 0;
  let approved = 0;
  try {
    unapproved = countUnapprovedTranslations(db, options.lang);
    approved = countApprovedTranslations(db, options.lang);
  } finally {
    db.close();
  }

  if (!options.allowUnapproved && unapproved > 0) {
    throw new Error(
      `${unapproved} translated segment(s) are not locally approved yet. ` +
        `Run "polygit review --lang=${options.lang}" to approve them, or pass --allow-unapproved.`,
    );
  }
  if (approved === 0 && !options.allowUnapproved) {
    throw new Error(
      `No locally approved translations found. Run "polygit review --lang=${options.lang}" first.`,
    );
  }

  const remoteUrl = await getRemoteUrl(root);
  if (!remoteUrl) {
    throw new Error(
      `No git remote "origin" found. Clone with "polygit clone <url>" or add a remote first.`,
    );
  }

  const repo = detectForgeFromRemoteUrl(remoteUrl, options.forge);
  const forge = createForgeClient(repo.kind);

  const targetBranch = options.targetBranch ?? (await getDefaultRemoteBranch(root));
  const sourceBranch =
    options.branch ??
    `polygit/translate-${options.lang ?? "all"}-${new Date()
      .toISOString()
      .slice(0, 10)
      .replace(/-/g, "")}`;

  const current = await getCurrentBranch(root);
  if (current !== sourceBranch) {
    try {
      await checkoutBranch(root, sourceBranch, true);
      console.log(`Created and checked out branch ${sourceBranch}`);
    } catch {
      await checkoutBranch(root, sourceBranch, false);
      console.log(`Checked out branch ${sourceBranch}`);
    }
  }

  if (await hasUncommittedTranslationChanges(root)) {
    const diff = await getDiffSummary(root);
    console.log("Uncommitted translation changes:\n");
    console.log(diff);
    console.log("");

    const message =
      options.title ??
      `translate: publish ${options.lang ?? "translations"} (${new Date().toISOString().slice(0, 10)})`;

    if (!options.yes) {
      if (!process.stdin.isTTY) {
        throw new Error("Non-interactive shell: pass --yes to commit and publish.");
      }
      const rl = readline.createInterface({ input, output });
      try {
        const label = repo.kind === "github" ? "PR" : "MR";
        const answer = (
          await rl.question(`Commit and open a ${label}? [y/N] > `)
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
    } else {
      console.log(`Committed: ${message}`);
    }
  }

  console.log(`Pushing ${sourceBranch} to origin…`);
  try {
    await pushBranch(root, sourceBranch);
  } catch (err) {
    const detail = err instanceof Error ? err.message : String(err);
    throw new Error(
      `Push failed. You need write access to this remote (or publish from your fork). ` +
        `Polygit does not grant GitHub/GitLab permissions — use SSH/HTTPS credentials that can push.\n${detail}`,
    );
  }

  const title =
    options.title ?? `translate: ${options.lang ?? "translations"} via Polygit`;
  const body =
    options.body ??
    [
      `## Summary`,
      ``,
      `Translation update prepared with Polygit.`,
      options.lang ? `- Language: \`${options.lang}\`` : null,
      `- Locally approved segments: ${approved}`,
      ``,
      `## Review`,
      ``,
      `Please review the changes under \`outputs/\` before merging.`,
      ``,
      `_Opened automatically by \`polygit publish\`._`,
    ]
      .filter((line) => line !== null)
      .join("\n");

  let mr;
  try {
    mr = await forge.createMergeRequest(repo, {
      sourceBranch,
      targetBranch,
      title,
      body,
      draft: Boolean(options.draft),
    });
  } catch (err) {
    const detail = err instanceof Error ? err.message : String(err);
    const tokenHint =
      repo.kind === "github"
        ? "Set GITHUB_TOKEN (or GH_TOKEN) with permission to create pull requests."
        : "Set GITLAB_TOKEN (or GL_TOKEN) with api scope to create merge requests.";
    throw new Error(
      `Could not open a ${repo.kind === "github" ? "pull request" : "merge request"}. ${tokenHint}\n${detail}`,
    );
  }

  const label = repo.kind === "github" ? "Pull request" : "Merge request";
  const ref = repo.kind === "github" ? `#${mr.number}` : `!${mr.number}`;
  console.log(`${label} opened: ${mr.url}`);
  console.log(
    `Remote approval: merge ${label.toLowerCase()} ${ref} on ${repo.kind} to land the translations.`,
  );
}
