import { redactSecrets } from "../connectors/index.js";
import { fetchJson, HttpJsonError } from "../http/fetch-json.js";
import type {
  CreateMergeRequestInput,
  CreateMergeRequestResult,
  ForgeClient,
  ForgeRepoRef,
} from "./types.js";
import { ForgeApiError, ForgeAuthError } from "./types.js";

export function createGitHubClient(
  token = process.env.GITHUB_TOKEN ?? process.env.GH_TOKEN,
  fetchImpl: typeof fetch = fetch,
): ForgeClient {
  if (!token) {
    throw new ForgeAuthError(
      "github",
      "Missing GITHUB_TOKEN (or GH_TOKEN). Set it in your environment or .env file.",
    );
  }

  return {
    kind: "github",

    async createMergeRequest(
      repo: ForgeRepoRef,
      input: CreateMergeRequestInput,
    ): Promise<CreateMergeRequestResult> {
      const apiBase = githubApiBase(repo.host);

      let result;
      try {
        result = await fetchJson<{
          html_url?: string;
          number?: number;
          message?: string;
          errors?: Array<{ message?: string }>;
        }>(`${apiBase}/repos/${repo.owner}/${repo.name}/pulls`, {
          method: "POST",
          headers: {
            accept: "application/vnd.github+json",
            authorization: `Bearer ${token}`,
            "content-type": "application/json",
            "x-github-api-version": "2022-11-28",
          },
          body: JSON.stringify({
            title: input.title,
            head: input.sourceBranch,
            base: input.targetBranch,
            body: input.body,
            draft: Boolean(input.draft),
          }),
          fetchImpl,
        });
      } catch (err) {
        if (err instanceof HttpJsonError) {
          throw new ForgeApiError("github", err.status, redactSecrets(err.message));
        }
        throw err;
      }

      const body = result.data;
      if (result.status === 401 || result.status === 403) {
        throw new ForgeAuthError(
          "github",
          redactSecrets(body.message ?? `HTTP ${result.status}`),
        );
      }
      if (!result.ok || !body.html_url || body.number == null) {
        const detail =
          body.message ??
          body.errors?.map((e) => e.message).filter(Boolean).join("; ") ??
          `HTTP ${result.status}`;
        throw new ForgeApiError("github", result.status, redactSecrets(detail));
      }

      return { url: body.html_url, number: body.number };
    },
  };
}

function githubApiBase(host: string): string {
  assertSafeForgeApiHost(host);
  if (host === "api.github.com") return "https://api.github.com";
  return `https://${host}/api/v3`;
}

function assertSafeForgeApiHost(host: string): void {
  if (
    !host ||
    host.includes("://") ||
    host.includes("/") ||
    host.includes("@") ||
    host.includes("\\") ||
    host.includes(" ")
  ) {
    throw new Error(`Invalid forge API host: ${host}`);
  }
}
