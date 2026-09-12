import {
  buildTranslationMessages,
  redactSecrets,
  type TranslateContext,
  type TranslationProvider,
} from "./provider.js";

interface OpenAIResponse {
  choices?: Array<{ message?: { content?: string | null } }>;
  error?: { message?: string };
}

export function createOpenAIProvider(
  apiKey = process.env.OPENAI_API_KEY,
): TranslationProvider {
  if (!apiKey) {
    throw new Error("Missing OPENAI_API_KEY. Set it in your environment or .env file.");
  }

  const key = apiKey;

  return {
    name: "openai",

    async translateSegment(
      text: string,
      sourceLang: string,
      targetLang: string,
      context?: TranslateContext,
    ): Promise<string> {
      const messages = buildTranslationMessages(text, sourceLang, targetLang, context);

      let response: Response;
      try {
        response = await fetch("https://api.openai.com/v1/chat/completions", {
          method: "POST",
          headers: {
            "content-type": "application/json",
            authorization: `Bearer ${key}`,
          },
          body: JSON.stringify({
            model: process.env.POLYGIT_OPENAI_MODEL ?? "gpt-4o-mini",
            temperature: 0.2,
            messages,
          }),
          signal: AbortSignal.timeout(60_000),
        });
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        throw new Error(`OpenAI request failed: ${redactSecrets(msg)}`);
      }

      const body = (await response.json()) as OpenAIResponse;
      if (!response.ok) {
        const detail = body.error?.message ?? response.statusText;
        throw new Error(`OpenAI API error (${response.status}): ${redactSecrets(detail)}`);
      }

      const textOut = body.choices?.[0]?.message?.content?.trim();
      if (!textOut) {
        throw new Error("OpenAI returned an empty translation.");
      }
      return textOut;
    },
  };
}
