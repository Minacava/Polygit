import { createClaudeProvider } from "./claude.js";
import { createHuggingFaceProvider } from "./huggingface.js";
import { createOllamaProvider } from "./ollama.js";
import { createOpenAIProvider } from "./openai.js";
import type { ProviderName, TranslationProvider } from "./provider.js";

export interface CreateProviderOptions {
  model?: string;
}

export function createProvider(
  name: ProviderName,
  options: CreateProviderOptions = {},
): TranslationProvider {
  const model = options.model?.trim() || undefined;
  switch (name) {
    case "claude":
      return createClaudeProvider(model ? { model } : {});
    case "openai":
      return createOpenAIProvider(model ? { model } : {});
    case "ollama":
      return createOllamaProvider(model ? { model } : {});
    case "huggingface":
      return createHuggingFaceProvider(model ? { model } : {});
    default: {
      const exhaustive: never = name;
      throw new Error(`Unknown provider: ${String(exhaustive)}`);
    }
  }
}

export type { ProviderName, TranslateContext, TranslationProvider } from "./provider.js";
export {
  buildTranslationMessages,
  isProviderName,
  parseProviderName,
  PROVIDER_NAMES,
  redactSecrets,
} from "./provider.js";
export { createChatCompletionsProvider } from "./chat-completions.js";
export { createClaudeProvider } from "./claude.js";
export { createHuggingFaceProvider } from "./huggingface.js";
export { createOllamaProvider } from "./ollama.js";
export { createOpenAIProvider } from "./openai.js";
export {
  DEFAULT_MODELS,
  envModelKey,
  getEnvModel,
  HUGGINGFACE_CURATED_MODELS,
  resolveModel,
  resolveModelSync,
  type ModelSource,
  type ResolvedModel,
} from "./resolve-model.js";
export {
  formatOllamaModelSize,
  getOllamaHost,
  listOllamaModels,
  type OllamaModelInfo,
} from "./ollama-models.js";
