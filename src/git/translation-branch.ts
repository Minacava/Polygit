import { assertSafeGitBranch } from "./validate.js";
import { checkoutBranch, getCurrentBranch } from "./git.js";

const PROTECTED = new Set(["main", "master"]);

/**
 * Short work-branch name: `polygit/fr-20261021`.
 * (Legacy form `polygit/translate-fr-YYYYMMDD` is still recognized.)
 */
export function translationBranchName(
  lang: string,
  now = new Date(),
): string {
  const day = now.toISOString().slice(0, 10).replace(/-/g, "");
  const name = `polygit/${lang.trim().toLowerCase()}-${day}`;
  return assertSafeGitBranch(name);
}

export function isProtectedBranch(branch: string): boolean {
  return PROTECTED.has(branch.trim());
}

/**
 * True for current `polygit/<lang>-YYYYMMDD` and legacy
 * `polygit/translate-<lang>` / `polygit/translate-<lang>-YYYYMMDD`.
 */
export function isTranslationBranchForLang(branch: string, lang: string): boolean {
  const b = branch.trim();
  const code = lang.trim().toLowerCase();
  // Require `-YYYYMMDD` so `polygit/fr-…` cannot match unrelated `polygit/fr*`.
  if (new RegExp(`^polygit/${escapeRegex(code)}-\\d{8}$`).test(b)) return true;
  const legacyExact = `polygit/translate-${code}`;
  const legacyPrefix = `polygit/translate-${code}-`;
  return b === legacyExact || b.startsWith(legacyPrefix);
}

function escapeRegex(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

export interface EnsureTranslationBranchResult {
  branch: string;
  created: boolean;
  switched: boolean;
}

/**
 * Ensure translation/review work happens off main/master.
 * - Already on a polygit/<lang>-* (or legacy translate-*) branch → stay
 * - On main/master → create/checkout today's polygit/<lang>-YYYYMMDD
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
 * Prefer an explicit --branch, else current polygit/<lang>-* branch,
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
