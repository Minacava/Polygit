/**
 * Parse a git remote URL into a forge repo reference.
 * Supports github.com, gitlab.com, and self-hosted gitlab.* hosts.
 */
import type { ForgeKind, ForgeRepoRef } from "./types.js";

export function detectForgeFromRemoteUrl(remoteUrl: string): ForgeRepoRef {
  const normalized = remoteUrl.trim().replace(/\.git$/i, "");

  // git@host:path/to/repo
  const ssh = normalized.match(/^git@([^:]+):(.+)$/);
  if (ssh) {
    return fromHostAndPath(ssh[1]!, ssh[2]!);
  }

  // ssh://git@host/path/to/repo
  const sshUrl = normalized.match(/^ssh:\/\/git@([^/]+)\/(.+)$/);
  if (sshUrl) {
    return fromHostAndPath(sshUrl[1]!, sshUrl[2]!);
  }

  // https://host/path/to/repo
  let url: URL;
  try {
    url = new URL(normalized);
  } catch {
    throw new Error(`Unrecognized git remote URL: ${remoteUrl}`);
  }
  const path = url.pathname.replace(/^\/+/, "");
  return fromHostAndPath(url.host, path);
}

function fromHostAndPath(host: string, repoPath: string): ForgeRepoRef {
  const cleanPath = repoPath.replace(/^\/+|\/+$/g, "");
  const parts = cleanPath.split("/").filter(Boolean);
  if (parts.length < 2) {
    throw new Error(`Remote path must include owner/name: ${repoPath}`);
  }

  const kind = detectKind(host);
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
  // gitlab.com and self-hosted GitLab instances
  return "gitlab";
}
