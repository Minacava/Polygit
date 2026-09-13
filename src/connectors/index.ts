import { createClaudeProvider } from "./claude.js";
import { createHuggingFaceProvider } from "./huggingface.js";
import { createOllamaProvider } from "./ollama.js";
import { createOpenAIProvider } from "./openai.js";
import type { ProviderName, TranslationProvider } from "./provider.js";

export function createProvider(name: ProviderName): TranslationProvider {
  switch (name) {
    case "claude":
      return createClaudeProvider();
    case "openai":
      return createOpenAIProvider();
    case "ollama":
      return createOllamaProvider();
    case "huggingface":
      return createHuggingFaceProvider();
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
