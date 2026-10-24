import readline from "node:readline/promises";
import { stdin as input, stdout as output } from "node:process";
import { assertLangCode } from "../core/lang.js";
import { assertApprovedOutputsOnDisk } from "../core/output.js";
import {
  openProjectDb,
  readConfig,
  requireProjectRoot,
} from "../core/project.js";
import {
  countApprovedTranslations,
  countUnapprovedTranslations,
} from "../core/repository.js";
import {
  assertSafeGitBranch,
  checkoutBranch,
  commitSourcesAndOutputs,
  getCurrentBranch,
  getDefaultRemoteBranch,
  getDiffSummary,
  getRemoteUrl,
  hasUncommittedTranslationChanges,
  pushBranch,
} from "../git/git.js";
import { resolvePublishSourceBranch } from "../git/translation-branch.js";
import {
  createForgeClient,
  detectForgeFromRemoteUrl,
  isTrustedForgeHost,
  normalizeForgeHostname,
  peekRemoteHostname,
} from "../forge/index.js";
import type { ForgeRepoRef } from "../forge/index.js";

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
  /**
   * Confirm sending forge API tokens to a non-github.com / non-gitlab.com host.
   * Independent of --yes (commit confirmation).
   */
  confirmForgeHost?: boolean;
}

/**
 * Local approval → commit → push branch → open GitHub PR or GitLab MR.
 * Always restores the originally checked-out branch when finished or on failure.
 */
export async function runPublish(options: PublishOptions = {}): Promise<void> {
  if (!options.lang) {
    throw new Error(
      `Language is required. Pass --lang=<code> (e.g. polygit publish --lang=fr).`,
    );
  }

  assertLangCode(options.lang);
  if (options.branch !== undefined) {
    assertSafeGitBranch(options.branch, "branch");
  }
  if (options.targetBranch !== undefined) {
    assertSafeGitBranch(options.targetBranch, "target-branch");
  }

  const root = requireProjectRoot();
  const originalBranch = await getCurrentBranch(root);

  try {
    await publishOnce(root, originalBranch, options);
  } finally {
    await restoreBranch(root, originalBranch);
  }
}

async function publishOnce(
  root: string,
  originalBranch: string,
  options: PublishOptions,
): Promise<void> {
  const lang = options.lang!;

  // Approval gates first (before remote/forge auth errors).
  const db = openProjectDb(root);
  let unapproved = 0;
  let approved = 0;
  try {
    unapproved = countUnapprovedTranslations(db, lang);
    approved = countApprovedTranslations(db, lang);
    if (!options.allowUnapproved && unapproved > 0) {
      throw new Error(
        `${unapproved} translated segment(s) are not locally approved yet. ` +
          `Run "polygit review --lang=${lang}" to approve them, or pass --allow-unapproved.`,
      );
    }
    if (approved === 0 && !options.allowUnapproved) {
      throw new Error(
        `No locally approved translations found. Run "polygit review --lang=${lang}" first.`,
      );
    }
    assertApprovedOutputsOnDisk(db, root, lang);
  } finally {
    db.close();
  }

  const remoteUrl = await getRemoteUrl(root);
  if (!remoteUrl) {
    throw new Error(
      `No git remote "origin" found. Clone with "polygit clone <url>" or add a remote first.`,
    );
  }

  const config = readConfig(root);
  const repo = await resolvePublishForgeRepo(remoteUrl, options, config.forgeHosts);
  // Only create the client (which reads tokens) after the host is confirmed.
  const forge = createForgeClient(repo.kind);

  const targetBranch = options.targetBranch ?? (await getDefaultRemoteBranch(root));
  const current = await getCurrentBranch(root);
  const sourceBranch = resolvePublishSourceBranch(lang, current, options.branch);

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
      `translate: publish ${lang} (${new Date().toISOString().slice(0, 10)})`;

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
        `polygit does not grant GitHub/GitLab permissions — use SSH/HTTPS credentials that can push.\n${detail}`,
    );
  }

  const title = options.title ?? `translate: ${lang} via polygit`;
  const body =
    options.body ??
    [
      `## Summary`,
      ``,
      `Translation update prepared with polygit.`,
      `- Language: \`${lang}\``,
      `- Locally approved segments: ${approved}`,
      ``,
      `## Review`,
      ``,
      `Please review the translated output files before merging.`,
      ``,
      `_Opened automatically by \`polygit publish\`._`,
    ].join("\n");

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
  void originalBranch;
}

async function restoreBranch(projectRoot: string, originalBranch: string): Promise<void> {
  if (!originalBranch || originalBranch === "HEAD") return;
  try {
    const current = await getCurrentBranch(projectRoot);
    if (current === originalBranch) return;
    await checkoutBranch(projectRoot, originalBranch, false);
    console.log(`Restored branch ${originalBranch}`);
  } catch (err) {
    const detail = err instanceof Error ? err.message : String(err);
    console.warn(`Warning: could not restore branch ${originalBranch}: ${detail}`);
  }
}

async function resolvePublishForgeRepo(
  remoteUrl: string,
  options: PublishOptions,
  forgeHosts: string[],
): Promise<ForgeRepoRef> {
  const host = peekRemoteHostname(remoteUrl);
  let confirmUntrustedHost = Boolean(options.confirmForgeHost);
  const envHosts = (process.env.POLYGIT_FORGE_HOSTS ?? "")
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);

  if (forgeHosts.length > 0) {
    console.warn(
      "forgeHosts in .tmconfig.json no longer grants token trust; " +
        "set POLYGIT_FORGE_HOSTS or pass --confirm-forge-host.",
    );
  }

  if (!isTrustedForgeHost(host) && !confirmUntrustedHost) {
    const allowlisted = envHosts.some(
      (entry) => normalizeForgeHostname(entry) === normalizeForgeHostname(host),
    );
    if (!allowlisted) {
      if (!options.forge) {
        throw new Error(
          `Cannot detect forge for host "${host}". ` +
            `Only github.com and gitlab.com are trusted automatically. ` +
            `Pass --forge=github|gitlab and --confirm-forge-host (or set POLYGIT_FORGE_HOSTS).`,
        );
      }
      confirmUntrustedHost = await confirmUntrustedForgeHost(host, options.forge);
    }
  }

  return detectForgeFromRemoteUrl(remoteUrl, {
    ...(options.forge ? { forge: options.forge } : {}),
    allowedHosts: envHosts,
    confirmUntrustedHost,
  });
}

async function confirmUntrustedForgeHost(
  host: string,
  forge: "github" | "gitlab",
): Promise<boolean> {
  if (!process.stdin.isTTY) {
    throw new Error(
      `Refusing to send forge credentials to untrusted host "${host}". ` +
        `Set POLYGIT_FORGE_HOSTS or pass --confirm-forge-host after verifying the remote.`,
    );
  }

  const tokenName = forge === "github" ? "GITHUB_TOKEN" : "GITLAB_TOKEN";
  const rl = readline.createInterface({ input, output });
  try {
    const answer = (
      await rl.question(
        `Host "${host}" is not github.com/gitlab.com. Send ${tokenName} to https://${host} as ${forge}? [y/N] > `,
      )
    )
      .trim()
      .toLowerCase();
    if (answer !== "y" && answer !== "yes") {
      throw new Error(`Aborted: untrusted forge host "${host}" was not confirmed.`);
    }
  } finally {
    rl.close();
  }
  return true;
}
