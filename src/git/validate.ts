/**
 * Validate git branch names and clone URLs before they reach the git CLI.
 * Rejects option-injection (`-u`, `--upload-pack`) and dangerous helpers (`ext::`, `file:`).
 */

/** Git branch-ish names: no leading dash, no path tricks, limited charset. */
const BRANCH_NAME =
  /^(?!-)(?!.*\.\.)(?!.*@\{)[A-Za-z0-9](?:[A-Za-z0-9._/-]*[A-Za-z0-9])?$/;

export function isValidGitBranchName(value: unknown): value is string {
  if (typeof value !== "string") return false;
  const name = value.trim();
  if (!name || name !== value) return false;
  if (name.endsWith(".lock") || name.endsWith(".")) return false;
  if (name.includes("//") || name.includes("\\")) return false;
  return BRANCH_NAME.test(name);
}

export function assertSafeGitBranch(value: unknown, label = "branch"): string {
  if (!isValidGitBranchName(value)) {
    throw new Error(
      `Invalid ${label} name: ${JSON.stringify(value)}. ` +
        `Use letters, digits, "/", "_", "-", or "."; do not start with "-".`,
    );
  }
  return value;
}

/**
 * Clone URLs must be https://, ssh://, or git@host:path SCP-style.
 * Never allow ext::, file:, or leading dashes (git option injection).
 */
export function assertSafeCloneUrl(url: unknown): string {
  if (typeof url !== "string" || !url.trim()) {
    throw new Error("Clone URL is required.");
  }
  const trimmed = url.trim();
  if (trimmed !== url) {
    throw new Error("Clone URL must not have leading or trailing whitespace.");
  }
  if (trimmed.startsWith("-")) {
    throw new Error(
      `Rejected clone URL starting with "-": ${JSON.stringify(url)}. ` +
        `This can be interpreted as a git option.`,
    );
  }

  const lower = trimmed.toLowerCase();
  if (lower.startsWith("ext::") || lower.includes("ext::")) {
    throw new Error(
      `Rejected clone URL using the ext:: remote helper: ${JSON.stringify(url)}.`,
    );
  }
  if (lower.startsWith("file:") || lower.startsWith("file://")) {
    throw new Error(
      `Rejected file: clone URL: ${JSON.stringify(url)}. Use https://, ssh://, or git@.`,
    );
  }

  // SCP-like: git@host:path/to/repo.git
  if (/^git@[A-Za-z0-9._-]+(?:\.[A-Za-z0-9._-]+)*:[^\s]+$/.test(trimmed)) {
    const pathPart = trimmed.slice(trimmed.indexOf(":") + 1);
    if (pathPart.startsWith("-") || pathPart.includes("ext::")) {
      throw new Error(`Rejected unsafe git@ clone path: ${JSON.stringify(url)}.`);
    }
    return trimmed;
  }

  let parsed: URL;
  try {
    parsed = new URL(trimmed);
  } catch {
    throw new Error(
      `Unrecognized clone URL: ${JSON.stringify(url)}. ` +
        `Use https://, ssh://, or git@host:path.`,
    );
  }

  if (parsed.protocol === "https:" || parsed.protocol === "ssh:") {
    if (!parsed.hostname) {
      throw new Error(`Clone URL is missing a hostname: ${JSON.stringify(url)}.`);
    }
    return trimmed;
  }

  throw new Error(
    `Unsupported clone URL protocol "${parsed.protocol}" in ${JSON.stringify(url)}. ` +
      `Only https://, ssh://, and git@host:path are allowed.`,
  );
}
