import {
  buildTranslationMessages,
  redactSecrets,
  type ProviderName,
  type TranslateContext,
  type TranslationProvider,
} from "./provider.js";

interface ChatCompletionsResponse {
  choices?: Array<{ message?: { content?: string | null } }>;
  error?: { message?: string };
}

export interface ChatCompletionsOptions {
  name: ProviderName;
  /** Full URL to POST chat completions (OpenAI-compatible). */
  endpoint: string;
  model: string;
  apiKey?: string;
  /** Human label for error messages, e.g. "Ollama". */
  label: string;
  temperature?: number;
  timeoutMs?: number;
  missingKeyMessage?: string;
}

/**
 * OpenAI-compatible chat completions (OpenAI, Ollama /v1, Hugging Face router).
 */
export function createChatCompletionsProvider(
  opts: ChatCompletionsOptions,
): TranslationProvider {
  if (opts.missingKeyMessage && !opts.apiKey) {
    throw new Error(opts.missingKeyMessage);
  }

  const temperature = opts.temperature ?? 0.2;
  const timeoutMs = opts.timeoutMs ?? 60_000;

  return {
    name: opts.name,

    async translateSegment(
      text: string,
      sourceLang: string,
      targetLang: string,
      context?: TranslateContext,
    ): Promise<string> {
      const messages = buildTranslationMessages(text, sourceLang, targetLang, context);
      const headers: Record<string, string> = { "content-type": "application/json" };
      if (opts.apiKey) {
        headers.authorization = `Bearer ${opts.apiKey}`;
      }

      let response: Response;
      try {
        response = await fetch(opts.endpoint, {
          method: "POST",
          headers,
          body: JSON.stringify({
            model: opts.model,
            temperature,
            messages,
          }),
          signal: AbortSignal.timeout(timeoutMs),
        });
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        throw new Error(`${opts.label} request failed: ${redactSecrets(msg)}`);
      }

      const body = (await response.json()) as ChatCompletionsResponse;
      if (!response.ok) {
        const detail = body.error?.message ?? response.statusText;
        throw new Error(
          `${opts.label} API error (${response.status}): ${redactSecrets(detail)}`,
        );
      }

      const textOut = body.choices?.[0]?.message?.content?.trim();
      if (!textOut) {
        throw new Error(`${opts.label} returned an empty translation.`);
      }
      return textOut;
    },
  };
}
