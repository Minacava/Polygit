/**
 * Parse a git remote URL into a forge repo reference.
 *
 * Automatically trusted API hosts: github.com and gitlab.com only.
 * Other hosts (Enterprise / self-hosted) require --forge plus either
 * confirmation or an allowlisted entry in forgeHosts.
 */
import type { ForgeKind, ForgeRepoRef } from "./types.js";

/** Hosts that may receive forge API tokens without extra confirmation. */
export const TRUSTED_FORGE_HOSTS = ["github.com", "gitlab.com"] as const;

export interface DetectForgeOptions {
  /** Override forge kind (required for non-trusted hosts). */
  forge?: ForgeKind;
  /** Extra hosts allowed to receive API tokens (from .tmconfig.json forgeHosts). */
  allowedHosts?: readonly string[];
  /**
   * Explicit confirmation that a non-trusted host may receive the forge token.
   * Required when the host is not in allowedHosts.
   */
  confirmUntrustedHost?: boolean;
}

export function normalizeForgeHostname(host: string): string {
  const bare = host.trim().toLowerCase().replace(/\.$/, "");
  // Strip brackets from IPv6 literals; drop www. for comparison only.
  const noBrackets = bare.startsWith("[") && bare.endsWith("]") ? bare.slice(1, -1) : bare;
  const withoutWww = noBrackets.replace(/^www\./, "");
  // hostname without port (URL.host may include :port)
  if (withoutWww.startsWith("[")) {
    const end = withoutWww.indexOf("]");
    return end >= 0 ? withoutWww.slice(0, end + 1) : withoutWww;
  }
  const colon = withoutWww.lastIndexOf(":");
  if (colon > -1 && /^\d+$/.test(withoutWww.slice(colon + 1))) {
    return withoutWww.slice(0, colon);
  }
  return withoutWww;
}

export function trustedForgeKindForHost(host: string): ForgeKind | null {
  const h = normalizeForgeHostname(host);
  if (h === "github.com") return "github";
  if (h === "gitlab.com") return "gitlab";
  return null;
}

export function isTrustedForgeHost(host: string): boolean {
  return trustedForgeKindForHost(host) !== null;
}

export function isAllowedForgeHost(
  host: string,
  allowedHosts: readonly string[] = [],
): boolean {
  if (isTrustedForgeHost(host)) return true;
  const normalized = normalizeForgeHostname(host);
  return allowedHosts.some((entry) => normalizeForgeHostname(entry) === normalized);
}

function asDetectOptions(
  forgeOverrideOrOptions?: ForgeKind | DetectForgeOptions,
): DetectForgeOptions {
  if (forgeOverrideOrOptions == null) return {};
  if (typeof forgeOverrideOrOptions === "string") {
    return { forge: forgeOverrideOrOptions };
  }
  return forgeOverrideOrOptions;
}

export function detectForgeFromRemoteUrl(
  remoteUrl: string,
  forgeOverrideOrOptions?: ForgeKind | DetectForgeOptions,
): ForgeRepoRef {
  const options = asDetectOptions(forgeOverrideOrOptions);
  const normalized = remoteUrl.trim().replace(/\.git$/i, "");

  const ssh = normalized.match(/^git@([^:]+):(.+)$/);
  if (ssh) {
    return fromHostAndPath(ssh[1]!, ssh[2]!, options);
  }

  const sshUrl = normalized.match(/^ssh:\/\/git@([^/]+)\/(.+)$/);
  if (sshUrl) {
    return fromHostAndPath(sshUrl[1]!, sshUrl[2]!, options);
  }

  let url: URL;
  try {
    url = new URL(normalized);
  } catch {
    throw new Error(`Unrecognized git remote URL: ${remoteUrl}`);
  }

  if (url.protocol !== "https:") {
    throw new Error(
      `Refusing non-HTTPS remote for forge API use: ${remoteUrl}. Use https:// or an SSH remote.`,
    );
  }

  // Prefer hostname (no port) for trust checks; keep host for API if custom port.
  const path = url.pathname.replace(/^\/+/, "");
  return fromHostAndPath(url.hostname || url.host, path, options, url.port);
}

/** Hostname of a git remote (no credentials). Used before confirming untrusted forges. */
export function peekRemoteHostname(remoteUrl: string): string {
  const normalized = remoteUrl.trim().replace(/\.git$/i, "");
  const ssh = normalized.match(/^git@([^:]+):(.+)$/);
  if (ssh) return normalizeForgeHostname(ssh[1]!);
  const sshUrl = normalized.match(/^ssh:\/\/git@([^/]+)\/(.+)$/);
  if (sshUrl) return normalizeForgeHostname(sshUrl[1]!);
  let url: URL;
  try {
    url = new URL(normalized);
  } catch {
    throw new Error(`Unrecognized git remote URL: ${remoteUrl}`);
  }
  return normalizeForgeHostname(url.hostname || url.host);
}

function fromHostAndPath(
  host: string,
  repoPath: string,
  options: DetectForgeOptions,
  port?: string,
): ForgeRepoRef {
  const cleanPath = repoPath.replace(/^\/+|\/+$/g, "");
  const parts = cleanPath.split("/").filter(Boolean);
  if (parts.length < 2) {
    throw new Error(`Remote path must include owner/name: ${repoPath}`);
  }

  const kind = resolveForgeKind(host, options);
  const name = parts[parts.length - 1]!;
  const owner = parts[0]!;
  const fullPath = parts.join("/");
  const apiHost = buildApiHost(host, kind, port);
  const webHost = port && port !== "443" ? `${normalizeForgeHostname(host)}:${port}` : normalizeForgeHostname(host);

  if (kind === "github") {
    return {
      kind,
      host: apiHost,
      owner,
      name,
      fullPath: `${owner}/${name}`,
      webBase: `https://${webHost === "api.github.com" ? "github.com" : webHost}`,
    };
  }

  return {
    kind: "gitlab",
    host: apiHost,
    owner,
    name,
    fullPath,
    webBase: `https://${webHost}`,
  };
}

function buildApiHost(host: string, kind: ForgeKind, port?: string): string {
  const hostname = normalizeForgeHostname(host);
  if (kind === "github" && hostname === "github.com") {
    return "api.github.com";
  }
  if (port && port !== "443" && port !== "80") {
    return `${hostname}:${port}`;
  }
  return hostname;
}

function resolveForgeKind(host: string, options: DetectForgeOptions): ForgeKind {
  const trusted = trustedForgeKindForHost(host);
  if (trusted) {
    if (options.forge && options.forge !== trusted) {
      // Explicit override on a trusted host still wins (advanced / mislabel cases).
      return options.forge;
    }
    return trusted;
  }

  const allowed = isAllowedForgeHost(host, options.allowedHosts ?? []);
  const confirmed = Boolean(options.confirmUntrustedHost) || allowed;

  if (!options.forge) {
    throw new Error(
      `Cannot detect forge for host "${normalizeForgeHostname(host)}". ` +
        `Only github.com and gitlab.com are trusted automatically. ` +
        `Pass --forge=github|gitlab and confirm the host (or add it to forgeHosts in .tmconfig.json).`,
    );
  }

  if (!confirmed) {
    throw new Error(
      `Refusing to send forge credentials to untrusted host "${normalizeForgeHostname(host)}". ` +
        `Add it to forgeHosts in .tmconfig.json, or pass --confirm-forge-host after verifying the remote.`,
    );
  }

  return options.forge;
}
