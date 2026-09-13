import { createChatCompletionsProvider } from "./chat-completions.js";
import type { TranslationProvider } from "./provider.js";

/**
 * Local models via Ollama (must be installed and running on the user's machine).
 * @see https://github.com/ollama/ollama/blob/main/docs/api.md
 */
export function createOllamaProvider(): TranslationProvider {
  const host = (process.env.OLLAMA_HOST ?? "http://127.0.0.1:11434").replace(/\/$/, "");
  return createChatCompletionsProvider({
    name: "ollama",
    endpoint: `${host}/v1/chat/completions`,
    model: process.env.POLYGIT_OLLAMA_MODEL ?? "llama3.2",
    label: "Ollama",
    temperature: 0.2,
    timeoutMs: 120_000,
  });
}
