import { createChatCompletionsProvider } from "./chat-completions.js";
import type { TranslationProvider } from "./provider.js";
import { getOllamaHost } from "./ollama-models.js";
import { DEFAULT_MODELS } from "./resolve-model.js";

export interface OllamaProviderOptions {
  model?: string;
  host?: string;
}

/**
 * Local models via Ollama (must be installed and running on the user's machine).
 * @see https://github.com/ollama/ollama/blob/main/docs/api.md
 */
export function createOllamaProvider(
  options: OllamaProviderOptions = {},
): TranslationProvider {
  const host = (options.host ?? getOllamaHost()).replace(/\/$/, "");
  const model =
    options.model?.trim() ||
    process.env.POLYGIT_OLLAMA_MODEL?.trim() ||
    DEFAULT_MODELS.ollama;

  return createChatCompletionsProvider({
    name: "ollama",
    endpoint: `${host}/v1/chat/completions`,
    model,
    label: "Ollama",
    temperature: 0.2,
    timeoutMs: 120_000,
  });
}
