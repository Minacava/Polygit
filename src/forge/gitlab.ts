import { redactSecrets } from "../connectors/index.js";
import type {
  CreateMergeRequestInput,
  CreateMergeRequestResult,
  ForgeClient,
  ForgeRepoRef,
} from "./types.js";
import { ForgeApiError, ForgeAuthError } from "./types.js";

export function createGitLabClient(
  token = process.env.GITLAB_TOKEN ?? process.env.GL_TOKEN,
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
      const apiBase = `https://${repo.host}/api/v4`;
      const projectId = encodeURIComponent(repo.fullPath);

      const response = await fetch(`${apiBase}/projects/${projectId}/merge_requests`, {
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
        signal: AbortSignal.timeout(60_000),
      });

      const body = (await response.json()) as {
        web_url?: string;
        iid?: number;
        message?: string | string[];
        error?: string;
      };

      if (response.status === 401 || response.status === 403) {
        const msg = Array.isArray(body.message)
          ? body.message.join("; ")
          : (body.message ?? body.error ?? response.statusText);
        throw new ForgeAuthError("gitlab", redactSecrets(String(msg)));
      }
      if (!response.ok || !body.web_url || body.iid == null) {
        const msg = Array.isArray(body.message)
          ? body.message.join("; ")
          : (body.message ?? body.error ?? response.statusText);
        throw new ForgeApiError("gitlab", response.status, redactSecrets(String(msg)));
      }

      return { url: body.web_url, number: body.iid };
    },
  };
}
