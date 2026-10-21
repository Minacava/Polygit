import { assertSafeGitBranch } from "./validate.js";
import { checkoutBranch, getCurrentBranch } from "./git.js";

const PROTECTED = new Set(["main", "master"]);

/** `polygit/translate-fr-20261021` */
export function translationBranchName(
  lang: string,
  now = new Date(),
): string {
  const day = now.toISOString().slice(0, 10).replace(/-/g, "");
  const name = `polygit/translate-${lang.trim().toLowerCase()}-${day}`;
  return assertSafeGitBranch(name);
}

export function isProtectedBranch(branch: string): boolean {
  return PROTECTED.has(branch.trim());
}

/** True for `polygit/translate-fr` or `polygit/translate-fr-20261021`. */
export function isTranslationBranchForLang(branch: string, lang: string): boolean {
  const b = branch.trim();
  const code = lang.trim().toLowerCase();
  const prefix = `polygit/translate-${code}`;
  return b === prefix || b.startsWith(`${prefix}-`);
}

export interface EnsureTranslationBranchResult {
  branch: string;
  created: boolean;
  switched: boolean;
}

/**
 * Ensure translation/review work happens off main/master.
 * - Already on a polygit/translate-<lang>* branch → stay
 * - On main/master → create/checkout today's polygit/translate-<lang>-YYYYMMDD
 * - On any other branch → stay (do not hijack the user's feature branch)
 */
export async function ensureTranslationBranch(
  projectRoot: string,
  lang: string,
): Promise<EnsureTranslationBranchResult> {
  const current = await getCurrentBranch(projectRoot);
  if (current === "HEAD") {
    // Empty repo / detached — skip.
    return { branch: current, created: false, switched: false };
  }

  if (isTranslationBranchForLang(current, lang)) {
    return { branch: current, created: false, switched: false };
  }

  if (!isProtectedBranch(current)) {
    console.log(
      `Staying on branch "${current}" (not main/master). ` +
        `Publish will open a PR from this branch when translations are approved.`,
    );
    return { branch: current, created: false, switched: false };
  }

  const target = translationBranchName(lang);
  try {
    await checkoutBranch(projectRoot, target, true);
    console.log(`Created and checked out branch ${target} for ${lang} translation work.`);
    return { branch: target, created: true, switched: true };
  } catch {
    await checkoutBranch(projectRoot, target, false);
    console.log(`Checked out branch ${target} for ${lang} translation work.`);
    return { branch: target, created: false, switched: true };
  }
}

/**
 * Resolve which branch to push for publish.
 * Prefer an explicit --branch, else current polygit/translate-<lang>* branch,
 * else a fresh dated name.
 */
export function resolvePublishSourceBranch(
  lang: string,
  currentBranch: string,
  explicitBranch?: string,
): string {
  if (explicitBranch) return assertSafeGitBranch(explicitBranch);
  if (isTranslationBranchForLang(currentBranch, lang)) {
    return currentBranch;
  }
  return translationBranchName(lang);
}
