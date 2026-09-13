import { createChatCompletionsProvider } from "./chat-completions.js";
import type { TranslationProvider } from "./provider.js";

export function createOpenAIProvider(
  apiKey = process.env.OPENAI_API_KEY,
): TranslationProvider {
  return createChatCompletionsProvider({
    name: "openai",
    endpoint: "https://api.openai.com/v1/chat/completions",
    model: process.env.POLYGIT_OPENAI_MODEL ?? "gpt-4o-mini",
    ...(apiKey ? { apiKey } : {}),
    label: "OpenAI",
    missingKeyMessage:
      "Missing OPENAI_API_KEY. Set it in your environment or .env file.",
    temperature: 0.2,
  });
}
