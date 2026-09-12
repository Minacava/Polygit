import { createClaudeProvider } from "./claude.js";
import { createOpenAIProvider } from "./openai.js";
import type { ProviderName, TranslationProvider } from "./provider.js";

export function createProvider(name: ProviderName): TranslationProvider {
  switch (name) {
    case "claude":
      return createClaudeProvider();
    case "openai":
      return createOpenAIProvider();
    default: {
      const exhaustive: never = name;
      throw new Error(`Unknown provider: ${String(exhaustive)}`);
    }
  }
}

export type { ProviderName, TranslateContext, TranslationProvider } from "./provider.js";
export { buildTranslationMessages, redactSecrets } from "./provider.js";
export { createClaudeProvider } from "./claude.js";
export { createOpenAIProvider } from "./openai.js";
