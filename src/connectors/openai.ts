import { createChatCompletionsProvider } from "./chat-completions.js";
import type { TranslationProvider } from "./provider.js";
import { DEFAULT_MODELS } from "./resolve-model.js";

export interface OpenAIProviderOptions {
  apiKey?: string;
  model?: string;
}

export function createOpenAIProvider(
  options: OpenAIProviderOptions = {},
): TranslationProvider {
  const apiKey = options.apiKey ?? process.env.OPENAI_API_KEY;
  const model =
    options.model?.trim() ||
    process.env.POLYGIT_OPENAI_MODEL?.trim() ||
    DEFAULT_MODELS.openai;

  return createChatCompletionsProvider({
    name: "openai",
    endpoint: "https://api.openai.com/v1/chat/completions",
    model,
    ...(apiKey ? { apiKey } : {}),
    label: "OpenAI",
    missingKeyMessage:
      "Missing OPENAI_API_KEY. Set it in your environment or .env file.",
    temperature: 0.2,
  });
}
