export type ForgeKind = "github" | "gitlab";

export interface ForgeRepoRef {
  kind: ForgeKind;
  /** API host, e.g. api.github.com or gitlab.com */
  host: string;
  /** owner/name for GitHub, or URL-encoded path for GitLab */
  owner: string;
  name: string;
  /** Full path with namespace for GitLab (group/subgroup/project) */
  fullPath: string;
  webBase: string;
}

export interface CreateMergeRequestInput {
  sourceBranch: string;
  targetBranch: string;
  title: string;
  body: string;
  draft?: boolean;
}

export interface CreateMergeRequestResult {
  url: string;
  number: number;
}

export interface ForgeClient {
  readonly kind: ForgeKind;
  createMergeRequest(
    repo: ForgeRepoRef,
    input: CreateMergeRequestInput,
  ): Promise<CreateMergeRequestResult>;
}

export class ForgeAuthError extends Error {
  constructor(kind: ForgeKind, message: string) {
    super(`${kind}: ${message}`);
    this.name = "ForgeAuthError";
  }
}

export class ForgeApiError extends Error {
  constructor(
    kind: ForgeKind,
    readonly status: number,
    message: string,
  ) {
    super(`${kind} API ${status}: ${message}`);
    this.name = "ForgeApiError";
  }
}
