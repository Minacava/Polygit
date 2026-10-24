import { redactSecrets } from "./provider.js";

export interface OllamaModelInfo {
  name: string;
  size?: number;
  parameterSize?: string;
}

interface TagsResponse {
  models?: Array<{
    name?: string;
    model?: string;
    size?: number;
    details?: { parameter_size?: string };
  }>;
}

export function getOllamaHost(): string {
  let h = (process.env.OLLAMA_HOST ?? "").trim() || "127.0.0.1:11434";
  if (!/^https?:\/\//i.test(h)) h = `http://${h}`;
  h = h.replace("://0.0.0.0", "://127.0.0.1");
  return h.replace(/\/+$/, "");
}

/**
 * List models installed locally via Ollama `GET /api/tags`.
 */
export async function listOllamaModels(
  host = getOllamaHost(),
): Promise<OllamaModelInfo[]> {
  let response: Response;
  try {
    response = await fetch(`${host}/api/tags`, {
      signal: AbortSignal.timeout(10_000),
    });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    throw new Error(
      `Cannot reach Ollama at ${host}. Start it with \`ollama serve\`.\n${redactSecrets(msg)}`,
    );
  }

  if (!response.ok) {
    throw new Error(
      `Ollama returned ${response.status} from ${host}/api/tags. Is \`ollama serve\` running?`,
    );
  }

  const body = (await response.json()) as TagsResponse;
  const models = body.models ?? [];
  return models
    .map((m) => {
      const name = (m.name ?? m.model ?? "").trim();
      if (!name) return null;
      return {
        name,
        ...(typeof m.size === "number" ? { size: m.size } : {}),
        ...(m.details?.parameter_size
          ? { parameterSize: m.details.parameter_size }
          : {}),
      } satisfies OllamaModelInfo;
    })
    .filter((m): m is OllamaModelInfo => m !== null);
}

export function formatOllamaModelSize(bytes?: number): string {
  if (bytes == null || !Number.isFinite(bytes)) return "";
  const gib = bytes / (1024 ** 3);
  if (gib >= 1) return `${gib.toFixed(1)} GB`;
  const mib = bytes / (1024 ** 2);
  return `${mib.toFixed(0)} MB`;
}

/**
 * Ollama `/api/tags` returns tagged names (`llama3.2:latest`) while users often
 * pass the short form (`llama3.2`). Treat untagged ids as matching any tag.
 */
export function ollamaModelMatches(
  requested: string,
  installedName: string,
): boolean {
  const want = requested.trim();
  const have = installedName.trim();
  if (!want || !have) return false;
  if (want === have) return true;
  if (!want.includes(":")) return have.startsWith(`${want}:`);
  if (!have.includes(":")) return want.startsWith(`${have}:`);
  return false;
}

export function isOllamaModelInstalled(
  requested: string,
  installed: ReadonlyArray<Pick<OllamaModelInfo, "name">>,
): boolean {
  return installed.some((m) => ollamaModelMatches(requested, m.name));
}
