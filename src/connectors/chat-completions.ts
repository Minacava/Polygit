import { fetchJson, HttpJsonError } from "../http/fetch-json.js";
import {
  buildTranslationMessages,
  redactSecrets,
  sanitizeLlmTranslation,
  type ChatMessage,
  type ProviderName,
  type TranslateContext,
  type TranslationProvider,
} from "./provider.js";

interface ChatCompletionsResponse {
  choices?: Array<{
    message?: { content?: string | null };
    finish_reason?: string | null;
  }>;
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
  fetchImpl?: typeof fetch;
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

  async function complete(messages: ChatMessage[]): Promise<string> {
    const headers: Record<string, string> = { "content-type": "application/json" };
    if (opts.apiKey) {
      headers.authorization = `Bearer ${opts.apiKey}`;
    }

    let result;
    try {
      result = await fetchJson<ChatCompletionsResponse>(opts.endpoint, {
        method: "POST",
        headers,
        body: JSON.stringify({
          model: opts.model,
          temperature,
          messages,
        }),
        timeoutMs,
        ...(opts.fetchImpl ? { fetchImpl: opts.fetchImpl } : {}),
      });
    } catch (err) {
      if (err instanceof HttpJsonError) {
        throw new Error(
          `${opts.label} API error (${err.status}): ${redactSecrets(err.message)}`,
        );
      }
      const msg = err instanceof Error ? err.message : String(err);
      throw new Error(`${opts.label} request failed: ${redactSecrets(msg)}`);
    }

    if (!result.ok) {
      const detail = result.data.error?.message ?? `HTTP ${result.status}`;
      throw new Error(
        `${opts.label} API error (${result.status}): ${redactSecrets(detail)}`,
      );
    }

    const choice = result.data.choices?.[0];
    if (choice?.finish_reason === "length") {
      throw new Error(
        `${opts.label} output truncated (finish_reason=length); segment too long.`,
      );
    }
    const textOut = choice?.message?.content?.trim();
    if (!textOut) {
      throw new Error(`${opts.label} returned an empty response.`);
    }
    return textOut;
  }

  return {
    name: opts.name,

    async translateSegment(
      text: string,
      sourceLang: string,
      targetLang: string,
      context?: TranslateContext,
    ): Promise<string> {
      const raw = await complete(
        buildTranslationMessages(text, sourceLang, targetLang, context),
      );
      return sanitizeLlmTranslation(raw, text);
    },

    complete,
  };
}
