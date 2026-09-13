/**
 * Parse a git remote URL into a forge repo reference.
 * Supports github.com, gitlab.com, and self-hosted gitlab.* hosts.
 */
import type { ForgeKind, ForgeRepoRef } from "./types.js";

export function detectForgeFromRemoteUrl(
  remoteUrl: string,
  forgeOverride?: ForgeKind,
): ForgeRepoRef {
  const normalized = remoteUrl.trim().replace(/\.git$/i, "");

  const ssh = normalized.match(/^git@([^:]+):(.+)$/);
  if (ssh) {
    return fromHostAndPath(ssh[1]!, ssh[2]!, forgeOverride);
  }

  const sshUrl = normalized.match(/^ssh:\/\/git@([^/]+)\/(.+)$/);
  if (sshUrl) {
    return fromHostAndPath(sshUrl[1]!, sshUrl[2]!, forgeOverride);
  }

  let url: URL;
  try {
    url = new URL(normalized);
  } catch {
    throw new Error(`Unrecognized git remote URL: ${remoteUrl}`);
  }
  const path = url.pathname.replace(/^\/+/, "");
  return fromHostAndPath(url.host, path, forgeOverride);
}

function fromHostAndPath(
  host: string,
  repoPath: string,
  forgeOverride?: ForgeKind,
): ForgeRepoRef {
  const cleanPath = repoPath.replace(/^\/+|\/+$/g, "");
  const parts = cleanPath.split("/").filter(Boolean);
  if (parts.length < 2) {
    throw new Error(`Remote path must include owner/name: ${repoPath}`);
  }

  const kind = forgeOverride ?? detectKind(host);
  const name = parts[parts.length - 1]!;
  const owner = parts[0]!;
  const fullPath = parts.join("/");

  if (kind === "github") {
    return {
      kind,
      host: host === "github.com" ? "api.github.com" : host,
      owner,
      name,
      fullPath: `${owner}/${name}`,
      webBase: host.includes("://") ? host : `https://${host}`,
    };
  }

  // GitLab: project path may include subgroups
  const apiHost = host;
  return {
    kind: "gitlab",
    host: apiHost,
    owner,
    name,
    fullPath,
    webBase: host.includes("://") ? host : `https://${host}`,
  };
}

function detectKind(host: string): ForgeKind {
  const h = host.toLowerCase().replace(/^www\./, "");
  if (h === "github.com" || h.endsWith(".github.com")) {
    return "github";
  }
  // GitHub Enterprise Server commonly uses github. as a subdomain label.
  if (h.startsWith("github.") || h.includes(".github.")) {
    return "github";
  }
  if (h === "gitlab.com" || h.endsWith(".gitlab.com") || h.startsWith("gitlab.") || h.includes(".gitlab.")) {
    return "gitlab";
  }
  // Unknown hosts: prefer GitLab API shape only when the hostname looks like GitLab;
  // otherwise require an explicit --forge override from publish.
  throw new Error(
    `Cannot detect forge for host "${host}". Pass --forge=github or --forge=gitlab.`,
  );
}
