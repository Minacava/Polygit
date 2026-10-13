import { redactSecrets } from "../connectors/index.js";
import { fetchJson, HttpJsonError } from "../http/fetch-json.js";
import type {
  CreateMergeRequestInput,
  CreateMergeRequestResult,
  ForgeClient,
  ForgeRepoRef,
} from "./types.js";
import { ForgeApiError, ForgeAuthError } from "./types.js";

export function createGitLabClient(
  token = process.env.GITLAB_TOKEN ?? process.env.GL_TOKEN,
  fetchImpl: typeof fetch = fetch,
): ForgeClient {
  if (!token) {
    throw new ForgeAuthError(
      "gitlab",
      "Missing GITLAB_TOKEN (or GL_TOKEN). Set it in your environment or .env file.",
    );
  }

  return {
    kind: "gitlab",

    async createMergeRequest(
      repo: ForgeRepoRef,
      input: CreateMergeRequestInput,
    ): Promise<CreateMergeRequestResult> {
      const apiBase = gitlabApiBase(repo.host);
      const projectId = encodeURIComponent(repo.fullPath);

      let result;
      try {
        result = await fetchJson<{
          web_url?: string;
          iid?: number;
          message?: string | string[];
          error?: string;
        }>(`${apiBase}/projects/${projectId}/merge_requests`, {
          method: "POST",
          headers: {
            "content-type": "application/json",
            "private-token": token,
          },
          body: JSON.stringify({
            source_branch: input.sourceBranch,
            target_branch: input.targetBranch,
            title: input.draft ? `Draft: ${input.title}` : input.title,
            description: input.body,
          }),
          fetchImpl,
        });
      } catch (err) {
        if (err instanceof HttpJsonError) {
          throw new ForgeApiError("gitlab", err.status, redactSecrets(err.message));
        }
        throw err;
      }

      const body = result.data;
      if (result.status === 401 || result.status === 403) {
        const msg = Array.isArray(body.message)
          ? body.message.join("; ")
          : (body.message ?? body.error ?? `HTTP ${result.status}`);
        throw new ForgeAuthError("gitlab", redactSecrets(String(msg)));
      }
      if (!result.ok || !body.web_url || body.iid == null) {
        const msg = Array.isArray(body.message)
          ? body.message.join("; ")
          : (body.message ?? body.error ?? `HTTP ${result.status}`);
        throw new ForgeApiError("gitlab", result.status, redactSecrets(String(msg)));
      }

      return { url: body.web_url, number: body.iid };
    },
  };
}

function gitlabApiBase(host: string): string {
  assertSafeForgeApiHost(host);
  return `https://${host}/api/v4`;
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
