import { createGitHubClient } from "./github.js";
import { createGitLabClient } from "./gitlab.js";
import type { ForgeClient, ForgeKind } from "./types.js";

export function createForgeClient(kind: ForgeKind): ForgeClient {
  switch (kind) {
    case "github":
      return createGitHubClient();
    case "gitlab":
      return createGitLabClient();
    default: {
      const exhaustive: never = kind;
      throw new Error(`Unknown forge: ${String(exhaustive)}`);
    }
  }
}

export { detectForgeFromRemoteUrl } from "./detect.js";
export { createGitHubClient } from "./github.js";
export { createGitLabClient } from "./gitlab.js";
export type {
  ForgeClient,
  ForgeKind,
  ForgeRepoRef,
  CreateMergeRequestInput,
  CreateMergeRequestResult,
} from "./types.js";
export { ForgeAuthError, ForgeApiError } from "./types.js";
