export interface FetchJsonOptions {
  method?: string;
  headers?: Record<string, string>;
  body?: string;
  timeoutMs?: number;
  /** Max attempts including the first (default 3). */
  retries?: number;
  /** Base delay for exponential backoff in ms (default 200). */
  retryDelayMs?: number;
  fetchImpl?: typeof fetch;
  /** Injected for tests. */
  sleep?: (ms: number) => Promise<void>;
}

export interface FetchJsonResult<T> {
  ok: boolean;
  status: number;
  data: T;
  bodyText: string;
  headers: Headers;
}

export class HttpJsonError extends Error {
  constructor(
    message: string,
    readonly status: number,
    readonly bodyText: string,
  ) {
    super(message);
    this.name = "HttpJsonError";
  }
}

function shouldRetry(status: number): boolean {
  return status === 429 || status >= 500;
}

async function defaultSleep(ms: number): Promise<void> {
  await new Promise((r) => setTimeout(r, ms));
}

/**
 * fetch + JSON parse with HTML/non-JSON safety and retries on 429/5xx.
 * Non-2xx responses are returned (not thrown) after retries are exhausted,
 * unless the body is non-JSON.
 */
export async function fetchJson<T>(
  url: string,
  options: FetchJsonOptions = {},
): Promise<FetchJsonResult<T>> {
  const fetchImpl = options.fetchImpl ?? fetch;
  const sleep = options.sleep ?? defaultSleep;
  const retries = Math.max(1, options.retries ?? 3);
  const baseDelay = options.retryDelayMs ?? 200;
  const timeoutMs = options.timeoutMs ?? 60_000;

  let lastNetworkError: unknown;
  for (let attempt = 0; attempt < retries; attempt++) {
    let response: Response;
    try {
      const init: RequestInit = {
        method: options.method ?? "GET",
        signal: AbortSignal.timeout(timeoutMs),
      };
      if (options.headers) init.headers = options.headers;
      if (options.body !== undefined) init.body = options.body;
      response = await fetchImpl(url, init);
    } catch (err) {
      lastNetworkError = err;
      if (attempt + 1 >= retries) throw err;
      await sleep(baseDelay * 2 ** attempt);
      continue;
    }

    const bodyText = await response.text();
    if (!response.ok && shouldRetry(response.status) && attempt + 1 < retries) {
      await sleep(baseDelay * 2 ** attempt);
      continue;
    }

    const trimmed = bodyText.trim();
    let data: T;
    if (!trimmed) {
      data = {} as T;
    } else {
      try {
        data = JSON.parse(trimmed) as T;
      } catch {
        throw new HttpJsonError(
          `Expected JSON but received non-JSON body (HTTP ${response.status})`,
          response.status,
          bodyText.slice(0, 500),
        );
      }
    }

    return {
      ok: response.ok,
      status: response.status,
      data,
      bodyText,
      headers: response.headers,
    };
  }

  throw lastNetworkError instanceof Error
    ? lastNetworkError
    : new Error(String(lastNetworkError));
}
